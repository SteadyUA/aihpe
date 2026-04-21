import { Service } from 'typedi';
import { ChatAttachment, ChatMessage, LlmProvider, SessionMetadata, SessionStatus, Turn, ChatRole } from '../types/chat';

import { FilesService } from './session/FilesService';
import { SessionService } from './session/SessionService';
import { ContextService } from './session/ContextService';
import { TurnService } from './session/TurnService';
import { PageGenAgent } from './llm/agents/PageGenAgent';
import { HistorySummaryAgent } from './llm/agents/HistorySummaryAgent';
import { ProjectService } from './ProjectService';
import { ImageService } from './image/ImageService';
import { formatContentForUi, calculateContextStartTurn } from '../utils/chat';
import { UnsentService } from './session/UnsentService';
import { UploadService } from './image/UploadService';
import { EventBus } from '../utils/bus';

export const SessionCreatedEvent = EventBus.createEvent<{
    sessionId: string;
    projectId: string;
    group: number;
    sourceSessionId?: string;
    lastTurn?: number;
}>('SESSION_CREATED');

export const SessionDeletedEvent = EventBus.createEvent<{
    sessionId: string;
    projectId: string;
}>('SESSION_DELETED');

export const SessionPatchEvent = EventBus.createEvent<any>('SESSION_PATCH');

export const SessionStatusChangedEvent = EventBus.createEvent<{
    sessionId: string;
    status: SessionStatus;
    message?: string;
}>('SESSION_STATUS_CHANGED');

export const ChatTokenUsedEvent = EventBus.createEvent<{
    sessionId: string;
    projectId: string;
    agent: string;
    turn: number;
    model: string;
    prompt: number;
    completion: number;
    total: number;
}>('CHAT_TOKEN_USED');

@Service()
export class ChatService {
    constructor(
        private readonly filesService: FilesService,
        private readonly sessionService: SessionService,
        private readonly contextService: ContextService,
        private readonly turnService: TurnService,
        private readonly pageGenAgent: PageGenAgent,
        private readonly historySummaryAgent: HistorySummaryAgent,
        private readonly imageService: ImageService,
        private readonly projectService: ProjectService,
        private readonly unsentService: UnsentService,
        private readonly uploadService: UploadService,
        private readonly eventBus: EventBus,
    ) { }

    private activeGenerations = new Map<string, AbortController>();

    async addUserMessage(
        sessionId: string,
        userMessage: string,
        attachment?: ChatAttachment,
        selection?: { selector: string },
        provider?: LlmProvider,
        fastMode?: boolean,
    ): Promise<{
        turn: number;
        promptData?: {
            message: string;
            attachment?: ChatAttachment;
            selection?: { selector: string };
            createdAt?: Date;
        };
        skipped: boolean;
    }> {
        const trimmed = userMessage.trim();
        const normalizedAttachment = await this.prepareAttachment(sessionId, attachment);
        const hasContent =
            trimmed.length > 0 ||
            !!normalizedAttachment ||
            !!selection;

        const metadata = await this.sessionService.getMetadata(sessionId);
        if (!metadata) {
            throw new Error(`Session ${sessionId} not found`);
        }

        if (!hasContent) {
            this.notifyStatus(
                sessionId,
                SessionStatus.IDLE,
                'Message is empty. No changes applied.',
            );
            return {
                turn: metadata?.lastTurn ?? 0,
                skipped: true,
            };
        }

        // Update provider if specified and different
        if (provider && provider != metadata.provider) {
            await this.sessionService.updateMetadata(sessionId, { provider });
        }

        // Reload session metadata after potential update
        const currentMetadata = await this.sessionService.getMetadata(sessionId);
        if (!currentMetadata) {
            throw new Error(`Session ${sessionId} not found`);
        }

        // Append user message immediately
        const userContentForHistory = this.composeUserContent(
            trimmed,
            normalizedAttachment,
        );
        const now = new Date();
        // Determine turn: User message starts a new turn
        const currentTurn = currentMetadata.lastTurn ?? 0;

        const newTurn = currentTurn + 1;

        const contextEntry: ChatMessage = {
            role: ChatRole.USER,
            content: this.enrichContentWithSelection(userContentForHistory, selection),
            createdAt: now,
            selection,
            attachment: normalizedAttachment,
            version: currentMetadata.currentVersion,
            turn: newTurn,
        };

        // Create incomplete Turn
        const newTurnEntry: Turn = {
            turn: newTurn,
            beginTime: now,
            request: userContentForHistory,
            response: '',
            provider: provider ?? currentMetadata.provider ?? LlmProvider.OPENAI,
            fastMode: fastMode ?? currentMetadata.fastMode ?? false,
            selection,
            attachment: normalizedAttachment,
            version: currentMetadata.currentVersion,
        };

        // Append new messages
        await this.contextService.appendMessage(sessionId, contextEntry);

        // Append new turn
        await this.turnService.appendTurn(sessionId, newTurnEntry);

        await this.sessionService.updateMetadata(sessionId, {
            lastTurn: newTurn,
            updatedAt: now,
            fastMode: fastMode ?? currentMetadata.fastMode,
        });

        // Clear unsent data as we just sent it
        await this.unsentService.deleteUnsent(sessionId);

        return {
            turn: newTurn,
            promptData: {
                message: trimmed,
                attachment: normalizedAttachment,
                selection,
                createdAt: now,
            },
            skipped: false,
        };
    }

    async generateResponse(
        sessionId: string,
        promptData: {
            message: string;
            attachment?: ChatAttachment;
            selection?: { selector: string };
            createdAt?: Date;
        },
        turn: number,
        allowVariants: boolean = true,
        fastModeOverride?: boolean,
    ): Promise<void> {
        this.notifyStatus(sessionId, SessionStatus.STARTED, 'Thinking...');

        // Cancel any existing generation for this session (just in case)
        if (this.activeGenerations.has(sessionId)) {
            try {
                this.activeGenerations.get(sessionId)?.abort();
                this.activeGenerations.delete(sessionId);
            } catch (e) { }
        }

        const controller = new AbortController();
        this.activeGenerations.set(sessionId, controller);

        // Refresh session metadata to get the new summary
        let currentMetadata = await this.sessionService.getMetadata(sessionId);
        if (!currentMetadata) throw new Error(`Session ${sessionId} not found`);

        // 0. Generate history summary properly BEFORE generation
        await this.generateHistorySummary(sessionId, turn);

        // 2. Prepare conversation history for prompt
        const currentContext = await this.contextService.loadContext(sessionId);

        // Apply Step-based Window logic
        const startTurn = calculateContextStartTurn(turn);

        // We assume the last message in context is the one we just added (the user instruction)
        // Check if context has message for current turn?
        // Note: addUserMessage added it. So currentContext should have it at the end.
        // historyCandidates should exclude it.
        const historyCandidates = currentContext.slice(0, -1).filter((msg) => (msg.turn ?? 0) >= startTurn);

        // hydrate attachments for the prompt/LLM
        // Note: We need to hydrate ONLY the items that are going to be sent to LLM?
        // Or do we need to hydrate history too?
        // AI SDK usually handles history images if they have dataUrl.
        // But our stored history now DOES NOT have dataUrl.
        // We probably need to hydrate the ENTIRE conversation history that has images?
        // Or at least the current message's attachments.
        // For now, let's just hydrate the current request attachments.
        // If we want history images to work, we'd need to hydrate conversation too.

        // Let's hydrate the current attachment first (for the prompt 'user' message)
        const hydratedCurrentAttachment = await this.hydrateAttachment(sessionId, promptData.attachment);

        // We also need to hydrate conversation history images if they are used by the model
        // Ideally we should do this in generatePage or before passing.

        // Let's create a hydrated copy of the conversation for the LLM
        const conversation = await Promise.all(historyCandidates.map(async (msg) => {
            if (msg.attachment) {
                return {
                    ...msg,
                    attachment: await this.hydrateAttachment(sessionId, msg.attachment)
                };
            }
            return msg;
        }));

        let selectorsSummary = '';
        if (promptData.attachment) {
            selectorsSummary = `Image: ${promptData.attachment.filename}`;
        }
        const selectionContext = promptData.selection
            ? `Selected element: ${promptData.selection.selector}.`
            : '';

        let effectiveInstructions = promptData.message;
        if (selectionContext) {
            effectiveInstructions = `${selectionContext} ${effectiveInstructions}`;
        }
        if (!effectiveInstructions && selectorsSummary) {
            effectiveInstructions = `Process attached screenshots of selected elements: ${selectorsSummary}.`;
        }

        const project = await this.projectService.getProject(currentMetadata.projectId);
        const rulesAndGoal = project?.rulesAndGoal;
        const imageGenerationPref = project?.imageGenerationPref;
        const modelRole = project?.modelRole;

        try {
            // Buffer for streaming thoughts to avoid emitting too frequent partial updates
            let thoughtBuffer = '';

            const generation = await this.pageGenAgent.generatePage(currentMetadata.provider || LlmProvider.OPENAI, {
                sessionId,
                instructions: effectiveInstructions,
                conversation,
                attachment: hydratedCurrentAttachment,
                allowVariants,
                currentVersion: currentMetadata.currentVersion,
                rulesAndGoal,
                imageGenerationPref,
                modelRole,
                fastMode: fastModeOverride ?? currentMetadata.fastMode,
                subject: currentMetadata.subject,
                abortSignal: controller.signal,
                summary: currentMetadata.summary, // Pass cumulative summary
                onTokenUsage: this.createTokenUsageCallback(sessionId, currentMetadata.projectId, turn),
                onPatch: (patch: any) => {
                    this.eventBus.publish(SessionPatchEvent({
                        sessionId,
                        ...patch,
                    }));
                },
                onNewMessage: async (msg: ChatMessage) => {
                    const currentMeta = await this.sessionService.getMetadata(sessionId);
                    await this.contextService.appendMessage(sessionId, {
                        ...msg,
                        version: currentMeta?.currentVersion || currentMetadata.currentVersion,
                        turn: currentMeta?.lastTurn ?? turn,
                    });
                },
                onChunkContent: (chunk: string) => {
                    if (controller.signal.aborted) return;

                    // Text stream (thoughts)
                    thoughtBuffer += chunk;
                    if (thoughtBuffer.includes('\n')) {
                        const lines = thoughtBuffer.split('\n');
                        thoughtBuffer = lines.pop() || ''; // Keep last partial line

                        for (const line of lines) {
                            const trimmedLine = line.trim();
                            if (trimmedLine.length > 0) {
                                this.notifyStatus(sessionId, SessionStatus.GENERATING, trimmedLine);
                            }
                        }
                    }
                },
                onToolCall: (toolName: string, args: any) => {
                    if (controller.signal.aborted) return;
                    const summary = args?.summary || toolName;
                    this.notifyStatus(sessionId, SessionStatus.GENERATING, summary);
                },
                onVariantRequest: async (instruction: string) => {
                    this.notifyStatus(
                        sessionId,
                        SessionStatus.GENERATING,
                        `Tool call: generate_variant`,
                    );

                    // Re-instantiate metadata
                    const sessionMetadata = await this.sessionService.getMetadata(sessionId);
                    if (!sessionMetadata) throw new Error(`Session ${sessionId} not found`);

                    const targetTurn = Math.max(0, turn - 1);
                    const variantId = this.sessionService.getNextId();
                    const variantGroup = this.sessionService.getNextGroup();

                    const newSession = await this.performCloneSession(variantId, sessionId, targetTurn);

                    // 2. Set up the new session
                    await this.sessionService.updateMetadata(newSession.id, {
                        group: variantGroup,
                        lastTurn: targetTurn,
                    });
                    const updatedContext = await this.contextService.loadContext(newSession.id);
                    await this.contextService.saveContext(newSession.id, updatedContext);

                    // Add to project
                    if (sessionMetadata.projectId) {
                        await this.projectService.addSessionToProject(sessionMetadata.projectId, newSession.id);
                    }

                    // Emit creation event
                    this.eventBus.publish(SessionCreatedEvent({
                        sourceSessionId: sessionId,
                        sessionId: newSession.id,
                        group: variantGroup,
                        projectId: sessionMetadata.projectId,
                        lastTurn: targetTurn,
                    }));

                    this.addUserMessage(
                        newSession.id,
                        instruction,
                        undefined,
                        undefined,
                        undefined,
                        undefined, // Do NOT persist fastMode
                    ).then(async (result) => {
                        if (!result.skipped && result.promptData) {
                            await this.generateResponse(newSession.id, result.promptData, result.turn, false, true);
                        }
                    }).catch((e) =>
                        console.error(
                            `Failed to generate variant for session ${newSession.id}`,
                            e,
                        ),
                    );

                    return `Variant created in session: ${newSession.id}`;
                },
            });

            if (generation.targetVersion !== undefined && generation.targetVersion !== null) {
                if (generation.targetVersion > currentMetadata.currentVersion) {
                    await this.sessionService.updateMetadata(sessionId, {
                        currentVersion: generation.targetVersion,
                        updatedAt: new Date(),
                    });
                }

                await this.imageService.updateImagesUsage(sessionId, generation.targetVersion);
            }

            // Re-fetch strict session state
            const updatedMetadata = await this.sessionService.getMetadata(sessionId);
            if (!updatedMetadata) throw new Error(`Session ${sessionId} not found`);

            // Update the existing turn with response, endTime and version
            // turn is passed from addUserMessage (1-based), but turn in DB is also 1-based.
            await this.turnService.updateTurn(sessionId, turn, {
                endTime: new Date(),
                response: generation.summary || '',
                version: updatedMetadata.currentVersion,
            });
            await this.sessionService.updateMetadata(sessionId, { updatedAt: new Date() });

            this.notifyStatus(
                sessionId,
                SessionStatus.IDLE,
                'Request completed.',
            );

        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                // Handled in stopGeneration or just ignored, but we MUST ensure we don't leave it in 'generating' if stopGeneration didn't catch it yet
                console.log(`Generation aborted for session ${sessionId}`);
                // If stopGeneration was called, it might have already set it to 'completed' or 'idle'.
                // But if the abort happened for other reasons (timeout?), we should be safe.
                // Let's force 'idle' implicitly by cleaning up activeGenerations in finally block.
                // But we also need to tell the UI if it wasn't a manual stop.

                // If manual stop, stopGeneration handles notification.
                // If we return here, finally block runs.
                return;
            }

            const description = this.describeError(error);
            this.notifyStatus(
                sessionId,
                SessionStatus.ERROR,
                description,
            );

            // Update the failed turn
            const finalMetadataError = await this.sessionService.getMetadata(sessionId);
            if (!finalMetadataError) throw new Error(`Session ${sessionId} not found`);

            await this.turnService.updateTurn(sessionId, turn, {
                endTime: new Date(),
                response: description,
                version: finalMetadataError.currentVersion,
            });
            await this.sessionService.updateMetadata(sessionId, { updatedAt: new Date() });

            // We don't throw here as this is a background task now
            console.error('Generation failed:', error);
        } finally {
            this.activeGenerations.delete(sessionId);
        }
    }

    private abortGeneration(sessionId: string) {
        const controller = this.activeGenerations.get(sessionId);
        if (controller) {
            controller.abort();
            this.activeGenerations.delete(sessionId);
        }
    }

    async stopGeneration(sessionId: string): Promise<{
        restoredInput?: string;
        restoredSelection?: string;
        restoredAttachment?: ChatAttachment;
        previousTurn: number;
    }> {
        // 1. Abort active generation
        this.abortGeneration(sessionId);

        // 2. Undo last turn (cleanup)
        // This removes the user message and any partial state if persisted (though generatePage usually doesn't persist until done)
        const result = await this.undoLastTurn(sessionId);

        // 3. Notify status
        // Since we undid the turn, the frontend will likely reload or rely on result data.
        // But we should push 'idle' status just in case (undoLastTurn does it, but we can be explicit if needed).
        // The undoLastTurn sets status to 'idle'.

        // Emitting 'idle' status might be useful for transient UI states
        this.notifyStatus(sessionId, SessionStatus.IDLE, 'Request stopped.');
        // Actually undoLastTurn handles the SessionData update.
        // We might want to send a specific event to client? 
        // The client will handle the response from this API call.

        return result;
    }

    async stopAll(): Promise<void> {
        console.log(`Stopping all active generations (${this.activeGenerations.size})...`);
        for (const [sessionId, controller] of this.activeGenerations.entries()) {
            try {
                controller.abort();
                console.log(`Aborted generation for session ${sessionId}`);
            } catch (e) {
                console.error(`Failed to abort generation for session ${sessionId}`, e);
            }
        }
        this.activeGenerations.clear();
    }

    isGenerating(sessionId: string): boolean {
        return this.activeGenerations.has(sessionId);
    }

    private async notifyStatus(
        sessionId: string,
        status: SessionStatus,
        message?: string,
    ): Promise<void> {

        await this.sessionService.updateMetadata(
            sessionId,
            {
                status: status,
                errorMessage: status === 'error' ? message : undefined,
            }
        );

        this.eventBus.publish(SessionStatusChangedEvent({
            sessionId,
            status,
            message,
        }));
    }

    private createTokenUsageCallback(sessionId: string, projectId: string, turn: number) {
        return async (agentName: string, modelId: string, prompt: number, completion: number, total: number) => {
            this.eventBus.publish(ChatTokenUsedEvent({
                projectId,
                sessionId,
                agent: agentName,
                turn,
                model: modelId,
                prompt,
                completion,
                total,
            }));
        };
    }

    private describeError(error: unknown): string {
        let current = error;
        // Limit depth to avoid infinite loops
        for (let i = 0; i < 5; i++) {
            if (current instanceof Error) {
                // Check if it is a specific error wrapping another one (like RetryError from Vercel AI SDK)
                // Some retry errors have a 'lastError' property
                if ((current as any).lastError) {
                    current = (current as any).lastError;
                    continue;
                }

                // If message is generic and there is a cause, look deeper
                const message = current.message;
                const isGeneric = message.includes('No output generated') || message.includes('Failed to process');

                if (isGeneric && (current as any).cause) {
                    current = (current as any).cause;
                    continue;
                }

                return message;
            }

            // Handle plain objects that look like errors
            if (current && typeof current === 'object') {
                // Case 1: Nested error object (e.g. OpenAI error structure)
                // { error: { message: ... } }
                if ('error' in current && (current as any).error && typeof (current as any).error === 'object' && 'message' in (current as any).error) {
                    return (current as any).error.message;
                }

                // Case 2: Direct message property
                if ('message' in current && typeof (current as any).message === 'string') {
                    return (current as any).message;
                }
            }
            break;
        }

        if (typeof current === 'string') {
            return current;
        }

        // Fallback to original if we couldn't dig deeper but it was an error
        if (error instanceof Error) {
            return error.message;
        }

        return 'unknown error';
    }

    private async prepareAttachment(
        sessionId: string,
        attachment?: ChatAttachment,
    ): Promise<ChatAttachment | undefined> {
        if (!attachment) {
            return undefined;
        }

        if (attachment.type === 'image' && attachment.filename) {
            // Verify existence but do NOT read content
            try {
                const filePath = this.uploadService.getExistsFilePath(sessionId, attachment.filename);

                if (filePath) {
                    // Just keep metadata. formatted for storage.
                    return {
                        type: 'image',
                        filename: attachment.filename,
                        id: attachment.id?.trim(),
                        originalName: attachment.originalName
                    };
                }
            } catch (e) {
                console.error('Failed to verify attached image', e);
            }
        }
        return undefined;
    }

    private async hydrateAttachment(
        sessionId: string,
        attachment?: ChatAttachment,
    ): Promise<ChatAttachment | undefined> {
        if (!attachment) return undefined;

        const publicHost = process.env.PUBLIC_HOST?.replace(/\/+$/, ''); // Remove trailing slash

        if (attachment.type === 'image' && attachment.filename) {
            const copy = { ...attachment };

            if (publicHost) {
                // Use Public URL
                // URL format: /api/sessions/:sessionId/uploads/:filename
                // We need to construct absolute URL
                const relativeUrl = `/api/sessions/${sessionId}/uploads/${attachment.filename}`;
                const basePath = process.env.APP_BASE_PATH || '';
                copy.dataUrl = `${publicHost}${basePath}${relativeUrl}`;
            } else {
                // Fallback to Base64
                try {
                    const buffer = await this.uploadService.getFileBuffer(sessionId, attachment.filename);

                    if (buffer) {
                        const base64 = buffer.toString('base64');
                        const metadata = await this.uploadService.getUpload(sessionId, attachment.filename);
                        const mimeType = metadata?.mimeType || 'image/png';

                        copy.dataUrl = `data:${mimeType};base64,${base64}`;
                    }
                } catch (e) {
                    console.error('Failed to hydrate attached image', e);
                }
            }
            return copy;
        }
        return attachment;
    }

    private composeUserContent(
        message: string,
        attachment?: ChatAttachment,
    ): string {
        return message.trim();
    }

    private async appendAssistantMessage(
        sessionId: string,
        content: any,
        version?: number,
        addToContext: boolean = true,
    ): Promise<void> {
        const uiContent = formatContentForUi(content);

        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);

        const assistantMessage: ChatMessage = {
            role: ChatRole.ASSISTANT,
            content: content,
            createdAt: new Date(),
            version: version ?? 0,
            turn: session.lastTurn ?? 0, // Associate with current turn
        };

        // Filter logic for HISTORY (UI)

        // Context logic
        if (addToContext) {
            await this.contextService.appendMessage(sessionId, assistantMessage);
            await this.sessionService.updateMetadata(sessionId, { updatedAt: new Date() });
        }
    }

    private enrichContentWithSelection(
        content: any,
        selection?: { selector: string },
    ): any {
        if (!selection) return content;
        if (typeof content === 'string') {
            return `[Selected element: ${selection.selector}] ${content}`;
        }
        return content;
    }

    public async generateHistorySummary(sessionId: string, turn: number): Promise<void> {

        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);

        // Apply Step-based Window logic (sync with generateResponse)
        const contextStartTurn = calculateContextStartTurn(turn);

        // We want to summarize everything that is about to be dropped (or has been dropped) 
        // and hasn't been summarized yet.
        // The context window starts at contextStartTurn.
        // So we summarize up to contextStartTurn - 1.
        const targetSummaryEnd = contextStartTurn - 1;
        const previousSummaryTurn = session.summaryTurn ?? 0;

        if (targetSummaryEnd <= previousSummaryTurn) {
            return;
        }

        // Collect messages to summarize: turns (previousSummaryTurn + 1) to targetSummaryEnd
        const currentContext = await this.contextService.loadContext(sessionId);
        const messagesToSummarize = currentContext.filter((msg) =>
            (msg.turn ?? 0) > previousSummaryTurn && (msg.turn ?? 0) <= targetSummaryEnd
        );

        if (messagesToSummarize.length === 0 && !session.summary) {
            return;
        }

        const project = await this.projectService.getProject(session.projectId);
        const rulesAndGoal = project?.rulesAndGoal;
        const modelRole = project?.modelRole;

        try {
            this.notifyStatus(sessionId, SessionStatus.GENERATING, `summarization...`);
            const summary = await this.historySummaryAgent.summarizeHistory(session.provider || LlmProvider.OPENAI, {
                sessionId,
                conversation: messagesToSummarize,
                rulesAndGoal,
                modelRole,
                abortSignal: this.activeGenerations.get(sessionId)?.signal,
                previousSummary: session.summary,
                onTokenUsage: this.createTokenUsageCallback(sessionId, session.projectId, turn),
            });

            // Update session with new summary
            await this.sessionService.updateMetadata(sessionId, {
                summary: summary,
                summaryTurn: targetSummaryEnd,
            });

            console.log(`Generated history summary for session ${sessionId}. Added turns ${previousSummaryTurn + 1}-${targetSummaryEnd}. Total coverage: 1-${targetSummaryEnd}.`);
            console.log(`Summary: ${summary}\n`);
        } catch (error) {
            console.error(`Failed to generate history summary for session ${sessionId}:`, error);
        }
    }

    async rebuildSessionSummary(sessionId: string): Promise<void> {
        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);

        console.log(`Rebuilding summary for session ${sessionId}, total turns: ${session.lastTurn || 0}`);

        // Reset summary
        await this.sessionService.updateMetadata(sessionId, {
            summary: undefined,
            summaryTurn: 0,
        });

        // Iterate through turns to trigger summarization
        // Logic: generateHistorySummary checks if summarization is needed for a given turn.
        // It summarizes up to calculateContextStartTurn(turn) - 1.
        // So we just need to hit the thresholds.

        const lastTurn = session.lastTurn || 0;

        // We simulate the progression of the session
        for (let t = 1; t <= lastTurn; t++) {
            // We only need to check at specific intervals where summarization MIGHT trigger.
            // But valid logic is encapsulated in generateHistorySummary, so we can just call it?
            // Actually generateHistorySummary expects 'turn' to be the CURRENT turn being generated.
            // And it calculates what to summarize based on that.

            await this.generateHistorySummary(sessionId, t);
        }

        this.notifyStatus(sessionId, SessionStatus.IDLE, 'Summary regeneration complete.');
        console.log(`Finished rebuilding summary for session ${sessionId}`);
    }

    public async createSession(
        sessionId: string,
        projectId: string,
        group?: number,
        provider: LlmProvider = LlmProvider.OPENAI,
        sourceSessionId: string = 'system'
    ): Promise<SessionMetadata> {
        const now = new Date();
        const metadata: SessionMetadata = {
            id: sessionId,
            projectId,
            updatedAt: now,
            group: group ?? this.sessionService.getNextGroup(),
            currentVersion: 0,
            lastTurn: 0,
            provider,
            fastMode: false,
            status: SessionStatus.IDLE,
            subject: '...',
        };

        await this.sessionService.saveMetadata(metadata);
        await this.contextService.saveContext(sessionId, []);
        await this.turnService.saveTurns(sessionId, []);
        this.filesService.initFirstVersion(sessionId);

        this.eventBus.publish(SessionCreatedEvent({
            sessionId,
            projectId,
            group: metadata.group,
            sourceSessionId,
            lastTurn: metadata.lastTurn,
        }));

        return metadata;
    }

    public async performCloneSession(targetId: string, sourceId: string, turn?: number): Promise<SessionMetadata> {
        const sourceMetadata = await this.sessionService.getMetadata(sourceId);
        if (!sourceMetadata) throw new Error(`Source session ${sourceId} not found`);

        const sourceContext = await this.contextService.loadContext(sourceId);
        const sourceTurns = await this.turnService.loadTurns(sourceId);

        let targetVersion = sourceMetadata.currentVersion;
        let lastTurn = sourceMetadata.lastTurn ?? 0;
        let contextSnapshot = [...sourceContext];
        let turnsSnapshot = [...sourceTurns];

        if (turn !== undefined) {
            const normalizedTurn = Math.floor(turn);
            if (!Number.isFinite(normalizedTurn) || normalizedTurn < 0) {
                throw new Error(`Invalid turn ${turn}`);
            }
            if (normalizedTurn > (sourceMetadata.lastTurn ?? 0)) {
                throw new Error(`Turn ${normalizedTurn} exceeds current session turn ${sourceMetadata.lastTurn}`);
            }

            lastTurn = normalizedTurn;
            contextSnapshot = sourceContext
                .filter(m => typeof m.turn === 'number' && m.turn <= normalizedTurn)
                .map(m => ({ ...m }));
            turnsSnapshot = sourceTurns
                .filter(t => t.turn <= normalizedTurn)
                .map(t => ({ ...t }));

            targetVersion = 0;
            if (turnsSnapshot.length > 0) {
                targetVersion = turnsSnapshot[turnsSnapshot.length - 1].version;
            }
            for (const ctx of contextSnapshot) {
                if (typeof ctx.version === 'number' && ctx.version > targetVersion) {
                    targetVersion = ctx.version;
                }
            }
        }

        // We should eventually return just metadata or void.
        // ChatController expects SessionData, so we construct it.
        const newMetadata: SessionMetadata = {
            ...sourceMetadata,
            id: targetId,
            updatedAt: new Date(),
            currentVersion: targetVersion,
            lastTurn: lastTurn,
            status: SessionStatus.IDLE,
        };

        this.filesService.deleteSessionDir(targetId);
        if (turn === undefined) {
            this.filesService.copyVersionHistory(sourceId, targetId);
        } else {
            this.filesService.copyVersionHistoryUpTo(sourceId, targetId, targetVersion);
        }

        const uploadMapping = await this.uploadService.copyUploads(sourceId, targetId);

        // Update attachment IDs
        contextSnapshot.forEach(msg => {
            if (msg.attachment?.id && uploadMapping.has(msg.attachment.id)) {
                msg.attachment = { ...msg.attachment, id: uploadMapping.get(msg.attachment.id)! };
            }
        });
        turnsSnapshot.forEach(t => {
            if (t.attachment?.id && uploadMapping.has(t.attachment.id)) {
                t.attachment = { ...t.attachment, id: uploadMapping.get(t.attachment.id)! };
            }
        });

        await this.imageService.copySessionImages(sourceId, targetId, turn === undefined ? undefined : targetVersion).catch(err => {
            console.error(`Failed to copy images for session ${targetId}`, err);
        });

        await this.sessionService.saveMetadata(newMetadata);
        await this.contextService.saveContext(targetId, contextSnapshot);
        await this.turnService.saveTurns(targetId, turnsSnapshot);

        if (sourceMetadata.projectId) {
            this.eventBus.publish(SessionCreatedEvent({
                sessionId: targetId,
                projectId: sourceMetadata.projectId,
                group: newMetadata.group,
                sourceSessionId: sourceId,
                lastTurn: newMetadata.lastTurn,
            }));
        }

        return newMetadata;
    }

    public async undoLastTurn(sessionId: string): Promise<{
        restoredInput?: string;
        restoredSelection?: string;
        restoredAttachment?: ChatAttachment;
        previousTurn: number;
    }> {
        const sessionMetadata = await this.sessionService.getMetadata(sessionId);
        if (!sessionMetadata) throw new Error(`Session ${sessionId} not found`);

        const currentTurn = sessionMetadata.lastTurn ?? 0;

        if (currentTurn <= 0) {
            return { previousTurn: 0 };
        }

        // We need turns to know what to remove
        const turns = await this.turnService.loadTurns(sessionId);
        const turnToRemove = turns[currentTurn - 1]; // turns are 1-based index but array is 0-based

        if (!turnToRemove) {
            // Inconsistency? Just decrement lastTurn
            await this.sessionService.updateMetadata(sessionId, {
                lastTurn: currentTurn - 1,
                updatedAt: new Date(),
            });
            return { previousTurn: currentTurn - 1 };
        }

        const restoredInput = turnToRemove.request;
        const restoredSelection = turnToRemove.selection?.selector;
        const restoredAttachment = turnToRemove.attachment;

        const currentContext = await this.contextService.loadContext(sessionId);

        const newContext = currentContext.filter(m => typeof m.turn !== 'number' || m.turn < currentTurn);
        const newTurns = turns.filter(t => t.turn < currentTurn);

        let targetVersion = 0;
        if (newTurns.length > 0) {
            targetVersion = newTurns[newTurns.length - 1].version;
        }
        for (const ctx of newContext) {
            if (typeof ctx.version === 'number' && ctx.version > targetVersion) {
                targetVersion = ctx.version;
            }
        }

        this.filesService.cleanupHigherVersions(sessionId, targetVersion);

        await this.sessionService.updateMetadata(sessionId, {
            currentVersion: targetVersion,
            lastTurn: currentTurn - 1,
            updatedAt: new Date(),
            status: SessionStatus.IDLE,
        });
        await this.contextService.saveContext(sessionId, newContext);
        await this.turnService.saveTurns(sessionId, newTurns);

        await this.unsentService.saveUnsent(sessionId, {
            input: restoredInput,
            selection: restoredSelection,
            attachment: restoredAttachment,
        });

        try {
            await this.imageService.deleteImagesAfterVersion(sessionId, targetVersion);
        } catch (e) {
            console.error(`Failed to cleanup images for session ${sessionId} after undo`, e);
        }

        return {
            restoredInput,
            restoredSelection,
            restoredAttachment,
            previousTurn: currentTurn - 1
        };
    }

    public async deleteSession(sessionId: string): Promise<void> {
        const session = await this.sessionService.getMetadata(sessionId);
        if (!session) {
            return;
        }

        this.abortGeneration(sessionId);

        this.sessionService.deleteFromCache(sessionId);
        this.filesService.deleteSessionDir(sessionId);

        await Promise.all([
            this.sessionService.deleteFromDb(sessionId),
            this.contextService.deleteContext(sessionId),
            this.turnService.deleteTurns(sessionId),
            this.imageService.deleteSessionImages(sessionId).catch(e => console.error(`Failed to delete images`, e)),
            this.unsentService.deleteUnsent(sessionId).catch(e => console.error(`Failed to delete unsent`, e)),
            this.uploadService.deleteSessionUploads(sessionId).catch(e => console.error(`Failed to delete uploads`, e)),
        ]);

        this.eventBus.publish(SessionDeletedEvent({
            sessionId,
            projectId: session.projectId
        }));
    }

    public async deleteProjectSessions(projectId: string): Promise<void> {
        const sessions = await this.sessionService.getSessionsByProjectId(projectId);
        for (const session of sessions) {
            await this.deleteSession(session.id);
        }
    }

}
