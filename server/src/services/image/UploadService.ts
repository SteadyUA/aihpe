import { Service } from 'typedi';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../../data-source';
import { SessionUpload } from '../../entities/SessionUpload';
import { getSessionsDir } from '../../utils/pathUtils';

export interface UploadMetadata {
    id: number;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    createdAt: string;
}

@Service()
export class UploadService {
    private readonly repository = AppDataSource.getRepository(SessionUpload);

    protected resolveUploadDir(sessionId: string): string {
        const root = getSessionsDir();
        const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
        return path.join(root, safeId, 'uploads');
    }

    protected ensureDirectory(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    async saveUpload(sessionId: string, file: Express.Multer.File): Promise<UploadMetadata> {
        const uploadDir = this.resolveUploadDir(sessionId);
        this.ensureDirectory(uploadDir);

        // Generate filename using MD5 hash of content if available?
        // ChatController was using MD5 of buffer. Let's replicate or use UUID if we prefer.
        // User didn't specify hashing, but current implementation uses MD5. 
        // Let's stick to MD5 for compatibility/consistency if possible, or UUID for simplicity.
        // But ChatController logic was: const hash = crypto.createHash('md5').update(req.file.buffer).digest('hex');

        let filename: string;
        if (file.buffer) {
            const crypto = await import('node:crypto');
            const hash = crypto.createHash('md5').update(file.buffer).digest('hex');
            const ext = path.extname(file.originalname); // multer uses originalname
            filename = `${hash}${ext}`;
        } else {
            // Fallback if no buffer (streaming middleware?)
            const uuid = randomUUID();
            const ext = path.extname(file.originalname);
            filename = `${uuid}${ext}`;
        }

        const filePath = path.join(uploadDir, filename);

        // Save file to disk
        if (file.path) {
            // If multer saved to temp path
            fs.copyFileSync(file.path, filePath);
        } else if (file.buffer) {
            fs.writeFileSync(filePath, file.buffer);
        } else {
            throw new Error('No file content found');
        }

        // Save to DB
        // Check if exists first? MD5 implies content-addressable, so maybe same file uploaded twice.
        // If same file, we can reuse or just ensure metadata exists.
        // But sessionId is part of key? No unique constraint on (sessionId, filename) in my entity yet, but should be conceptually unique per session if content-based.

        let upload = await this.repository.findOne({ where: { sessionId, filename } });
        if (!upload) {
            upload = new SessionUpload();
            upload.sessionId = sessionId;
            upload.filename = filename;
            upload.createdAt = new Date();
        }

        upload.originalName = file.originalname;
        upload.mimeType = file.mimetype;
        upload.size = file.size;

        await this.repository.save(upload);

        return {
            id: upload.id,
            filename: upload.filename,
            originalName: upload.originalName,
            mimeType: upload.mimeType,
            size: upload.size,
            createdAt: upload.createdAt.toISOString()
        };
    }

    async getUpload(sessionId: string, filename: string): Promise<UploadMetadata | undefined> {
        const upload = await this.repository.findOne({ where: { sessionId, filename } });
        if (!upload) return undefined;
        return {
            id: upload.id,
            filename: upload.filename,
            originalName: upload.originalName,
            mimeType: upload.mimeType,
            size: upload.size,
            createdAt: upload.createdAt.toISOString()
        };
    }

    getExistsFilePath(sessionId: string, filename: string): string | null {
        const uploadDir = this.resolveUploadDir(sessionId);
        const safeFilename = path.basename(filename);
        const filePath = path.join(uploadDir, safeFilename);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        return filePath;
    }

    async deleteUpload(sessionId: string, filename: string): Promise<void> {
        const upload = await this.repository.findOne({ where: { sessionId, filename } });

        // Delete from disk
        const filePath = this.getExistsFilePath(sessionId, filename);
        if (filePath) {
            fs.unlinkSync(filePath);
        }

        if (upload) {
            await this.repository.remove(upload);
        }
    }

    async getFileBuffer(sessionId: string, filename: string): Promise<Buffer | null> {
        const filePath = this.getExistsFilePath(sessionId, filename);
        if (!filePath) return null;
        try {
            return await fs.promises.readFile(filePath);
        } catch (e) {
            console.error(`Failed to read file buffer for ${filename}`, e);
            return null;
        }
    }

    async deleteSessionUploads(sessionId: string): Promise<void> {
        // Delete all from DB
        await this.repository.delete({ sessionId });

        // Delete from disk (directory)
        const uploadDir = this.resolveUploadDir(sessionId);
        try {
            if (fs.existsSync(uploadDir)) {
                fs.rmSync(uploadDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.error(`Failed to delete uploads directory for session ${sessionId}`, e);
        }
    }

    async copyUploads(sourceId: string, targetId: string): Promise<Map<string, string>> {
        const idMapping = new Map<string, string>();
        const sourceUploads = await this.repository.find({ where: { sessionId: sourceId } });

        if (sourceUploads.length === 0) return idMapping;

        const targetDir = this.resolveUploadDir(targetId);
        this.ensureDirectory(targetDir);
        const sourceDir = this.resolveUploadDir(sourceId);

        for (const upload of sourceUploads) {
            // Copy file on disk
            const sourcePath = path.join(sourceDir, upload.filename);
            const targetPath = path.join(targetDir, upload.filename);

            try {
                if (fs.existsSync(sourcePath)) {
                    fs.copyFileSync(sourcePath, targetPath);
                }
            } catch (e) {
                console.error(`Failed to copy upload file ${upload.filename} from ${sourceId} to ${targetId}`, e);
                // Continue with other files?
            }

            // Create DB entry
            const newUpload = new SessionUpload();
            newUpload.sessionId = targetId;
            newUpload.filename = upload.filename;
            newUpload.originalName = upload.originalName;
            newUpload.mimeType = upload.mimeType;
            newUpload.size = upload.size;
            // createdAt will be now

            const saved = await this.repository.save(newUpload);
            idMapping.set(upload.id.toString(), saved.id.toString());
        }

        return idMapping;
    }
}
