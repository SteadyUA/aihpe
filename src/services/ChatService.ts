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
    const hasContent = trimmed.length > 0 || normalizedAttachments.length > 0 || !!selection;
    const session = this.sessionStore.getOrCreate(sessionId);

    if (!hasContent) {
      this.notifyStatus(sessionId, 'skipped', 'Сообщение пустое. Изменения не применены.');
      return { message: 'Сообщение пустое. Изменения не применены.', session };
    }

    // 1. Append user message immediately
    const userContentForHistory = this.composeUserContent(trimmed, normalizedAttachments);
    const now = new Date();
    const userMessageEntry: ChatMessage = {
      role: 'user',
      content: userContentForHistory,
      createdAt: now,
      selection,
      version: session.currentVersion,
    };
    this.sessionStore.appendMessage(sessionId, userMessageEntry);

    this.notifyStatus(sessionId, 'started', 'Запрос к GPT выполняется...');

    // 2. Prepare conversation history for prompt
    // Exclude the message we just added (the last one) so GPT treats it as "instruction" not "previous conversation"
    const currentHistory = this.sessionStore.getOrCreate(sessionId).history;
    const historyForPrompt = currentHistory.slice(0, -1);

    const conversation = historyForPrompt
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({
        role: item.role as 'user' | 'assistant',
        content: this.enrichContentWithSelection(item.content, item.selection)
      }));

    const selectorsSummary = normalizedAttachments.map((attachment) => attachment.selector).join(', ');
    const selectionContext = selection ? `Выбран элемент: ${selection.selector}.` : '';

    let effectiveInstructions = trimmed;
    if (selectionContext) {
      effectiveInstructions = `${selectionContext} ${effectiveInstructions}`;
    }
    if (!effectiveInstructions && selectorsSummary) {
      effectiveInstructions = `Обработай вложенные скриншоты выбранных элементов: ${selectorsSummary}.`;
    }

    try {
      const client = this.llmFactory.getClient();
      const generation = await client.generatePage({
        sessionId,
        instructions: effectiveInstructions,
        files: session.files,
        conversation,
        attachments: normalizedAttachments,
        allowVariants,
      });

      if (generation.variantRequest) {
        const { count, instructions } = generation.variantRequest;
        const variantsCreated = [];

        this.notifyStatus(sessionId, 'completed', `Запущена генерация ${count} вариантов...`);

        for (let i = 0; i < count; i++) {
          const newSession = this.sessionStore.clone(sessionId);

          // Generate a random group for each variant to distinguish them visually
          const variantGroup = Math.floor(Math.random() * 32);

          // Remove the last message from the new session (which is the prompt that triggered this variant generation)
          if (newSession.history.length > 0) {
            const newHistory = newSession.history.slice(0, -1);
            this.sessionStore.upsert(newSession.id, { history: newHistory, group: variantGroup });
          } else {
            this.sessionStore.upsert(newSession.id, { group: variantGroup });
          }

          this.sseService.emitSessionCreated({
            sourceSessionId: sessionId,
            newSessionId: newSession.id,
            group: variantGroup,
          });

          variantsCreated.push(newSession.id);

          // Trigger generation for the new session in the background
          const variantInstruction = instructions[i] || effectiveInstructions;
          this.handleUserMessage(
            newSession.id,
            variantInstruction,
            [],
            false
          ).catch(e => console.error(`Failed to generate variant for session ${newSession.id}`, e));
        }

        const summary = `Создано ${count} вариантов в новых сессиях.`;
        this.appendAssistantMessage(sessionId, summary, session.currentVersion);

        return {
          message: summary,
          session: this.sessionStore.getOrCreate(sessionId),
        };
      }

      const updated = this.sessionStore.updateFiles(sessionId, generation.files);
      this.appendAssistantMessage(sessionId, generation.summary, updated.currentVersion);

      this.notifyStatus(sessionId, 'completed', 'Запрос к GPT завершён.', generation.summary);

      return {
        message: generation.summary,
        session: updated,
      };
    } catch (error) {
      const description = this.describeError(error);
      this.notifyStatus(sessionId, 'error', 'Не удалось выполнить запрос к GPT.', description);
      throw error;
    }
  }

  private notifyStatus(sessionId: string, status: ChatStatus, message?: string, details?: unknown): void {
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

  private normalizeAttachments(attachments?: ChatAttachment[]): ChatAttachment[] {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    return attachments
      .filter((attachment): attachment is ChatAttachment => Boolean(attachment && attachment.type === 'screenshot' && attachment.selector && attachment.dataUrl))
      .map((attachment) => ({
        type: 'screenshot',
        selector: attachment.selector.trim(),
        dataUrl: attachment.dataUrl.trim(),
        id: attachment.id?.trim(),
      }));
  }

  private composeUserContent(message: string, attachments: ChatAttachment[]): string {
    const base = message.trim();
    if (attachments.length === 0) {
      return base;
    }

    const attachmentLines = attachments
      .map((attachment, index) => `[Вложение ${index + 1}: ${attachment.type} ${attachment.selector}]`)
      .join('\n');

    if (base) {
      return `${base}\n\n${attachmentLines}`;
    }
    return attachmentLines;
  }

  private appendAssistantMessage(sessionId: string, content: string, version?: number): void {
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: content,
      createdAt: new Date(),
      version,
    };
    this.sessionStore.appendMessage(sessionId, assistantMessage);
  }

  private enrichContentWithSelection(content: string, selection?: { selector: string }): string {
    if (!selection) return content;
    return `[Выбран элемент: ${selection.selector}] ${content}`;
  }

  getSession(sessionId: string): SessionData {
    return this.sessionStore.getOrCreate(sessionId);
  }
}
