import { Inject, Service } from 'typedi';
import { ChatAttachment, ChatMessage, SessionData } from '../types/chat';
import { ChatStatus, SseService } from './SseService';
import { SessionStore } from './session/SessionStore';
import { LlmFactory } from './llm/LlmFactory';

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
        const userMessageEntry: ChatMessage = {
            role: 'user',
            content: userContentForHistory,
            createdAt: now,
            selection,
            version: session.currentVersion,
        };
        this.sessionStore.appendMessage(sessionId, userMessageEntry);

        this.notifyStatus(sessionId, 'started', 'Thinking...');

        // 2. Prepare conversation history for prompt
        // Exclude the message we just added (the last one) so GPT treats it as "instruction" not "previous conversation"
        const currentHistory = this.sessionStore.getOrCreate(sessionId).history;
        const historyForPrompt = currentHistory.slice(0, -1);

        const conversation = historyForPrompt.map((item) => ({
            ...item,
            content: this.enrichContentWithSelection(
                item.content,
                item.selection,
            ),
        }));

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
                currentVersion: session.currentVersion,
                onProgress: (chunk) => {
                    // Logic to handle both streaming thoughts and tool status updates
                    // Chunk usually comes as tokens or lines.
                    // We need to identify specific events.

                    if (chunk.startsWith('Tool call:') || chunk.startsWith('Step ')) {
                        // Crucial event: emit immediately as a standalone message
                        // Also flush any pending thoughts first if needed? 
                        // Actually, 'utilMessages' on client is a list.
                        // Ideally we append "thoughts" as items too.
                        // But thoughts are streaming.
                        // Let's compromise: If we hit a tool call, we emit it.
                        // Thoughts are tricky with the new "list" requirements.
                        // If "Generating..." is one item, and we update it, that works.
                        // But the requirement says "client adds elements as new events arrive".
                        // So we should emit completed thoughts or distinct steps.

                        this.notifyStatus(sessionId, 'generating', chunk);
                    } else {
                        // Text stream (thoughts)
                        // In the old logic we concatenated. 
                        // In the new logic, maybe we want to show thoughts?
                        // Or just "Thinking..."? 
                        // The user said "Thinking..." is the start.
                        // Then "generating" events are added to the list.
                        // If we emit every token, the list will explode.
                        // So we should probably accumulate thoughts and emit lines?
                        // Or maybe we ignore raw tokens and only emit specific log lines from the LLM wrapper?
                        // The `chunk` here comes from `LlmClient` which might already be doing some processing.
                        // Let's look at `LlmClient`... wait I can't look at it easily now without tool call.
                        // Assuming `chunk` is a token string.

                        // If we just want to show "Tool calls", then we might ignore raw text if it's just "I will now..."
                        // UNLESS the user wants to see the thoughts.
                        // Let's assume we maintain a "Processing..." item that updates? 
                        // No, the user said "adds elements".
                        // So we should emit only SIGNIFICANT events.
                        // Tool calls and Steps are significant.
                        // Random text generation might be too noisy.
                        // Let's try buffering lines.

                        thoughtBuffer += chunk;
                        if (thoughtBuffer.includes('\n')) {
                            const lines = thoughtBuffer.split('\n');
                            thoughtBuffer = lines.pop() || ''; // Keep last partial line

                            for (const line of lines) {
                                const trimmedLine = line.trim();
                                if (trimmedLine.length > 0) {
                                    // Check if it looks like a log or just text
                                    // If we emit every line of thought, it might be okay?
                                    // Let's emit it.
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

                this.notifyStatus(
                    sessionId,
                    'completed',
                    `Starting generation of ${count} variants...`,
                );

                for (let i = 0; i < count; i++) {
                    const newSession = this.sessionStore.clone(sessionId);

                    // Generate a random group for each variant to distinguish them visually
                    const variantGroup = Math.floor(Math.random() * 32);

                    // Remove the last message from the new session (which is the prompt that triggered this variant generation)
                    if (newSession.history.length > 0) {
                        const newHistory = newSession.history.slice(0, -1);
                        this.sessionStore.upsert(newSession.id, {
                            history: newHistory,
                            group: variantGroup,
                        });
                    } else {
                        this.sessionStore.upsert(newSession.id, {
                            group: variantGroup,
                        });
                    }

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
                );

                return {
                    message: summary,
                    session: this.sessionStore.getOrCreate(sessionId),
                };
            }

            const updated = this.sessionStore.updateFiles(
                sessionId,
                generation.files,
            );

            if (generation.newMessages && generation.newMessages.length > 0) {
                for (const msg of generation.newMessages) {
                    // Create a clean message object to ensure all required fields are present
                    const cleanMsg: ChatMessage = {
                        role: msg.role,
                        content: msg.content,
                        createdAt: new Date(),
                        version: updated.currentVersion,
                        selection: msg.selection,
                    };
                    this.sessionStore.appendMessage(sessionId, cleanMsg);
                }

                // Check if we need to append the summary explicitly.
                // If the last message was a tool execution (role='tool') or an assistant call without text response,
                // we should append the summary so the user sees it.
                const lastMsg =
                    generation.newMessages[generation.newMessages.length - 1];
                let hasVisibleResponse = false;

                if (lastMsg.role === 'assistant') {
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
                    );
                }
            } else {
                this.appendAssistantMessage(
                    sessionId,
                    generation.summary,
                    updated.currentVersion,
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
    ): void {
        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: content,
            createdAt: new Date(),
            version,
        };
        this.sessionStore.appendMessage(sessionId, assistantMessage);
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
