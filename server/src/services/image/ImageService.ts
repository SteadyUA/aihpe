import { Service } from 'typedi';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { SessionFiles } from '../../types/chat';

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
            this.saveMetadata(sessionId, version, {
                filename,
                description,
                createdAt: new Date().toISOString(),
                model: this.modelId,
                width,
                height,
                isUsed: false, // Default to false until code uses it
            });

            return filename;
        } catch (error) {
            console.error('Failed to generate image:', error);
            throw new Error(`Failed to generate image: ${error instanceof Error ? error.message : String(error)}`);
        }
    }


    async editAndSave(sessionId: string, filename: string, prompt: string, sourceVersion: number, targetVersion: number): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        console.log(`Editing image ${filename} for session ${sessionId} source v${sourceVersion} -> target v${targetVersion} with prompt: ${prompt}`);

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
        const base64Data = buffer.toString('base64');
        const mimeType = this.getMimeType(filename);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;

        // Augment prompt to ask for description
        const augmentedPrompt = `${prompt}\n\nAlso describe it in a single sentence so that I can use this description for alt-text or generating a similar image.`;

        const body = {
            contents: [{
                parts: [
                    { text: augmentedPrompt },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    }
                ]
            }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"]
            }
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
            console.log(data.candidates[0].content);

            // Extract image and text from response
            let newBase64Data: string | undefined;
            let newDescription: string | undefined;

            if (data.candidates?.[0]?.content?.parts) {
                const parts = data.candidates[0].content.parts;

                const imagePart = parts.find((p: any) => p.inlineData);
                if (imagePart) {
                    newBase64Data = imagePart.inlineData.data;
                }

                const textPart = parts.find((p: any) => p.text);
                if (textPart) {
                    newDescription = textPart.text;
                }
            }

            if (!newBase64Data) {
                throw new Error(`No image data found in response. Raw response: ${JSON.stringify(data).substring(0, 200)}...`);
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
            this.saveMetadata(sessionId, targetVersion, {
                filename,
                description: newDescription || prompt, // Use generated description or fallback to prompt
                createdAt: new Date().toISOString(),
                model: this.modelId,
                width,
                height,
                isUsed: true,
            });

            return filename;
        } catch (error) {
            console.error('Failed to edit image:', error);
            throw new Error(`Failed to edit image: ${error instanceof Error ? error.message : String(error)}`);
        }
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

        this.saveMetadata(sessionId, version, metadata);

        return metadata;
    }

    async describeImage(sessionId: string, version: number, filename: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        const versionDir = this.resolveVersionDir(sessionId, version);
        const filePath = path.join(versionDir, filename);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Image file not found: ${filePath}`);
        }

        const buffer = fs.readFileSync(filePath);
        const base64Image = buffer.toString('base64');
        const mimeType = this.getMimeType(filename);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;

        const body = {
            contents: [{
                parts: [
                    // { text: 'Analyze this image. Describe it in detail so that I can use this description for alt-text or generating a similar image.' },
                    { text: 'Analyze this image. Describe it in a single sentence so that I can use this description for alt-text or generating a similar image.' },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Image
                        }
                    }
                ]
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

            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }

            throw new Error('No description text found in response');

        } catch (error) {
            console.error('Failed to describe image:', error);
            throw new Error(`Failed to describe image: ${error instanceof Error ? error.message : String(error)}`);
        }
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
            default: return 'image/png';
        }
    }

    async updateImageDescription(sessionId: string, version: number, filename: string, newDescription: string): Promise<void> {
        const metadataList = this.loadMetadata(sessionId, version);
        const imageIndex = metadataList.findIndex(img => img.filename === filename);

        if (imageIndex === -1) {
            throw new Error(`Image ${filename} not found in session ${sessionId} version ${version}`);
        }

        metadataList[imageIndex].description = newDescription;

        const metaPath = this.getMetadataPath(sessionId, version);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(metadataList, null, 2), 'utf-8');
        } catch (e) {
            console.error(`Failed to save updated image description for ${sessionId} v${version}`, e);
            throw new Error('Failed to save image metadata');
        }
    }

    async listImages(sessionId: string, version: number): Promise<ImageMetadata[]> {
        const metadata = this.loadMetadata(sessionId, version);
        return metadata;
    }

    async getImageInfo(sessionId: string, version: number, filename: string): Promise<ImageMetadata | undefined> {
        const metadata = this.loadMetadata(sessionId, version);
        return metadata.find(img => img.filename === filename);
    }

    async updateImagesUsage(sessionId: string, version: number, files: SessionFiles): Promise<void> {
        const metadata = this.loadMetadata(sessionId, version);
        if (metadata.length === 0) return;

        let hasChanges = false;
        const htmlContent = files['index.html'] || files['html'] || '';
        const cssContent = files['styles.css'] || files['css'] || '';
        const jsContent = files['script.js'] || files['js'] || '';

        const updatedMetadata = metadata.map(img => {
            // Check usage
            const isUsed = htmlContent.includes(img.filename) || cssContent.includes(img.filename) || jsContent.includes(img.filename);

            if (img.isUsed !== isUsed) {
                hasChanges = true;
                return { ...img, isUsed };
            }
            return img;
        });

        if (hasChanges) {
            const metaPath = this.getMetadataPath(sessionId, version);
            try {
                fs.writeFileSync(metaPath, JSON.stringify(updatedMetadata, null, 2), 'utf-8');
            } catch (e) {
                console.error(`Failed to save updated image usage for ${sessionId} v${version}`, e);
            }
        }
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

    async deleteImage(sessionId: string, version: number, filename: string): Promise<void> {
        const metadataList = this.loadMetadata(sessionId, version);
        const imageIndex = metadataList.findIndex(img => img.filename === filename);

        if (imageIndex === -1) {
            throw new Error(`Image ${filename} not found in session ${sessionId} version ${version}`);
        }

        const image = metadataList[imageIndex];
        if (image.isUsed) {
            throw new Error(`Cannot delete used image ${filename}`);
        }

        // Remove from metadata
        metadataList.splice(imageIndex, 1);
        const metaPath = this.getMetadataPath(sessionId, version);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(metadataList, null, 2), 'utf-8');
        } catch (e) {
            console.error(`Failed to update metadata after deleting ${filename}`, e);
            throw new Error('Failed to update metadata');
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
            // We removed it from metadata, so it's "deleted" logically. 
            // We might want to warn but not fail entirely if file was missing/locked.
        }
    }

    private saveMetadata(sessionId: string, version: number, newEntry: ImageMetadata): void {
        let current = this.loadMetadata(sessionId, version);
        // Remove existing entry if any to support updates
        current = current.filter(item => item.filename !== newEntry.filename);
        // Add new entry
        current.push(newEntry);

        const metaPath = this.getMetadataPath(sessionId, version);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(current, null, 2), 'utf-8');
        } catch (e) {
            console.error(`Failed to save image metadata for ${sessionId} v${version}`, e);
        }
    }
}
