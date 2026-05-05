import { Service, Inject } from 'typedi';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

export enum ResourceFontType {
    ICONS = 'icons',
    FONT = 'font'
}

export enum ResourceFontStyle {
    SERIF = 'serif',
    SANS_SERIF = 'sans-serif',
    MONOSPACE = 'monospace',
    HANDWRITING = 'handwriting',
    DISPLAY = 'display',
    UNKNOWN = 'unknown'
}

export interface ResourceMetadata {
    filename: string;
    description: string;
    createdAt: string;
    model: string;
    isUsed?: boolean;
    mimetype?: string;

    // Metadata from screenshot-service /info API
    format?: string;
    width?: number;
    height?: number;
    duration?: number;
    videoCodec?: string;
    audioCodec?: string;
    container?: string;
    type?: ResourceFontType; // e.g., 'icons', 'font'
    fontFamily?: string; // font family string or 'unknown'
    glyphCount?: number; // null for regular fonts
    puaRanges?: string[]; // array of unicode ranges and/or codepoints in hex format e.g. ['E000-EFFF', 'F001', 'F400'] or null for regular fonts
    style?: ResourceFontStyle; // e.g., 'serif', 'sans-serif', 'monospace', 'handwriting', 'display', 'unknown'
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

    async generateAndSaveImage(sessionId: string, description: string, version: number, targetFilename: string | undefined, abortSignal: AbortSignal | undefined, aspectRatio?: string): Promise<string> {
        const result = await this.llmImageService.generateRaw(description, abortSignal, aspectRatio);
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

        const mimetype = this.getMimeType(filename);

        const extraMeta = await this.fetchResourceMetadata(sessionId, version, filename, mimetype);

        // Save metadata
        await this.saveMetadata(sessionId, version, filename, mimetype, {
            description,
            model: this.llmImageService.modelId,
            isUsed: false,
            ...extraMeta
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

        const extraMeta = await this.fetchResourceMetadata(sessionId, targetVersion, filename, mimeType);

        // Save metadata
        await this.saveMetadata(sessionId, targetVersion, filename, mimeType, {
            description: newDescription || prompt,
            model: this.llmImageService.modelId,
            isUsed: true,
            ...extraMeta
        });

        return filename;
    }

    private parsePuaRanges(puaRanges: string[] | undefined): string[] {
        if (!puaRanges || !Array.isArray(puaRanges)) return [];
        const result: string[] = [];
        for (const range of puaRanges) {
            if (range.includes('-')) {
                const [startHex, endHex] = range.split('-');
                const start = parseInt(startHex, 16);
                const end = parseInt(endHex, 16);
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                    const maxCount = 5000;
                    let count = 0;
                    for (let i = start; i <= end; i++) {
                        if (count++ > maxCount) break;
                        result.push(i.toString(16).toUpperCase());
                    }
                }
            } else {
                result.push(range.toUpperCase());
            }
        }
        return result;
    }

    async describeResource(sessionId: string, version: number, filename: string, abortSignal?: AbortSignal): Promise<string> {
        const metadata = await this.getResourceInfo(sessionId, version, filename);
        if (!metadata) {
            throw new Error(`Resource metadata not found: ${filename}`);
        }

        const mimeType = metadata.mimetype || this.getMimeType(filename);
        const isIconFont = mimeType.startsWith('font/') && metadata.type === ResourceFontType.ICONS;
        const isTextFont = mimeType.startsWith('font/') && metadata.type === ResourceFontType.FONT;
        const isVideo = mimeType.startsWith('video/');

        if (isIconFont && metadata.puaRanges && metadata.puaRanges.length > 0) {
            const chunkSizeStr = process.env.ICON_FONT_CHUNK_SIZE || '16';
            let chunkSize = parseInt(chunkSizeStr, 10);
            if (isNaN(chunkSize) || chunkSize <= 0) chunkSize = 16;

            const hexCodes = this.parsePuaRanges(metadata.puaRanges);
            if (hexCodes.length > 0) {
                let accumulatedDescription = '';
                const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://screenshot:3001';
                const targetUrl = `file://sessions/${sessionId}/versions/${version}/${filename}`;

                for (let i = 0; i < hexCodes.length; i += chunkSize) {
                    const chunk = hexCodes.slice(i, i + chunkSize);
                    const rangeParam = chunk.join(',');
                    const previewUrl = `${screenshotServiceUrl}/preview?url=${encodeURIComponent(targetUrl)}&range=${encodeURIComponent(rangeParam)}`;

                    let chunkBuffer: Buffer | null = null;
                    let chunkMimeType = 'image/png';
                    try {
                        const response = await fetch(previewUrl, { signal: abortSignal });
                        if (response.ok) {
                            const arrayBuffer = await response.arrayBuffer();
                            chunkBuffer = Buffer.from(arrayBuffer);
                            chunkMimeType = response.headers.get('content-type') || 'image/png';
                        } else {
                            console.warn(`Failed to fetch icon chunk preview for ${filename}: ${response.status}`);
                            continue;
                        }
                    } catch (e) {
                        console.warn(`Error fetching icon chunk preview for ${filename}`, e);
                        continue;
                    }

                    let prompt = "This image shows a grid of icons from an icon font. The hex code is written directly below each icon. Carefully read the grid row by row, from left to right, and provide a list of the icons and their corresponding hex codes. Make sure to match each icon strictly with the code directly beneath it. Do not guess or hallucinate codes. Describe each icon in detail using a short phrase (more than one word if possible) rather than just a single word. Format the list strictly as '* [HEX]: [Description]' and do NOT output any conversational text, introductory remarks, or concluding sentences.";

                    if (i === 0) {
                        prompt = "This image is a preview of an icon font file. The hex code is written directly below each icon. First, write exactly one sentence starting with 'This font file contains icons in a...' to describe the overall visual style, aesthetic, and characteristics of the icons (e.g., minimalist, line-art, solid, rounded, detailed). Do not mention the image itself. Then, carefully read the grid row by row, from left to right, and provide a list of the icons and their corresponding hex codes. Make sure to match each icon strictly with the code directly beneath it. Do not guess or hallucinate codes. Describe each icon in detail using a short phrase (more than one word if possible) rather than just a single word. Format the list strictly as '* [HEX]: [Description]' and do NOT output any conversational text, introductory remarks, or concluding sentences.";
                    }

                    const result = await this.llmImageService.describeRaw(chunkBuffer, chunkMimeType, prompt, abortSignal);

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

                    accumulatedDescription += result.description + '\n';
                }

                return accumulatedDescription.trim();
            }
        }

        let previewBuffer: Buffer | null = null;
        let previewMimeType = 'image/png';

        try {
            const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://screenshot:3001';
            const targetUrl = `file://sessions/${sessionId}/versions/${version}/${filename}`;
            const previewUrl = `${screenshotServiceUrl}/preview?url=${encodeURIComponent(targetUrl)}`;
            const response = await fetch(previewUrl, { signal: abortSignal });
            if (!response.ok) {
                console.warn(`Failed to fetch preview for ${filename}: ${response.status}`);
            } else {
                const arrayBuffer = await response.arrayBuffer();
                previewBuffer = Buffer.from(arrayBuffer);
                previewMimeType = response.headers.get('content-type') || 'image/png';
            }
        } catch (e) {
            console.warn(`Error fetching preview for ${filename}`, e);
        }

        if (!previewBuffer) {
            previewBuffer = this.filesService.readVersionFileBuffer(sessionId, version, filename) || null;
            if (!previewBuffer) {
                throw new Error(`Resource file not found: ${filename}`);
            }
            previewMimeType = mimeType;
        }

        let prompt = "Analyze this image. Describe it in a single sentence so that I can use this description for alt-text or generating a similar image.";

        if (isVideo) {
            prompt = "This is a storyboard of a video. Describe the main events and visual contents of the video based on these extracted frames in a single sentence.";
        } else if (isIconFont) {
            prompt = "This image shows a grid of icons from an icon font. The hex code is written directly below each icon. First, write one sentence describing the overall visual style, aesthetic, and characteristics of the icons (e.g., minimalist, line-art, solid, rounded, detailed) without mentioning the image itself. Then, carefully read the grid row by row, from left to right, and provide a list of the icons and their corresponding hex codes. Make sure to match each icon strictly with the code directly beneath it. Do not guess or hallucinate codes. Describe each icon in detail using a short phrase (more than one word if possible) rather than just a single word. Format the list as '* [HEX]: [Description]'.";
        } else if (isTextFont) {
            prompt = "This is a text font preview showing sample text. First, determine if the font style is serif, sans-serif, monospace, handwriting, or display, and write '[STYLE: <style>]' (e.g., '[STYLE: monospace]'). Then describe the visual characteristics and style of the font in a single sentence.";
        }

        const result = await this.llmImageService.describeRaw(previewBuffer, previewMimeType, prompt, abortSignal);

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

        let description = result.description;

        if (isTextFont) {
            const styleMatch = description.match(/\[STYLE:\s*(serif|sans-serif|monospace|handwriting|display)\]/i);
            if (styleMatch) {
                const detectedStyle = styleMatch[1].toLowerCase() as ResourceFontStyle;
                description = description.replace(styleMatch[0], '').trim();

                if (!metadata.style || metadata.style === ResourceFontStyle.UNKNOWN) {
                    try {
                        await this.saveMetadata(sessionId, version, filename, mimeType, { style: detectedStyle });
                    } catch (e) {
                        console.warn(`Failed to save extracted style for ${filename}`, e);
                    }
                }
            }
        }

        return description;
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

        const extraMeta = await this.fetchResourceMetadata(sessionId, version, filename, mimetype);
        Object.assign(metadataObj, extraMeta);

        await this.saveMetadata(sessionId, version, filename, mimetype, metadataObj);

        return await this.getResourceInfo(sessionId, version, filename) as ResourceMetadata;
    }

    // Shared Helper Methods

    private async fetchResourceMetadata(sessionId: string, version: number, filename: string, mimetype: string): Promise<any> {
        if (!mimetype.startsWith('image/') && !mimetype.startsWith('video/') && !mimetype.startsWith('font/')) {
            return {};
        }

        try {
            const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://screenshot:3001';
            const targetUrl = `file://sessions/${sessionId}/versions/${version}/${filename}`;
            const response = await fetch(`${screenshotServiceUrl}/info?url=${encodeURIComponent(targetUrl)}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.warn('Failed to fetch resource metadata from screenshot service', e);
        }
        return {};
    }

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

    async copyResource(sourceSessionId: string, sourceVersion: number, targetSessionId: string, targetVersion: number, filename: string): Promise<ResourceMetadata | undefined> {
        const buffer = this.filesService.readVersionFileBuffer(sourceSessionId, sourceVersion, filename);
        if (!buffer) {
            throw new Error(`Source file not found: ${filename}`);
        }

        this.filesService.writeVersionFile(targetSessionId, targetVersion, filename, buffer);

        const mimetype = this.getMimeType(filename);
        let metadataObj: any = {
            description: '',
            model: 'clipboard-copy',
            isUsed: false,
        };

        const targetResource = await this.repository.findOne({ where: { sessionId: targetSessionId, version: targetVersion, filename } });
        const targetIsUsed = targetResource?.metadata?.isUsed ?? false;

        const sourceResource = await this.repository.findOne({ where: { sessionId: sourceSessionId, version: sourceVersion, filename } });
        if (sourceResource && sourceResource.metadata) {
            metadataObj = { ...sourceResource.metadata };
            metadataObj.isUsed = targetResource ? targetIsUsed : false;
        } else {
            const extraMeta = await this.fetchResourceMetadata(targetSessionId, targetVersion, filename, mimetype);
            Object.assign(metadataObj, extraMeta);
            metadataObj.isUsed = targetResource ? targetIsUsed : false;
        }

        await this.saveMetadata(targetSessionId, targetVersion, filename, mimetype, metadataObj);
        return await this.getResourceInfo(targetSessionId, targetVersion, filename);
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
