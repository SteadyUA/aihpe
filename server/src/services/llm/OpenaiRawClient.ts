import { BaseLlmClient, FALLBACK_RESPONSE } from './BaseLlmClient';
import { GeneratePageRequest, GeneratePageResult, SessionFiles, SummarizeHistoryRequest } from './types';
import { ImageService } from '../image/ImageService';
import { SessionStore } from '../session/SessionStore';
import { ChatMessage } from '../../types/chat';

export class OpenaiRawClient extends BaseLlmClient {
    private baseUrl: string;
    private apiKey: string;

    constructor(
        imageService: ImageService,
        sessionStore: SessionStore,
        url: string,
        apiKey: string,
        private readonly modelId: string,
        maxContextTokens: number = 128000,
    ) {
        super(imageService, sessionStore, maxContextTokens);
        // Ensure url doesn't end with slash if we append it, but usually standard is base url
        // If the url is just the base (e.g. http://localhost:4000), we might need to append /chat/completions later
        // But usually LITELLM_API_URL might be the full base. Standard openai is https://api.openai.com/v1
        this.baseUrl = url.replace(/\/$/, '');
        this.apiKey = apiKey;
    }

    async generatePage(request: GeneratePageRequest): Promise<GeneratePageResult> {
        if (!this.baseUrl || !this.apiKey) {
            console.warn('No OpenAI URL or API Key provided to OpenaiRawClient');
            return FALLBACK_RESPONSE;
        }

        const systemPrompt = this.buildSystemPrompt(
            request.rulesAndGoal,
            request.imageGenerationPref,
            request.modelRole,
            request.summary
        );

        const initialMessages = this.buildMessages(request, systemPrompt);
        let currentMessages = [...initialMessages];
        let currentFiles = { ...request.files };

        const implementations = this.getToolImplementations(request, currentFiles);
        const tools = this.getOpenAiTools(request);

        let steps = 0;
        const maxSteps = 30;
        let fullText = '';
        const collectedNewMessages: any[] = [];
        let stop = false;

        try {
            while (steps < maxSteps && !stop) {
                if (request.abortSignal?.aborted) {
                    console.log('OpenaiRawClient: Generation aborted by signal');
                    break;
                }

                steps++;
                console.log(`OpenaiRawClient: Step ${steps}/${maxSteps} started.`);

                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                };

                const body = {
                    model: this.modelId,
                    messages: currentMessages,
                    tools: tools,
                    stream: true,
                    stream_options: { include_usage: true }
                };

                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: request.abortSignal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
                }

                if (!response.body) {
                    throw new Error('No response body');
                }

                // Streaming handling
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                let stepText = '';
                let toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }> = {};
                let finishReason: string | null = null;
                let usageSent = false;
                let currentStepUsage = { prompt: 0, completion: 0, total: 0 };

                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');

                        // Keep the last partial line in the buffer
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmedLine = line.trim();
                            if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

                            if (trimmedLine.startsWith('data: ')) {
                                try {
                                    const jsonStr = trimmedLine.slice(6);
                                    const chunk = JSON.parse(jsonStr);

                                    if (chunk.choices && chunk.choices.length > 0) {
                                        const delta = chunk.choices[0].delta;
                                        const finish = chunk.choices[0].finish_reason;

                                        if (delta.content) {
                                            stepText += delta.content;
                                            if (request.onProgress) {
                                                request.onProgress(delta.content);
                                            }
                                        }

                                        if (delta.tool_calls) {
                                            for (const toolCall of delta.tool_calls) {
                                                const index = toolCall.index;
                                                if (!toolCallsBuffer[index]) {
                                                    toolCallsBuffer[index] = { id: '', name: '', arguments: '' };
                                                }
                                                if (toolCall.id) toolCallsBuffer[index].id = toolCall.id;
                                                if (toolCall.function?.name) toolCallsBuffer[index].name = toolCall.function.name;
                                                if (toolCall.function?.arguments) toolCallsBuffer[index].arguments += toolCall.function.arguments;
                                            }
                                        }

                                        if (finish) {
                                            finishReason = finish;
                                        }
                                    }

                                    if (chunk.usage) {
                                        currentStepUsage = {
                                            prompt: chunk.usage.prompt_tokens,
                                            completion: chunk.usage.completion_tokens,
                                            total: chunk.usage.total_tokens
                                        };
                                        usageSent = true;
                                    }
                                } catch (e) {
                                    console.warn('Error parsing stream line:', trimmedLine, e);
                                }
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

                if (usageSent && request.trackRequestTokenUsage) {
                    await request.trackRequestTokenUsage({
                        ...currentStepUsage,
                        model: this.modelId,
                        agent: this.agentName,
                    });
                }

                fullText += stepText;

                // Construct Assistant Message
                const assistantMessage: any = {
                    role: 'assistant',
                    content: stepText || null,
                };

                const toolCalls = Object.values(toolCallsBuffer).map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: tc.arguments
                    }
                }));

                // Filter out invalid tool calls
                const validToolCalls = toolCalls.filter(tc => tc.function.name && tc.function.name.trim() !== '');

                // litellm with gemini can call tools even if there is text in the response
                // so we need to check if there is text in the response
                if (stepText && stepText.trim().length > -1) {
                    stop = true;
                } else if (validToolCalls.length > 0) {
                    assistantMessage.tool_calls = validToolCalls;
                }

                currentMessages.push(assistantMessage);
                collectedNewMessages.push(assistantMessage);

                console.log(`OpenaiRawClient: Step finished. Has text: ${stepText.length > 0 ? 'yes' : 'no'}, FinishReason: ${finishReason}, ValidToolCalls: ${validToolCalls.length}`);

                if (!stop && validToolCalls.length > 0) {
                    for (const toolCall of validToolCalls) {
                        const name = toolCall.function.name;
                        const argsString = toolCall.function.arguments;
                        let args;
                        try {
                            args = JSON.parse(argsString);
                        } catch (e) {
                            console.error(`Failed to parse arguments for tool ${name}: ${argsString}`);
                            args = {};
                        }

                        let result = '';
                        // @ts-ignore
                        const implementation = implementations[name];
                        if (implementation) {
                            try {
                                result = await implementation(args);
                            } catch (e: any) {
                                result = `Error executing ${name}: ${e.message}`;
                            }
                        } else {
                            result = `Error: Tool ${name} not found.`;
                        }

                        if (request.onProgress) {
                            const label = args.summary || `Tool call: ${name}`;
                            request.onProgress(`${label}\n`);
                        }

                        const toolMessage = {
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: result
                        };
                        currentMessages.push(toolMessage);
                        collectedNewMessages.push(toolMessage);
                    }
                    // Loop continues to generate response to tool outputs
                } else if (finishReason === 'stop' || finishReason === null) {
                    stop = true;
                }
            }

            // Map back to ChatMessage
            const newMessages: ChatMessage[] = collectedNewMessages.map(m => {
                let content: any = m.content;

                if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                    // Convert to AiSDK-like structure
                    const parts: any[] = [];
                    if (typeof m.content === 'string' && m.content) {
                        parts.push({ type: 'text', text: m.content });
                    }

                    m.tool_calls.forEach((tc: any) => {
                        parts.push({
                            type: 'tool-call',
                            toolCallId: tc.id,
                            toolName: tc.function.name,
                            args: JSON.parse(tc.function.arguments)
                        });
                    });
                    content = parts;
                } else if (m.role === 'tool' && m.tool_call_id) {
                    // Convert tool message to AiSDK-like structure
                    content = [{
                        type: 'tool-result',
                        toolCallId: m.tool_call_id,
                        result: m.content
                    }];
                } else if (content === null) {
                    content = '';
                }

                return {
                    role: m.role as any,
                    content: content,
                    createdAt: new Date(),
                    version: request.currentVersion,
                    turn: 0
                };
            });

            return {
                summary: fullText || 'Changes applied.',
                files: currentFiles,
                newMessages,
                targetVersion: this.targetVersion ?? request.currentVersion
            };

        } catch (error) {
            console.error(`OpenaiRawClient Error:`, error);
            throw error;
        }
    }

    async summarizeHistory(request: SummarizeHistoryRequest): Promise<string> {
        const historyMessages = request.conversation.map(msg => {
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                return { role: msg.role, content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) };
            }
            return null;
        }).filter(m => m !== null);

        const summaryPrompt = this.getHistorySummaryPrompt(request.previousSummary);

        const body = {
            model: this.modelId,
            messages: [
                { role: 'system', content: summaryPrompt },
                ...historyMessages,
                { role: 'user', content: this.getHistorySummaryUserInstruction() }
            ],
            stream: false
        };

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
                signal: request.abortSignal
            });

            if (!response.ok) {
                console.warn(`Summarize history failed with status ${response.status}`);
                return 'Summary unavailable.';
            }

            const data = await response.json();

            if (data.usage && request.trackRequestTokenUsage) {
                await request.trackRequestTokenUsage({
                    prompt: data.usage.prompt_tokens,
                    completion: data.usage.completion_tokens,
                    total: data.usage.total_tokens,
                    model: this.modelId,
                    agent: this.agentName,
                });
            }
            if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                return data.choices[0].message.content || 'Summary failed.';
            }
            return 'Summary unavailable.';

        } catch (e) {
            console.error('Error summarizing history:', e);
            return 'Summary unavailable.';
        }
    }


    private buildMessages(request: GeneratePageRequest, systemPrompt: string): any[] {
        const messages: any[] = [
            { role: 'system', content: systemPrompt }
        ];

        for (const entry of request.conversation) {
            if (entry.role === 'system') {
                messages.push({ role: 'system', content: entry.content as string });
                continue;
            }

            if (entry.role === 'user') {
                let content: any = entry.content;
                if (entry.attachment) {
                    if (typeof content === 'string') {
                        content = [
                            { type: 'text', text: content },
                            { type: 'image_url', image_url: { url: entry.attachment.dataUrl } }
                        ];
                    }
                }
                messages.push({ role: 'user', content });
            } else if (entry.role === 'assistant') {
                if (Array.isArray(entry.content)) {
                    // Reconstruct tool calls
                    // @ts-ignore
                    const toolCalls = entry.content.filter(c => c.type === 'tool-call').map(c => ({
                        id: c.toolCallId,
                        type: 'function',
                        function: {
                            name: c.toolName,
                            arguments: JSON.stringify(c.args)
                        }
                    }));
                    // @ts-ignore
                    const textPart = entry.content.find(c => c.type === 'text');
                    const content = textPart ? textPart.text : null;

                    messages.push({
                        role: 'assistant',
                        content: content,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    });
                } else {
                    messages.push({ role: 'assistant', content: entry.content as string });
                }
            } else if (entry.role === 'tool') {
                if (Array.isArray(entry.content)) {
                    // @ts-ignore
                    const toolResultPart = entry.content.find(c => c.type === 'tool-result');
                    if (toolResultPart) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolResultPart.toolCallId,
                            content: toolResultPart.result
                        });
                    }
                }
            }
        }

        let userContent: any = request.fastMode ? `No plan\n${request.instructions}` : request.instructions;
        if (request.attachment) {
            userContent = [
                { type: 'text', text: userContent },
                { type: 'image_url', image_url: { url: request.attachment.dataUrl } }
            ];
        }

        messages.push({ role: 'user', content: userContent });
        return messages;
    }

    private getOpenAiTools(request: GeneratePageRequest): any[] {
        const tools: any[] = [
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: 'Read the content of a file. Use this to understand current code before editing.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to read' },
                            summary: { type: 'string', description: 'Explain why you need to read this file.' }
                        },
                        required: ['file', 'summary']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'edit_file',
                    description: 'Edit a file by replacing exact string match.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file: { type: 'string', enum: ['index.html', 'styles.css', 'script.js'], description: 'The file to edit' },
                            oldString: { type: 'string', description: 'The exact string to replace.' },
                            newString: { type: 'string', description: 'The new string to replace it with.' },
                            summary: { type: 'string', description: 'Explain why you are making this edit.' }
                        },
                        required: ['file', 'oldString', 'newString', 'summary']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_subject',
                    description: 'Update the subject/topic of the session.',
                    parameters: {
                        type: 'object',
                        properties: {
                            subject: { type: 'string', description: 'The new subject (3-5 words).' }
                        },
                        required: ['subject']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'read_subject',
                    description: 'Read the current subject/topic of the session.',
                    parameters: {
                        type: 'object',
                        properties: {
                            summary: { type: 'string', description: 'Explain why you are checking the subject/topic.' }
                        },
                        required: ['summary']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_images',
                    description: 'List available UNUSED images in the current session.',
                    parameters: {
                        type: 'object',
                        properties: {
                            summary: { type: 'string', description: 'Explain why you are listing images.' }
                        },
                        required: ['summary']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'image_info',
                    description: 'Get details about a specific image.',
                    parameters: {
                        type: 'object',
                        properties: {
                            filename: { type: 'string', description: 'The filename of the image.' },
                            summary: { type: 'string', description: 'Explain why you are requesting info.' }
                        },
                        required: ['filename', 'summary']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'generate_image',
                    description: 'Generate an image based on a description.',
                    parameters: {
                        type: 'object',
                        properties: {
                            description: { type: 'string', description: 'Detailed description of the image.' },
                            summary: { type: 'string', description: 'Explain why you are generating this image.' }
                        },
                        required: ['description', 'summary']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'edit_image',
                    description: 'Edit an existing image based on a description.',
                    parameters: {
                        type: 'object',
                        properties: {
                            filename: { type: 'string', description: 'The filename of the image to edit.' },
                            description: { type: 'string', description: 'The instruction for editing the image.' },
                            summary: { type: 'string', description: 'Explain why you are editing this image.' }
                        },
                        required: ['filename', 'description', 'summary']
                    }
                }
            }
        ];

        if (request.allowVariants) {
            tools.push({
                type: 'function',
                function: {
                    name: 'generate_variant',
                    description: 'Generate A SINGLE variant of the page.',
                    parameters: {
                        type: 'object',
                        properties: {
                            instruction: { type: 'string', description: 'Specific, actionable instruction for this variant.' }
                        },
                        required: ['instruction']
                    }
                }
            });
        }

        return tools;
    }
}
