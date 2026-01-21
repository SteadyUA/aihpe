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
import { BaseLlmClient, FALLBACK_RESPONSE } from './BaseLlmClient';
import { SessionStore } from '../session/SessionStore';

export class AiSdkClient extends BaseLlmClient {

    constructor(
        imageService: ImageService,
        sessionStore: SessionStore,
        private readonly model?: LanguageModel,
        private readonly modelId?: string,
        maxContextTokens: number = 128000,
    ) {
        super(imageService, sessionStore, maxContextTokens);
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
            request.modelRole
        );
        const initialMessages: ModelMessage[] = this.buildMessages(request);

        // Local state for files
        let currentFiles = { ...request.files };

        // Helper to get shared tool implementations
        const implementations = this.getToolImplementations(request, currentFiles);


        // Tool definitions using AI SDK 'tool' helper
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
                execute: implementations.read_file,
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
                execute: implementations.edit_file,
            }),
            update_subject: tool({
                description: 'Update the subject/topic of the session. Use this tool when the session subject is "..." or generic, and the conversation context allows for a better, short summary (3-5 words).',
                inputSchema: z.object({
                    subject: z.string().describe('The new subject for the session. Should be concise (3-5 words max) and in the language of the user\'s messages.'),
                }),
                execute: implementations.update_subject,
            }),
            read_subject: tool({
                description: 'Read the current subject/topic of the session. Use this to check if the subject is still "..." or if it needs updating based on the current context.',
                inputSchema: z.object({}),
                execute: implementations.read_subject,
            }),
            list_images: tool({
                description: 'List available UNUSED images in the current session. Returns image filenames and their geometry (width/height). Use this to find existing unused assets.',
                inputSchema: z.object({
                    summary: z.string().describe('Explain why you are listing images. This will be shown to the user.'),
                }),
                execute: implementations.list_images,
            }),
            image_info: tool({
                description: 'Get details about a specific image including its description and geometry (width/height). Use this when you need to know the properties of a specific image file.',
                inputSchema: z.object({
                    filename: z.string().describe('The filename of the image (e.g., "image.png").'),
                    summary: z.string().describe('Explain why you are requesting info for this image. This will be shown to the user.'),
                }),
                execute: implementations.image_info,
            }),
            generate_image: tool({
                description: 'Generate an image based on a description. Use this when you need a specific image that doesn\'t exist. Returns the filename of the generated image.',
                inputSchema: z.object({
                    description: z.string().describe('Detailed description of the image to generate'),
                    summary: z.string().describe('Explain why you are generating this image. This will be shown to the user.'),
                }),
                execute: implementations.generate_image,
            }),
            edit_image: tool({
                description: 'Edit an existing image based on a description. Use this when the user wants to change specific elements of an image (e.g., "change background to forest") while keeping the main subject. The new image will replace the old one with the same filename.',
                inputSchema: z.object({
                    filename: z.string().describe('The filename of the image to edit (e.g., "image.png"). Must exist in the session.'),
                    description: z.string().describe('The instruction for editing the image (e.g., "Change the background to a modern kitchen").'),
                    summary: z.string().describe('Explain why you are editing this image. This will be shown to the user.'),
                }),
                execute: implementations.edit_image,
            }),
        };


        if (request.allowVariants) {
            tools.generate_variant = tool({
                description:
                    'Generate A SINGLE variant of the page based on user request. Use this tool ONLY when the user explicitly asks for multiple options, variations, or different styles/designs (e.g. "show me 3 versions", "give me options"). Do NOT use this tool for standard edits, fixes, or updates to the current page (e.g. "change background to red" should use edit_file). You can call this tool multiple times to generate multiple variants. The instruction must be an actionable command that describes HOW to modify the current page to achieve the desired look.',
                inputSchema: z.object({
                    instruction: z
                        .string()
                        .describe(
                            'Specific, actionable instruction for this variant. Focused on WHAT to change (e.g., "Change background to blue...", "Update font to..."). Must be in the language of the user\'s messages.',
                        ),
                }),
                execute: implementations.generate_variant,
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
            let stop = false;

            const totalUsage: {
                prompt: number;
                completion: number;
                total: number;
                reasoning?: number;
                cached?: number;
            } = {
                prompt: 0,
                completion: 0,
                total: 0,
            };

            let usage;
            while (steps < maxSteps && !stop) {
                steps++;

                const result = streamText({
                    model: this.model,
                    system: systemPrompt,
                    messages: currentMessages,
                    tools: tools,
                    // Manual loop, so no maxSteps here
                });

                let stepText = '';
                let streamError: unknown = null;

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
                            streamError = part.error;
                            break;
                        case 'finish':
                            if (part.finishReason === 'stop') {
                                console.log('\n[System] Agent finished (final answer received).');
                                stop = true;
                            }
                            break;
                    }
                }

                if (streamError) {
                    throw streamError;
                }
                fullText += stepText;

                usage = await result.usage;

                totalUsage.prompt += usage.inputTokens || 0;
                totalUsage.completion += usage.outputTokens || 0;
                totalUsage.total += usage.totalTokens || 0;

                // Check for cached tokens
                // @ts-ignore: Accessing potential cache properties
                const cachedTokens =
                    (usage as any).cachedInputTokens ??
                    (usage as any).promptTokensDetails?.cachedTokens;

                // Check for reasoning tokens
                // @ts-ignore: Accessing potential reasoning properties
                const reasoningTokens =
                    (usage as any).reasoningTokens ??
                    (usage as any).completionTokensDetails?.reasoningTokens;

                if (cachedTokens !== undefined) {
                    totalUsage.cached = (totalUsage.cached || 0) + cachedTokens;
                }

                if (reasoningTokens !== undefined) {
                    totalUsage.reasoning = (totalUsage.reasoning || 0) + reasoningTokens;
                }

                const response = await result.response;
                // These are the messages generated in this step
                const stepMessages = response.messages;

                // --- FIX: Sort tool results if they were auto-executed or provided by the model ---
                const assistantMsgWithCalls = stepMessages.find(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool-call'));
                const toolMsgWithResults = stepMessages.find(m => m.role === 'tool' && Array.isArray(m.content));

                if (assistantMsgWithCalls && toolMsgWithResults && Array.isArray(assistantMsgWithCalls.content) && Array.isArray(toolMsgWithResults.content)) {
                    const callOrder = assistantMsgWithCalls.content
                        .filter((c: any) => c.type === 'tool-call')
                        .map((c: any) => c.toolCallId);

                    if (callOrder.length > 0) {
                        const results = toolMsgWithResults.content as any[];
                        results.sort((a, b) => {
                            const idxA = callOrder.indexOf(a.toolCallId);
                            const idxB = callOrder.indexOf(b.toolCallId);
                            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                        });
                    }
                }

                // Add step messages to current history and collection
                for (const m of stepMessages) {
                    currentMessages.push(m);
                    collectedNewMessages.push(m);
                }
            }

            if (this.modelId) {
                console.log('Model:', this.modelId);
            }

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

            const summaryText = fullText || 'Changes applied.';

            return {
                summary: summaryText,
                files: currentFiles,
                newMessages,
                targetVersion: this.targetVersion ?? request.currentVersion,
                usage: totalUsage,
                contextUsage: {
                    total: usage?.totalTokens || 0,
                    capacity: this.maxContextTokens,
                }
            };
        } catch (error) {
            console.error(
                `Failed to generate page with ${this.modelId || 'unknown model'} `,
                error,
            );
            // Rethrow the error so ChatService can handle it and set session status to 'error'
            throw error;
        }
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
            { type: 'text', text: request.fastMode ? `No plan\n${request.instructions}` : request.instructions },
        ];

        content.push(...processAttachment(request.attachment));

        messages.push({
            role: 'user',
            content: content,
        });

        return messages;
    }
}
