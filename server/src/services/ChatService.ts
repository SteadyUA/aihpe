import { Inject, Service } from 'typedi';
import { ChatAttachment, ChatMessage, SessionData } from '../types/chat';
import { ChatStatus, SseService } from './SseService';
import { SessionStore } from './session/SessionStore';
import { LlmFactory } from './llm/LlmFactory';
import { formatContentForUi } from '../utils/chat';

interface ChatResult {
    message: string;
    session: SessionData;
}

@Service()
export class ChatService {
    constructor(
        private readonly sessionStore: SessionStore,
        private readonly sseService: SseService,
        private readonly llmFactory: LlmFactory,
    ) { }

    async handleUserMessage(
        sessionId: string,
        userMessage: string,
        attachments: ChatAttachment[] = [],
        allowVariants: boolean = true,
        selection?: { selector: string },
    ): Promise<ChatResult> {
        const trimmed = userMessage.trim();
        const normalizedAttachments = this.normalizeAttachments(attachments);
        const hasContent =
            trimmed.length > 0 ||
            normalizedAttachments.length > 0 ||
            !!selection;
        const session = this.sessionStore.getOrCreate(sessionId);

        if (!hasContent) {
            this.notifyStatus(
                sessionId,
                'skipped',
                'Message is empty. No changes applied.',
            );
            return {
                message: 'Message is empty. No changes applied.',
                session,
            };
        }

        // 1. Append user message immediately
        const userContentForHistory = this.composeUserContent(
            trimmed,
            normalizedAttachments,
        );
        const now = new Date();
        // Determine turn: User message starts a new turn
        const currentTurn = session.lastTurn ?? 0;
        const newTurn = currentTurn + 1;

        const userMessageEntry: ChatMessage = {
            role: 'user',
            content: userContentForHistory,
            createdAt: now,
            selection,
            version: session.currentVersion,
            turn: newTurn,
        };

        const contextEntry: ChatMessage = {
            role: 'user',
            content: this.enrichContentWithSelection(userContentForHistory, selection),
            createdAt: now,
            selection,
            version: session.currentVersion,
            turn: newTurn,
        };

        this.sessionStore.upsert(sessionId, {
            history: [...session.history, userMessageEntry],
            context: [...session.context, contextEntry],
            lastTurn: newTurn, // Update lastTurn
            updatedAt: now,
        });

        this.notifyStatus(sessionId, 'started', 'Thinking...');

        // 2. Prepare conversation history for prompt
        // Use separate context list. Exclude the last message (just added) as it's the instruction.
        const currentContext = this.sessionStore.getOrCreate(sessionId).context;
        const conversation = currentContext.slice(0, -1);

        const selectorsSummary = normalizedAttachments
            .map((attachment) => attachment.selector)
            .join(', ');
        const selectionContext = selection
            ? `Выбран элемент: ${selection.selector}.`
            : '';

        let effectiveInstructions = trimmed;
        if (selectionContext) {
            effectiveInstructions = `${selectionContext} ${effectiveInstructions}`;
        }
        if (!effectiveInstructions && selectorsSummary) {
            effectiveInstructions = `Обработай вложенные скриншоты выбранных элементов: ${selectorsSummary}.`;
        }

        try {
            // Buffer for streaming thoughts to avoid emitting too frequent partial updates
            let thoughtBuffer = '';

            const client = this.llmFactory.getClient();
            const generation = await client.generatePage({
                sessionId,
                instructions: effectiveInstructions,
                files: session.files,
                conversation,
                attachments: normalizedAttachments,
                allowVariants,
                imageGenerationAllowed: session.imageGenerationAllowed ?? true,
                currentVersion: session.currentVersion,
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
            });

            if (generation.variantRequest) {
                const { count, instructions } = generation.variantRequest;
                const variantsCreated = [];

                // Remove the user message from context as per requirements
                // We do not want to influence the context with the variant generation request
                const currentSession = this.sessionStore.getOrCreate(sessionId);
                const cleanedContext = currentSession.context.filter(
                    (msg) => !(msg.role === 'user' && msg.turn === newTurn),
                );
                this.sessionStore.upsert(sessionId, {
                    context: cleanedContext,
                });

                this.notifyStatus(
                    sessionId,
                    'completed',
                    `Starting generation of ${count} variants...`,
                );

                for (let i = 0; i < count; i++) {
                    const sessionData = this.sessionStore.getOrCreate(sessionId);
                    const currentTurn = sessionData.lastTurn ?? 0;
                    const targetTurn = Math.max(0, currentTurn - 1);

                    const { id: variantId } = this.sessionStore.prepareClone(sessionId);
                    const variantGroup = Math.floor(Math.random() * 32);

                    const newSession = await this.sessionStore.executeCloneAtTurn(variantId, sessionId, targetTurn);

                    // Update group to be random as requested
                    this.sessionStore.upsert(newSession.id, {
                        group: variantGroup,
                    });

                    this.sseService.emitSessionCreated({
                        sourceSessionId: sessionId,
                        newSessionId: newSession.id,
                        group: variantGroup,
                    });

                    variantsCreated.push(newSession.id);

                    // Trigger generation for the new session in the background
                    const variantInstruction =
                        instructions[i] || effectiveInstructions;
                    this.handleUserMessage(
                        newSession.id,
                        variantInstruction,
                        [],
                        false,
                    ).catch((e) =>
                        console.error(
                            `Failed to generate variant for session ${newSession.id}`,
                            e,
                        ),
                    );
                }

                const summary = `Created ${count} variants in new sessions.`;
                this.appendAssistantMessage(
                    sessionId,
                    summary,
                    session.currentVersion,
                    false, // Do not add to context
                );

                return {
                    message: summary,
                    session: this.sessionStore.getOrCreate(sessionId),
                };
            }

            if (generation.targetVersion) {
                const updated = this.sessionStore.updateFiles(
                    sessionId,
                    generation.files,
                    generation.targetVersion,
                );
            } else {
                // No changes to files/version, just append messages
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

            this.notifyStatus(
                sessionId,
                'completed',
                'Request completed.',
                generation.summary,
            );

            return {
                message: generation.summary,
                session: updated,
            };
        } catch (error) {
            const description = this.describeError(error);
            this.notifyStatus(
                sessionId,
                'error',
                'Failed to process request.',
                description,
            );
            throw error;
        }
    }

    private notifyStatus(
        sessionId: string,
        status: ChatStatus,
        message?: string,
        details?: unknown,
    ): void {
        this.sseService.emitChatStatus({
            sessionId,
            status,
            message,
            details,
        });
    }

    private describeError(error: unknown): string {
        if (error instanceof Error && error.message) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        return 'неизвестная ошибка';
    }

    private normalizeAttachments(
        attachments?: ChatAttachment[],
    ): ChatAttachment[] {
        if (!attachments || attachments.length === 0) {
            return [];
        }

        return attachments
            .filter((attachment): attachment is ChatAttachment =>
                Boolean(
                    attachment &&
                    attachment.type === 'screenshot' &&
                    attachment.selector &&
                    attachment.dataUrl,
                ),
            )
            .map((attachment) => ({
                type: 'screenshot',
                selector: attachment.selector.trim(),
                dataUrl: attachment.dataUrl.trim(),
                id: attachment.id?.trim(),
            }));
    }

    private composeUserContent(
        message: string,
        attachments: ChatAttachment[],
    ): string {
        const base = message.trim();
        if (attachments.length === 0) {
            return base;
        }

        const attachmentLines = attachments
            .map(
                (attachment, index) =>
                    `[Вложение ${index + 1}: ${attachment.type} ${attachment.selector}]`,
            )
            .join('\n');

        if (base) {
            return `${base}\n\n${attachmentLines}`;
        }
        return attachmentLines;
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
            return `[Выбран элемент: ${selection.selector}] ${content}`;
        }
        return content;
    }

    getSession(sessionId: string): SessionData {
        return this.sessionStore.getOrCreate(sessionId);
    }
}
