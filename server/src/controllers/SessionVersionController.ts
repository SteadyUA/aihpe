import { Body, Delete, Get, JsonController, Params, Post, UseBefore, NotFoundError, BadRequestError, InternalServerError, UploadedFile, UseInterceptor } from 'routing-controllers';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { ImmutableCacheMiddleware } from '../middlewares/ImmutableCacheMiddleware';
import { Type } from 'class-transformer';
import { FilesService } from '../services/session/FilesService';
import { SessionResourceService, ResourceMetadata } from '../services/session/SessionResourceService';
import { MemoryService } from '../services/session/MemoryService';
import archiver from 'archiver';
import { Service } from 'typedi';
import { Readable } from 'stream';
import { FileResponse, FileStreamResponse, FileResponseHandler } from '../interceptors/FileResponseHandler';
import { IsString, IsNumber, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { resolveInternalUrl } from '../utils/url';
import express from 'express';

class SessionVersionParams {
    @IsString()
    sessionId!: string;

    @Type(() => Number)
    @IsInt({ message: 'Invalid version' })
    @Min(0, { message: 'Invalid version' })
    version!: number;
}

class SessionVersionFileParams extends SessionVersionParams {
    @IsString()
    filename!: string;
}

class ResourceResponse {
    @IsString()
    filename!: string;

    @IsString()
    mimetype!: string;

    @IsString()
    description!: string;

    @IsString()
    createdAt!: string;

    @IsString()
    model!: string;

    @IsOptional()
    @IsNumber()
    width?: number;

    @IsOptional()
    @IsNumber()
    height?: number;

    @IsOptional()
    @IsNumber()
    duration?: number;

    @IsOptional()
    @IsString()
    fontFamily?: string;

    @IsOptional()
    @IsBoolean()
    isUsed?: boolean;
}

class GalleryImageResponse {
    @IsString()
    filename!: string;

    @IsString()
    description!: string;

    @IsString()
    createdAt!: string;

    @IsString()
    model!: string;

    @IsOptional()
    @IsNumber()
    width?: number;

    @IsOptional()
    @IsNumber()
    height?: number;

    @IsOptional()
    @IsNumber()
    duration?: number;

    @IsOptional()
    @IsString()
    fontFamily?: string;

    @IsOptional()
    @IsBoolean()
    isUsed?: boolean;
}

class UpdateDescriptionRequest {
    @IsString()
    description!: string;
}

class DescriptionResponse {
    @IsString()
    description!: string;
}

class OkResponse {
    @IsString()
    message!: string;
}

@Service()
@JsonController()
export class SessionVersionController {
    constructor(
        private readonly filesService: FilesService,
        private readonly resourceService: SessionResourceService,
        private readonly memoryService: MemoryService,
    ) { }

    private mapImageToResponse(metadata: ResourceMetadata): GalleryImageResponse {
        return {
            filename: metadata.filename,
            description: metadata.description || '',
            createdAt: metadata.createdAt,
            model: metadata.model || 'unknown',
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
            fontFamily: metadata.fontFamily,
            isUsed: metadata.isUsed,
        };
    }

    private mapResourceToResponse(metadata: ResourceMetadata): ResourceResponse {
        return {
            filename: metadata.filename,
            mimetype: metadata.mimetype || 'application/octet-stream',
            description: metadata.description || '',
            createdAt: metadata.createdAt,
            model: metadata.model || 'unknown',
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
            fontFamily: metadata.fontFamily,
            isUsed: metadata.isUsed,
        };
    }

    @Post('/api/sessions/:sessionId/:version/files/:filename')
    @UseBefore(AuthMiddleware)
    @UseBefore(express.text({ type: '*/*', limit: '50mb' }))
    async updateStaticFile(
        @Params() params: SessionVersionFileParams,
        @Body() body: string,
    ): Promise<OkResponse> {
        const { sessionId, version, filename } = params;

        if (typeof body !== 'string') {
            console.error('[updateStaticFile] Invalid body type', typeof body);
            throw new BadRequestError('Invalid body: expected a plain text string');
        }

        const content = body;

        try {
            await this.filesService.writeVersionFile(
                sessionId,
                version,
                filename,
                content
            );
            return { message: 'OK' };
        } catch (error: any) {
            console.error('Failed to update file', error);
            throw new InternalServerError('Failed to update file');
        }
    }

    @Get('/api/sessions/:sessionId/:version/files/:filename')
    @UseInterceptor(FileResponseHandler)
    async getFile(
        @Params() params: SessionVersionFileParams,
    ): Promise<string | FileResponse | FileStreamResponse> {
        const { sessionId, version, filename } = params;

        const stream = this.filesService.getVersionFileStream(sessionId, version, filename);

        if (!stream) {
            throw new NotFoundError('File not found');
        }

        if (filename === 'script.js') {
            const basePath = process.env.APP_BASE_PATH || '';
            const header = `const API_BASE = '${basePath}/api/stab';\n`;
            const footer = `\nif (typeof regform !== 'undefined') { window.regform = regform; }
document.querySelectorAll('form').forEach(form => {
    const action = form.getAttribute('action');
    if (action && action.startsWith('/')) {
        form.action = API_BASE + action;
    }
});`;

            const modifiedStream = Readable.from((async function* () {
                yield header;
                for await (const chunk of stream) {
                    yield chunk;
                }
                yield footer;
            })());

            return new FileStreamResponse(filename, modifiedStream);
        }

        return new FileStreamResponse(filename, stream);
    }

    @Get('/api/sessions/:sessionId/:version/resources')
    @UseBefore(AuthMiddleware)
    async getResources(
        @Params() params: SessionVersionParams,
    ): Promise<ResourceResponse[]> {
        const { sessionId, version } = params;
        const resources = await this.resourceService.listResources(sessionId, version);
        return resources.map(res => this.mapResourceToResponse(res));
    }

    @Get('/api/sessions/:sessionId/:version/images')
    @UseBefore(AuthMiddleware)
    async getImages(
        @Params() params: SessionVersionParams,
    ): Promise<GalleryImageResponse[]> {
        const { sessionId, version } = params;

        const images = await this.resourceService.listImages(sessionId, version);
        return images.map(img => this.mapImageToResponse(img));
    }

    @Post('/api/sessions/:sessionId/:version/resources')
    @UseBefore(AuthMiddleware)
    async uploadResource(
        @Params() params: SessionVersionParams,
        @UploadedFile('file') file: Express.Multer.File,
        @Body() body: { generateDescription?: string }
    ): Promise<ResourceResponse> {
        const { sessionId, version } = params;

        if (!file) {
            throw new BadRequestError('No file provided');
        }

        try {
            const metadata = await this.resourceService.saveUploadedFile(sessionId, version, file);

            const generateDescription = body.generateDescription === 'true';
            if (generateDescription) {
                try {
                    const description = await this.resourceService.describeResource(sessionId, version, metadata.filename, undefined);
                    await this.resourceService.updateResourceDescription(sessionId, version, metadata.filename, description);
                    metadata.description = description;
                } catch (descError) {
                    console.error('Failed to generate description during upload', descError);
                }
            }

            return this.mapResourceToResponse(metadata);
        } catch (error) {
            console.error('Failed to save uploaded file', error);
            throw new InternalServerError('Failed to save file');
        }
    }

    @Delete('/api/sessions/:sessionId/:version/resources/:filename')
    @UseBefore(AuthMiddleware)
    async deleteResource(
        @Params() params: SessionVersionFileParams,
    ): Promise<OkResponse> {
        const { sessionId, version, filename } = params;

        try {
            await this.resourceService.deleteResource(sessionId, version, filename);
            return { message: 'Image deleted' };
        } catch (error: any) {
            console.error('Failed to delete image', error);
            if (error.message.includes('not found')) {
                throw new NotFoundError(error.message);
            }
            if (error.message.includes('used')) {
                throw new BadRequestError(error.message);
            }
            throw new InternalServerError('Failed to delete image');
        }
    }

    @Get('/api/sessions/:sessionId/:version/resources/:filename/thumbnail')
    @UseBefore(ImmutableCacheMiddleware)
    @UseInterceptor(FileResponseHandler)
    async getResourceThumbnail(
        @Params() params: SessionVersionFileParams,
    ): Promise<FileStreamResponse | FileResponse | any> {
        const { sessionId, version, filename } = params;

        const thumbnailFilename = `.thumbnail/${filename}.png`;
        const thumbnailStream = this.filesService.getVersionFileStream(sessionId, version, thumbnailFilename);

        if (thumbnailStream) {
            return new FileStreamResponse(thumbnailFilename, thumbnailStream);
        }

        if (!this.filesService.versionFileExists(sessionId, version, filename)) {
            throw new NotFoundError('Original resource not found');
        }

        const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://screenshot:3001';
        const targetUrl = `file://sessions/${sessionId}/versions/${version}/${filename}`;

        try {
            const response = await fetch(`${screenshotServiceUrl}/thumbnail?url=${encodeURIComponent(targetUrl)}&size=250`);

            if (!response.ok) {
                throw new Error(`Screenshot service returned ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            this.filesService.writeVersionFile(sessionId, version, thumbnailFilename, buffer);

            const newStream = this.filesService.getVersionFileStream(sessionId, version, thumbnailFilename);
            if (!newStream) {
                throw new Error('Failed to read saved thumbnail');
            }

            return new FileStreamResponse(thumbnailFilename, newStream);
        } catch (error: any) {
            console.error('Failed to generate thumbnail:', error);
            throw new InternalServerError('Failed to generate thumbnail');
        }
    }

    @Post('/api/sessions/:sessionId/:version/resources/:filename/description')
    @UseBefore(AuthMiddleware)
    async updateResourceDescription(
        @Params() params: SessionVersionFileParams,
        @Body() body: UpdateDescriptionRequest,
    ): Promise<OkResponse> {
        const { sessionId, version, filename } = params;

        try {
            await this.resourceService.updateResourceDescription(sessionId, version, filename, body.description);
            return { message: 'Description updated' };
        } catch (error: any) {
            console.error('Failed to update image description', error);
            if (error.message.includes('not found')) {
                throw new NotFoundError(error.message);
            }
            throw new InternalServerError('Failed to update image description');
        }
    }

    @Get('/api/sessions/:sessionId/:version/resources/:filename/describe')
    @UseBefore(AuthMiddleware)
    async generateResourceDescription(
        @Params() params: SessionVersionFileParams,
    ): Promise<DescriptionResponse> {
        const { sessionId, version, filename } = params;

        try {
            const description = await this.resourceService.describeResource(sessionId, version, filename, undefined);
            return { description };
        } catch (error: any) {
            console.error('Failed to generate image description', error);
            if (error.message.includes('not found')) {
                throw new NotFoundError(error.message);
            }
            throw new InternalServerError(`Failed to generate image description: ${error.message}`);
        }
    }

    @Get('/api/sessions/:sessionId/:version/archive')
    @UseBefore(AuthMiddleware)
    @UseInterceptor(FileResponseHandler)
    async downloadArchive(
        @Params() params: SessionVersionParams,
    ): Promise<FileStreamResponse> {
        const { sessionId, version } = params;

        const physicalFiles = this.filesService.listVersionFiles(sessionId, version);
        if (physicalFiles.length === 0 && version > 0) {
            throw new NotFoundError('Files for the specified turn not found');
        }

        const archive = archiver('zip', { zlib: { level: 9 } });

        for (const filename of physicalFiles) {
            const stream = this.filesService.getVersionFileStream(sessionId, version, filename);
            if (stream) {
                archive.append(stream, { name: filename });
            }
        }

        void archive.finalize();

        const downloadFilename = `session-${sessionId}-v${version}.zip`;
        // Since FileStreamResponse expectation is a ReadStream from fs, but archiver is a stream as well, 
        // we might need to cast or adjust. archiver is a Transform stream which is a Writable/Readable combo.
        return new FileStreamResponse(downloadFilename, archive as any, downloadFilename);
    }

    @Get('/api/sessions/:sessionId/:version/memory')
    @UseBefore(AuthMiddleware)
    async getMemoryContext(
        @Params() params: SessionVersionParams,
    ): Promise<{ memory: string }> {
        const { sessionId, version } = params;
        const memory = await this.memoryService.getMemoryContext(sessionId, version);
        return { memory };
    }

    @Post('/api/sessions/:sessionId/:version/screenshot')
    @UseBefore(express.urlencoded({ extended: true, limit: '50mb' }))
    @UseBefore(express.json({ limit: '50mb' }))
    @UseInterceptor(FileResponseHandler)
    async postScreenshot(
        @Params() params: SessionVersionParams,
        @Body() body: any,
    ): Promise<FileStreamResponse> {
        const { sessionId, version } = params;

        if (!this.filesService.versionFileExists(sessionId, version, 'index.html')) {
            throw new NotFoundError('index.html not found');
        }

        const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://screenshot:3001';
        const serverInternalUrl = await resolveInternalUrl(process.env.SERVER_INTERNAL_URL || 'http://app:5000');
        const basePath = process.env.APP_BASE_PATH || '';
        const targetUrl = `${serverInternalUrl}${basePath}/api/sessions/${sessionId}/${version}/files/index.html`;

        const payload = {
            url: targetUrl,
            html: body?.html,
            viewportWidth: body?.width ? parseInt(body.width) : undefined,
            viewportHeight: body?.height ? parseInt(body.height) : undefined,
            scrollY: body?.scrollY ? parseInt(body.scrollY) : undefined
        };

        const url = `${screenshotServiceUrl}/screenshot`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Screenshot service returned ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const stream = Readable.from(buffer);

            return new FileStreamResponse('screenshot.png', stream);
        } catch (error: any) {
            console.error('Failed to generate screenshot:', error);
            throw new InternalServerError('Failed to generate screenshot');
        }
    }

    @Get('/api/sessions/:sessionId/:version/preview')
    @UseBefore(ImmutableCacheMiddleware)
    @UseInterceptor(FileResponseHandler)
    async getSessionPreview(
        @Params() params: SessionVersionParams,
    ): Promise<FileStreamResponse> {
        const { sessionId, version } = params;

        let stream = this.filesService.getVersionFileStream(sessionId, version, '.preview.png');

        if (stream) {
            return new FileStreamResponse('.preview.png', stream);
        }

        if (!this.filesService.versionFileExists(sessionId, version, 'index.html')) {
            throw new NotFoundError('index.html not found');
        }

        const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://screenshot:3001';
        const serverInternalUrl = await resolveInternalUrl(process.env.SERVER_INTERNAL_URL || 'http://app:5000');
        const basePath = process.env.APP_BASE_PATH || '';
        const targetUrl = `${serverInternalUrl}${basePath}/api/sessions/${sessionId}/${version}/files/index.html`;

        const payload = {
            url: targetUrl,
            viewportWidth: 430,
            viewportHeight: 932
        };

        const url = `${screenshotServiceUrl}/screenshot`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Screenshot service returned ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            this.filesService.writeVersionFile(sessionId, version, '.preview.png', buffer);

            const savedStream = this.filesService.getVersionFileStream(sessionId, version, '.preview.png');
            if (!savedStream) {
                throw new InternalServerError('Failed to read saved preview');
            }

            return new FileStreamResponse('.preview.png', savedStream);
        } catch (error: any) {
            console.error('Failed to generate session preview:', error);
            throw new InternalServerError('Failed to generate session preview');
        }
    }
}
