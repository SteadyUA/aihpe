import OpenAI from 'openai';
import { BaseLlmClient, FALLBACK_RESPONSE } from './BaseLlmClient';
import { GeneratePageRequest, GeneratePageResult, SessionFiles, LlmClient } from './types';
import { ImageService } from '../image/ImageService';
import { SessionStore } from '../session/SessionStore';
import { ChatMessage } from '../../types/chat';

export class OpenaiClient extends BaseLlmClient {
    constructor(
        imageService: ImageService,
        sessionStore: SessionStore,
        private readonly client: OpenAI,
        private readonly modelId: string,
        maxContextTokens: number = 128000,
    ) {
        super(imageService, sessionStore, maxContextTokens);
    }

    async generatePage(request: GeneratePageRequest): Promise<GeneratePageResult> {
        if (!this.client) {
            console.warn('No OpenAI Client provided to OpenaiClient');
            return FALLBACK_RESPONSE;
        }

        const systemPrompt = this.buildSystemPrompt(
            request.rulesAndGoal,
            request.imageGenerationPref,
            request.modelRole
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

        const totalUsage = {
            prompt: 0,
            completion: 0,
            total: 0,
            cached: 0,
            reasoning: 0
        };

        try {
            while (steps < maxSteps && !stop) {
                steps++;

                const stream = await this.client.chat.completions.create({
                    model: this.modelId,
                    messages: currentMessages,
                    tools: tools,
                    stream: true,
                    stream_options: { include_usage: true }
                });

                let stepText = '';
                let toolCallsBuffer: Record<number, { id: string; name: string; arguments: string }> = {};
                let finishReason: string | null = null;
                let usageSent = false;

                for await (const chunk of stream) {
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
                        totalUsage.total = chunk.usage.total_tokens;
                        totalUsage.prompt = chunk.usage.prompt_tokens;
                        totalUsage.completion = chunk.usage.completion_tokens;
                        // @ts-ignore
                        if (chunk.usage.prompt_tokens_details?.cached_tokens) totalUsage.cached = chunk.usage.prompt_tokens_details.cached_tokens;
                        // @ts-ignore
                        if (chunk.usage.completion_tokens_details?.reasoning_tokens) totalUsage.reasoning = chunk.usage.completion_tokens_details.reasoning_tokens;
                        usageSent = true;
                    }
                }

                fullText += stepText;

                // Construct Assistant Message
                const assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
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

                if (toolCalls.length > 0) {
                    assistantMessage.tool_calls = toolCalls;
                }

                currentMessages.push(assistantMessage);
                collectedNewMessages.push(assistantMessage);

                // FIX: Prioritize tool execution if tool calls exist, even if finishReason is 'stop' (some providers do this)
                if (toolCalls.length > 0) {
                    for (const toolCall of toolCalls) {
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

                        const toolMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
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
                    // Convert to AiSDK-like structure to preserve tool calls in history
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
                targetVersion: this.targetVersion ?? request.currentVersion,
                usage: {
                    prompt: totalUsage.prompt,
                    completion: totalUsage.completion,
                    total: totalUsage.total,
                },
                // @ts-ignore
                contextUsage: {
                    total: totalUsage.total,
                    capacity: this.maxContextTokens,
                }
            };

        } catch (error) {
            console.error(`OpenaiClient Error:`, error);
            throw error;
        }
    }

    private buildMessages(request: GeneratePageRequest, systemPrompt: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt }
        ];

        // Convert request.conversation (ChatMessage[]) to OpenAI format
        // ChatMessage: { role: 'user'|'assistant'|'system'|'tool', content: string|parts }

        for (const entry of request.conversation) {
            if (entry.role === 'system') continue; // We already added system prompt

            // Simple mapping:
            if (entry.role === 'user') {
                // Handle images
                let content: any = entry.content;
                if (entry.attachment) {
                    // Add attachment
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
                    // Reconstruct tool calls from array content
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
                        // @ts-ignore
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    });
                } else {
                    messages.push({ role: 'assistant', content: entry.content as string });
                }
            } else if (entry.role === 'tool') {
                // Reconstruct tool message from array content
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
                } else {
                    // If it's a simple string, we can't reconstruct tool_call_id.
                    // This case should ideally not happen if history is properly stored with tool_call_id.
                    // For now, we'll skip or log a warning.
                    console.warn('Skipping tool message in history due to missing tool_call_id:', entry);
                }
            }
        }

        // Add current instruction
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

    private getOpenAiTools(request: GeneratePageRequest): OpenAI.Chat.Completions.ChatCompletionTool[] {
        const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
                        properties: {},
                        required: []
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
