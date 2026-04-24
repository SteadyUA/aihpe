import { Service } from 'typedi';
import { SessionTurn } from '../../entities/SessionTurn';
import { AppDataSource } from '../../data-source';
import { Turn, LlmProvider, ChatAttachment, ChatMessage , ChatRole } from '../../types/chat';
import { EventBus } from '../../utils/bus';

export const TurnCompletedEvent = EventBus.createEvent<{
    sessionId: string;
    turn: number;
    message: ChatMessage;
}>('turn.completed');

@Service()
export class TurnService {
    private readonly turnRepository = AppDataSource.getRepository(SessionTurn);

    constructor(private readonly eventBus: EventBus) {}

    public async loadTurns(sessionId: string): Promise<Turn[]> {
        const entries = await this.turnRepository.find({
            where: { sessionId },
            order: { turn: 'ASC' },
            relations: ['attachment']
        });

        return entries.map(entry => ({
            turn: entry.turn,
            beginTime: entry.beginTime,
            endTime: entry.endTime || undefined,
            request: entry.request,
            response: entry.response,
            provider: entry.provider as LlmProvider,
            fastMode: entry.fastMode,
            selection: entry.selection ? { selector: entry.selection } : undefined,
            attachment: entry.attachment ? {
                type: 'image',
                id: entry.attachment.id.toString(),
                filename: entry.attachment.filename,
                originalName: entry.attachment.originalName
            } as ChatAttachment : undefined,
            version: entry.version
        }));
    }

    public async saveTurns(sessionId: string, turns: Turn[]): Promise<void> {
        // Replace all for now to keep it simple
        await this.turnRepository.delete({ sessionId });

        const entities = turns.map(t => {
            const entity = new SessionTurn();
            entity.sessionId = sessionId;
            entity.turn = t.turn;
            entity.beginTime = t.beginTime;
            entity.endTime = t.endTime || null;
            entity.request = t.request;
            entity.response = t.response;
            entity.provider = t.provider;
            entity.fastMode = t.fastMode;
            entity.selection = t.selection?.selector || null;
            entity.uploadId = t.attachment?.id ? parseInt(t.attachment.id, 10) : null;
            entity.version = t.version;
            return entity;
        });

        if (entities.length > 0) {
            await this.turnRepository.save(entities);
        }
    }

    public async deleteTurns(sessionId: string): Promise<void> {
        await this.turnRepository.delete({ sessionId });
    }

    public async getVersionForTurn(sessionId: string, turn: number): Promise<number | undefined> {
        const turnEntry = await this.turnRepository.findOne({
            where: { sessionId, turn },
            select: ['version']
        });
        return turnEntry?.version;
    }

    public async appendTurn(sessionId: string, turn: Turn): Promise<void> {
        const entity = new SessionTurn();
        entity.sessionId = sessionId;
        entity.turn = turn.turn;
        entity.beginTime = turn.beginTime;
        entity.endTime = turn.endTime || null;
        entity.request = turn.request;
        entity.response = turn.response;
        entity.provider = turn.provider;
        entity.fastMode = turn.fastMode;
        entity.selection = turn.selection?.selector || null;
        entity.uploadId = turn.attachment?.id ? parseInt(turn.attachment.id, 10) : null;
        entity.version = turn.version;

        await this.turnRepository.save(entity);
    }

    public async updateTurn(sessionId: string, turnNumber: number, update: Partial<Turn>): Promise<void> {
        const turnEntry = await this.turnRepository.findOne({ where: { sessionId, turn: turnNumber } });
        if (!turnEntry) {
            throw new Error(`Turn ${turnNumber} for session ${sessionId} not found`);
        }

        if (update.endTime !== undefined) turnEntry.endTime = update.endTime || null;
        if (update.response !== undefined) turnEntry.response = update.response;
        if (update.version !== undefined) turnEntry.version = update.version;
        // Add other fields if needed, but these are the main ones updated during generation

        await this.turnRepository.save(turnEntry);

        if (update.response !== undefined) {
            const message: ChatMessage = {
                role: ChatRole.ASSISTANT,
                content: turnEntry.response,
                createdAt: turnEntry.endTime || new Date(),
                version: turnEntry.version,
                turn: turnEntry.turn,
            };

            this.eventBus.publish(TurnCompletedEvent({
                sessionId,
                turn: turnNumber,
                message,
            }));
        }
    }
}
