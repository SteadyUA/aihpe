import { Service } from 'typedi';
import { Session } from '../../entities/Session';
import { AppDataSource } from '../../data-source';
import { LlmProvider, SessionMetadata, SessionStatus } from '../../types/chat';


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

    public getNextId(): string {
        return crypto.randomUUID();
    }

    public async getSessionsByProjectId(projectId: string): Promise<SessionMetadata[]> {
        const entities = await this.sessionRepository.find({ where: { projectId } });

        return entities.map(entity => {
            const metadata: SessionMetadata = {
                id: entity.sessionId,
                projectId: entity.projectId || '',
                updatedAt: entity.updatedAt || new Date(),
                group: entity.group || 0,
                currentVersion: entity.currentVersion || 0,
                lastTurn: entity.lastTurn || 0,
                provider: (entity.provider as LlmProvider) || 'openai',
                fastMode: entity.fastMode || false,
                status: (entity.status as SessionStatus) || SessionStatus.IDLE,
                errorMessage: entity.errorMessage || undefined,
                subject: entity.subject || undefined,
            };
            this.sessions.set(metadata.id, metadata);
            return metadata;
        });
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
            status: (entity.status as SessionStatus) || SessionStatus.IDLE,
            errorMessage: entity.errorMessage || undefined,
            subject: entity.subject || undefined,
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
        entity.errorMessage = metadata.errorMessage ?? null;
        entity.updatedAt = metadata.updatedAt;

        await this.sessionRepository.save(entity);
    }

    public async updateMetadata(
        sessionId: string,
        update: Partial<SessionMetadata>
    ): Promise<SessionMetadata> {
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
