import { Service } from 'typedi';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

interface ImageMetadata {
    filename: string;
    description: string;
    createdAt: string;
    model: string;
}

@Service()
export class ImageService {
    private readonly modelId = 'gemini-2.5-flash-image';

    async generateAndSave(sessionId: string, description: string, version: number, targetFilename?: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        console.log(`Generating image for session ${sessionId} version ${version} with description: ${description}`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;
        const body = {
            contents: [{
                parts: [{ text: description }]
            }]
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }

            const data = await response.json();

            // Extract image from response
            let base64Data: string | undefined;
            if (data.candidates?.[0]?.content?.parts) {
                const parts = data.candidates[0].content.parts;
                const imagePart = parts.find((p: any) => p.inlineData);
                if (imagePart) {
                    base64Data = imagePart.inlineData.data;
                }
            }

            if (!base64Data) {
                throw new Error(`No image data found in response. Raw response: ${JSON.stringify(data).substring(0, 200)}...`);
            }

            const versionDir = this.resolveVersionDir(sessionId, version);
            this.ensureDirectory(versionDir);

            const uuid = randomUUID();
            const filename = targetFilename || `${uuid}.png`;
            const filePath = path.join(versionDir, filename);

            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);

            // Save metadata
            this.saveMetadata(sessionId, version, {
                filename,
                description,
                createdAt: new Date().toISOString(),
                model: this.modelId,
            });

            return filename;
        } catch (error) {
            console.error('Failed to generate image:', error);
            throw new Error(`Failed to generate image: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async listImages(sessionId: string, version: number): Promise<ImageMetadata[]> {
        const metadata = this.loadMetadata(sessionId, version);
        return metadata;
    }

    private resolveVersionDir(sessionId: string, version: number): string {
        const customRoot = process.env.SESSION_ROOT?.trim();
        const root = customRoot ? path.resolve(customRoot) : path.resolve(process.cwd(), 'data', 'sessions');
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
        const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;
        return path.join(root, safeId, 'versions', String(safeVersion));
    }

    private ensureDirectory(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private getMetadataPath(sessionId: string, version: number): string {
        return path.join(this.resolveVersionDir(sessionId, version), 'images.json');
    }

    private loadMetadata(sessionId: string, version: number): ImageMetadata[] {
        const metaPath = this.getMetadataPath(sessionId, version);
        try {
            if (!fs.existsSync(metaPath)) {
                return [];
            }
            const content = fs.readFileSync(metaPath, 'utf-8');
            return JSON.parse(content) as ImageMetadata[];
        } catch (e) {
            console.error(`Failed to load image metadata for ${sessionId} v${version}`, e);
            return [];
        }
    }

    private saveMetadata(sessionId: string, version: number, newEntry: ImageMetadata): void {
        let current = this.loadMetadata(sessionId, version);
        // Remove existing entry if any to support updates
        current = current.filter(item => item.filename !== newEntry.filename);
        current.push(newEntry);
        const metaPath = this.getMetadataPath(sessionId, version);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(current, null, 2), 'utf-8');
        } catch (e) {
            console.error(`Failed to save image metadata for ${sessionId} v${version}`, e);
        }
    }
}
