import { Service } from 'typedi';
import { SummarizeHistoryRequest } from '../types';
import { OpenaiRawClient } from '../core/OpenaiRawClient';
import { LlmMessage, LlmRequest, LlmContentPart, LlmRole } from '../core/types';
import { LlmProvider } from '../../../types/chat';
import { getHistorySummaryPrompt, getHistorySummaryUserInstruction } from '../prompts/HistorySummaryPrompt';

@Service()
export class HistorySummaryAgent {

    public async summarizeHistory(provider: LlmProvider, request: SummarizeHistoryRequest): Promise<string> {
        const { modelId, litellmUrl, litellmKey } = this.getConfig(provider);
        const client = new OpenaiRawClient(litellmUrl, litellmKey, modelId);
        
        const systemPrompt = getHistorySummaryPrompt(request.previousSummary);
        
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
                    // For history summary, we might not need base64 images, but we pass them if they exist
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

        // Add the Final User Instruction 
        const userContent = getHistorySummaryUserInstruction();
        messages.push({ role: LlmRole.USER, content: userContent });

        const llmReq: LlmRequest = {
            messages,
            abortSignal: request.abortSignal,
            onTokenUsage: request.onTokenUsage
        };

        const result = await client.generate(llmReq);
        
        return result.text;
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
}
