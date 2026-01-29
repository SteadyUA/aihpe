import { Inject, Service } from 'typedi';
import { ChatAttachment, ChatMessage, LlmProvider, SessionData, SessionStatus, Turn } from '../types/chat';
import { ChatStatus, SseService } from './SseService';
import { SessionStore } from './session/SessionStore';
import { LlmFactory } from './llm/LlmFactory';
import { ProjectService } from './ProjectService';
import { ImageService } from './image/ImageService';
import { formatContentForUi, calculateContextStartTurn } from '../utils/chat';
import fs from 'fs';
import path from 'path';
import { getSessionsDir } from '../utils/pathUtils';
import { TokenUsageService } from './TokenUsageService';

@Service()
export class ChatService {
    constructor(
        private readonly sessionStore: SessionStore,
        private readonly sseService: SseService,
        private readonly llmFactory: LlmFactory,
        private readonly imageService: ImageService,
        private readonly projectService: ProjectService,
        private readonly tokenUsageService: TokenUsageService,
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
        session: SessionData;
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
        const session = this.sessionStore.getOrCreate(sessionId);

        if (!hasContent) {
            this.notifyStatus(
                sessionId,
                'skipped',
                'Message is empty. No changes applied.',
            );
            return {
                turn: session.lastTurn ?? 0,
                session,
                skipped: true,
            };
        }

        // Update provider if specified and different
        if (provider) {
            this.sessionStore.updateProvider(sessionId, provider);
        }

        // Reload session data after potential update
        const currentSessionData = this.sessionStore.getOrCreate(sessionId);

        // 1. Append user message immediately
        const userContentForHistory = this.composeUserContent(
            trimmed,
            normalizedAttachment,
        );
        const now = new Date();
        // Determine turn: User message starts a new turn
        const currentTurn = currentSessionData.lastTurn ?? 0;

        const newTurn = currentTurn + 1;

        const userMessageEntry: ChatMessage = {
            role: 'user',
            content: userContentForHistory,
            createdAt: now,
            selection,
            version: currentSessionData.currentVersion,
            turn: newTurn,
            attachment: normalizedAttachment,
        };

        const contextEntry: ChatMessage = {
            role: 'user',
            content: this.enrichContentWithSelection(userContentForHistory, selection),
            createdAt: now,
            selection,
            attachment: normalizedAttachment,
            version: currentSessionData.currentVersion,
            turn: newTurn,
        };

        // Create incomplete Turn
        const newTurnEntry: Turn = {
            turn: newTurn,
            beginTime: now,
            // endTime: undefined, // Incomplete
            request: userContentForHistory,
            response: '',
            provider: provider ?? currentSessionData.provider ?? 'openai',
            fastMode: fastMode ?? currentSessionData.fastMode ?? false,
            selection,
            attachment: normalizedAttachment,
            version: currentSessionData.currentVersion,
        };

        this.sessionStore.upsert(sessionId, {
            context: [...currentSessionData.context, contextEntry],
            turns: [...currentSessionData.turns, newTurnEntry],
            lastTurn: newTurn, // Update lastTurn
            updatedAt: now,
            fastMode: fastMode ?? currentSessionData.fastMode, // Persist fastMode if provided
            unsent: undefined // Clear unsent data as we just sent it
        });

        return {
            turn: newTurn,
            session: this.sessionStore.getOrCreate(sessionId),
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
        this.notifyStatus(sessionId, 'started', 'Thinking...');

        // Cancel any existing generation for this session (just in case)
        if (this.activeGenerations.has(sessionId)) {
            try {
                this.activeGenerations.get(sessionId)?.abort();
                this.activeGenerations.delete(sessionId);
            } catch (e) { }
        }

        const controller = new AbortController();
        this.activeGenerations.set(sessionId, controller);

        let currentSessionData = this.sessionStore.getOrCreate(sessionId);

        // 0. Generate history summary properly BEFORE generation
        // This ensures the LLM gets the latest summary including the "dropped" messages
        // We call it every turn, as it internally checks if there is work to do (idempotent).
        if (await this.generateHistorySummary(sessionId, turn)) {
            // Refresh session data to get the new summary
            currentSessionData = this.sessionStore.getOrCreate(sessionId);
        }

        // 2. Prepare conversation history for prompt
        // Use separate context list. Exclude the last message (just added) as it's the instruction.
        const currentContext = currentSessionData.context;

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

        const project = await this.projectService.getProject(currentSessionData.projectId);
        const rulesAndGoal = project?.rulesAndGoal;
        const imageGenerationPref = project?.imageGenerationPref;
        const modelRole = project?.modelRole;

        try {
            // Buffer for streaming thoughts to avoid emitting too frequent partial updates
            let thoughtBuffer = '';

            const client = this.llmFactory.getClient(currentSessionData.provider);
            const generation = await client.generatePage({
                sessionId,
                instructions: effectiveInstructions,
                files: currentSessionData.files,
                conversation,
                attachment: hydratedCurrentAttachment,
                allowVariants,
                currentVersion: currentSessionData.currentVersion,
                rulesAndGoal,
                imageGenerationPref,
                modelRole,
                fastMode: fastModeOverride ?? currentSessionData.fastMode,
                subject: currentSessionData.subject,
                abortSignal: controller.signal,
                summary: currentSessionData.summary, // Pass cumulative summary
                trackRequestTokenUsage: async (u) => {
                    if (controller.signal.aborted) return;
                    await this.tokenUsageService.saveUsage({
                        projectId: currentSessionData.projectId,
                        sessionId: sessionId,
                        agent: u.agent,
                        turn: turn,
                        model: u.model,
                        prompt: u.prompt,
                        completion: u.completion,
                        total: u.total,
                    });
                },
                onPatch: (patch) => {
                    this.sseService.emitSessionUpdate({
                        sessionId,
                        ...patch,
                    });
                },
                onProgress: (chunk) => {
                    // Logic to handle both streaming thoughts and tool status updates
                    if (controller.signal.aborted) return;

                    if (chunk.startsWith('Tool call:') || chunk.startsWith('Step ')) {
                        this.notifyStatus(sessionId, 'generating', chunk);
                    } else {
                        // Text stream (thoughts)
                        thoughtBuffer += chunk;
                        if (thoughtBuffer.includes('\n')) {
                            const lines = thoughtBuffer.split('\n');
                            thoughtBuffer = lines.pop() || ''; // Keep last partial line

                            for (const line of lines) {
                                const trimmedLine = line.trim();
                                if (trimmedLine.length > 0) {
                                    this.notifyStatus(sessionId, 'generating', trimmedLine);
                                }
                            }
                        }
                    }
                },
                onVariantRequest: async (instruction) => {
                    this.notifyStatus(
                        sessionId,
                        'generating',
                        `Tool call: generate_variant`,
                    );

                    // Re-instantiate session data just in case
                    const session = this.sessionStore.getOrCreate(sessionId);

                    const targetTurn = Math.max(0, turn - 1);
                    const { id: variantId } = this.sessionStore.prepareClone(sessionId);
                    const variantGroup = Math.floor(Math.random() * 32);

                    const newSession = await this.sessionStore.executeCloneAtTurn(variantId, sessionId, targetTurn);

                    // 2. Set up the new session
                    this.sessionStore.upsert(newSession.id, {
                        group: variantGroup,
                        context: newSession.context, // Already correct from clone
                        lastTurn: targetTurn,
                    });

                    // Add to project
                    if (session.projectId) {
                        this.projectService.addSessionToProject(session.projectId, newSession.id);
                    }

                    // Emit creation event
                    this.sseService.emitSessionCreated({
                        sourceSessionId: sessionId,
                        newSessionId: newSession.id,
                        group: variantGroup,
                        projectId: session.projectId,
                    });

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
                // Merge existing files with new changes to avoid overwriting with partial updates
                const mergedFiles = { ...currentSessionData.files, ...generation.files };

                const updated = this.sessionStore.updateFiles(
                    sessionId,
                    mergedFiles,
                    generation.targetVersion,
                );
                await this.imageService.updateImagesUsage(sessionId, generation.targetVersion, generation.files);



                // Detect and emit file changes
                // Detect and emit file changes
                // REMOVED file-change event emission
            } else {
                // No changes to files/version, just append messages
                const session = this.sessionStore.getOrCreate(sessionId);
            }

            // Token usage is now tracked per-request via trackRequestTokenUsage callback

            const usageSummary = await this.tokenUsageService.getSummary(sessionId, 'chat');
            const currentUsageSummary = {
                ...usageSummary,
                capacity: client.getCapacity()
            };

            // Re-fetch strict session state
            const updated = this.sessionStore.getOrCreate(sessionId);

            if (generation.newMessages && generation.newMessages.length > 0) {
                for (const msg of generation.newMessages) {
                    // Optimized content for UI, full content for Context
                    const uiContent = formatContentForUi(msg.content);

                    // Create a clean message object to ensure all required fields are present
                    const cleanMsg: ChatMessage = {
                        role: msg.role,
                        content: msg.content,
                        createdAt: new Date(),
                        version: updated.currentVersion,
                        selection: msg.selection,
                        turn: updated.lastTurn ?? 0, // Use current turn (which was updated by user message)
                    };

                    const sessionParams = this.sessionStore.getOrCreate(sessionId);

                    // Filter logic: User always in, others only if non-empty string
                    const shouldAddToHistory = msg.role === 'user' || uiContent.trim().length > 0;

                    // Update lists

                    this.sessionStore.upsert(sessionId, {
                        context: [...sessionParams.context, cleanMsg],
                    });
                }
            }

            // Check if we need to append the summary explicitly.
            // If the last message was a tool execution (role='tool') or an assistant call without text response,
            // we should append the summary so the user sees it.
            const lastMsg =
                generation.newMessages?.[generation.newMessages.length - 1];
            let hasVisibleResponse = false;

            if (lastMsg && lastMsg.role === 'assistant') {
                if (
                    typeof lastMsg.content === 'string' &&
                    lastMsg.content.trim().length > 0
                ) {
                    hasVisibleResponse = true;
                } else if (Array.isArray(lastMsg.content)) {
                    // Check if there is any text part with content
                    const textPart = lastMsg.content.find(
                        (p: any) =>
                            p.type === 'text' &&
                            p.text &&
                            p.text.trim().length > 0,
                    );
                    if (textPart) hasVisibleResponse = true;
                }
            }

            if (!hasVisibleResponse && generation.summary) {
                this.appendAssistantMessage(
                    sessionId,
                    generation.summary,
                    updated.currentVersion,
                    false, // Do not add to context
                );
            }

            // Construct the assistant message object to send to client
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: generation.summary,
                createdAt: new Date(),
                version: updated.currentVersion,
                turn: updated.lastTurn ?? 0,
            };

            const finalSession = this.sessionStore.getOrCreate(sessionId);

            // Update the existing turn with response, endTime and version
            const updatedTurns = [...finalSession.turns];
            const turnIndexFull = turn - 1; // turn is passed from addUserMessage
            if (updatedTurns[turnIndexFull]) {
                updatedTurns[turnIndexFull] = {
                    ...updatedTurns[turnIndexFull],
                    endTime: new Date(),
                    response: generation.summary || '',
                    version: updated.currentVersion,
                };
            }

            this.sessionStore.upsert(sessionId, {
                turns: updatedTurns
            });

            // Summary generation moved to start of function
            /* 
            if (turn > 0 && turn % 5 === 0) {
                await this.generateHistorySummary(sessionId, turn);
            }
            */

            this.notifyStatus(
                sessionId,
                'completed',
                'Request completed.',
                {
                    message: assistantMessage,
                    tokenUsage: currentUsageSummary, // Pass usage to SSE
                },
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
                'error',
                description,
                description,
            );

            // Update the failed turn
            const finalSessionError = this.sessionStore.getOrCreate(sessionId);
            const updatedTurnsError = [...finalSessionError.turns];
            const errorTurnIndex = turn - 1;

            if (updatedTurnsError[errorTurnIndex]) {
                updatedTurnsError[errorTurnIndex] = {
                    ...updatedTurnsError[errorTurnIndex],
                    endTime: new Date(),
                    response: description,
                    version: finalSessionError.currentVersion,
                };
            }

            this.sessionStore.upsert(sessionId, {
                turns: updatedTurnsError
            });

            // We don't throw here as this is a background task now
            console.error('Generation failed:', error);
        } finally {
            this.activeGenerations.delete(sessionId);
        }
    }

    async stopGeneration(sessionId: string): Promise<{
        success: boolean;
        restoredInput?: string;
        restoredSelection?: string;
        restoredAttachment?: ChatAttachment;
        previousTurn?: number;
    }> {
        // 1. Abort active generation
        const controller = this.activeGenerations.get(sessionId);
        if (controller) {
            controller.abort();
            this.activeGenerations.delete(sessionId);
        }

        // 2. Undo last turn (cleanup)
        // This removes the user message and any partial state if persisted (though generatePage usually doesn't persist until done)
        const result = this.sessionStore.undoLastTurn(sessionId);

        // 3. Notify status
        // Since we undid the turn, the frontend will likely reload or rely on result data.
        // But we should push 'idle' status just in case (undoLastTurn does it, but we can be explicit if needed).
        // The undoLastTurn sets status to 'idle'.

        // Emitting 'stopped' status might be useful for transient UI states
        this.notifyStatus(sessionId, 'completed', 'Request stopped.'); // Using 'completed' or 'skipped' to reset state?
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

    private notifyStatus(
        sessionId: string,
        status: ChatStatus,
        message?: string,
        details?: any,
    ): void {
        this.sseService.emitChatStatus({
            sessionId,
            status,
            message,
            details,
        });

        // Map ChatStatus to SessionStatus for persistence
        // ChatStatus: 'started' | 'generating' | 'completed' | 'error' | 'skipped'
        // SessionStatus: ChatStatus | 'idle'

        let newStatus: SessionStatus = status;
        if (status === 'completed' || status === 'skipped') {
            newStatus = 'idle';
        } else if (status === 'started' || status === 'generating') {
            // Keep as is, or map to 'busy'?
            // Client uses 'busy' for 'started'.
            // But we defined SessionStatus = ChatStatus | 'idle'. 
            // So we store 'started'/'generating'. Client should handle 'started' as busy.
        }

        this.sessionStore.upsert(sessionId, {
            status: newStatus,
            errorMessage: status === 'error' ? message : undefined,
        });
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
                const sessionRoot = getSessionsDir();
                const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
                const uploadDir = path.join(sessionRoot, safeId, 'uploads');
                const filePath = path.join(uploadDir, attachment.filename);

                if (fs.existsSync(filePath)) {
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

        if (attachment.type === 'image') {
            const copy = { ...attachment };

            if (publicHost) {
                // Use Public URL
                // URL format: /api/sessions/:sessionId/uploads/:filename
                // We need to construct absolute URL
                const relativeUrl = `/api/sessions/${sessionId}/uploads/${attachment.filename}`;
                copy.dataUrl = `${publicHost}${relativeUrl}`;
            } else {
                // Fallback to Base64
                try {
                    const sessionRoot = getSessionsDir();
                    const safeId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
                    const uploadDir = path.join(sessionRoot, safeId, 'uploads');
                    const filePath = path.join(uploadDir, attachment.filename);

                    if (fs.existsSync(filePath)) {
                        const buffer = await fs.promises.readFile(filePath);
                        const base64 = buffer.toString('base64');
                        const ext = path.extname(attachment.filename).toLowerCase();
                        let mimeType = 'image/png';
                        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
                        else if (ext === '.webp') mimeType = 'image/webp';
                        else if (ext === '.gif') mimeType = 'image/gif';

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

    private appendAssistantMessage(
        sessionId: string,
        content: any,
        version?: number,
        addToContext: boolean = true,
    ): void {
        const uiContent = formatContentForUi(content);

        const session = this.sessionStore.getOrCreate(sessionId);

        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: content,
            createdAt: new Date(),
            version: version ?? 0,
            turn: session.lastTurn ?? 0, // Associate with current turn
        };

        // Filter logic for HISTORY (UI)

        // Context logic
        let newContext = session.context;
        if (addToContext) {
            newContext = [...newContext, assistantMessage];
        }

        this.sessionStore.upsert(sessionId, {
            context: newContext,
        });
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

    public async generateHistorySummary(sessionId: string, turn: number): Promise<boolean> {

        const session = this.sessionStore.getOrCreate(sessionId);

        // Apply Step-based Window logic (sync with generateResponse)
        const contextStartTurn = calculateContextStartTurn(turn);

        // We want to summarize everything that is about to be dropped (or has been dropped) 
        // and hasn't been summarized yet.
        // The context window starts at contextStartTurn.
        // So we summarize up to contextStartTurn - 1.
        const targetSummaryEnd = contextStartTurn - 1;
        const previousSummaryTurn = session.summaryTurn ?? 0;

        if (targetSummaryEnd <= previousSummaryTurn) {
            // console.log(`Skipping summarization for session ${sessionId}: target summary end ${targetSummaryEnd} <= previous summary turn ${previousSummaryTurn}`);
            return false;
        }

        // Collect messages to summarize: turns (previousSummaryTurn + 1) to targetSummaryEnd
        // We use context, but we might need to be careful if messages were already dropped from context?
        // SessionData.context usually keeps growing? Or do we prune it?
        // Current implementation: context is NOT pruned in upsert, just appended.
        // But generateResponse slices it.
        // So session.context has full history.

        const messagesToSummarize = session.context.filter((msg) =>
            (msg.turn ?? 0) > previousSummaryTurn && (msg.turn ?? 0) <= targetSummaryEnd
        );

        if (messagesToSummarize.length === 0 && !session.summary) {
            console.log(`Skipping summarization for session ${sessionId}: no messages to summarize.`);
            return false;
        }

        const project = await this.projectService.getProject(session.projectId);
        const rulesAndGoal = project?.rulesAndGoal;
        const modelRole = project?.modelRole;

        try {
            this.notifyStatus(sessionId, 'generating', `summarization...`);
            const client = this.llmFactory.getClient(session.provider);
            const summary = await client.summarizeHistory({
                sessionId,
                conversation: messagesToSummarize,
                rulesAndGoal,
                modelRole,
                abortSignal: this.activeGenerations.get(sessionId)?.signal,
                previousSummary: session.summary,
                trackRequestTokenUsage: async (u) => {
                    await this.tokenUsageService.saveUsage({
                        projectId: session.projectId,
                        sessionId: sessionId,
                        agent: u.agent,
                        turn: turn,
                        model: u.model,
                        prompt: u.prompt,
                        completion: u.completion,
                        total: u.total,
                    });
                }
            });

            // Update session with new summary
            this.sessionStore.upsert(sessionId, {
                summary: summary,
                summaryTurn: targetSummaryEnd,
                // We do NOT add a message to history/context anymore.
            });

            console.log(`Generated history summary for session ${sessionId}. Added turns ${previousSummaryTurn + 1}-${targetSummaryEnd}. Total coverage: 1-${targetSummaryEnd}.`);
            console.log(`Summary: ${summary}\n`);
        } catch (error) {
            console.error(`Failed to generate history summary for session ${sessionId}:`, error);
        }
        return true;
    }

    async rebuildSessionSummary(sessionId: string): Promise<void> {
        const session = this.sessionStore.getOrCreate(sessionId);
        console.log(`Rebuilding summary for session ${sessionId}, total turns: ${session.lastTurn || 0}`);

        // Reset summary
        this.sessionStore.upsert(sessionId, {
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

        this.notifyStatus(sessionId, 'completed', 'Summary regeneration complete.');
        console.log(`Finished rebuilding summary for session ${sessionId}`);
    }

    getSession(sessionId: string): SessionData {
        return this.sessionStore.getOrCreate(sessionId);
    }
}
