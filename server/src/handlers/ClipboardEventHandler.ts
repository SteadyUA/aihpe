import { Service } from 'typedi';
import { Subscribe } from '../utils/bus';
import { ClipboardService } from '../services/ClipboardService';
import { ProjectDeletedEvent } from '../services/ProjectService';
import { SessionDeletedEvent, SessionVersionDeletedEvent } from '../services/ChatService';
import { AccountDeletedEvent } from '../services/AccountService';

@Service()
export class ClipboardEventHandler {
    constructor(private clipboardService: ClipboardService) {
        console.log('ClipboardEventHandler initialized');
    }

    @Subscribe(ProjectDeletedEvent)
    async onProjectDeleted(event: { projectId: string }) {
        try {
            await this.clipboardService.deleteByProject(event.projectId);
        } catch (error) {
            console.error('Failed to process ProjectDeletedEvent in ClipboardEventHandler:', error);
        }
    }

    @Subscribe(SessionDeletedEvent)
    async onSessionDeleted(event: { sessionId: string; projectId?: string }) {
        try {
            await this.clipboardService.deleteBySession(event.sessionId);
        } catch (error) {
            console.error('Failed to process SessionDeletedEvent in ClipboardEventHandler:', error);
        }
    }

    @Subscribe(AccountDeletedEvent)
    async onAccountDeleted(event: { accountId: number }) {
        try {
            await this.clipboardService.deleteByAccount(event.accountId);
        } catch (error) {
            console.error('Failed to process AccountDeletedEvent in ClipboardEventHandler:', error);
        }
    }

    @Subscribe(SessionVersionDeletedEvent)
    async onSessionVersionDeleted(event: { sessionId: string; targetVersion: number }) {
        try {
            await this.clipboardService.deleteBySessionVersion(event.sessionId, event.targetVersion);
        } catch (error) {
            console.error('Failed to process SessionVersionDeletedEvent in ClipboardEventHandler:', error);
        }
    }
}
