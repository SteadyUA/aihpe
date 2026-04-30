import { Service, Inject } from 'typedi';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { AppDataSource } from '../../data-source';
import { SessionResource } from '../../entities/SessionResource';
import { FilesService } from './FilesService';
import { EventBus } from '../../utils/bus';
import { MoreThan, LessThanOrEqual, Like } from 'typeorm';
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

export interface ResourceMetadata {
    filename: string;
    description: string;
    createdAt: string;
    model: string;
    width?: number;
    height?: number;
    isUsed?: boolean;
    [key: string]: any;
}

@Service()
export class SessionResourceService {
    protected readonly repository = AppDataSource.getRepository(SessionResource);
    private llmImageService: LlmImageService;

    @Inject()
    protected readonly eventBus!: EventBus;

    constructor(
        private readonly filesService: FilesService,
        private readonly llmImageServiceFactory: LlmImageServiceFactory
    ) {
        this.llmImageService = this.llmImageServiceFactory.create();
    }

    async generateAndSaveImage(sessionId: string, description: string, version: number, targetFilename: string | undefined, abortSignal: AbortSignal | undefined): Promise<string> {
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

        const mimetype = this.getMimeType(filename);

        // Save metadata
        await this.saveMetadata(sessionId, version, filename, mimetype, {
            description,
            model: this.llmImageService.modelId,
            width,
            height,
            isUsed: false,
        });

        return filename;
    }

    async editAndSaveImage(sessionId: string, filename: string, prompt: string, sourceVersion: number, targetVersion: number, abortSignal: AbortSignal | undefined): Promise<string> {
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
        const info = await this.getResourceInfo(sessionId, sourceVersion, filename);
        const currentDescription = info?.description || '';

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
        await this.saveMetadata(sessionId, targetVersion, filename, mimeType, {
            description: newDescription || prompt,
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

    async saveUploadedFile(sessionId: string, version: number, file: Express.Multer.File, preserveFilename = false): Promise<ResourceMetadata> {
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

        const mimetype = this.getMimeType(filename);

        let metadataObj: any = {
            description: '',
            model: 'user-upload',
            isUsed: false,
        };

        // If it's an image, calculate dimensions
        if (mimetype.startsWith('image/')) {
            try {
                const buffer = this.filesService.readVersionFileBuffer(sessionId, version, filename);
                if (buffer) {
                    const dimensions = imageSize(buffer);
                    metadataObj.width = dimensions.width;
                    metadataObj.height = dimensions.height;
                }
            } catch (e) {
                console.warn('Failed to calculate image dimensions', e);
            }
        }

        await this.saveMetadata(sessionId, version, filename, mimetype, metadataObj);

        return await this.getResourceInfo(sessionId, version, filename) as ResourceMetadata;
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
            case '.mp4': return 'video/mp4';
            case '.webm': return 'video/webm';
            case '.woff': return 'font/woff';
            case '.woff2': return 'font/woff2';
            case '.ttf': return 'font/ttf';
            case '.svg': return 'image/svg+xml';
            default: return 'application/octet-stream';
        }
    }

    async updateResourceDescription(sessionId: string, version: number, filename: string, newDescription: string): Promise<void> {
        const resource = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (!resource) {
            throw new Error(`Resource ${filename} not found in session ${sessionId} version ${version}`);
        }
        resource.metadata.description = newDescription;
        await this.repository.save(resource);
    }

    async listImages(sessionId: string, version: number): Promise<ResourceMetadata[]> {
        const resources = await this.repository.find({ where: { sessionId, version, mimetype: Like('image/%') } });
        return resources.map(res => ({
            filename: res.filename,
            createdAt: res.createdAt.toISOString(),
            description: res.metadata.description || '',
            model: res.metadata.model || 'unknown',
            ...res.metadata,
        }));
    }

    async listResources(sessionId: string, version: number): Promise<ResourceMetadata[]> {
        const resources = await this.repository.find({ where: { sessionId, version } });
        return resources.map(res => ({
            filename: res.filename,
            createdAt: res.createdAt.toISOString(),
            mimetype: res.mimetype,
            description: res.metadata.description || '',
            model: res.metadata.model || 'unknown',
            ...res.metadata,
        }));
    }

    async getResourceInfo(sessionId: string, version: number, filename: string): Promise<ResourceMetadata | undefined> {
        const res = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (!res) return undefined;
        return {
            filename: res.filename,
            createdAt: res.createdAt.toISOString(),
            mimetype: res.mimetype,
            description: res.metadata.description || '',
            model: res.metadata.model || 'unknown',
            ...res.metadata,
        };
    }

    async updateResourcesUsage(sessionId: string, version: number): Promise<void> {
        const resources = await this.repository.find({ where: { sessionId, version } });
        if (resources.length === 0) return;

        const htmlContent = this.filesService.readVersionFile(sessionId, version, 'index.html');
        const cssContent = this.filesService.readVersionFile(sessionId, version, 'styles.css');
        const jsContent = this.filesService.readVersionFile(sessionId, version, 'script.js');

        const updates = [];
        for (const res of resources) {
            const isUsed = htmlContent?.includes(res.filename) || cssContent?.includes(res.filename) || jsContent?.includes(res.filename) || false;
            if (res.metadata.isUsed !== isUsed) {
                res.metadata.isUsed = isUsed;
                updates.push(res);
            }
        }

        if (updates.length > 0) {
            await this.repository.save(updates);
        }
    }

    async deleteResource(sessionId: string, version: number, filename: string): Promise<void> {
        const resource = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (resource && resource.metadata.isUsed) {
            throw new Error(`Cannot delete used resource ${filename}`);
        }

        // Delete file
        try {
            this.filesService.deleteVersionFile(sessionId, version, filename);
        } catch (e) {
            console.error(`Failed to delete resource file ${filename}`, e);
        }

        try {
            this.filesService.deleteVersionFile(sessionId, version, `.thumbnail/${filename}.png`);
        } catch (e) {
            // ignore
        }

        if (resource) {
            await this.repository.remove(resource);
        }
    }

    async migrateResourcesToVersion(sessionId: string, sourceVersion: number, targetVersion: number): Promise<void> {
        const sourceResources = await this.repository.find({ where: { sessionId, version: sourceVersion } });

        for (const res of sourceResources) {
            // Check if already exists in target (idempotency)
            const exists = await this.repository.findOne({ where: { sessionId, version: targetVersion, filename: res.filename } });
            if (exists) continue;

            const newRes = new SessionResource();
            newRes.sessionId = sessionId;
            newRes.version = targetVersion;
            newRes.filename = res.filename;
            newRes.mimetype = res.mimetype;
            newRes.metadata = { ...res.metadata };
            newRes.createdAt = res.createdAt;

            await this.repository.save(newRes);
        }
    }

    async deleteResourcesAfterVersion(sessionId: string, version: number): Promise<void> {
        await this.repository.delete({
            sessionId: sessionId,
            version: MoreThan(version),
        });
    }

    async deleteSessionResources(sessionId: string): Promise<void> {
        await this.repository.delete({ sessionId });
    }

    protected async saveMetadata(sessionId: string, version: number, filename: string, mimetype: string, metaPayload: any): Promise<void> {
        let resource = await this.repository.findOne({ where: { sessionId, version, filename } });
        if (!resource) {
            resource = new SessionResource();
            resource.sessionId = sessionId;
            resource.version = version;
            resource.filename = filename;
            resource.mimetype = mimetype;
            resource.metadata = {};
        }

        resource.metadata = {
            ...resource.metadata,
            ...metaPayload
        };

        await this.repository.save(resource);
    }

    async copySessionResources(sourceId: string, targetId: string, maxVersion?: number): Promise<void> {
        const whereClause: any = { sessionId: sourceId };
        if (maxVersion !== undefined) {
            whereClause.version = LessThanOrEqual(maxVersion);
        }

        const sourceResources = await this.repository.find({ where: whereClause });

        for (const res of sourceResources) {
            const newRes = new SessionResource();
            newRes.sessionId = targetId;
            newRes.version = res.version;
            newRes.filename = res.filename;
            newRes.mimetype = res.mimetype;
            newRes.metadata = { ...res.metadata };
            newRes.createdAt = res.createdAt;

            await this.repository.save(newRes);
        }
    }
}
