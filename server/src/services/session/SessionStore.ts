import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { ChatMessage, LlmProvider, SessionData, SessionFiles, UnsentData, SessionStatus, TokenUsage, Turn, ChatAttachment } from '../../types/chat';
import { formatContentForUi } from '../../utils/chat';
import { getSessionsDir } from '../../utils/pathUtils';
import { string } from 'zod';

type SessionUpdate = Partial<
    Pick<SessionData, 'files' | 'context' | 'updatedAt' | 'lastTurn' | 'unsent' | 'provider' | 'status' | 'fastMode' | 'subject' | 'errorMessage' | 'turns' | 'summary' | 'summaryTurn'>
>;


type PersistedSession = {
    id: string;
    updatedAt: string;
    group?: number;
    currentVersion?: number;
    lastTurn?: number;
    provider?: LlmProvider;
    fastMode?: boolean;
    unsent?: UnsentData;
    projectId?: string;
    status?: SessionStatus;
    errorMessage?: string;
    subject?: string;
    summary?: string;
    summaryTurn?: number;
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
    'index.html': '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>New Page</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <script src="script.js"></script>\n  </body>\n</html>',
    'styles.css': '/* Add your styles here */\nbody {\n  font-family: system-ui, sans-serif;\n  margin: 0;\n  padding: 2rem;\n  background-color: #f5f5f5;\n}\n',
    'script.js': DEFAULT_SESSION_SCRIPT,
};

const SESSION_ROOT = resolveSessionRoot();

const VERSION_DIRNAME = 'versions';

@Service()
export class SessionStore {
    private readonly sessions = new Map<string, SessionData>();
    private nextGroupIndex = Math.floor(Math.random() * 10);

    constructor() {
        ensureDirectory(SESSION_ROOT);
    }

    private getNextGroup(): number {
        const group = this.nextGroupIndex;
        this.nextGroupIndex = (this.nextGroupIndex + 1) % 10;
        return group;
    }

    getVersionForTurn(sessionId: string, turn: number): number | undefined {
        const session = this.getOrCreate(sessionId);

        // Find the last version used in or before this turn.
        const relevantTurns = session.turns.filter(t => t.turn <= turn);
        if (relevantTurns.length === 0) {
            return undefined;
        }

        // Return version of the last relevant turn
        // Note: each turn has a version. We take the version of the latest turn.
        return relevantTurns[relevantTurns.length - 1].version;
    }

    create(projectId: string, group?: number): SessionData {
        const id = randomUUID();
        const session = this.createFreshSession(id, projectId, group);
        this.sessions.set(id, session);
        this.persistSession(session);
        return cloneSession(session);
    }

    prepareCreate(): { id: string; group: number } {
        const id = randomUUID();
        const group = this.getNextGroup();
        return { id, group };
    }

    async executeCreate(id: string, projectId: string, group: number): Promise<SessionData> {
        const session = this.createFreshSession(id, projectId, group);
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
            context: source.context.map((c) => ({ ...c })),
            files: { ...source.files },
            group: source.group,
            currentVersion: source.currentVersion,
            lastTurn: source.lastTurn,
            provider: source.provider,
            projectId: source.projectId,
            status: 'idle', // Clone starts idle? Or copy? Usually idle as it's a new session.
        };

        clearPersistedSessionData(targetId);
        copyVersionHistory(sourceId, targetId);
        copyUploads(sourceId, targetId);

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

        // 1. Filter Context
        const contextSnapshot: ChatMessage[] = source.context
            .filter(m => typeof m.turn === 'number' && m.turn <= normalizedTurn)
            .map(m => ({
                ...m,
                version: typeof m.version === 'number' ? m.version : 0,
                turn: m.turn!
            }));

        // 2. Filter Turns
        const turnsSnapshot = source.turns
            .filter(t => t.turn <= normalizedTurn)
            .map(t => ({ ...t }));

        // 3. Determine File Version
        // We look at the last turn in the snapshot to determine the version.
        let targetVersion = 0;
        if (turnsSnapshot.length > 0) {
            targetVersion = turnsSnapshot[turnsSnapshot.length - 1].version;
        }

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
            throw new Error(`Files for version ${targetVersion} not found`);
        }

        const newSession: SessionData = {
            id: targetId,
            files: { ...snapshot },
            context: contextSnapshot,
            updatedAt: new Date(),
            group: source.group,
            currentVersion: targetVersion,
            lastTurn: normalizedTurn,
            provider: source.provider,
            projectId: source.projectId,
            status: 'idle',
            subject: source.subject,
            fastMode: source.fastMode,
            turns: turnsSnapshot,
            summary: source.summary,
            summaryTurn: source.summaryTurn,
        };

        clearPersistedSessionData(targetId);
        // We need to copy version history up to targetVersion.
        copyVersionHistoryUpTo(sourceId, targetId, targetVersion);
        copyUploads(sourceId, targetId);

        this.sessions.set(targetId, newSession);
        this.persistSession(newSession);
        return cloneSession(newSession);
    }

    undoLastTurn(sessionId: string): {
        success: boolean;
        restoredInput?: string;
        restoredSelection?: string;
        restoredAttachment?: ChatAttachment;
        previousTurn?: number;
    } {
        const session = this.getOrCreate(sessionId);
        const currentTurn = session.lastTurn ?? 0;

        if (currentTurn <= 0) {
            return { success: false };
        }

        // 1. Identify items to remove
        const turnToRemove = session.turns[currentTurn - 1];

        if (!turnToRemove) {
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
        const restoredInput = turnToRemove.request;
        const restoredSelection = turnToRemove.selection?.selector;
        const restoredAttachment = turnToRemove.attachment;

        // 3. New Context & Turns
        const newContext = session.context.filter(m => typeof m.turn !== 'number' || m.turn < currentTurn);
        const newTurns = session.turns.filter(t => t.turn < currentTurn);

        // 4. Determine Target Version
        let targetVersion = 0;
        if (newTurns.length > 0) {
            targetVersion = newTurns[newTurns.length - 1].version;
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
            context: newContext,
            files: snapshot,
            currentVersion: targetVersion,
            lastTurn: currentTurn - 1,
            updatedAt: new Date(),
            unsent: {
                ...session.unsent,
                input: restoredInput,
                selection: restoredSelection, // selector string
                attachment: restoredAttachment,
            },
            status: 'idle', // Reset status to idle to clear error state
            turns: newTurns,
        };

        this.sessions.set(sessionId, updated);
        this.persistSession(updated);

        return {
            success: true,
            restoredInput,
            restoredSelection,
            restoredAttachment,
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


    private createFreshSession(sessionId: string, projectId: string, group?: number): SessionData {
        return {
            id: sessionId,
            projectId,
            files: { ...EMPTY_FILES },
            context: [],
            updatedAt: new Date(),
            group: group ?? this.getNextGroup(),
            currentVersion: 0,
            lastTurn: 0,
            provider: 'openai', // Default provider
            fastMode: false,
            unsent: {},
            status: 'idle',
            subject: '...',
            turns: [],
        };
    }

    updateProvider(sessionId: string, provider: LlmProvider): SessionData {
        const session = this.getOrCreate(sessionId);
        const updated: SessionData = {
            ...session,
            provider,
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

        // If not found and generic create requested, defaulting to empty project? 
        // This path (auto-creation without explicit create call) is dangerous now as we need projectId.
        // Usually getOrCreate is called for EXISTING sessions or implicitly created ones.
        // If we strictly require projectId, we cannot create a FRESH session here without knowing it.
        // But for compatibility, let's assume we fallback to legacy/empty project.
        const fresh = this.createFreshSession(sessionId, '');

        this.sessions.set(sessionId, fresh);
        this.persistSession(fresh);
        return cloneSession(fresh);
    }

    appendMessage(sessionId: string, message: ChatMessage): SessionData {
        const session = this.getOrCreate(sessionId);

        let currentTurn = session.lastTurn ?? 0;

        // Logic to determine turn:
        // If the message is from 'user', we generally start a new turn.
        // If history exists, user message starts Turn N+1.
        // System/Assistant/Tool messages belong to the SAME turn as the preceding User message.

        // Wait, "lastTurn - number of the last turn".
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
        const nextTurns = [...session.turns];

        // appendMessage is tricky with turns. We need to respect the request/response structure.
        // But for now, let's just update lastTurn and assume the turn entry is managed elsewhere or we add a partial turn.
        // Actually, we should probably throw or handle this better. 
        // For now, removing history update. 
        // NOTE: This method seems legacy or for simple appends?

        const updated: SessionData = {
            ...session,
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
        filename: string,
        content: string,
    ): SessionData {
        const session = this.getOrCreate(sessionId);

        const newFiles: SessionFiles = {
            ...session.files,
        };

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

        // Editing past version
        ensureVersionSnapshot(sessionId, version, readVersionFiles(sessionId, version) || EMPTY_FILES);
        const versionDir = resolveVersionDir(sessionId, version);
        ensureDirectory(versionDir);

        fs.writeFileSync(path.join(versionDir, filename), content, 'utf-8');

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




    getTurns(sessionId: string, limit: number = 50, beforeTurn?: number): Turn[] {
        const session = this.getOrCreate(sessionId);

        // Filter turns if beforeTurn is specified
        let turns = session.turns;
        if (typeof beforeTurn === 'number') {
            turns = turns.filter(t => t.turn < beforeTurn);
        }

        // Sort turns by index to ensure order
        turns.sort((a, b) => a.turn - b.turn);

        // Return the last 'limit' turns
        return turns.slice(-limit);
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
            context: update.context ?? session.context,
            updatedAt: update.updatedAt ?? new Date(),
            group: update.group ?? session.group,
            provider: update.provider ?? session.provider,
            fastMode: update.fastMode ?? session.fastMode,
            status: update.status ?? session.status,
            summary: update.summary ?? session.summary,
            summaryTurn: update.summaryTurn ?? session.summaryTurn,
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
                'index.html': readFileOrDefault(
                    path.join(versionDir, 'index.html'),
                    EMPTY_FILES['index.html'],
                ),
                'styles.css': readFileOrDefault(
                    path.join(versionDir, 'styles.css'),
                    EMPTY_FILES['styles.css'],
                ),
                'script.js': readFileOrDefault(
                    path.join(versionDir, 'script.js'),
                    EMPTY_FILES['script.js'],
                ),
            };

            const session: SessionData = {
                id: parsed.id || sessionId,
                projectId: parsed.projectId || '',
                files,
                context: [],
                updatedAt: parsed.updatedAt
                    ? new Date(parsed.updatedAt)
                    : new Date(),
                group: parsed.group ?? 0,
                currentVersion,
                lastTurn: parsed.lastTurn ?? 0,
                provider: parsed.provider ?? 'openai',
                fastMode: parsed.fastMode ?? false,
                unsent: parsed.unsent || {},
                status: parsed.status ?? 'idle',
                errorMessage: parsed.errorMessage,
                subject: parsed.subject,
                summary: parsed.summary,
                summaryTurn: parsed.summaryTurn,
                turns: [],
            };

            // Attempt to load context.json from session root
            const contextPath = path.join(sessionDir, 'context.json');
            const turnsPath = path.join(sessionDir, 'turns.json');

            if (fs.existsSync(turnsPath)) {
                try {
                    const rawTurns = fs.readFileSync(turnsPath, 'utf-8');
                    session.turns = JSON.parse(rawTurns).map((t: any) => ({
                        ...t,
                        beginTime: new Date(t.beginTime),
                        endTime: new Date(t.endTime),
                    }));
                    // Reconstruct history from turns DEPRECATED
                    // Reconstruct history from turns DEPRECATED
                } catch (e) {
                    console.error(`Failed to parse turns.json for ${sessionId}`, e);
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
                path.join(sessionDir, 'context.json'),
                JSON.stringify(session.context, null, 2),
                'utf-8'
            );

            fs.writeFileSync(
                path.join(sessionDir, 'turns.json'),
                JSON.stringify(session.turns, null, 2),
                'utf-8'
            );

            const payload: PersistedSession = {
                id: session.id,
                projectId: session.projectId,
                updatedAt: session.updatedAt.toISOString(),
                group: session.group,
                currentVersion: session.currentVersion,
                lastTurn: session.lastTurn,
                provider: session.provider,
                unsent: session.unsent,
                status: session.status,
                subject: session.subject,
                fastMode: session.fastMode,
                errorMessage: session.errorMessage,
                summary: session.summary,
                summaryTurn: session.summaryTurn,
            };
            fs.writeFileSync(
                path.join(sessionDir, 'session.json'),
                JSON.stringify(payload, null, 2),
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'index.html'),
                session.files['index.html'],
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'styles.css'),
                session.files['styles.css'],
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'script.js'),
                session.files['script.js'],
                'utf-8',
            );
            fs.writeFileSync(
                path.join(versionDir, 'script.js'),
                session.files['script.js'],
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
    return getSessionsDir();
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

function copyUploads(sourceId: string, targetId: string): void {
    const sourceDir = path.join(resolveSessionDir(sourceId), 'uploads');
    const targetDir = path.join(resolveSessionDir(targetId), 'uploads');

    try {
        if (!fs.existsSync(sourceDir)) {
            return; // No uploads to copy
        }

        // Ensure parent dir exists (session dir)
        ensureDirectory(resolveSessionDir(targetId));

        // Remove existing target uploads if any
        if (fs.existsSync(targetDir)) {
            removeDirectory(targetDir);
        }

        // Copy recursive
        fs.cpSync(sourceDir, targetDir, { recursive: true });
    } catch (error) {
        console.error(
            `Failed to copy uploads from ${sourceId} to ${targetId}`,
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
    fs.writeFileSync(path.join(versionDir, 'index.html'), files['index.html'], 'utf-8');
    fs.writeFileSync(path.join(versionDir, 'styles.css'), files['styles.css'], 'utf-8');
    fs.writeFileSync(path.join(versionDir, 'script.js'), files['script.js'], 'utf-8');
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
        'index.html': readFileOrDefault(
            path.join(versionDir, 'index.html'),
            EMPTY_FILES['index.html'],
        ),
        'styles.css': readFileOrDefault(
            path.join(versionDir, 'styles.css'),
            EMPTY_FILES['styles.css'],
        ),
        'script.js': readFileOrDefault(
            path.join(versionDir, 'script.js'),
            EMPTY_FILES['script.js'],
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
        provider: session.provider,
        unsent: session.unsent ? { ...session.unsent } : undefined,
        projectId: session.projectId,

        status: session.status,
        errorMessage: session.errorMessage,
        subject: session.subject,
        fastMode: session.fastMode,
        summary: session.summary,
        summaryTurn: session.summaryTurn,
        turns: session.turns.map(t => ({ ...t })),
    };
}
