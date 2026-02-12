import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { Session } from '../../entities/Session';
import { AppDataSource } from '../../data-source';
import { ChatMessage, LlmProvider, SessionMetadata, SessionStatus, Turn } from '../../types/chat';

// SessionMetadata is now defined in types/chat.ts

@Service()
export class SessionService {
    private readonly sessions = new Map<string, SessionMetadata>();
    private nextGroupIndex = Math.floor(Math.random() * 10);
    private readonly sessionRepository = AppDataSource.getRepository(Session);

    public getNextGroup(): number {
        const group = this.nextGroupIndex;
        this.nextGroupIndex = (this.nextGroupIndex + 1) % 10;
        return group;
    }

    public async getMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
        const cached = this.sessions.get(sessionId);
        if (cached) return cached;

        const entity = await this.sessionRepository.findOne({ where: { sessionId } });
        if (!entity) return undefined;

        const metadata: SessionMetadata = {
            id: entity.sessionId,
            projectId: entity.projectId || '',
            updatedAt: entity.updatedAt || new Date(),
            group: entity.group || 0,
            currentVersion: entity.currentVersion || 0,
            lastTurn: entity.lastTurn || 0,
            provider: (entity.provider as LlmProvider) || 'openai',
            fastMode: entity.fastMode || false,
            status: (entity.status as SessionStatus) || 'idle',
            errorMessage: entity.errorMessage || undefined,
            subject: entity.subject || undefined,
            summary: entity.summary || undefined,
            summaryTurn: entity.summaryTurn || undefined,
        };

        this.sessions.set(sessionId, metadata);
        return metadata;
    }

    public async saveMetadata(metadata: SessionMetadata): Promise<void> {
        this.sessions.set(metadata.id, metadata);

        const entity = new Session();
        entity.sessionId = metadata.id;
        entity.projectId = metadata.projectId;
        entity.group = metadata.group;
        entity.currentVersion = metadata.currentVersion;
        entity.lastTurn = metadata.lastTurn ?? null;
        entity.provider = metadata.provider || 'openai';
        entity.status = metadata.status;
        entity.fastMode = metadata.fastMode || false;
        entity.subject = metadata.subject ?? null;
        entity.summary = metadata.summary ?? null;
        entity.summaryTurn = metadata.summaryTurn ?? null;
        entity.errorMessage = metadata.errorMessage ?? null;
        entity.updatedAt = metadata.updatedAt;

        await this.sessionRepository.save(entity);
    }

    public async updateMetadata(sessionId: string, update: Partial<SessionMetadata>): Promise<SessionMetadata> {
        const existing = await this.getMetadata(sessionId);
        if (!existing) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const updated = {
            ...existing,
            ...update,
            updatedAt: update.updatedAt ?? new Date(),
        };

        await this.saveMetadata(updated);
        return updated;
    }

    public deleteFromCache(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    public async deleteFromDb(sessionId: string): Promise<void> {
        await this.sessionRepository.delete({ sessionId });
    }
}
