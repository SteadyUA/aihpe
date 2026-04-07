import { Body, Delete, Get, JsonController, Param, Post, UseBefore, NotFoundError, BadRequestError, InternalServerError, UploadedFile, UseInterceptor } from 'routing-controllers';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { FilesService } from '../services/session/FilesService';
import { SessionService } from '../services/session/SessionService';
import { ImageService, ImageMetadata } from '../services/image/ImageService';
import { getSessionsDir } from '../utils/pathUtils';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { Service } from 'typedi';
import { Readable } from 'stream';
import { TokenUsageService } from '../services/llm/TokenUsageService';
import { FileResponse, FileStreamResponse, FileResponseHandler } from '../interceptors/FileResponseHandler';
import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';

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
    @IsBoolean()
    isUsed?: boolean;
}

class UpdateStaticFileRequest {
    @IsString()
    content!: string;
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
        private readonly sessionService: SessionService,
        private readonly imageService: ImageService,
        private readonly tokenUsageService: TokenUsageService,
    ) { }

    private mapImageToResponse(metadata: ImageMetadata): GalleryImageResponse {
        return {
            filename: metadata.filename,
            description: metadata.description,
            createdAt: metadata.createdAt,
            model: metadata.model,
            width: metadata.width,
            height: metadata.height,
            isUsed: metadata.isUsed,
        };
    }

    @Post('/api/sessions/:sessionId/:version/files/:filename')
    @UseBefore(AuthMiddleware)
    async updateStaticFile(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Body() body: string | UpdateStaticFileRequest,
    ): Promise<OkResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        let content = '';
        if (typeof body === 'string') {
            content = body;
        } else if (typeof body === 'object' && body !== null) {
            if (typeof body.content === 'string') {
                content = body.content;
            } else {
                // Fallback for cases where filename is the key
                const anyBody = body as any;
                if (typeof anyBody[filename] === 'string') {
                    content = anyBody[filename];
                } else {
                    console.error('[updateStaticFile] Missing content in object body', body);
                    throw new BadRequestError('Missing content');
                }
            }
        } else {
            console.error('[updateStaticFile] Invalid body type', typeof body);
            throw new BadRequestError('Invalid body');
        }

        try {
            await this.filesService.persistSessionFile(
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
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
    ): Promise<string | FileResponse | FileStreamResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        const validFiles = ['index.html', 'styles.css', 'script.js'];
        if (validFiles.includes(filename)) {
            const files = this.filesService.readVersionFiles(sessionId, version);
            if (!files) {
                throw new NotFoundError('Files not found');
            }

            let content = files[filename];
            if (content === undefined) {
                throw new NotFoundError('File content missing');
            }

            if (filename === 'script.js') {
                const basePath = process.env.APP_BASE_PATH || '';
                const header = `const API_BASE = '${basePath}/api/stab';\n`;
                const footer = `\nif (typeof regform !== 'undefined') { window.regform = regform; }`;

                const stream = Readable.from((async function* () {
                    yield header;
                    yield content;
                    yield footer;
                })());

                return new FileStreamResponse(filename, stream);
            }

            // For index.html and styles.css, we return the string directly
            // routing-controllers will handle basic content-types if we are lucky, 
            // but for index.html/styles.css it might return text/plain by default without interceptor help.
            // Actually, we can just use FileResponse if we persisted them to disk, 
            // but if they are in memory (FilesService Cache), we return string.
            // Let's use FileResponse where possible.
        }

        // Validate filename for fallback
        if (!/^[a-zA-Z0-9-_\.]+$/.test(filename)) {
            throw new BadRequestError('Invalid filename');
        }

        // Fallback for other files
        const sessionRoot = getSessionsDir();
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
        const safeVersion = version;
        // SECURITY: Always use path.basename
        const safeFilename = path.basename(filename);
        const filePath = path.join(sessionRoot, safeId, 'versions', String(safeVersion), safeFilename);

        if (!fs.existsSync(filePath)) {
            throw new NotFoundError('File found');
        }

        return new FileResponse(filePath);
    }

    @Get('/api/sessions/:sessionId/:version/images')
    @UseBefore(AuthMiddleware)
    async getImages(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
    ): Promise<GalleryImageResponse[]> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        const images = await this.imageService.listImages(sessionId, version);
        return images.map(img => this.mapImageToResponse(img));
    }

    @Post('/api/sessions/:sessionId/:version/images')
    @UseBefore(AuthMiddleware)
    async uploadGalleryImage(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @UploadedFile('file') file: Express.Multer.File,
        @Body() body: { generateDescription?: string }
    ): Promise<GalleryImageResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        if (!file) {
            throw new BadRequestError('No file provided');
        }

        try {
            const metadata = await this.imageService.saveUploadedImage(sessionId, version, file);

            const generateDescription = body.generateDescription === 'true';
            if (generateDescription) {
                try {
                    const tracker = await this.createTokenTracker(sessionId);
                    const description = await this.imageService.describeImage(sessionId, version, metadata.filename, undefined, tracker);
                    await this.imageService.updateImageDescription(sessionId, version, metadata.filename, description);
                    metadata.description = description;
                } catch (descError) {
                    console.error('Failed to generate description during upload', descError);
                }
            }

            return this.mapImageToResponse(metadata);
        } catch (error) {
            console.error('Failed to save uploaded image', error);
            throw new InternalServerError('Failed to save image');
        }
    }

    @Delete('/api/sessions/:sessionId/:version/images/:filename')
    @UseBefore(AuthMiddleware)
    async deleteImage(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
    ): Promise<OkResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        try {
            await this.imageService.deleteImage(sessionId, version, filename);
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

    @Post('/api/sessions/:sessionId/:version/images/:filename/description')
    @UseBefore(AuthMiddleware)
    async updateImageDescription(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
        @Body() body: UpdateDescriptionRequest,
    ): Promise<OkResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        try {
            await this.imageService.updateImageDescription(sessionId, version, filename, body.description);
            return { message: 'Description updated' };
        } catch (error: any) {
            console.error('Failed to update image description', error);
            if (error.message.includes('not found')) {
                throw new NotFoundError(error.message);
            }
            throw new InternalServerError('Failed to update image description');
        }
    }

    @Get('/api/sessions/:sessionId/:version/images/:filename/describe')
    @UseBefore(AuthMiddleware)
    async generateImageDescription(
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
        @Param('filename') filename: string,
    ): Promise<DescriptionResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        try {
            const tracker = await this.createTokenTracker(sessionId);
            const description = await this.imageService.describeImage(sessionId, version, filename, undefined, tracker);
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
        @Param('sessionId') sessionId: string,
        @Param('version') versionParam: string,
    ): Promise<FileStreamResponse> {
        const version = parseInt(versionParam, 10);
        if (isNaN(version) || version < 0) {
            throw new BadRequestError('Invalid version');
        }

        // Get code files
        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) {
            throw new NotFoundError('Session not found');
        }
        const files = this.filesService.readVersionFiles(sessionId, version);
        if (!files) {
            throw new NotFoundError('Files for the specified turn not found');
        }

        const safeId = sessionId?.replace(/[^a-zA-Z0-9-_]/g, '_') || 'session';
        const archive = archiver('zip', { zlib: { level: 9 } });

        // Add code files
        for (const [filename, content] of Object.entries(files)) {
            archive.append(content, { name: filename });
        }

        // Add images
        try {
            const images = await this.imageService.listImages(sessionId, version);
            const sessionRoot = getSessionsDir();
            const safeVersion = version;

            const versionDir = path.join(
                sessionRoot,
                safeId,
                'versions',
                String(safeVersion)
            );

            for (const img of images) {
                const imgPath = path.join(versionDir, img.filename);
                if (fs.existsSync(imgPath)) {
                    archive.file(imgPath, { name: img.filename });
                }
            }
        } catch (imageError) {
            console.warn('Failed to add images to archive', imageError);
        }

        void archive.finalize();

        const downloadFilename = `session-${safeId}-v${version}.zip`;
        // Since FileStreamResponse expectation is a ReadStream from fs, but archiver is a stream as well, 
        // we might need to cast or adjust. archiver is a Transform stream which is a Writable/Readable combo.
        return new FileStreamResponse(downloadFilename, archive as any, downloadFilename);
    }

    private async createTokenTracker(sessionId: string) {
        // Fetch session to getKey info
        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);

        return async (usage: { prompt: number, completion: number, total: number, model: string }) => {
            const currentTurn = session.lastTurn || 0;
            // Maybe increment turn? Or attach to current turn? 
            // In ChatService we attached to the turn being generated. 
            // Here we are outside of a chat turn generation flow (it's a manual upload or manual describe trigger).
            // Attaching to currentTurn is probably safest.

            await this.tokenUsageService.saveUsage({
                projectId: session.projectId,
                sessionId: sessionId,
                agent: 'image',
                turn: currentTurn,
                model: usage.model,
                prompt: usage.prompt,
                completion: usage.completion,
                total: usage.total,
            });
        };
    }
}
