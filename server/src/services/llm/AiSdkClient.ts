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
} from './types';
import { ImageService } from '../image/ImageService';

const FALLBACK_RESPONSE: GeneratePageResult = {
    summary:
        'API key not configured. Returning existing files without modifications. Configure OPENAI_API_KEY or GEMINI_API_KEY.',
    files: {
        'index.html': '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Preview Unavailable</title>\n  </head>\n  <body>\n    <h1>Enable LLM Integration</h1>\n    <p>Provide an API key to generate content.</p>\n  </body>\n</html>',
        'styles.css': '',
        'script.js': '',
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

        const systemPrompt = this.buildSystemPrompt(
            request.rulesAndGoal,
            request.imageGenerationPref,
            !!request.files['implementation_plan.md']
        );
        const initialMessages: ModelMessage[] = this.buildMessages(request);

        // Local state for files
        let currentFiles = { ...request.files };
        let finalSummary = '';

        // Tool definitions (kept for usage in loop)
        const tools: Record<string, any> = {
            read_file: tool({
                description:
                    'Read the content of a file. Use this to understand current code before editing.',
                inputSchema: z.object({
                    file: z
                        .enum(['index.html', 'styles.css', 'script.js', 'implementation_plan.md'])
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
                    file: 'index.html' | 'styles.css' | 'script.js' | 'implementation_plan.md';
                    summary: string;
                }) => {
                    const content = currentFiles[file];
                    if (content !== undefined) return content;
                    return 'File not found';
                },
            }),
            edit_file: tool({
                description:
                    'Edit a file by replacing exact string match. The oldString must match exactly one location in the file.',
                inputSchema: z.object({
                    file: z
                        .enum(['index.html', 'styles.css', 'script.js', 'implementation_plan.md'])
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
                    file: 'index.html' | 'styles.css' | 'script.js' | 'implementation_plan.md';
                    oldString: string;
                    newString: string;
                    summary: string;
                }) => {
                    // Logic for Plan-First Workflow:
                    // 1. If editing implementation_plan.md, we stay on current version (mutable plan).
                    // 2. If editing code files, we MUST ensure a new version exists.
                    //    When we switch to a new version, we reset implementation_plan.md to empty to indicate a fresh start.

                    if (file === 'implementation_plan.md') {
                        // Edit in place. Do NOT trigger ensureNextVersion.
                    } else {
                        // Editing code. Ensure new version.
                        if (this.targetVersion === undefined) {
                            // This matches the FIRST code edit in this turn.
                            // We are transitioning from "Planning" to "Implementation".
                            this.ensureNextVersion(request.sessionId);

                            // currentFiles['implementation_plan.md'] = ''; // DEFERRED: We do not reset plan here anymore. We reset it at the end of generation if version changed.
                        }
                    }


                    const versionToUpdate = this.targetVersion !== undefined ? this.targetVersion : request.currentVersion;

                    let content = currentFiles[file] || '';
                    if (!content && (file === 'styles.css' || file === 'script.js' || file === 'implementation_plan.md')) {
                        // Allow empty css/js if undefined
                        content = '';
                    } else if (content === undefined) {
                        return `Error: File ${file} not found.`;
                    }

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
                    currentFiles[file] = newContent;


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
            description: 'List available UNUSED images in the current session. Returns image filenames and their geometry (width/height). Use this to find existing unused assets.',
            inputSchema: z.object({
                summary: z.string().describe('Explain why you are listing images. This will be shown to the user.'),
            }),
            execute: async ({ summary }: { summary: string }) => {
                try {
                    const images = await this.imageService.listImages(request.sessionId, request.currentVersion);
                    const unusedImages = images.filter((img) => !img.isUsed && img.description && img.description.trim() !== '');

                    if (unusedImages.length === 0) {
                        return 'No unused images found in this session.';
                    }
                    return JSON.stringify(unusedImages.map((img) => ({
                        filename: img.filename,
                        description: img.description,
                        width: img.width,
                        height: img.height,
                        model: img.model
                    })));
                } catch (error: any) {
                    return `Failed to list images: ${error.message}`;
                }
            },
        });

        tools.image_info = tool({
            description: 'Get details about a specific image including its description and geometry (width/height). Use this when you need to know the properties of a specific image file.',
            inputSchema: z.object({
                filename: z.string().describe('The filename of the image (e.g., "image.png").'),
                summary: z.string().describe('Explain why you are requesting info for this image. This will be shown to the user.'),
            }),
            execute: async ({ filename, summary }: { filename: string; summary: string }) => {
                try {
                    const info = await this.imageService.getImageInfo(request.sessionId, request.currentVersion, filename);
                    if (!info) {
                        return `Image not found: ${filename}`;
                    }
                    return JSON.stringify({
                        filename: info.filename,
                        description: info.description,
                        width: info.width,
                        height: info.height,
                        model: info.model
                    });
                } catch (error: any) {
                    return `Failed to get image info: ${error.message}`;
                }
            },
        });

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
            description: 'Edit an existing image based on a description. Use this when the user wants to change specific elements of an image (e.g., "change background to forest") while keeping the main subject. The new image will replace the old one with the same filename.',
            inputSchema: z.object({
                filename: z.string().describe('The filename of the image to edit (e.g., "image.png"). Must exist in the session.'),
                description: z.string().describe('The instruction for editing the image (e.g., "Change the background to a modern kitchen").'),
                summary: z.string().describe('Explain why you are editing this image. This will be shown to the user.'),
            }),
            execute: async ({ filename, description, summary }: { filename: string; description: string; summary: string }) => {
                try {
                    const nextVersion = this.ensureNextVersion(request.sessionId);
                    // Use currentVersion as source, nextVersion as target
                    const savedFilename = await this.imageService.editAndSave(request.sessionId, filename, description, request.currentVersion, nextVersion);
                    return `Image edited successfully: ${savedFilename}`;
                } catch (error: any) {
                    return `Failed to edit image: ${error.message}`;
                }
            },
        });

        if (request.allowVariants) {
            tools.generate_variant = tool({
                description:
                    'Generate A SINGLE variant of the page based on user request. Use this tool ONLY when the user explicitly asks for multiple options, variations, or different styles/designs (e.g. "show me 3 versions", "give me options"). Do NOT use this tool for standard edits, fixes, or updates to the current page (e.g. "change background to red" should use edit_file). You can call this tool multiple times to generate multiple variants. The instruction must be an actionable command that describes HOW to modify the current page to achieve the desired look.',
                inputSchema: z.object({
                    instruction: z
                        .string()
                        .describe(
                            'Specific, actionable instruction for this variant. Focused on WHAT to change (e.g., "Change background to blue...", "Update font to...").',
                        ),
                }),
                execute: async (args: {
                    instruction: string;
                }) => {
                    if (request.onVariantRequest) {
                        return await request.onVariantRequest(args.instruction);
                    }
                    return 'Variant generation not supported in this context.';
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
                            (tc) => tc.toolName === 'generate_variant',
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
                    version: request.currentVersion,
                    turn: 0, // Placeholder, will be assigned by ChatService
                }),
            );

            // Use the summary from tool if available, otherwise fallback to generated text or generic
            const summaryText = finalSummary || fullText || 'Changes applied.';

            // If we created a new version (targetVersion is set), we should reset the plan for the NEXT turn.
            // effectively, the new version's plan starts empty.
            if (this.targetVersion !== undefined) {
                currentFiles['implementation_plan.md'] = '';
            }

            return {
                summary: summaryText,
                files: currentFiles,
                newMessages,
                targetVersion: this.targetVersion ?? request.currentVersion,
            };
        } catch (error) {
            console.error(

                `Failed to generate page with ${this.modelId || 'unknown model'} `,
                error,
            );
            return {
                summary: `Не удалось получить ответ от модели: ${this.formatError(error)}. Предыдущая версия страницы сохранена.`,
                files: request.files,
            };
        }
    }

    private buildSystemPrompt(
        rulesAndGoal?: string,
        imageGenerationPref?: string,
        hasPlan?: boolean
    ): string {

        let prompt = `You are an expert web developer that maintains a simple web page composed of three files: index.html, styles.css, and script.js.
You additionally maintain a 'implementation_plan.md' file that tracks the immediate next steps.

Your goal is to fulfill the user's request by following this strict workflow:

1.  **PLAN FIRST**:
    -   All user messages are initially treated as discussion and clarification of the plan.
    -   Your first priority is always to update 'implementation_plan.md' to reflect the user's request.
    -   'implementation_plan.md' must be a CONCRETE, ACTIONABLE list of implementation steps.
    -   **IMPORTANT**: The content of 'implementation_plan.md' MUST be written in the same language as the user's messages.
    -   **CRITICAL**: DO NOT PROCEED TO IMPLEMENTATION UNTIL THE USER EXPLICITLY APPROVES THE PLAN.
    -   Explicit approval is typically a short phrase like "ok", "proceed", "yes", "do it", "looks good".
    -   If the user has not explicitly approved the plan, STOP after updating 'implementation_plan.md'.

    -   **STRICT PLAN STRUCTURE**:
        1.  **# Type of Changes** (H1): Describes the essence of the planned changes.
        2.  **## Goal** (H2, optional): A single paragraph describing the goal of the changes.
        3.  **## Proposed Changes** (H2): A section detailing the changes.
        4.  **List of changes**: A brief list of elements and how they will be modified. 
            - Use **### Component/Location** (H3) to group changes by file or component.
            - Ensure every step is clear and executable.

2.  **IMPLEMENT SECOND**:
    -   ONLY when the user says "ok" or explicitly approves the plan, proceed to implementation.
    -   Implement the changes in the code files ('index.html', etc.).
    -   When you start editing code files, the system will automatically create a NEW version.
    -   The 'implementation_plan.md' for the NEW version will be reset to empty. This is normal.
    -   After code generation or image generation, you must re-verify the new plan with the user for the next steps.

Strategy:
- Use 'read_file' to inspect the code to inform your plan.
- Use 'edit_file' to update 'implementation_plan.md' first. Ask for confirmation.
- Use 'edit_file' to apply changes to code files ONLY after confirmation.
- Use 'generate_variant' if asked for multiple options.

Rules:
- Preserve valid HTML/CSS/JS syntax.
- Do not output the full file content unless absolutely necessary (use 'edit_file').
- 'generate_variant' creates a NEW separate session.
- Partially autonomous image generation with 'generate_image' is encouraged.
`;

        if (rulesAndGoal) {
            prompt += `\n\nCONTEXT - PROJECT RULES AND GOAL:\n"${rulesAndGoal}"`;
        }

        if (imageGenerationPref) {
            prompt += `\n\nCONTEXT - IMAGE GENERATION PREFERENCES:\n"${imageGenerationPref}"`;
        }

        // if (hasPlan) {
        //     prompt += `\n\nCONTEXT: A 'implementation_plan.md' file exists from the previous turn. Read it and follow it if you are moving to implementation.`;
        // }

        return prompt;
    }

    private buildMessages(request: GeneratePageRequest): ModelMessage[] {
        const messages: ModelMessage[] = [];

        const processAttachment = (attachment?: any) => {
            const contentParts: ImagePart[] = [];
            if (attachment && attachment.dataUrl) {
                contentParts.push({
                    type: 'image',
                    image: attachment.dataUrl,
                });
            }
            return contentParts;
        };

        for (const entry of request.conversation) {
            const role = entry.role;
            if (role === 'user' || role === 'assistant') { // Assistant can also have images if multimodal model output supported, but mainly user
                let content: any = entry.content;

                // Check if we have attachments to inject
                if (entry.attachment) {
                    const attachmentParts = processAttachment(entry.attachment);
                    if (attachmentParts.length > 0) {
                        if (typeof content === 'string') {
                            content = [{ type: 'text', text: content }, ...attachmentParts];
                        } else if (Array.isArray(content)) {
                            content = [...content, ...attachmentParts];
                        }
                    }
                }

                messages.push({ role: role as any, content });
            } else if (entry.role === 'tool') {
                messages.push({ role: 'tool', content: entry.content });
            } else if (entry.role === 'system') {
                messages.push({ role: 'system', content: entry.content });
            }
        }

        const content: (TextPart | ImagePart)[] = [
            { type: 'text', text: request.instructions },
        ];

        content.push(...processAttachment(request.attachment));

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
