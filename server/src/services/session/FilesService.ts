import fs from 'node:fs';
import path from 'node:path';
import { Service } from 'typedi';
import { SessionFiles } from '../../types/chat';
import { getSessionsDir } from '../../utils/pathUtils';

const DEFAULT_SESSION_SCRIPT = `(() => {
  const MODIFIER_KEYS = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'];

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (MODIFIER_KEYS.some((key) => event[key])) {
      return;
    }

    const anchor = (event.target as HTMLElement)?.closest?.('a');
    if (!anchor || anchor.hasAttribute('download')) {
      return;
    }

    const href = anchor.getAttribute('href')?.trim() ?? '';
    if (!href.startsWith('#')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const hash = href.slice(1);
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const destination = document.getElementById(hash) ?? document.querySelector('[name="' + hash + '"]');
    destination?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, true);
})();\n`;

export const EMPTY_FILES: SessionFiles = {
    'index.html': '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>New Page</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <script src="script.js"></script>\n  </body>\n</html>',
    'styles.css': '/* Add your styles here */\nbody {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  padding: 2rem;\n  background-color: #f5f5f5;\n}\n',
    'script.js': DEFAULT_SESSION_SCRIPT,
};

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

    public readVersionFiles(sessionId: string, version: number): SessionFiles | undefined {
        const versionDir = this.resolveVersionDir(sessionId, version);
        if (!fs.existsSync(versionDir)) {
            return undefined;
        }
        return {
            'index.html': this.readFileOrDefault(path.join(versionDir, 'index.html'), EMPTY_FILES['index.html']),
            'styles.css': this.readFileOrDefault(path.join(versionDir, 'styles.css'), EMPTY_FILES['styles.css']),
            'script.js': this.readFileOrDefault(path.join(versionDir, 'script.js'), EMPTY_FILES['script.js']),
        };
    }

    private readFileOrDefault(filePath: string, fallback: string): string {
        try {
            if (!fs.existsSync(filePath)) return fallback;
            return fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
            console.error(`Failed to read file ${filePath}`, error);
            return fallback;
        }
    }

    public persistVersionFiles(sessionId: string, version: number, files: SessionFiles): void {
        const versionDir = this.resolveVersionDir(sessionId, version);
        this.ensureDirectory(versionDir);
        fs.writeFileSync(path.join(versionDir, 'index.html'), files['index.html'] || '', 'utf-8');
        fs.writeFileSync(path.join(versionDir, 'styles.css'), files['styles.css'] || '', 'utf-8');
        fs.writeFileSync(path.join(versionDir, 'script.js'), files['script.js'] || '', 'utf-8');
    }

    public persistSessionFile(sessionId: string, version: number, filename: string, content: string): void {
        const versionDir = this.resolveVersionDir(sessionId, version);
        this.ensureDirectory(versionDir);
        fs.writeFileSync(path.join(versionDir, filename), content, 'utf-8');
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

    public clearVersions(sessionId: string): void {
        const versionRootDir = path.join(this.resolveSessionDir(sessionId), VERSION_DIRNAME);
        this.removeDirectory(versionRootDir);
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
