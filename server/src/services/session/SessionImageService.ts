import { Service, Inject } from 'typedi';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { AppDataSource } from '../../data-source';
import { SessionImage } from '../../entities/SessionImage';
import { FilesService } from './FilesService';
import { EventBus } from '../../utils/bus';
import { MoreThan, LessThanOrEqual } from 'typeorm';
import { LlmImageServiceFactory } from '../llm/image/LlmImageServiceFactory';
import { LlmImageService } from '../llm/image/LlmImageService';

export const ImageTokenUsedEvent = EventBus.createEvent<{
    sessionId: string;
    agent: string;
    model: string;
    prompt: number;
    completion: number;
    total: number;
}>('IMAGE_TOKEN_USED');

export interface ImageMetadata {
    filename: string;
    description: string;
    createdAt: string;
    model: string;
    width?: number;
    height?: number;
    isUsed?: boolean;
}

@Service()
export class SessionImageService {
    protected readonly repository = AppDataSource.getRepository(SessionImage);
    private llmImageService: LlmImageService;

    @Inject()
    protected readonly eventBus!: EventBus;

    constructor(
        private readonly filesService: FilesService,
        private readonly llmImageServiceFactory: LlmImageServiceFactory
    ) {
        this.llmImageService = this.llmImageServiceFactory.create();
    }

    async generateAndSave(sessionId: string, description: string, version: number, targetFilename: string | undefined, abortSignal: AbortSignal | undefined): Promise<string> {
        const result = await this.llmImageService.generateRaw(description, abortSignal);
        const base64Data = result.base64;

        if (result.usage) {
            this.eventBus.publish(ImageTokenUsedEvent({
                sessionId,
                agent: result.usage.agent,
                model: result.usage.model,
                prompt: result.usage.prompt,
                completion: result.usage.completion,
                total: result.usage.total,
            }));
        }

        const uuid = randomUUID();
        const filename = targetFilename || `${uuid}.png`;

        const buffer = Buffer.from(base64Data, 'base64');
        this.filesService.writeVersionFile(sessionId, version, filename, buffer);

        // Calculate dimensions
        let width, height;
        try {
            const dimensions = imageSize(buffer);
            width = dimensions.width;
            height = dimensions.height;
        } catch (e) {
            console.warn('Failed to calculate image dimensions', e);
        }

        // Save metadata
        await this.saveMetadata(sessionId, version, {
            filename,
            description,
            createdAt: new Date().toISOString(),
            model: this.llmImageService.modelId,
            width,
            height,
            isUsed: false,
        });

        return filename;
    }

    async editAndSave(sessionId: string, filename: string, prompt: string, sourceVersion: number, targetVersion: number, abortSignal: AbortSignal | undefined): Promise<string> {
        let versionToRead = targetVersion;
        if (!this.filesService.versionFileExists(sessionId, targetVersion, filename)) {
            // Fallback to source version
            versionToRead = sourceVersion;
        }

        const buffer = this.filesService.readVersionFileBuffer(sessionId, versionToRead, filename);
        if (!buffer) {
            throw new Error(`Source image not found: ${filename}`);
        }
        const mimeType = this.getMimeType(filename);

        // Get current description
        const info = await this.getImageInfo(sessionId, sourceVersion, filename);
        const currentDescription = info?.description;

        const result = await this.llmImageService.editRaw(buffer, mimeType, prompt, currentDescription, abortSignal);
        const newBase64Data = result.base64;
        const newDescription = result.description;

        if (result.usage) {
            this.eventBus.publish(ImageTokenUsedEvent({
                sessionId,
                agent: result.usage.agent,
                model: result.usage.model,
                prompt: result.usage.prompt,
                completion: result.usage.completion,
                total: result.usage.total,
            }));
        }

        // We overwrite the file in the target version location with the same filename
        const newBuffer = Buffer.from(newBase64Data, 'base64');
        this.filesService.writeVersionFile(sessionId, targetVersion, filename, newBuffer);

        // Calculate dimensions of new image
        let width, height;
        try {
            const dimensions = imageSize(newBuffer);
            width = dimensions.width;
            height = dimensions.height;
        } catch (e) {
            console.warn('Failed to calculate new image dimensions', e);
        }

        // Save metadata
        await this.saveMetadata(sessionId, targetVersion, {
            filename,
            description: newDescription || prompt,
            createdAt: new Date().toISOString(),
            model: this.llmImageService.modelId,
            width,
            height,
            isUsed: true,
        });

        return filename;
    }

    async describeImage(sessionId: string, version: number, filename: string, abortSignal?: AbortSignal): Promise<string> {
        const buffer = this.filesService.readVersionFileBuffer(sessionId, version, filename);

        if (!buffer) {
            throw new Error(`Image file not found: ${filename}`);
        }
        const mimeType = this.getMimeType(filename);

        const result = await this.llmImageService.describeRaw(buffer, mimeType, abortSignal);

        if (result.usage) {
            this.eventBus.publish(ImageTokenUsedEvent({
                sessionId,
                agent: result.usage.agent,
                model: result.usage.model,
                prompt: result.usage.prompt,
                completion: result.usage.completion,
                total: result.usage.total,
            }));
        }

        return result.description;
    }

    async saveUploadedImage(sessionId: string, version: number, file: Express.Multer.File, preserveFilename = false): Promise<ImageMetadata> {
        const uuid = randomUUID();
        const ext = path.extname(file.originalname);
        const filename = preserveFilename ? file.originalname : `${uuid}${ext}`;

        // Copy file from temp location or write buffer
        if (file.path) {
            this.filesService.copyFileToVersion(sessionId, version, filename, file.path);
        } else if (file.buffer) {
            this.filesService.writeVersionFile(sessionId, version, filename, file.buffer);
        } else {
            throw new Error('No file content found');
        }

        // Calculate dimensions
        let width, height;
        try {
            const buffer = this.filesService.readVersionFileBuffer(sessionId, version, filename);
            if (buffer) {
                const dimensions = imageSize(buffer);
                width = dimensions.width;
                height = dimensions.height;
            }
        } catch (e) {
            console.warn('Failed to calculate image dimensions', e);
        }

        const metadata: ImageMetadata = {
            filename,
            description: '', // Empty description
            createdAt: new Date().toISOString(),
            model: 'user-upload',
            width,
            height,
            isUsed: false,
        };

        await this.saveMetadata(sessionId, version, metadata);

        return metadata;
    }

    // Shared Helper Methods

    private getMimeType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        switch (ext) {
            case '.png': return 'image/png';
            case '.jpg':
            case '.jpeg': return 'image/jpeg';
            case '.webp': return 'image/webp';
            case '.heic': return 'image/heic';
            case '.heif': return 'image/heif';
            default: return 'image/png';
        }
    }

    async updateImageDescription(sessionId: string, version: number, filename: string, newDescription: string): Promise<void> {
        const image = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (!image) {
            throw new Error(`Image ${filename} not found in session ${sessionId} version ${version}`);
        }
        image.description = newDescription;
        await this.repository.save(image);
    }

    async listImages(sessionId: string, version: number): Promise<ImageMetadata[]> {
        const images = await this.repository.find({ where: { sessionId, version } });
        return images.map(img => ({
            filename: img.filename,
            description: img.description,
            createdAt: img.createdAt.toISOString(),
            model: img.model,
            width: img.width,
            height: img.height,
            isUsed: img.isUsed
        }));
    }

    async getImageInfo(sessionId: string, version: number, filename: string): Promise<ImageMetadata | undefined> {
        const img = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (!img) return undefined;
        return {
            filename: img.filename,
            description: img.description,
            createdAt: img.createdAt.toISOString(),
            model: img.model,
            width: img.width,
            height: img.height,
            isUsed: img.isUsed
        };
    }

    async updateImagesUsage(sessionId: string, version: number): Promise<void> {
        const images = await this.repository.find({ where: { sessionId, version } });
        if (images.length === 0) return;

        const htmlContent = this.filesService.readVersionFile(sessionId, version, 'index.html');
        const cssContent = this.filesService.readVersionFile(sessionId, version, 'styles.css');
        const jsContent = this.filesService.readVersionFile(sessionId, version, 'script.js');

        const updates = [];
        for (const img of images) {
            const isUsed = htmlContent?.includes(img.filename) || cssContent?.includes(img.filename) || jsContent?.includes(img.filename) || false;
            if (img.isUsed !== isUsed) {
                img.isUsed = isUsed;
                updates.push(img);
            }
        }

        if (updates.length > 0) {
            await this.repository.save(updates);
        }
    }

    async deleteImage(sessionId: string, version: number, filename: string): Promise<void> {
        const image = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (image && image.isUsed) {
            throw new Error(`Cannot delete used image ${filename}`);
        }

        // Delete file
        try {
            this.filesService.deleteVersionFile(sessionId, version, filename);
        } catch (e) {
            console.error(`Failed to delete image file ${filename}`, e);
        }

        if (image) {
            await this.repository.remove(image);
        }
    }

    async migrateToVersion(sessionId: string, sourceVersion: number, targetVersion: number): Promise<void> {
        const sourceImages = await this.repository.find({ where: { sessionId, version: sourceVersion } });

        for (const img of sourceImages) {
            // Check if already exists in target (idempotency)
            const exists = await this.repository.findOne({ where: { sessionId, version: targetVersion, filename: img.filename } });
            if (exists) continue;

            const newImg = new SessionImage();
            newImg.sessionId = sessionId;
            newImg.version = targetVersion;
            newImg.filename = img.filename;
            newImg.description = img.description;
            newImg.createdAt = img.createdAt;
            newImg.model = img.model;
            newImg.width = img.width;
            newImg.height = img.height;
            newImg.isUsed = img.isUsed;

            await this.repository.save(newImg);
        }
    }

    async deleteImagesAfterVersion(sessionId: string, version: number): Promise<void> {
        await this.repository.delete({
            sessionId: sessionId,
            version: MoreThan(version),
        });
    }

    async deleteSessionImages(sessionId: string): Promise<void> {
        await this.repository.delete({ sessionId });
    }

    protected async saveMetadata(sessionId: string, version: number, newEntry: ImageMetadata): Promise<void> {
        let image = await this.repository.findOne({ where: { sessionId, version, filename: newEntry.filename } });
        if (!image) {
            image = new SessionImage();
            image.sessionId = sessionId;
            image.version = version;
            image.filename = newEntry.filename;
        }

        image.description = newEntry.description;
        image.createdAt = new Date(newEntry.createdAt);
        image.model = newEntry.model;
        if (newEntry.width) image.width = newEntry.width;
        if (newEntry.height) image.height = newEntry.height;
        if (newEntry.isUsed !== undefined) image.isUsed = newEntry.isUsed;

        await this.repository.save(image);
    }

    async copySessionImages(sourceId: string, targetId: string, maxVersion?: number): Promise<void> {
        const whereClause: any = { sessionId: sourceId };
        if (maxVersion !== undefined) {
            whereClause.version = LessThanOrEqual(maxVersion);
        }

        const sourceImages = await this.repository.find({ where: whereClause });

        for (const img of sourceImages) {
            const newImg = new SessionImage();
            newImg.sessionId = targetId;
            newImg.version = img.version;
            newImg.filename = img.filename;
            newImg.description = img.description;
            newImg.createdAt = img.createdAt;
            newImg.model = img.model;
            newImg.width = img.width;
            newImg.height = img.height;
            newImg.isUsed = img.isUsed;

            await this.repository.save(newImg);
        }
    }
}
