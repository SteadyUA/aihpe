import { SseService } from "../services/SseService";
import { Service } from "typedi";
import { AppStoppingEvent, Subscribe } from "../utils/bus";
import { SessionCreatedEvent, SessionPatchEvent, SessionStatusChangedEvent } from "../services/ChatService";
import { TurnCompletedEvent } from "../services/session/TurnService";
import { TokenUsageChangedEvent } from "../services/llm/TokenUsageService";

@Service()
export class SseHandler {
    constructor(
        private readonly sseService: SseService,
    ) {
    }

    @Subscribe(AppStoppingEvent)
    async onAppStopping() {
        this.sseService.emitServerStop();
        console.log('Broadcasted server-stop event');
    }

    @Subscribe(SessionCreatedEvent)
    async onSessionCreated(payload: ReturnType<typeof SessionCreatedEvent>['payload']) {
        this.sseService.emitSessionCreated({
            id: payload.sessionId,
            projectId: payload.projectId,
            group: payload.group,
            sourceSessionId: payload.sourceSessionId || 'system',
            lastTurn: payload.lastTurn,
        });
    }

    @Subscribe(SessionStatusChangedEvent)
    async onSessionStatusChanged(payload: ReturnType<typeof SessionStatusChangedEvent>['payload']) {
        this.sseService.emitChatStatus({
            sessionId: payload.sessionId,
            status: payload.status,
            message: payload.message,
        });
    }

    @Subscribe(TurnCompletedEvent)
    async onTurnCompleted(payload: ReturnType<typeof TurnCompletedEvent>['payload']) {
        this.sseService.emitTurnCompleted(payload);
    }

    @Subscribe(TokenUsageChangedEvent)
    async onTokenUsageChanged(payload: ReturnType<typeof TokenUsageChangedEvent>['payload']) {
        this.sseService.emitTokenUsage(payload);
    }

    @Subscribe(SessionPatchEvent)
    async onSessionPatch(payload: ReturnType<typeof SessionPatchEvent>['payload']) {
        this.sseService.emitSessionUpdate(payload);
    }
}