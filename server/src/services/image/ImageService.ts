import { Service } from 'typedi';
import path from 'node:path';
import { getSessionsDir } from '../../utils/pathUtils';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { SessionFiles } from '../../types/chat';
import { ImageServiceFactory } from './ImageServiceFactory';
import { SessionImage } from '../../entities/SessionImage';
import { AppDataSource } from '../../data-source';
import { MoreThan, LessThanOrEqual } from 'typeorm';
import { In } from 'typeorm';

export interface ImageMetadata {
    filename: string;
    description: string;
    createdAt: string;
    model: string;
    width?: number;
    height?: number;
    isUsed?: boolean;
}

export interface TokenUsageData {
    prompt: number;
    completion: number;
    total: number;
    model: string;
    agent: string;
}

@Service({ factory: [ImageServiceFactory, 'create'] })
export abstract class ImageService {
    protected modelId = 'gemini-2.5-flash-image';
    protected agentName = 'image';
    protected readonly repository = AppDataSource.getRepository(SessionImage);

    protected abstract generateRaw(prompt: string, abortSignal?: AbortSignal): Promise<{ base64: string, usage?: TokenUsageData }>;
    protected abstract editRaw(imageBuffer: Buffer, mimeType: string, prompt: string, currentDescription?: string, abortSignal?: AbortSignal): Promise<{ base64: string, description?: string, usage?: TokenUsageData }>;
    protected abstract describeRaw(imageBuffer: Buffer, mimeType: string, abortSignal?: AbortSignal): Promise<{ description: string, usage?: TokenUsageData }>;

    async generateAndSave(sessionId: string, description: string, version: number, targetFilename: string | undefined, abortSignal: AbortSignal | undefined, trackTokenUsage: ((usage: TokenUsageData) => Promise<void>) | undefined): Promise<string> {
        const result = await this.generateRaw(description, abortSignal);
        const base64Data = result.base64;

        if (result.usage && trackTokenUsage) {
            await trackTokenUsage(result.usage);
        }

        const versionDir = this.resolveVersionDir(sessionId, version);
        this.ensureDirectory(versionDir);

        const uuid = randomUUID();
        const filename = targetFilename || `${uuid}.png`;
        const filePath = path.join(versionDir, filename);

        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);

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
            model: this.modelId,
            width,
            height,
            isUsed: false,
        });

        return filename;
    }

    async editAndSave(sessionId: string, filename: string, prompt: string, sourceVersion: number, targetVersion: number, abortSignal: AbortSignal | undefined, trackTokenUsage: ((usage: TokenUsageData) => Promise<void>) | undefined): Promise<string> {
        // Resolve source file: check target version first (in case it was already modified in this turn)
        let sourceDir = this.resolveVersionDir(sessionId, targetVersion);
        let sourcePath = path.join(sourceDir, filename);

        if (!fs.existsSync(sourcePath)) {
            // Fallback to source version
            sourceDir = this.resolveVersionDir(sessionId, sourceVersion);
            sourcePath = path.join(sourceDir, filename);
        }

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source image not found: ${filename}`);
        }

        const buffer = fs.readFileSync(sourcePath);
        const mimeType = this.getMimeType(filename);

        // Get current description
        const info = await this.getImageInfo(sessionId, sourceVersion, filename);
        const currentDescription = info?.description;

        const result = await this.editRaw(buffer, mimeType, prompt, currentDescription, abortSignal);
        const newBase64Data = result.base64;
        const newDescription = result.description;

        if (result.usage && trackTokenUsage) {
            await trackTokenUsage(result.usage);
        }

        const versionDir = this.resolveVersionDir(sessionId, targetVersion);
        this.ensureDirectory(versionDir);

        // We overwrite the file in the target version location with the same filename
        const savePath = path.join(versionDir, filename);
        const newBuffer = Buffer.from(newBase64Data, 'base64');
        fs.writeFileSync(savePath, newBuffer);

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
            model: this.modelId,
            width,
            height,
            isUsed: true,
        });

        return filename;
    }

    async describeImage(sessionId: string, version: number, filename: string, abortSignal?: AbortSignal, trackTokenUsage?: (usage: TokenUsageData) => Promise<void>): Promise<string> {
        const versionDir = this.resolveVersionDir(sessionId, version);
        const filePath = path.join(versionDir, filename);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Image file not found: ${filePath}`);
        }

        const buffer = fs.readFileSync(filePath);
        const mimeType = this.getMimeType(filename);

        const result = await this.describeRaw(buffer, mimeType, abortSignal);

        if (result.usage && trackTokenUsage) {
            await trackTokenUsage(result.usage);
        }

        return result.description;
    }

    async saveUploadedImage(sessionId: string, version: number, file: Express.Multer.File): Promise<ImageMetadata> {
        const versionDir = this.resolveVersionDir(sessionId, version);
        this.ensureDirectory(versionDir);

        const uuid = randomUUID();
        const ext = path.extname(file.originalname);
        const filename = `${uuid}${ext}`;
        const filePath = path.join(versionDir, filename);

        // Copy file from temp location or write buffer
        if (file.path) {
            fs.copyFileSync(file.path, filePath);
            // Optionally remove temp file if we are responsible for it.
            // Multer usually cleans up if configured for diskStorage / temp
        } else if (file.buffer) {
            fs.writeFileSync(filePath, file.buffer);
        } else {
            throw new Error('No file content found');
        }

        // Calculate dimensions
        let width, height;
        try {
            const dimensions = imageSize(fs.readFileSync(filePath));
            width = dimensions.width;
            height = dimensions.height;
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

    async updateImagesUsage(sessionId: string, version: number, files: SessionFiles): Promise<void> {
        const images = await this.repository.find({ where: { sessionId, version } });
        if (images.length === 0) return;

        const htmlContent = files['index.html'] || files['html'] || '';
        const cssContent = files['styles.css'] || files['css'] || '';
        const jsContent = files['script.js'] || files['js'] || '';

        const updates = [];
        for (const img of images) {
            const isUsed = htmlContent.includes(img.filename) || cssContent.includes(img.filename) || jsContent.includes(img.filename);
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
        const versionDir = this.resolveVersionDir(sessionId, version);
        const filePath = path.join(versionDir, filename);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            console.error(`Failed to delete image file ${filename}`, e);
        }

        if (image) {
            await this.repository.remove(image);
        }
    }

    protected resolveVersionDir(sessionId: string, version: number): string {
        const root = getSessionsDir();
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
        const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;
        return path.join(root, safeId, 'versions', String(safeVersion));
    }

    async copyImagesToVersion(sessionId: string, sourceVersion: number, targetVersion: number): Promise<void> {
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


    protected ensureDirectory(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
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
