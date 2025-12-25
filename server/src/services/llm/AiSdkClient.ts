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

        const systemPrompt = this.buildSystemPrompt(request.imageGenerationAllowed);
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
                    'Call this when you are done making changes to provide a summary of what you did to the user. You can use Markdown to format the message.',
                inputSchema: z.object({
                    message: z
                        .string()
                        .describe(
                            'The summary message to display to the user. Use Markdown formatting (bold, italic, lists) to make it more readable.',
                        ),
                }),
                execute: async ({ message }: { message: string }) => {
                    finalSummary = message;
                    return 'Summary delivered.';
                },
            }),
        };

        // Add image tools
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

        if (request.imageGenerationAllowed) {
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
        }

        if (request.allowVariants) {
            tools.generate_variants = tool({
                description:
                    'Generate multiple variants of the page based on user request. Use this tool when the user asks for multiple variations, alternatives, or different styles/designs of the page. Do NOT implement in-page switchers for this purpose. The instructions for each variant must be actionable commands that describe HOW to modify the current page to achieve the desired look, not just a description of the final state.',
                inputSchema: z.object({
                    count: z
                        .number()
                        .min(2)
                        .max(5)
                        .describe('Number of variants to generate (max 5)'),
                    instructions: z
                        .array(z.string())
                        .describe(
                            'Specific, actionable instructions for each variant.  Do NOT include "Variant 1", "Variant 2", etc. prefixes. focused on WHAT to change (e.g., "Change background to blue...", "Update font to...").',
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
            const maxSteps = 30;
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
                // These are the messages generated in this step
                const stepMessages = response.messages;

                // --- FIX: Sort tool results if they were auto-executed or provided by the model ---
                // We check if stepMessages contains an assistant message with tool-calls AND a tool message with results.
                // If so, we sort the results in the tool message to match the order of calls.
                const assistantMsgWithCalls = stepMessages.find(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-call'));
                const toolMsgWithResults = stepMessages.find(m => m.role === 'tool' && Array.isArray(m.content));

                if (assistantMsgWithCalls && toolMsgWithResults && Array.isArray(assistantMsgWithCalls.content) && Array.isArray(toolMsgWithResults.content)) {
                    const callOrder = assistantMsgWithCalls.content
                        .filter((c: any) => c.type === 'tool-call')
                        .map((c: any) => c.toolCallId);

                    if (callOrder.length > 0) {
                        const results = toolMsgWithResults.content as any[];
                        // Check if we need to sort
                        // We only sort if all callIds are present to avoid dataloss
                        const resultIds = results.map(r => r.toolCallId);

                        // Simple check: do we have results for these calls?
                        // Note: resultIds might contain more or fewer if something is weird, but usually 1:1.

                        results.sort((a, b) => {
                            const idxA = callOrder.indexOf(a.toolCallId);
                            const idxB = callOrder.indexOf(b.toolCallId);
                            // Place known items in order, unknown items at end
                            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                        });
                    }
                }
                // ---------------------------------------------------------------------------------

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

                    if (toolCalls.length > 0) {
                        // All tools were executed by provider (or we processed results in stepMessages above).
                        // Check if we should stop loop based on executed tools.
                        const summaryExecuted = toolCalls.some(
                            (tc) => tc.toolName === 'summary',
                        );
                        // Also stop if variants were generated
                        const variantsExecuted = toolCalls.some(
                            (tc) => tc.toolName === 'generate_variants',
                        );

                        if (summaryExecuted || variantsExecuted) {
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
                    version: request.currentVersion,
                    turn: 0, // Placeholder, will be assigned by ChatService
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

    private buildSystemPrompt(imageGenerationAllowed: boolean = true): string {
        const imageInstructions = imageGenerationAllowed
            ? `- Image generation is ENABLED. You are encouraged to partially autonomously generate images using 'generate_image' when you believe they would enhance the user's request (e.g., adding a hero image to a landing page, visualizing a concept), even if the user didn't explicitly ask for it. Always check for existing images with 'list_images' first to avoid duplicates. Use 'edit_image' to modify existing images.`
            : `- Image generation is DISABLED. You can use 'list_images' to view what is available, BUT you CANNOT generate new images or edit existing ones. If user asks to generate/edit, explain it is disabled.`;

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
${imageInstructions}
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
