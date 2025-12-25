import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { ChatMessage, SessionData, SessionFiles } from '../../types/chat';
import { sanitizeHistoryForUi } from '../../utils/chat';

type SessionUpdate = Partial<
    Pick<SessionData, 'files' | 'history' | 'context' | 'updatedAt' | 'lastTurn'>
>;

type PersistedHistoryEntry = Omit<ChatMessage, 'createdAt'> & {
    createdAt: string;
};

type PersistedSession = {
    id: string;
    updatedAt: string;
    group?: number;
    currentVersion?: number;
    lastTurn?: number;
    imageGenerationAllowed?: boolean;
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

const VERSION_DIRNAME = 'versions';

@Service()
export class SessionStore {
    private readonly sessions = new Map<string, SessionData>();

    constructor() {
        ensureDirectory(SESSION_ROOT);
    }

    getVersionForTurn(sessionId: string, turn: number): number | undefined {
        const session = this.getOrCreate(sessionId);
        // Find the last version used in or before this turn.
        // We look at history up to this turn.

        // Optimize: look backwards from end of history?
        // Or filter history by turn <= targetTurn.
        // Then find the max version.

        // Actually, we want the version that represents the state AT THE END of that turn.
        // The last message in that turn (or previous turns) that has a version.

        const relevantHistory = session.history.filter(m => typeof m.turn === 'number' && m.turn <= turn);
        if (relevantHistory.length === 0) {
            // If turn is 0 or no history, maybe 0?
            // If turn 0, version 0.
            return 0;
        }

        // Iterate backwards to find first message with version
        for (let i = relevantHistory.length - 1; i >= 0; i--) {
            const msg = relevantHistory[i];
            if (typeof msg.version === 'number') {
                return msg.version;
            }
        }

        return 0;
    }

    create(): SessionData {
        const id = randomUUID();
        const session = this.createFreshSession(id);
        this.sessions.set(id, session);
        this.persistSession(session);
        return cloneSession(session);
    }

    prepareCreate(): { id: string; group: number } {
        const id = randomUUID();
        const group = Math.floor(Math.random() * 12);
        return { id, group };
    }

    async executeCreate(id: string, group: number): Promise<SessionData> {
        const session = this.createFreshSession(id, group);
        this.sessions.set(id, session);
        this.persistSession(session);
        return cloneSession(session);
    }

    clone(sourceId: string): SessionData {
        const newId = randomUUID();
        return this.performCloneSession(newId, sourceId);
    }

    prepareClone(sourceId: string): { id: string; group: number } {
        const source = this.getOrCreate(sourceId);
        const id = randomUUID();
        return { id, group: source.group };
    }



    private performCloneSession(targetId: string, sourceId: string): SessionData {
        const source = this.getOrCreate(sourceId);
        const newSession: SessionData = {
            ...source,
            id: targetId,
            updatedAt: new Date(),
            history: source.history.map((h) => ({ ...h })),
            context: source.context.map((c) => ({ ...c })),
            files: { ...source.files },
            group: source.group,
            currentVersion: source.currentVersion,
            lastTurn: source.lastTurn,
            imageGenerationAllowed: source.imageGenerationAllowed,
        };

        clearPersistedSessionData(targetId);
        copyVersionHistory(sourceId, targetId);

        this.sessions.set(targetId, newSession);
        this.persistSession(newSession);
        return cloneSession(newSession);
    }

    async executeCloneAtTurn(targetId: string, sourceId: string, turn: number): Promise<SessionData> {
        const normalizedTurn = Math.floor(turn);
        if (!Number.isFinite(normalizedTurn) || normalizedTurn < 0) {
            throw new Error(`Invalid turn ${turn}`);
        }

        const source = this.getOrCreate(sourceId);
        const currentTurn = source.lastTurn ?? 0;

        if (normalizedTurn > currentTurn) {
            throw new Error(
                `Turn ${normalizedTurn} exceeds current session turn ${currentTurn}`,
            );
        }

        // 1. Filter History
        // We want all messages up to the end of the requested turn.
        // A turn loosely includes a User message + subsequent Assistant messages.
        // Let's assume we want to include ALL messages that have turn <= normalizedTurn.
        const truncatedHistory = source.history
            .filter((entry) => typeof entry.turn === 'number' && entry.turn <= normalizedTurn)
            .map((entry) => ({
                ...entry,
                createdAt: new Date(entry.createdAt),
                selection: entry.selection
                    ? { selector: entry.selection.selector }
                    : undefined,
                version:
                    typeof entry.version === 'number'
                        ? entry.version
                        : 0,
                turn: entry.turn,
            }));

        // 2. Filter Context
        // Same logic: include context items up to (and including) the requested turn.
        const contextSnapshot: ChatMessage[] = source.context
            .filter(m => typeof m.turn === 'number' && m.turn <= normalizedTurn)
            .map(m => ({
                ...m,
                version: typeof m.version === 'number' ? m.version : 0,
                turn: m.turn! // We filtered for number above
            }));

        // 3. Determine File Version
        // We need to find the MAX version that existed within the truncated history/context of this turn.
        // Alternatively (and perhaps safer), we look at the very last message in the truncated history.
        // If that message has a version, we use it. If not, we look back.
        // If no version is found in the entire history, we default to 0.
        let targetVersion = 0;
        for (let i = truncatedHistory.length - 1; i >= 0; i--) {
            const entry = truncatedHistory[i];
            if (typeof entry.version === 'number') {
                targetVersion = entry.version;
                break;
            }
        }

        // Also check context, in case context has a later version (unlikely, but possible if context update happened after msg)
        for (const ctx of contextSnapshot) {
            if (typeof ctx.version === 'number' && ctx.version > targetVersion) {
                targetVersion = ctx.version;
            }
        }

        const snapshot =
            targetVersion === source.currentVersion
                ? { ...source.files }
                : readVersionFiles(sourceId, targetVersion);

        if (!snapshot) {
            // Fallback or error? If version 0 and no files, maybe default files?
            // But if we found a version number, we expect files.
            throw new Error(`Files for version ${targetVersion} not found`);
        }

        const newSession: SessionData = {
            id: targetId,
            files: { ...snapshot },
            history: truncatedHistory,
            context: contextSnapshot,
            updatedAt: new Date(),
            group: source.group,
            currentVersion: targetVersion,
            lastTurn: normalizedTurn,
            imageGenerationAllowed: true, // Reset or copy? Resetting seems safer for a "fork".
        };

        clearPersistedSessionData(targetId);
        // We need to copy version history up to targetVersion.
        copyVersionHistoryUpTo(sourceId, targetId, targetVersion);

        this.sessions.set(targetId, newSession);
        this.persistSession(newSession);
        return cloneSession(newSession);
    }

    undoLastTurn(sessionId: string): {
        success: boolean;
        restoredInput?: string;
        restoredSelection?: { selector: string };
        previousTurn?: number;
    } {
        const session = this.getOrCreate(sessionId);
        const currentTurn = session.lastTurn ?? 0;

        if (currentTurn <= 0) {
            return { success: false };
        }

        // 1. Identify items to remove
        const messagesToRemove = session.history.filter(m => typeof m.turn === 'number' && m.turn === currentTurn);
        if (messagesToRemove.length === 0) {
            const updated: SessionData = {
                ...session,
                lastTurn: currentTurn - 1,
                updatedAt: new Date(),
            };
            this.sessions.set(sessionId, updated);
            this.persistSession(updated);
            return { success: true, previousTurn: currentTurn - 1 };
        }

        // 2. Capture restoration data
        const userMessage = messagesToRemove.find(m => m.role === 'user');
        const restoredInput = userMessage?.content;
        const restoredSelection = userMessage?.selection;

        // 3. New History & Context
        const newHistory = session.history.filter(m => typeof m.turn !== 'number' || m.turn < currentTurn);
        const newContext = session.context.filter(m => typeof m.turn !== 'number' || m.turn < currentTurn);

        // 4. Determine Target Version
        let targetVersion = 0;
        for (let i = newHistory.length - 1; i >= 0; i--) {
            if (typeof newHistory[i].version === 'number') {
                targetVersion = newHistory[i].version!;
                break;
            }
        }

        for (const ctx of newContext) {
            if (typeof ctx.version === 'number' && ctx.version > targetVersion) {
                targetVersion = ctx.version;
            }
        }

        // 5. Cleanup higher versions on disk
        const versionRootDir = path.join(resolveSessionDir(sessionId), VERSION_DIRNAME);
        if (fs.existsSync(versionRootDir)) {
            const dirs = fs.readdirSync(versionRootDir);
            for (const dir of dirs) {
                const ver = Number.parseInt(dir, 10);
                if (!Number.isNaN(ver) && ver > targetVersion) {
                    removeDirectory(path.join(versionRootDir, dir));
                }
            }
        }

        // 6. Restore Files
        const snapshot =
            targetVersion === 0
                ? { ...EMPTY_FILES }
                : readVersionFiles(sessionId, targetVersion) || { ...EMPTY_FILES };

        // 7. Update Session
        const updated: SessionData = {
            ...session,
            history: newHistory,
            context: newContext,
            files: snapshot,
            currentVersion: targetVersion,
            lastTurn: currentTurn - 1,
            updatedAt: new Date(),
        };

        this.sessions.set(sessionId, updated);
        this.persistSession(updated);

        return {
            success: true,
            restoredInput,
            restoredSelection: restoredSelection ? { selector: restoredSelection.selector } : undefined,
            previousTurn: currentTurn - 1
        };
    }

    deleteSession(sessionId: string): void {
        const sessionDir = resolveSessionDir(sessionId);

        // 1. Remove from memory
        this.sessions.delete(sessionId);

        // 2. Remove from disk
        if (fs.existsSync(sessionDir)) {
            removeDirectory(sessionDir);
        }
    }


    private createFreshSession(sessionId: string, group?: number): SessionData {
        return {
            id: sessionId,
            files: { ...EMPTY_FILES },
            history: [],
            context: [],
            updatedAt: new Date(),
            group: group ?? Math.floor(Math.random() * 12),
            currentVersion: 0,
            lastTurn: 0,
            imageGenerationAllowed: true,
        };
    }

    updateImageGenerationAllowed(sessionId: string, allowed: boolean): SessionData {
        const session = this.getOrCreate(sessionId);
        const updated: SessionData = {
            ...session,
            imageGenerationAllowed: allowed,
            updatedAt: new Date(),
        };
        this.sessions.set(sessionId, updated);
        this.persistSession(updated);
        return cloneSession(updated);
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

        let currentTurn = session.lastTurn ?? 0;

        // Logic to determine turn:
        // If the message is from 'user', we generally start a new turn.
        // However, we need to be careful. If this is the VERY first message, it's turn 1 (or 0?).
        // Let's adopt a simple convention:
        // The "Turn" increments when the user sends a message.
        // If history is empty, user message starts Turn 1.
        // If history exists, user message starts Turn N+1.
        // System/Assistant/Tool messages belong to the SAME turn as the preceding User message.

        // Wait, "lastTurn - номер последнего хода".
        // If I create a fresh session, lastTurn = 0.
        // First user message -> Turn 1?
        // Let's assume 1-based turns if we want "turn - 1" to make sense for "previous turn".
        // But "createFreshSession" sets lastTurn: 0.

        let messageTurn = currentTurn;

        if (message.role === 'user') {
            messageTurn = currentTurn + 1;
        } else {
            // For assistant/system/tool, we stay on the current turn.
            // Special case: if for some reason we have assistant message first (unlikely but possible in some setups),
            // it should probably belong to turn 0 or 1.
            // If lastTurn is 0, let's just keep it 0 or 1.
            if (messageTurn === 0) {
                // Maybe initialize to 1 if we have content? 
                // Or keep 0 if it's setup.
            }
        }

        if (messageTurn > currentTurn) {
            currentTurn = messageTurn;
        }

        const msgWithTurn = { ...message, turn: messageTurn };
        const nextHistory = [...session.history, msgWithTurn];

        const updated: SessionData = {
            ...session,
            history: nextHistory,
            lastTurn: currentTurn,
            updatedAt: new Date(),
        };

        this.sessions.set(sessionId, updated);
        this.persistSession(updated);
        return cloneSession(updated);
    }

    initNextVersion(sessionId: string): number {
        const session = this.getOrCreate(sessionId);
        const nextVersion = session.currentVersion + 1;

        const nextVersionDir = resolveVersionDir(sessionId, nextVersion);

        // Idempotency check: if next version directory already exists, just return the version number
        if (fs.existsSync(nextVersionDir)) {
            return nextVersion;
        }

        // Copy content from current version to next version
        copyVersionContent(sessionId, sessionId, session.currentVersion, nextVersion);

        return nextVersion;
    }

    updateFiles(sessionId: string, files: SessionFiles, targetVersion: number): SessionData {
        if (targetVersion === undefined || targetVersion === null) {
            throw new Error('targetVersion is required for updateFiles');
        }

        const session = this.getOrCreate(sessionId);

        // Ensure the target version directory exists (must be initialized via initNextVersion)
        const targetVersionDir = resolveVersionDir(sessionId, targetVersion);
        if (!fs.existsSync(targetVersionDir)) {
            throw new Error(`Version ${targetVersion} not initialized. Call initNextVersion first.`);
        }

        // We do NOT copy content here anymore. We assume initNextVersion did it.
        // We just overwrite the files with the new content in memory.

        // If we are updating to a newer version than current, bump currentVersion
        const newCurrentVersion = targetVersion > session.currentVersion ? targetVersion : session.currentVersion;

        const updated: SessionData = {
            ...session,
            files,
            updatedAt: new Date(),
            currentVersion: newCurrentVersion,
        };

        this.sessions.set(sessionId, updated);
        this.persistSession(updated);

        // Also ensure we persist the specific files to the version directory
        persistVersionFiles(sessionId, targetVersion, files);

        return cloneSession(updated);
    }

    updateSessionFile(
        sessionId: string,
        version: number,
        filename: keyof SessionFiles,
        content: string,
    ): SessionData {
        const session = this.getOrCreate(sessionId);

        // We now allow editing past versions, so this check is removed:
        // if (version !== session.currentVersion) { ... }

        const newFiles: SessionFiles = {
            ...session.files,
        };

        // If we are editing the current version, update the main files object
        // If we are editing an old version, we need to update that version's files specifically
        // But wait, the logic for 'current version' files vs 'versioned' files storage is tricky in this store.
        // 'session.files' holds the HEAD (current version). 
        // Old versions are stored in 'versions' directory on disk.

        // If editing current version:
        if (version === session.currentVersion) {
            newFiles[filename] = content;
            const updated: SessionData = {
                ...session,
                files: newFiles,
                updatedAt: new Date(),
            };
            this.sessions.set(sessionId, updated);
            this.persistSession(updated);
            return cloneSession(updated);
        }

        // If editing past version:
        // We don't update 'session.files' because that's HEAD.
        // We just need to persist the file to the version directory.
        // However, 'SessionData' object in memory doesn't hold old versions content typically, 
        // except what's in 'history'.
        // But 'files' in SessionData is ONLY HEAD.

        // So for past versions, we just write to disk.
        // And if we want to return the updated session, the session object itself might not change 
        // (unless we track 'updatedAt').

        // Let's write to disk.
        ensureVersionSnapshot(sessionId, version, readVersionFiles(sessionId, version) || EMPTY_FILES);
        // We need to overwrite the specific file now.
        const versionDir = resolveVersionDir(sessionId, version);
        ensureDirectory(versionDir);

        // Map abstract filename (html/css/js) to actual filename
        const actualFilename = filename === 'html' ? 'index.html' :
            filename === 'css' ? 'styles.css' :
                filename === 'js' ? 'script.js' :
                    undefined;

        if (actualFilename) {
            fs.writeFileSync(path.join(versionDir, actualFilename), content, 'utf-8');
        }

        const updated: SessionData = {
            ...session,
            updatedAt: new Date(),
        };
        this.sessions.set(sessionId, updated);
        // We might not need to persist the whole session.json if only a file in a version dir changed,
        // but updating 'updatedAt' suggests we should.
        this.persistSession(updated);

        return cloneSession(updated);
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

    getAllHistory(sessionId: string): ChatMessage[] | undefined {
        const session = this.getOrCreate(sessionId);

        return session.history.map((msg) => ({
            ...msg,
            createdAt: new Date(msg.createdAt),
            version: typeof msg.version === 'number' ? msg.version : 0,
            turn: typeof msg.turn === 'number' ? msg.turn : 0,
        }));
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
            context: update.context ?? session.context,
            updatedAt: update.updatedAt ?? new Date(),
            group: update.group ?? session.group,
        };

        this.sessions.set(sessionId, merged);
        this.persistSession(merged);
        return cloneSession(merged);
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

            const currentVersion = typeof parsed.currentVersion === 'number' ? parsed.currentVersion : 0;
            const versionDir = resolveVersionDir(sessionId, currentVersion);

            const files: SessionFiles = {
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

            const session: SessionData = {
                id: parsed.id || sessionId,
                files,
                history: [],
                context: [],
                updatedAt: parsed.updatedAt
                    ? new Date(parsed.updatedAt)
                    : new Date(),
                group: parsed.group ?? 0,
                currentVersion,
                lastTurn: parsed.lastTurn ?? 0,
                imageGenerationAllowed: parsed.imageGenerationAllowed ?? true, // Default to true if missing
            };

            // Attempt to load messages.json and context.json from session root
            const messagesPath = path.join(sessionDir, 'messages.json');
            const contextPath = path.join(sessionDir, 'context.json');

            if (fs.existsSync(messagesPath)) {
                try {
                    const rawMessages = fs.readFileSync(messagesPath, 'utf-8');
                    const rawHistory = JSON.parse(rawMessages);
                    session.history = sanitizeHistoryForUi(rawHistory);
                } catch (e) {
                    console.error(`Failed to parse messages.json for ${sessionId}`, e);
                }
            }

            if (fs.existsSync(contextPath)) {
                try {
                    const rawContext = fs.readFileSync(contextPath, 'utf-8');
                    session.context = JSON.parse(rawContext).map((entry: any) => ({
                        ...entry,
                        createdAt: new Date(entry.createdAt),
                    }));
                } catch (e) {
                    console.error(`Failed to parse context.json for ${sessionId}`, e);
                }
            }


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
        const versionDir = resolveVersionDir(session.id, session.currentVersion);

        try {
            ensureDirectory(sessionDir);
            ensureDirectory(versionDir);



            // Write to session root
            fs.writeFileSync(
                path.join(sessionDir, 'messages.json'),
                JSON.stringify(session.history, null, 2),
                'utf-8'
            );

            fs.writeFileSync(
                path.join(sessionDir, 'context.json'),
                JSON.stringify(session.context, null, 2),
                'utf-8'
            );
            const payload: PersistedSession = {
                id: session.id,
                updatedAt: session.updatedAt.toISOString(),
                group: session.group,
                currentVersion: session.currentVersion,
                lastTurn: session.lastTurn,
                imageGenerationAllowed: session.imageGenerationAllowed,
            };
            fs.writeFileSync(
                path.join(sessionDir, 'session.json'),
                JSON.stringify(payload, null, 2),
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'index.html'),
                session.files.html,
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'styles.css'),
                session.files.css,
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'script.js'),
                session.files.js,
                'utf-8',
            );
        } catch (error: any) {
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

function copyVersionContent(
    sourceId: string,
    targetId: string,
    sourceVersion: number,
    targetVersion: number,
): void {
    const sourceDir = resolveVersionDir(sourceId, sourceVersion);
    const targetDir = resolveVersionDir(targetId, targetVersion);

    try {
        if (!fs.existsSync(sourceDir)) {
            return;
        }

        ensureDirectory(targetDir);
        fs.cpSync(sourceDir, targetDir, { recursive: true });
    } catch (error) {
        console.error(
            `Failed to copy version content from ${sourceId} v${sourceVersion} to ${targetId} v${targetVersion}`,
            error,
        );
    }
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
                    : 0,
            turn: typeof message.turn === 'number' ? message.turn : 0,
        })),
        context: session.context.map((message) => ({
            ...message,
            createdAt: new Date(message.createdAt),
            selection: message.selection
                ? { selector: message.selection.selector }
                : undefined,
            version:
                typeof message.version === 'number'
                    ? message.version
                    : 0,
            turn: typeof message.turn === 'number' ? message.turn : 0,
        })),
        updatedAt: new Date(session.updatedAt),
        group: session.group,
        currentVersion: session.currentVersion,
        lastTurn: session.lastTurn,
        imageGenerationAllowed: session.imageGenerationAllowed,
    };
}
