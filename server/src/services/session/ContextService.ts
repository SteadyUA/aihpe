import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { SessionContext } from '../../entities/SessionContext';
import { AppDataSource } from '../../data-source';
import { ChatMessage, ChatRole, ChatAttachment } from '../../types/chat';

@Service()
export class ContextService {
    private readonly contextRepository = AppDataSource.getRepository(SessionContext);

    public async loadContext(sessionId: string): Promise<ChatMessage[]> {
        const entries = await this.contextRepository.find({
            where: { sessionId },
            order: { createdAt: 'ASC' },
            relations: ['attachment']
        });

        return entries.map(entry => ({
            role: entry.role as ChatRole,
            content: entry.content,
            selection: entry.selection ? { selector: entry.selection } : undefined,
            attachment: entry.attachment ? {
                type: 'image',
                id: entry.attachment.id.toString(),
                filename: entry.attachment.filename,
                originalName: entry.attachment.originalName
            } as ChatAttachment : undefined,
            version: entry.version,
            turn: entry.turn,
            createdAt: entry.createdAt
        }));
    }

    public async saveContext(sessionId: string, context: ChatMessage[]): Promise<void> {
        // Replace all for now to keep it simple, as in the original implementation
        await this.contextRepository.delete({ sessionId });

        const entities = context.map(msg => {
            const entity = new SessionContext();
            entity.sessionId = sessionId;
            entity.role = msg.role;
            entity.content = msg.content;
            entity.selection = msg.selection?.selector || null;
            entity.uploadId = msg.attachment?.id ? parseInt(msg.attachment.id, 10) : null;
            entity.version = msg.version;
            entity.turn = msg.turn;
            entity.createdAt = msg.createdAt;
            return entity;
        });

        if (entities.length > 0) {
            await this.contextRepository.save(entities);
        }
    }

    public async deleteContext(sessionId: string): Promise<void> {
        await this.contextRepository.delete({ sessionId });
    }

    public async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
        const entity = new SessionContext();
        entity.sessionId = sessionId;
        entity.role = message.role;
        entity.content = message.content;
        entity.selection = message.selection?.selector || null;
        entity.uploadId = message.attachment?.id ? parseInt(message.attachment.id, 10) : null;
        entity.version = message.version;
        entity.turn = message.turn;
        entity.createdAt = message.createdAt;

        await this.contextRepository.save(entity);
    }
}
