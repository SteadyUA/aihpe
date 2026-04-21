import { Body, Delete, Get, JsonController, Param, Params, Post, UseBefore, NotFoundError, BadRequestError, InternalServerError, UploadedFile, UseInterceptor } from 'routing-controllers';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { Type } from 'class-transformer';
import { FilesService } from '../services/session/FilesService';
import { ImageService, ImageMetadata } from '../services/image/ImageService';
import archiver from 'archiver';
import { Service } from 'typedi';
import { Readable } from 'stream';
import { FileResponse, FileStreamResponse, FileResponseHandler } from '../interceptors/FileResponseHandler';
import { IsString, IsNumber, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

class SessionVersionParams {
    @IsString()
    sessionId!: string;

    @Type(() => Number)
    @IsInt({ message: 'Invalid version' })
    @Min(0, { message: 'Invalid version' })
    version!: number;
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
        private readonly imageService: ImageService,
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
        @Params() params: SessionVersionParams,
        @Param('filename') filename: string,
        @Body() body: any,
    ): Promise<OkResponse> {
        const { sessionId, version } = params;

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
        @Params() params: SessionVersionParams,
        @Param('filename') filename: string,
    ): Promise<string | FileResponse | FileStreamResponse> {
        const { sessionId, version } = params;

        const stream = this.filesService.getVersionFileStream(sessionId, version, filename);

        if (!stream) {
            throw new NotFoundError('File not found');
        }

        if (filename === 'script.js') {
            const basePath = process.env.APP_BASE_PATH || '';
            const header = `const API_BASE = '${basePath}/api/stab';\n`;
            const footer = `\nif (typeof regform !== 'undefined') { window.regform = regform; }`;

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

    @Get('/api/sessions/:sessionId/:version/images')
    @UseBefore(AuthMiddleware)
    async getImages(
        @Params() params: SessionVersionParams,
    ): Promise<GalleryImageResponse[]> {
        const { sessionId, version } = params;

        const images = await this.imageService.listImages(sessionId, version);
        return images.map(img => this.mapImageToResponse(img));
    }

    @Post('/api/sessions/:sessionId/:version/images')
    @UseBefore(AuthMiddleware)
    async uploadGalleryImage(
        @Params() params: SessionVersionParams,
        @UploadedFile('file') file: Express.Multer.File,
        @Body() body: { generateDescription?: string }
    ): Promise<GalleryImageResponse> {
        const { sessionId, version } = params;

        if (!file) {
            throw new BadRequestError('No file provided');
        }

        try {
            const metadata = await this.imageService.saveUploadedImage(sessionId, version, file);

            const generateDescription = body.generateDescription === 'true';
            if (generateDescription) {
                try {
                    const description = await this.imageService.describeImage(sessionId, version, metadata.filename, undefined);
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
        @Params() params: SessionVersionParams,
        @Param('filename') filename: string,
    ): Promise<OkResponse> {
        const { sessionId, version } = params;

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
        @Params() params: SessionVersionParams,
        @Param('filename') filename: string,
        @Body() body: UpdateDescriptionRequest,
    ): Promise<OkResponse> {
        const { sessionId, version } = params;

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
        @Params() params: SessionVersionParams,
        @Param('filename') filename: string,
    ): Promise<DescriptionResponse> {
        const { sessionId, version } = params;

        try {
            const description = await this.imageService.describeImage(sessionId, version, filename, undefined);
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

}
