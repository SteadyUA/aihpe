import { Inject, Service } from 'typedi';
import { ChatAttachment, ChatMessage, LlmProvider, SessionData, SessionStatus, Turn } from '../types/chat';
import { ChatStatus, SseService } from './SseService';
import { SessionStore } from './session/SessionStore';
import { LlmFactory } from './llm/LlmFactory';
import { ProjectService } from './ProjectService';
import { ImageService } from './image/ImageService';
import { formatContentForUi } from '../utils/chat';
import fs from 'fs';
import path from 'path';
import { getSessionsDir } from '../utils/pathUtils';

@Service()
export class ChatService {
    constructor(
        private readonly sessionStore: SessionStore,
        private readonly sseService: SseService,
        private readonly llmFactory: LlmFactory,
        private readonly imageService: ImageService,
        private readonly projectService: ProjectService,
    ) { }

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

        this.sessionStore.upsert(sessionId, {
            history: [...currentSessionData.history, userMessageEntry],
            context: [...currentSessionData.context, contextEntry],
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

        const currentSessionData = this.sessionStore.getOrCreate(sessionId);

        // 2. Prepare conversation history for prompt
        // Use separate context list. Exclude the last message (just added) as it's the instruction.
        const currentContext = currentSessionData.context;

        // Apply Step-based Window logic
        // Shift window every 5 turns (first shift at 15)
        let startTurn = 1;
        if (turn >= 15) {
            const shifts = Math.floor((turn - 15) / 5) + 1;
            startTurn = 5 * shifts;
        }

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
                onPatch: (patch) => {
                    this.sseService.emitSessionUpdate({
                        sessionId,
                        ...patch,
                    });
                },
                onProgress: (chunk) => {
                    // Logic to handle both streaming thoughts and tool status updates
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
                for (const [filename, content] of Object.entries(generation.files)) {
                    const oldContent = currentSessionData.files[filename as keyof typeof currentSessionData.files];
                    // Compare content. Note: files might be undefined in old session if new.
                    if (content !== oldContent) {
                        this.sseService.emitFileChange({
                            sessionId,
                            version: generation.targetVersion,
                            filename,
                            turn: updated.lastTurn ?? 0,
                        });
                    }
                }
            } else {
                // No changes to files/version, just append messages
                const session = this.sessionStore.getOrCreate(sessionId);
            }

            // Update token usage
            let newUsage: {
                prompt: number;
                completion: number;
                total: number;
                reasoning: number;
                cached: number;
            } | undefined;

            if (generation.usage) {
                const session = this.sessionStore.getOrCreate(sessionId);
                const currentUsage = session.tokenUsage || { prompt: 0, completion: 0, total: 0 };
                newUsage = {
                    prompt: currentUsage.prompt + generation.usage.prompt,
                    completion: currentUsage.completion + generation.usage.completion,
                    total: currentUsage.total + generation.usage.total,
                    reasoning: (currentUsage.reasoning || 0) + (generation.usage.reasoning || 0),
                    cached: (currentUsage.cached || 0) + (generation.usage.cached || 0),
                };
                this.sessionStore.upsert(sessionId, { tokenUsage: newUsage });
            }

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
                    let newHistory = sessionParams.history;
                    if (shouldAddToHistory) {
                        newHistory = [...newHistory, { ...cleanMsg, content: uiContent }];
                    }

                    this.sessionStore.upsert(sessionId, {
                        history: newHistory,
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

            // Use promptData directly for Turn record, avoiding history lookup
            const turnRecord: Turn = {
                turn: updated.lastTurn ?? 0,
                beginTime: promptData.createdAt || new Date(), // Use passed createdAt or fallback
                endTime: new Date(),
                request: promptData.message, // Use promptData directly
                response: generation.summary || '',
                provider: finalSession.provider || 'openai',
                fastMode: finalSession.fastMode || false,
                tokenUsage: generation.usage || { prompt: 0, completion: 0, total: 0 }, // Store per-turn usage
                selection: promptData.selection,
                attachment: promptData.attachment,
                version: updated.currentVersion,
            };

            this.sessionStore.upsert(sessionId, {
                turns: [...finalSession.turns, turnRecord]
            });

            this.notifyStatus(
                sessionId,
                'completed',
                'Request completed.',
                {
                    message: assistantMessage,
                    tokenUsage: newUsage, // Pass usage to SSE
                    contextUsage: generation.contextUsage,
                },
            );



        } catch (error) {
            const description = this.describeError(error);
            this.notifyStatus(
                sessionId,
                'error',
                description,
                description,
            );
            // We don't throw here as this is a background task now
            console.error('Generation failed:', error);
        }
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
                        url: attachment.url || '',

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
        const shouldAddToHistory = uiContent.trim().length > 0;
        let newHistory = session.history;
        if (shouldAddToHistory) {
            newHistory = [...newHistory, { ...assistantMessage, content: uiContent }];
        }

        // Context logic
        let newContext = session.context;
        if (addToContext) {
            newContext = [...newContext, assistantMessage];
        }

        this.sessionStore.upsert(sessionId, {
            history: newHistory,
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

    getSession(sessionId: string): SessionData {
        return this.sessionStore.getOrCreate(sessionId);
    }
}
