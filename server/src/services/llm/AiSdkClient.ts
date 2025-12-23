import {
    streamText,
    tool,
    ModelMessage,
    LanguageModel,
    ImagePart,
    TextPart,
} from 'ai';
import { z } from 'zod';
import { ChatMessage } from '../../types/chat';
import {
    GeneratePageRequest,
    GeneratePageResult,
    LlmClient,
    VariantRequest,
} from './types';
import { ImageService } from '../image/ImageService';

const FALLBACK_RESPONSE: GeneratePageResult = {
    summary:
        'API key not configured. Returning existing files without modifications. Configure OPENAI_API_KEY or GEMINI_API_KEY.',
    files: {
        html: '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Preview Unavailable</title>\n  </head>\n  <body>\n    <h1>Enable LLM Integration</h1>\n    <p>Provide an API key to generate content.</p>\n  </body>\n</html>',
        css: '',
        js: '',
    },
};

import { SessionStore } from '../session/SessionStore';

export class AiSdkClient implements LlmClient {
    private targetVersion: number | undefined;

    constructor(
        private readonly imageService: ImageService,
        private readonly sessionStore: SessionStore,
        private readonly model?: LanguageModel,
        private readonly modelId?: string,
        private readonly maxContextTokens: number = 128000,
    ) { }

    private ensureNextVersion(sessionId: string): number {
        if (this.targetVersion === undefined) {
            this.targetVersion = this.sessionStore.initNextVersion(sessionId);
        }
        return this.targetVersion;
    }

    async generatePage(
        request: GeneratePageRequest,
    ): Promise<GeneratePageResult> {
        if (!this.model) {
            console.warn('No LanguageModel provided to AiSdkClient');
            return FALLBACK_RESPONSE;
        }

        const systemPrompt = this.buildSystemPrompt();
        const initialMessages: ModelMessage[] = this.buildMessages(request);

        // Local state for files
        let currentFiles = { ...request.files };
        let finalSummary = '';
        let variantRequest: VariantRequest | undefined;

        // Tool definitions (kept for usage in loop)
        const tools: Record<string, any> = {
            read_file: tool({
                description:
                    'Read the content of a file. Use this to understand current code before editing.',
                inputSchema: z.object({
                    file: z
                        .enum(['index.html', 'styles.css', 'script.js'])
                        .describe('The file to read'),
                    summary: z
                        .string()
                        .describe(
                            'Explain why you need to read this file. This will be shown to the user.',
                        ),
                }),
                execute: async ({
                    file,
                    summary,
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    summary: string;
                }) => {
                    if (file === 'index.html') return currentFiles.html;
                    if (file === 'styles.css') return currentFiles.css;
                    if (file === 'script.js') return currentFiles.js;
                    return 'File not found';
                },
            }),
            edit_file: tool({
                description:
                    'Edit a file by replacing exact string match. The oldString must match exactly one location in the file.',
                inputSchema: z.object({
                    file: z
                        .enum(['index.html', 'styles.css', 'script.js'])
                        .describe('The file to edit'),
                    oldString: z
                        .string()
                        .describe(
                            'The exact string to replace. Must be unique in the file.',
                        ),
                    newString: z
                        .string()
                        .describe('The new string to replace it with.'),
                    summary: z
                        .string()
                        .describe(
                            'Explain why you are making this edit. This will be shown to the user.',
                        ),
                }),
                execute: async ({
                    file,
                    oldString,
                    newString,
                    summary,
                }: {
                    file: 'index.html' | 'styles.css' | 'script.js';
                    oldString: string;
                    newString: string;
                    summary: string;
                }) => {
                    this.ensureNextVersion(request.sessionId);

                    let content = '';
                    if (file === 'index.html') content = currentFiles.html;
                    else if (file === 'styles.css') content = currentFiles.css;
                    else if (file === 'script.js') content = currentFiles.js;

                    let targetString = oldString;
                    if (!content.includes(targetString)) {
                        // Try flexible matching for trailing/leading whitespace
                        if (content.includes(targetString.trim())) {
                            targetString = targetString.trim();
                        } else {
                            // Try normalizing newlines (CRLF vs LF)
                            const normalizedContent = content.replace(
                                /\r\n/g,
                                '\n',
                            );
                            const normalizedTarget = targetString.replace(
                                /\r\n/g,
                                '\n',
                            );
                            if (normalizedContent.includes(normalizedTarget)) {
                                // We found a match with normalized line endings.
                                // However, simple replace on 'content' won't work directly if indices differ.
                                // For simplicity/safety, we fail if strict match fails but hints validation
                                // OR we update the file content to be normalized (acceptable for this project).
                                content = normalizedContent;
                                targetString = normalizedTarget;
                            } else if (
                                normalizedContent.includes(
                                    normalizedTarget.trim(),
                                )
                            ) {
                                content = normalizedContent;
                                targetString = normalizedTarget.trim();
                            } else {
                                return `Error: oldString not found in ${file}`;
                            }
                        }
                    }

                    if (content.split(targetString).length > 2)
                        return `Error: oldString found multiple times in ${file}. Provide more unique context.`;

                    const newContent = content.replace(targetString, newString);
                    if (file === 'index.html') currentFiles.html = newContent;
                    else if (file === 'styles.css')
                        currentFiles.css = newContent;
                    else if (file === 'script.js') currentFiles.js = newContent;
                    return `Successfully updated ${file}`;
                },
            }),
            summary: tool({
                description:
                    'Call this when you are done making changes to provide a summary of what you did to the user.',
                inputSchema: z.object({
                    message: z
                        .string()
                        .describe(
                            'The summary message to display to the user.',
                        ),
                }),
                execute: async ({ message }: { message: string }) => {
                    finalSummary = message;
                    return 'Summary delivered.';
                },
            }),
        };

        // Add image tools
        tools.generate_image = tool({
            description: 'Generate an image based on a description. Use this when you need a specific image that doesn\'t exist. Returns the filename of the generated image.',
            inputSchema: z.object({
                description: z.string().describe('Detailed description of the image to generate'),
                summary: z.string().describe('Explain why you are generating this image. This will be shown to the user.'),
            }),
            execute: async ({ description, summary }: { description: string; summary: string }) => {
                try {
                    const nextVersion = this.ensureNextVersion(request.sessionId);
                    const filename = await this.imageService.generateAndSave(request.sessionId, description, nextVersion);
                    return `Image generated successfully: ${filename}`;
                } catch (error: any) {
                    return `Failed to generate image: ${error.message}`;
                }
            },
        });

        tools.list_images = tool({
            description: 'List available images in the current session. Use this to see if a suitable image already exists before generating a new one.',
            inputSchema: z.object({
                summary: z.string().describe('Explain why you are listing images. This will be shown to the user.'),
            }),
            execute: async ({ summary }: { summary: string }) => {
                try {
                    const images = await this.imageService.listImages(request.sessionId, request.currentVersion);
                    if (images.length === 0) {
                        return 'No images found in this session.';
                    }
                    return JSON.stringify(images);
                } catch (error: any) {
                    return `Failed to list images: ${error.message}`;
                }
            },
        });

        tools.edit_image = tool({
            description: 'Regenerate an existing image. Use this when the user wants to change or improve an image. The new image will replace the old one with the same filename.',
            inputSchema: z.object({
                filename: z.string().describe('The filename of the image to regenerate (e.g., "image.png")'),
                description: z.string().describe('The new detailed description for the image'),
                summary: z.string().describe('Explain why you are editing this image. This will be shown to the user.'),
            }),
            execute: async ({ filename, description, summary }: { filename: string; description: string; summary: string }) => {
                try {
                    const nextVersion = this.ensureNextVersion(request.sessionId);
                    const savedFilename = await this.imageService.generateAndSave(request.sessionId, description, nextVersion, filename);
                    return `Image updated successfully: ${savedFilename}`;
                } catch (error: any) {
                    return `Failed to update image: ${error.message}`;
                }
            },
        });

        if (request.allowVariants) {
            tools.generate_variants = tool({
                description:
                    'Generate multiple variants of the page based on user request. Use this tool when the user asks for multiple variations, alternatives, or different styles/designs of the page. Do NOT implement in-page switchers for this purpose.',
                inputSchema: z.object({
                    count: z
                        .number()
                        .min(2)
                        .max(5)
                        .describe('Number of variants to generate (max 5)'),
                    instructions: z
                        .array(z.string())
                        .describe(
                            'Specific instructions for each variant. Must match the count.',
                        ),
                }),
                execute: async (args: {
                    count: number;
                    instructions: string[];
                }) => {
                    variantRequest = args;
                    return 'Variants generation requested.';
                },
            });
        }

        try {
            let currentMessages = [...initialMessages];
            let steps = 0;
            const maxSteps = 15;
            let fullText = '';

            // We'll collect new messages here to return them
            // We start after initialMessages
            const collectedNewMessages: ModelMessage[] = [];

            while (steps < maxSteps) {
                steps++;

                if (request.onProgress) {
                    // Debug log to trace loop execution
                    // request.onProgress(`Step ${steps}: Context size ${currentMessages.length} messages`);
                }

                const result = streamText({
                    model: this.model,
                    system: systemPrompt,
                    messages: currentMessages,
                    tools: tools,
                    // Manual loop, so no maxSteps here
                });

                let stepText = '';
                for await (const part of result.fullStream) {
                    switch (part.type) {
                        case 'text-delta':
                            stepText += part.text;
                            if (request.onProgress) {
                                request.onProgress(part.text);
                            }
                            break;
                        case 'tool-call':
                            if (request.onProgress) {
                                const toolName = part.toolName;
                                let input = (part as any).input || (part as any).args;
                                if (typeof input === 'string') {
                                    try {
                                        input = JSON.parse(input);
                                    } catch (e) {
                                        // Ignore parse errors, maybe it's just a string argument?
                                    }
                                }
                                const summary = input?.summary;
                                const label = summary || `Tool call: ${toolName}`;
                                request.onProgress(`${label}\n`);
                            }
                            break;
                        case 'error':
                            console.error('Stream error:', part.error);
                            break;
                    }
                }
                fullText += stepText;

                const usage = await result.usage;
                console.log(usage);
                console.log(`\n🔍 --- Step ${steps} Token Usage ---`);
                console.log(`Total Tokens:      ${usage.totalTokens}`);
                console.log(`Input Tokens:      ${usage.inputTokens}`);
                console.log(`Output Tokens:     ${usage.outputTokens}`);

                // Check for cached tokens
                // @ts-ignore: Accessing potential cache properties
                const cachedTokens =
                    (usage as any).cachedInputTokens ??
                    (usage as any).promptTokensDetails?.cachedTokens;
                if (cachedTokens !== undefined) {
                    console.log(`📦 CACHED TOKENS:  ${cachedTokens}`);
                }

                const usedTokens = usage.totalTokens || 0;
                const limit = this.maxContextTokens;
                const percentage = ((usedTokens / limit) * 100).toFixed(1);

                console.log(
                    `Context Usage:     ${usedTokens.toLocaleString()} / ${limit.toLocaleString()} tokens`,
                );
                console.log(`Capacity Used:     ${percentage}%`);
                console.log('---------------------------------\n');

                const response = await result.response;
                // These are the messages generated in this step (usually just one assistant message with text/toolCalls)
                const stepMessages = response.messages;

                // Add step messages to current history and collection
                for (const m of stepMessages) {
                    currentMessages.push(m);
                    collectedNewMessages.push(m);

                    // Notify about content found in response (tool calls and reasoning)
                    // Notify about content found in response (tool calls and reasoning)
                    if (
                        m.role === 'assistant' &&
                        Array.isArray(m.content) &&
                        request.onProgress
                    ) {
                        // We already handled streaming tool calls.
                        // We might want to handle non-streamed ones if any?
                        // Generally stream loop covers it.
                        // Let's keep it minimal or remove if duplicate.
                        // If we are strictly streaming, we don't need this.
                    }
                }

                if (!stepText && request.onProgress) {
                    // Debug: Log if no text was streamed but messages were received
                    console.log('No text streamed in this step.');
                }

                // Check for tool calls in the last message
                const toolCalls = await result.toolCalls;

                if (toolCalls && toolCalls.length > 0) {
                    // Identify tool calls that were ALREADY executed by the provider/SDK in this step
                    // by checking if there are 'tool' messages with matching toolCallId in stepMessages
                    const executedToolCallIds = new Set(
                        stepMessages
                            .filter((m) => m.role === 'tool')
                            .flatMap((m) =>
                                Array.isArray(m.content)
                                    ? m.content.map((c: any) => c.toolCallId)
                                    : [],
                            ),
                    );

                    // Filter out tool calls that were already executed
                    const pendingToolCalls = toolCalls.filter(
                        (tc) => !executedToolCallIds.has(tc.toolCallId),
                    );

                    if (pendingToolCalls.length > 0) {
                        // Report tool usage
                        if (request.onProgress) {
                            const prog = request.onProgress;
                            pendingToolCalls.forEach((tc) => {
                                // Try to extract summary from args
                                let summaryInfo = `Tool call: ${tc.toolName}`;
                                try {
                                    // Check if args is an object and has summary
                                    const args = (tc as any).args;
                                    if (
                                        args &&
                                        typeof args === 'object' &&
                                        args.summary
                                    ) {
                                        summaryInfo = args.summary;
                                    }
                                } catch (e) {
                                    // ignore
                                }
                                prog(summaryInfo + '\n');
                            });
                        }

                        const toolResults = await Promise.all(
                            pendingToolCalls.map(async (tc) => {
                                const tool = tools[tc.toolName];
                                if (tool && tool.execute) {
                                    try {
                                        // Access input property, fallback to args if input is missing (for safety)
                                        const input =
                                            (tc as any).input ||
                                            (tc as any).args;
                                        if (!input) {
                                            throw new Error(
                                                `No input provided for tool ${tc.toolName}`,
                                            );
                                        }

                                        const executionResult =
                                            await tool.execute(input);

                                        // Ensure output is compliant with LanguageModelV2ToolResultOutput
                                        let output: any;

                                        if (
                                            typeof executionResult === 'string'
                                        ) {
                                            output = {
                                                type: 'text',
                                                value: executionResult,
                                            };
                                        } else {
                                            output = {
                                                type: 'json',
                                                value: executionResult,
                                            };
                                        }

                                        return {
                                            type: 'tool-result' as const,
                                            toolCallId: tc.toolCallId,
                                            toolName: tc.toolName,
                                            output: output,
                                        };
                                    } catch (e: any) {
                                        return {
                                            type: 'tool-result' as const,
                                            toolCallId: tc.toolCallId,
                                            toolName: tc.toolName,
                                            output: {
                                                type: 'error-text',
                                                value: e.message || String(e),
                                            },
                                        };
                                    }
                                }
                                return {
                                    type: 'tool-result' as const,
                                    toolCallId: tc.toolCallId,
                                    toolName: tc.toolName,
                                    output: {
                                        type: 'error-text',
                                        value: 'Tool not found',
                                    },
                                };
                            }),
                        );

                        // Construct tool message
                        const toolMessage: ModelMessage = {
                            role: 'tool',
                            content: toolResults,
                        };

                        currentMessages.push(toolMessage);
                        collectedNewMessages.push(toolMessage);

                        // Check if summary or variants was called, if so, we might want to stop
                        const summaryCalled = pendingToolCalls.some(
                            (tc) => tc.toolName === 'summary',
                        );
                        const variantsCalled = pendingToolCalls.some(
                            (tc) => tc.toolName === 'generate_variants',
                        );

                        if (summaryCalled || variantsCalled) {
                            break;
                        }
                    } else {
                        // All tools were executed by provider. Check if we should stop.
                        const summaryExecuted = toolCalls.some(
                            (tc) => tc.toolName === 'summary',
                        );
                        if (summaryExecuted) {
                            break;
                        }
                    }
                } else {
                    // No tool calls, model is done
                    break;
                }
            }

            if (this.modelId) {
                console.log('Model:', this.modelId);
            }
            console.log('User Instructions:', request.instructions);

            // Map ModelMessage back to ChatMessage-compatible structure
            const newMessages: ChatMessage[] = collectedNewMessages.map(
                (m) => ({
                    role: m.role as any,
                    content: m.content,
                    createdAt: new Date(),
                }),
            );

            // Use the summary from tool if available, otherwise fallback to generated text or generic
            const summaryText = finalSummary || fullText || 'Changes applied.';

            return {
                summary: summaryText,
                files: currentFiles,
                variantRequest,
                newMessages,
                targetVersion: this.targetVersion,
            };
        } catch (error) {
            console.error(
                `Failed to generate page with ${this.modelId || 'unknown model'}`,
                error,
            );
            return {
                summary: `Не удалось получить ответ от модели: ${this.formatError(error)}. Предыдущая версия страницы сохранена.`,
                files: request.files,
            };
        }
    }

    private buildSystemPrompt(): string {
        return `You are an expert web developer that maintains a simple web page composed of three files: index.html, styles.css, and script.js.

Your goal is to fulfill the user's request by modifying these files.

Strategy:
1. Use 'read_file' to examine the current content of relevant files. Provide a 'summary' explaining why you need to read it.
2. Use 'edit_file' to apply specific changes. You should favor targeted edits using unique string replacements to save context window. Provide a 'summary' explaining the change.
3. If you need to make multiple changes, perform them in steps.
4. Once you have completed the task, use the 'summary' tool to explain what you did and finish the turn.
5. IMPORTANT: Do not repeat a tool call if it was successful. Wait for the tool result before proceeding.

Rules:
- Preserve valid HTML/CSS/JS syntax.
- Do not output the full file content unless absolutely necessary (use 'edit_file').
- If the user asks for variants, use 'generate_variants'.
- If the user asks for images or you need an image, use 'list_images' to check existing ones, or 'generate_image' to create a new one.
- If the user asks to change/regenerate an existing image, use 'edit_image'.
`;
    }

    private buildMessages(request: GeneratePageRequest): ModelMessage[] {
        const messages: ModelMessage[] = [];

        for (const entry of request.conversation) {
            if (entry.role === 'user') {
                messages.push({ role: 'user', content: entry.content });
            } else if (entry.role === 'assistant') {
                // Check if content implies tool calls which might need strict shape?
                // For now, assume stored content is compatible or just text
                messages.push({ role: 'assistant', content: entry.content });
            } else if (entry.role === 'tool') {
                messages.push({ role: 'tool', content: entry.content });
            } else if (entry.role === 'system') {
                messages.push({ role: 'system', content: entry.content });
            }
        }

        const content: (TextPart | ImagePart)[] = [
            { type: 'text', text: request.instructions },
        ];

        if (request.attachments && request.attachments.length > 0) {
            for (const attachment of request.attachments) {
                if (attachment.dataUrl) {
                    content.push({
                        type: 'image',
                        image: attachment.dataUrl,
                    });
                }
            }
        }

        messages.push({
            role: 'user',
            content: content,
        });

        return messages;
    }

    private formatError(error: unknown): string {
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String(
                (error as { message: unknown }).message || 'неизвестная ошибка',
            );
        }
        return 'неизвестная ошибка';
    }
}
