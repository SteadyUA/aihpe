import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { ChatMessage, SessionData, SessionFiles } from '../../types/chat';

type SessionUpdate = Partial<
    Pick<SessionData, 'files' | 'history' | 'updatedAt'>
>;

type PersistedHistoryEntry = Omit<ChatMessage, 'createdAt'> & {
    createdAt: string;
};

type PersistedSession = {
    id: string;
    updatedAt: string;
    history: PersistedHistoryEntry[];
    group?: number;
    currentVersion?: number;
};

const DEFAULT_SESSION_SCRIPT = `(() => {
  const MODIFIER_KEYS = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'];

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (MODIFIER_KEYS.some((key) => event[key])) {
      return;
    }

    const anchor = event.target?.closest?.('a');
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

const EMPTY_FILES: SessionFiles = {
    html: '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>New Page</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <script src="script.js"></script>\n  </body>\n</html>',
    css: '/* Add your styles here */\nbody {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  padding: 2rem;\n  background-color: #f5f5f5;\n}\n',
    js: DEFAULT_SESSION_SCRIPT,
};

const SESSION_ROOT = resolveSessionRoot();
const FILES_DIRNAME = 'files';
const VERSION_DIRNAME = 'versions';

@Service()
export class SessionStore {
    private readonly sessions = new Map<string, SessionData>();

    constructor() {
        ensureDirectory(SESSION_ROOT);
    }

    create(): SessionData {
        const id = randomUUID();
        const session = this.createFreshSession(id);
        this.sessions.set(id, session);
        this.persistSession(session);
        return cloneSession(session);
    }

    clone(sourceId: string): SessionData {
        const source = this.getOrCreate(sourceId);
        const newId = randomUUID();
        const newSession: SessionData = {
            ...source,
            id: newId,
            updatedAt: new Date(),
            history: source.history.map((h) => ({ ...h })),
            files: { ...source.files },
            // Group is inherited from source
            group: source.group,
            currentVersion: source.currentVersion,
        };

        clearPersistedSessionData(newId);
        copyVersionHistory(sourceId, newId);

        this.sessions.set(newId, newSession);
        this.persistSession(newSession);
        return cloneSession(newSession);
    }

    cloneAtVersion(sourceId: string, version: number): SessionData {
        const normalizedVersion = Math.floor(version);
        if (!Number.isFinite(normalizedVersion) || normalizedVersion < 0) {
            throw new Error(`Invalid version ${version}`);
        }

        const source = this.getOrCreate(sourceId);
        if (normalizedVersion > source.currentVersion) {
            throw new Error(
                `Version ${normalizedVersion} exceeds current session version`,
            );
        }

        const targetIndex = source.history.findIndex(
            (entry) =>
                entry.role === 'assistant' &&
                typeof entry.version === 'number' &&
                entry.version === normalizedVersion,
        );

        if (targetIndex === -1) {
            throw new Error(
                `Assistant message for version ${normalizedVersion} not found`,
            );
        }

        const truncatedHistory = source.history
            .slice(0, targetIndex + 1)
            .map((entry) => ({
                ...entry,
                createdAt: new Date(entry.createdAt),
                selection: entry.selection
                    ? { selector: entry.selection.selector }
                    : undefined,
                version:
                    typeof entry.version === 'number'
                        ? entry.version
                        : undefined,
            }));

        const snapshot =
            normalizedVersion === source.currentVersion
                ? { ...source.files }
                : readVersionFiles(sourceId, normalizedVersion);

        if (!snapshot) {
            throw new Error(`Files for version ${normalizedVersion} not found`);
        }

        const newId = randomUUID();
        const newSession: SessionData = {
            id: newId,
            files: { ...snapshot },
            history: truncatedHistory,
            updatedAt: new Date(),
            group: source.group,
            currentVersion: normalizedVersion,
        };

        clearPersistedSessionData(newId);
        copyVersionHistoryUpTo(sourceId, newId, normalizedVersion);

        this.sessions.set(newId, newSession);
        this.persistSession(newSession);
        return cloneSession(newSession);
    }

    private createFreshSession(sessionId: string, group?: number): SessionData {
        return {
            id: sessionId,
            files: { ...EMPTY_FILES },
            history: [],
            updatedAt: new Date(),
            group: group ?? Math.floor(Math.random() * 32),
            currentVersion: 0,
        };
    }

    getOrCreate(sessionId: string): SessionData {
        const cached = this.sessions.get(sessionId);
        if (cached) {
            return cloneSession(cached);
        }

        const loaded = this.loadFromDisk(sessionId);
        if (loaded) {
            this.sessions.set(sessionId, loaded);
            return cloneSession(loaded);
        }

        const fresh = this.createFreshSession(sessionId);

        this.sessions.set(sessionId, fresh);
        this.persistSession(fresh);
        return cloneSession(fresh);
    }

    appendMessage(sessionId: string, message: ChatMessage): SessionData {
        const session = this.getOrCreate(sessionId);
        const nextHistory = [...session.history, message];
        const updated: SessionData = {
            ...session,
            history: nextHistory,
            updatedAt: new Date(),
        };

        this.sessions.set(sessionId, updated);
        this.persistSession(updated);
        return cloneSession(updated);
    }

    updateFiles(sessionId: string, files: SessionFiles): SessionData {
        const session = this.getOrCreate(sessionId);
        const nextVersion = session.currentVersion + 1;
        const updated: SessionData = {
            ...session,
            files,
            updatedAt: new Date(),
            currentVersion: nextVersion,
        };

        this.sessions.set(sessionId, updated);
        this.persistSession(updated);
        return cloneSession(updated);
    }

    getFiles(sessionId: string): SessionFiles | undefined {
        const cached = this.sessions.get(sessionId);
        if (cached) {
            return { ...cached.files };
        }

        const loaded = this.loadFromDisk(sessionId);
        if (!loaded) {
            return undefined;
        }

        this.sessions.set(sessionId, loaded);
        return { ...loaded.files };
    }

    getFilesByVersion(
        sessionId: string,
        version: number,
    ): SessionFiles | undefined {
        if (!Number.isInteger(version) || version < 0) {
            return undefined;
        }

        const session = this.getOrCreate(sessionId);
        if (version > session.currentVersion) {
            return undefined;
        }

        const files = readVersionFiles(sessionId, version);
        if (files) {
            return files;
        }

        if (version === session.currentVersion) {
            return { ...session.files };
        }

        return undefined;
    }

    snapshot(sessionId: string): SessionData | undefined {
        const cached = this.sessions.get(sessionId);
        if (cached) {
            return cloneSession(cached);
        }

        const loaded = this.loadFromDisk(sessionId);
        if (!loaded) {
            return undefined;
        }

        this.sessions.set(sessionId, loaded);
        return cloneSession(loaded);
    }

    upsert(
        sessionId: string,
        update: SessionUpdate & { group?: number },
    ): SessionData {
        const session = this.getOrCreate(sessionId);
        const merged: SessionData = {
            ...session,
            ...update,
            files: update.files ?? session.files,
            history: update.history ?? session.history,
            updatedAt: update.updatedAt ?? new Date(),
            group: update.group ?? session.group,
        };

        this.sessions.set(sessionId, merged);
        this.persistSession(merged);
        return cloneSession(merged);
    }

    reset(sessionId: string): SessionData {
        // Preserve group on reset
        const oldSession = this.getOrCreate(sessionId);
        const fresh = this.createFreshSession(sessionId, oldSession.group);

        clearPersistedSessionData(sessionId);

        this.sessions.set(sessionId, fresh);
        this.persistSession(fresh);
        return cloneSession(fresh);
    }

    private loadFromDisk(sessionId: string): SessionData | undefined {
        const sessionDir = resolveSessionDir(sessionId);
        const metaPath = path.join(sessionDir, 'session.json');

        try {
            if (!fs.existsSync(metaPath)) {
                return undefined;
            }

            const raw = fs.readFileSync(metaPath, 'utf-8');
            const parsed: PersistedSession = JSON.parse(raw);
            const filesDir = path.join(sessionDir, FILES_DIRNAME);
            const files: SessionFiles = {
                html: readFileOrDefault(
                    path.join(filesDir, 'index.html'),
                    EMPTY_FILES.html,
                ),
                css: readFileOrDefault(
                    path.join(filesDir, 'styles.css'),
                    EMPTY_FILES.css,
                ),
                js: readFileOrDefault(
                    path.join(filesDir, 'script.js'),
                    EMPTY_FILES.js,
                ),
            };

            const history = Array.isArray(parsed.history)
                ? parsed.history.map((entry) => ({
                      role: entry.role,
                      content: entry.content,
                      selection: entry.selection,
                      version:
                          typeof entry.version === 'number'
                              ? entry.version
                              : undefined,
                      createdAt: new Date(entry.createdAt),
                  }))
                : [];

            const session: SessionData = {
                id: parsed.id || sessionId,
                files,
                history,
                updatedAt: parsed.updatedAt
                    ? new Date(parsed.updatedAt)
                    : new Date(),
                // Default to a random group if missing (legacy sessions) or maybe 0?
                // Let's use a deterministic hash of ID for consistency if missing?
                // Or just random. Random is fine but changes every reload if not saved.
                // We should save it back? For now, let's just use 0 or random.
                // Requirement: "if missing... assign random" implied for new, but for legacy?
                // Let's assign 0 for legacy to be safe/stable.
                group: parsed.group ?? 0,
                currentVersion:
                    typeof parsed.currentVersion === 'number'
                        ? parsed.currentVersion
                        : 0,
            };

            ensureVersionSnapshot(
                session.id,
                session.currentVersion,
                session.files,
            );

            return session;
        } catch (error) {
            console.error(
                `Failed to load session ${sessionId} from disk`,
                error,
            );
            return undefined;
        }
    }

    private persistSession(session: SessionData): void {
        const sessionDir = resolveSessionDir(session.id);
        const filesDir = path.join(sessionDir, FILES_DIRNAME);

        try {
            ensureDirectory(sessionDir);
            ensureDirectory(filesDir);

            const payload: PersistedSession = {
                id: session.id,
                updatedAt: session.updatedAt.toISOString(),
                group: session.group,
                currentVersion: session.currentVersion,
                history: session.history.map((message) => ({
                    role: message.role,
                    content: message.content,
                    selection: message.selection
                        ? { selector: message.selection.selector }
                        : undefined,
                    version:
                        typeof message.version === 'number'
                            ? message.version
                            : undefined,
                    createdAt: message.createdAt.toISOString(),
                })),
            };

            fs.writeFileSync(
                path.join(sessionDir, 'session.json'),
                JSON.stringify(payload, null, 2),
                'utf-8',
            );
            fs.writeFileSync(
                path.join(filesDir, 'index.html'),
                session.files.html,
                'utf-8',
            );
            fs.writeFileSync(
                path.join(filesDir, 'styles.css'),
                session.files.css,
                'utf-8',
            );
            fs.writeFileSync(
                path.join(filesDir, 'script.js'),
                session.files.js,
                'utf-8',
            );
            persistVersionFiles(
                session.id,
                session.currentVersion,
                session.files,
            );
        } catch (error) {
            console.error(
                `Failed to persist session ${session.id} to disk`,
                error,
            );
        }
    }
}

function resolveSessionRoot(): string {
    const customRoot = process.env.SESSION_ROOT?.trim();
    if (customRoot) {
        return path.resolve(customRoot);
    }
    return path.resolve(process.cwd(), 'data', 'sessions');
}

function resolveSessionDir(sessionId: string): string {
    const safeId = sanitizeSessionId(sessionId);
    return path.join(SESSION_ROOT, safeId);
}

function resolveVersionDir(sessionId: string, version: number): string {
    const safeVersion = Number.isInteger(version) && version >= 0 ? version : 0;
    return path.join(
        resolveSessionDir(sessionId),
        VERSION_DIRNAME,
        String(safeVersion),
    );
}

function sanitizeSessionId(value: string): string {
    if (!value) {
        return 'default';
    }
    const sanitized = value.replace(/[^a-zA-Z0-9-_]/g, '_');
    return sanitized || 'default';
}

function ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function removeDirectory(dir: string): void {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function clearPersistedSessionData(sessionId: string): void {
    const sessionDir = resolveSessionDir(sessionId);
    ensureDirectory(sessionDir);
    removeDirectory(path.join(sessionDir, FILES_DIRNAME));
    removeDirectory(path.join(sessionDir, VERSION_DIRNAME));
}

function copyVersionHistory(sourceId: string, targetId: string): void {
    const sourceDir = path.join(resolveSessionDir(sourceId), VERSION_DIRNAME);
    const targetDir = path.join(resolveSessionDir(targetId), VERSION_DIRNAME);
    try {
        if (!fs.existsSync(sourceDir)) {
            removeDirectory(targetDir);
            return;
        }

        removeDirectory(targetDir);
        ensureDirectory(path.dirname(targetDir));
        fs.cpSync(sourceDir, targetDir, { recursive: true });
    } catch (error) {
        console.error(
            `Failed to copy version history from ${sourceId} to ${targetId}`,
            error,
        );
    }
}

function copyVersionHistoryUpTo(
    sourceId: string,
    targetId: string,
    maxVersion: number,
): void {
    const sourceDir = path.join(resolveSessionDir(sourceId), VERSION_DIRNAME);
    const targetDir = path.join(resolveSessionDir(targetId), VERSION_DIRNAME);
    try {
        removeDirectory(targetDir);
        if (!fs.existsSync(sourceDir)) {
            return;
        }

        ensureDirectory(targetDir);
        for (let version = 0; version <= maxVersion; version += 1) {
            const sourceVersionDir = path.join(sourceDir, String(version));
            if (!fs.existsSync(sourceVersionDir)) {
                continue;
            }
            const destinationDir = path.join(targetDir, String(version));
            ensureDirectory(path.dirname(destinationDir));
            fs.cpSync(sourceVersionDir, destinationDir, { recursive: true });
        }
    } catch (error) {
        console.error(
            `Failed to copy partial version history from ${sourceId} to ${targetId}`,
            error,
        );
    }
}

function persistVersionFiles(
    sessionId: string,
    version: number,
    files: SessionFiles,
): void {
    const versionDir = resolveVersionDir(sessionId, version);
    ensureDirectory(versionDir);
    fs.writeFileSync(path.join(versionDir, 'index.html'), files.html, 'utf-8');
    fs.writeFileSync(path.join(versionDir, 'styles.css'), files.css, 'utf-8');
    fs.writeFileSync(path.join(versionDir, 'script.js'), files.js, 'utf-8');
}

function ensureVersionSnapshot(
    sessionId: string,
    version: number,
    files: SessionFiles,
): void {
    const versionDir = resolveVersionDir(sessionId, version);
    const sentinel = path.join(versionDir, 'index.html');
    if (fs.existsSync(sentinel)) {
        return;
    }
    persistVersionFiles(sessionId, version, files);
}

function readVersionFiles(
    sessionId: string,
    version: number,
): SessionFiles | undefined {
    const versionDir = resolveVersionDir(sessionId, version);
    if (!fs.existsSync(versionDir)) {
        return undefined;
    }
    return {
        html: readFileOrDefault(
            path.join(versionDir, 'index.html'),
            EMPTY_FILES.html,
        ),
        css: readFileOrDefault(
            path.join(versionDir, 'styles.css'),
            EMPTY_FILES.css,
        ),
        js: readFileOrDefault(
            path.join(versionDir, 'script.js'),
            EMPTY_FILES.js,
        ),
    };
}

function readFileOrDefault(filePath: string, fallback: string): string {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
        console.error(`Failed to read file ${filePath}`, error);
        return fallback;
    }
}

function cloneSession(session: SessionData): SessionData {
    return {
        id: session.id,
        files: { ...session.files },
        history: session.history.map((message) => ({
            ...message,
            createdAt: new Date(message.createdAt),
            selection: message.selection
                ? { selector: message.selection.selector }
                : undefined,
            version:
                typeof message.version === 'number'
                    ? message.version
                    : undefined,
        })),
        updatedAt: new Date(session.updatedAt),
        group: session.group,
        currentVersion: session.currentVersion,
    };
}
