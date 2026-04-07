import { Service } from "typedi";
import { Subscribe, AppStoppingEvent } from "../utils/bus";
import { ChatService } from "../services/ChatService";
import { ProjectDeletedEvent } from "../services/ProjectService";

@Service()
export class ChatHandler {
    constructor(
        private readonly chatService: ChatService,
    ) {
    }

    @Subscribe(AppStoppingEvent)
    async onAppStopping() {
        this.chatService.stopAll();
    }

    @Subscribe(ProjectDeletedEvent)
    async onProjectDeleted(payload: ReturnType<typeof ProjectDeletedEvent>['payload']) {
        this.chatService.deleteProjectSessions(payload.projectId);
    }
}