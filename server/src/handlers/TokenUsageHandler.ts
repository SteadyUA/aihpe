import { Service } from 'typedi';
import { Subscribe } from '../utils/bus';
import { ChatTokenUsedEvent } from '../services/ChatService';
import { ImageTokenUsedEvent } from '../services/session/SessionImageService';
import { TokenUsageService } from '../services/llm/TokenUsageService';
import { SessionService } from '../services/session/SessionService';

@Service()
export class TokenUsageHandler {
    constructor(
        private readonly tokenUsageService: TokenUsageService,
        private readonly sessionService: SessionService,
    ) { }

    @Subscribe(ChatTokenUsedEvent)
    async onChatTokenUsed(payload: ReturnType<typeof ChatTokenUsedEvent>['payload']) {
        await this.tokenUsageService.saveUsage({
            projectId: payload.projectId,
            sessionId: payload.sessionId,
            agent: payload.agent,
            turn: payload.turn,
            model: payload.model,
            prompt: payload.prompt,
            completion: payload.completion,
            total: payload.total,
        });
    }

    @Subscribe(ImageTokenUsedEvent)
    async onImageTokenUsed(payload: ReturnType<typeof ImageTokenUsedEvent>['payload']) {
        // We need to fetch the session to get projectId and turn
        const session = await this.sessionService.getMetadata(payload.sessionId);
        if (!session) {
            console.warn(`[TokenUsageHandler] Received ImageTokenUsedEvent but session ${payload.sessionId} not found.`);
            return;
        }

        await this.tokenUsageService.saveUsage({
            projectId: session.projectId,
            sessionId: payload.sessionId,
            agent: payload.agent,
            turn: session.lastTurn || 0,
            model: payload.model,
            prompt: payload.prompt,
            completion: payload.completion,
            total: payload.total,
        });
    }
}
