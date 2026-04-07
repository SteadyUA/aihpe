import { Service } from 'typedi';
import { Subscribe } from '../utils/bus';
import { ProjectService } from '../services/ProjectService';
import { SessionCreatedEvent, SessionDeletedEvent } from '../services/ChatService';

@Service()
export class ProjectHandler {
    constructor(
        private readonly projectService: ProjectService
    ) { }

    @Subscribe(SessionCreatedEvent)
    async onSessionCreated(payload: ReturnType<typeof SessionCreatedEvent>['payload']) {
        await this.projectService.addSessionToProject(
            payload.projectId,
            payload.sessionId,
            payload.sourceSessionId // Optional: insert after source
        );
    }

    @Subscribe(SessionDeletedEvent)
    async onSessionDeleted(payload: ReturnType<typeof SessionDeletedEvent>['payload']) {
        await this.projectService.removeSessionFromProject(
            payload.projectId,
            payload.sessionId
        );
    }
}
