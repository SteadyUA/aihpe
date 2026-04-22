import { Service, Inject } from 'typedi';
import { GeneratePageRequest, GeneratePageResult } from '../types';
import { OpenaiRawClient } from '../core/OpenaiRawClient';
import { LlmMessage, LlmRequest, LlmContentPart, LlmRole } from '../core/types';
import { ImageService } from '../../image/ImageService';
import { FilesService } from '../../session/FilesService';
import { SessionService } from '../../session/SessionService';
import { LlmProvider, ChatMessage } from '../../../types/chat';
import { buildPageGenPrompt } from '../prompts/PageGenPrompt';
import { createPageGenTools, PageGenContext } from '../tools/PageGenTools';

@Service()
export class PageGenAgent {
    @Inject()
    private imageService!: ImageService;

    @Inject()
    private filesService!: FilesService;

    @Inject()
    private sessionService!: SessionService;

    public async generatePage(provider: LlmProvider, request: GeneratePageRequest): Promise<GeneratePageResult> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);
        const client = new OpenaiRawClient(litellmUrl, litellmKey, modelId);

        let targetVersion: number | undefined;

        const ensureNextVersion = async (sessionId: string): Promise<number> => {
            if (targetVersion === undefined) {
                const metadata = await this.sessionService.getMetadata(sessionId);
                const currentVersion = metadata?.currentVersion || 0;
                targetVersion = await this.filesService.initNextVersion(sessionId, currentVersion);
                await this.imageService.migrateToVersion(sessionId, currentVersion, targetVersion);
            }
            return targetVersion;
        };

        const context: PageGenContext = {
            getTargetVersion: () => targetVersion,
            ensureNextVersion
        };

        const domainTools = createPageGenTools(this.imageService, this.filesService, this.sessionService)(request as any, context);

        const systemPrompt = buildPageGenPrompt(request as any);

        const messages: LlmMessage[] = [
            { role: LlmRole.SYSTEM, content: systemPrompt }
        ];

        if (request.conversation) {
            for (const entry of request.conversation) {
                if (entry.role === 'system') {
                    messages.push({ role: LlmRole.SYSTEM, content: entry.content as string });
                    continue;
                }
                if (entry.role === 'user') {
                    let contentParts: LlmContentPart[] | string = entry.content as string;
                    if (entry.attachment && typeof contentParts === 'string') {
                        contentParts = [
                            { type: 'text', text: contentParts },
                            { type: 'image_url', image_url: { url: entry.attachment.dataUrl! } }
                        ];
                    }
                    messages.push({ role: LlmRole.USER, content: contentParts });
                } else if (entry.role === 'assistant') {
                    if (Array.isArray(entry.content)) {
                        const toolCalls = entry.content.filter((c: any) => c.type === 'tool-call').map((c: any) => ({
                            id: c.toolCallId,
                            name: c.toolName,
                            arguments: JSON.stringify(c.args)
                        }));
                        const textPart = entry.content.find((c: any) => c.type === 'text');
                        messages.push({
                            role: LlmRole.ASSISTANT,
                            content: textPart ? textPart.text : '',
                            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                            providerData: entry.providerData
                        });
                    } else {
                        messages.push({
                            role: LlmRole.ASSISTANT,
                            content: entry.content as string,
                            providerData: entry.providerData
                        });
                    }
                } else if (entry.role === 'tool') {
                    if (Array.isArray(entry.content)) {
                        const toolResultPart = entry.content.find((c: any) => c.type === 'tool-result');
                        if (toolResultPart) {
                            messages.push({
                                role: LlmRole.TOOL,
                                toolCallId: toolResultPart.toolCallId,
                                content: toolResultPart.result
                            });
                        }
                    } else {
                        messages.push({ role: LlmRole.TOOL, content: entry.content as string });
                    }
                }
            }
        }

        let userContent: string | LlmContentPart[] = request.fastMode ? `No plan\n${request.instructions}` : request.instructions;
        if (request.attachment) {
            userContent = [
                { type: 'text', text: userContent as string },
                { type: 'image_url', image_url: { url: request.attachment.dataUrl! } }
            ];
        }
        if (userContent) {
            messages.push({ role: LlmRole.USER, content: userContent });
        }

        const llmReq: LlmRequest = {
            messages,
            tools: domainTools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                execute: (args) => t.execute(args, context)
            })),
            abortSignal: request.abortSignal,
            onChunkContent: request.onChunkContent,
            onToolCall: request.onToolCall,
            onNewMessage: request.onNewMessage ? async (m: LlmMessage) => {
                const mapped = this.mapLlmMessageToChatMessage(m, request.currentVersion || 0);
                await request.onNewMessage!(mapped);
            } : undefined,
            onTokenUsage: request.onTokenUsage,
            maxSteps: request.maxSteps
        };

        const result = await client.generate(llmReq);

        return {
            summary: result.text,
            targetVersion: targetVersion
        };
    }

    private getConfig(provider: LlmProvider) {
        let modelId = '';
        if (provider === 'google') {
            modelId = process.env.GEMINI_MODEL || '';
        } else {
            modelId = process.env.OPENAI_MODEL || '';
        }

        if (!modelId) {
            throw new Error(`Model ID not configured for provider ${provider}`);
        }

        const litellmUrl = process.env.LITELLM_API_URL;
        const litellmKey = process.env.LITELLM_API_KEY;

        if (!litellmUrl || !litellmKey) {
            throw new Error('LITELLM_API_URL and LITELLM_API_KEY must be set');
        }

        return { modelId, litellmUrl, litellmKey };
    }

    private mapLlmMessageToChatMessage(m: LlmMessage, currentVersion: number): ChatMessage {
        let content: any = m.content;
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            const parts: any[] = [];
            if (typeof m.content === 'string' && m.content) {
                parts.push({ type: 'text', text: m.content });
            }
            m.toolCalls.forEach((tc) => {
                let args;
                try {
                    args = JSON.parse(tc.arguments);
                } catch (e) {
                    args = {};
                }
                parts.push({
                    type: 'tool-call',
                    toolCallId: tc.id,
                    toolName: tc.name,
                    args: args
                });
            });
            content = parts;
        } else if (m.role === 'tool' && m.toolCallId) {
            content = [{
                type: 'tool-result',
                toolCallId: m.toolCallId,
                result: m.content
            }];
        } else if (content === null || content === undefined) {
            content = '';
        }

        return {
            role: m.role as any,
            content: content,
            createdAt: new Date(),
            version: currentVersion,
            turn: 0,
            providerData: m.providerData || undefined
        };
    }
}
