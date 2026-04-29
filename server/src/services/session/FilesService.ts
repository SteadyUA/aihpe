import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Service } from 'typedi';
import { getSessionsDir } from '../../utils/pathUtils';



const VERSION_DIRNAME = 'versions';

@Service()
export class FilesService {
    private readonly sessionRoot = getSessionsDir();

    constructor() {
        this.ensureDirectory(this.sessionRoot);
    }

    private sanitizeSessionId(value: string): string {
        if (!value) return 'default';
        return value.replace(/[^a-zA-Z0-9-_]/g, '_') || 'default';
    }

    public resolveSessionDir(sessionId: string): string {
        return path.join(this.sessionRoot, this.sanitizeSessionId(sessionId));
    }

    public resolveVersionDir(sessionId: string, version: number): string {
        const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;
        return path.join(this.resolveSessionDir(sessionId), VERSION_DIRNAME, String(safeVersion));
    }

    public resolveVersionFilePath(sessionId: string, version: number, filename: string): string {
        if (filename.includes('..')) {
            throw new Error('Invalid filename: path traversal is not allowed');
        }
        return path.join(this.resolveVersionDir(sessionId, version), filename);
    }

    public ensureDirectory(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    public removeDirectory(dir: string): void {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    public listVersionFiles(sessionId: string, version: number): string[] {
        const versionDir = this.resolveVersionDir(sessionId, version);
        if (!fs.existsSync(versionDir)) {
            return [];
        }
        try {
            return fs.readdirSync(versionDir).filter(file => fs.statSync(path.join(versionDir, file)).isFile());
        } catch (error) {
            console.error(`Failed to list files for ${sessionId} v${version}`, error);
            return [];
        }
    }

    public readVersionFile(sessionId: string, version: number, filename: string): string | undefined {
        const filePath = this.resolveVersionFilePath(sessionId, version, filename);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
            console.error(`Failed to read file ${filePath}`, error);
            return undefined;
        }
    }

    public readVersionFileBuffer(sessionId: string, version: number, filename: string): Buffer | undefined {
        const filePath = this.resolveVersionFilePath(sessionId, version, filename);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        try {
            return fs.readFileSync(filePath);
        } catch (error) {
            console.error(`Failed to read buffer for ${filePath}`, error);
            return undefined;
        }
    }

    public versionFileExists(sessionId: string, version: number, filename: string): boolean {
        return fs.existsSync(this.resolveVersionFilePath(sessionId, version, filename));
    }

    public writeVersionFile(sessionId: string, version: number, filename: string, content: Buffer | string): void {
        const filePath = this.resolveVersionFilePath(sessionId, version, filename);
        this.ensureDirectory(path.dirname(filePath));
        fs.writeFileSync(filePath, content);
    }

    public copyFileToVersion(sessionId: string, version: number, filename: string, sourcePath: string): void {
        const filePath = this.resolveVersionFilePath(sessionId, version, filename);
        fs.copyFileSync(sourcePath, filePath);
    }

    public deleteVersionFile(sessionId: string, version: number, filename: string): void {
        const filePath = this.resolveVersionFilePath(sessionId, version, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    public getVersionFileStream(sessionId: string, version: number, filename: string): Readable | undefined {
        const filePath = this.resolveVersionFilePath(sessionId, version, filename);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        try {
            return fs.createReadStream(filePath);
        } catch (error) {
            console.error(`Failed to create read stream for ${filePath}`, error);
            return undefined;
        }
    }

    public async initNextVersion(sessionId: string, currentVersion: number): Promise<number> {
        const nextVersion = currentVersion + 1;
        const nextVersionDir = this.resolveVersionDir(sessionId, nextVersion);

        if (fs.existsSync(nextVersionDir)) {
            return nextVersion;
        }

        this.copyVersionContent(sessionId, sessionId, currentVersion, nextVersion);
        return nextVersion;
    }

    public copyVersionContent(sourceId: string, targetId: string, sourceVersion: number, targetVersion: number): void {
        const sourceDir = this.resolveVersionDir(sourceId, sourceVersion);
        const targetDir = this.resolveVersionDir(targetId, targetVersion);

        try {
            if (!fs.existsSync(sourceDir)) return;
            this.ensureDirectory(targetDir);
            fs.cpSync(sourceDir, targetDir, { recursive: true });
        } catch (error) {
            console.error(`Failed to copy version content from ${sourceId} v${sourceVersion} to ${targetId} v${targetVersion}`, error);
        }
    }

    public copyVersionHistory(sourceId: string, targetId: string): void {
        const sourceDir = path.join(this.resolveSessionDir(sourceId), VERSION_DIRNAME);
        const targetDir = path.join(this.resolveSessionDir(targetId), VERSION_DIRNAME);
        try {
            this.removeDirectory(targetDir);
            if (!fs.existsSync(sourceDir)) return;
            this.ensureDirectory(path.dirname(targetDir));
            fs.cpSync(sourceDir, targetDir, { recursive: true });
        } catch (error) {
            console.error(`Failed to copy version history from ${sourceId} to ${targetId}`, error);
        }
    }

    public copyVersionHistoryUpTo(sourceId: string, targetId: string, maxVersion: number): void {
        const sourceRoot = path.join(this.resolveSessionDir(sourceId), VERSION_DIRNAME);
        const targetRoot = path.join(this.resolveSessionDir(targetId), VERSION_DIRNAME);
        try {
            this.removeDirectory(targetRoot);
            if (!fs.existsSync(sourceRoot)) return;

            this.ensureDirectory(targetRoot);
            for (let version = 0; version <= maxVersion; version += 1) {
                const sourceVersionDir = path.join(sourceRoot, String(version));
                if (fs.existsSync(sourceVersionDir)) {
                    const destinationDir = path.join(targetRoot, String(version));
                    this.ensureDirectory(path.dirname(destinationDir));
                    fs.cpSync(sourceVersionDir, destinationDir, { recursive: true });
                }
            }
        } catch (error) {
            console.error(`Failed to copy partial version history from ${sourceId} to ${targetId}`, error);
        }
    }

    public deleteSessionDir(sessionId: string): void {
        const sessionDir = this.resolveSessionDir(sessionId);
        this.removeDirectory(sessionDir);
    }

    public cleanupHigherVersions(sessionId: string, targetVersion: number): void {
        const versionRootDir = path.join(this.resolveSessionDir(sessionId), VERSION_DIRNAME);
        if (fs.existsSync(versionRootDir)) {
            const dirs = fs.readdirSync(versionRootDir);
            for (const dir of dirs) {
                const ver = Number.parseInt(dir, 10);
                if (!Number.isNaN(ver) && ver > targetVersion) {
                    this.removeDirectory(path.join(versionRootDir, dir));
                }
            }
        }
    }
}
