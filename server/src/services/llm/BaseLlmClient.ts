import { ImageService } from '../image/ImageService';
import { SessionStore } from '../session/SessionStore';
import { GeneratePageRequest, GeneratePageResult, LlmClient, SessionFiles, SummarizeHistoryRequest } from './types';
import { ChatMessage } from '../../types/chat';

export const FALLBACK_RESPONSE: GeneratePageResult = {
    summary:
        'API key not configured. Returning existing files without modifications. Configure OPENAI_API_KEY or GEMINI_API_KEY.',
    files: {
        'index.html': '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Preview Unavailable</title>\n  </head>\n  <body>\n    <h1>Enable LLM Integration</h1>\n    <p>Provide an API key to generate content.</p>\n  </body>\n</html>',
        'styles.css': '',
        'script.js': '',
    }
};

export abstract class BaseLlmClient implements LlmClient {
    protected targetVersion: number | undefined;

    constructor(
        protected readonly imageService: ImageService,
        protected readonly sessionStore: SessionStore,
        protected readonly maxContextTokens: number = 128000,
    ) { }

    abstract generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
    abstract summarizeHistory(request: SummarizeHistoryRequest): Promise<string>;

    getCapacity(): number {
        return this.maxContextTokens;
    }

    protected ensureNextVersion(sessionId: string): number {
        if (this.targetVersion === undefined) {
            this.targetVersion = this.sessionStore.initNextVersion(sessionId);
        }
        return this.targetVersion;
    }

    protected buildSystemPrompt(
        rulesAndGoal?: string,
        imageGenerationPref?: string,
        modelRole?: string
    ): string {
        const roleDefinition = modelRole || 'You are an expert web developer';

        let prompt = `${roleDefinition} that maintains a simple web page composed of three files: index.html, styles.css, and script.js.

The user acts as a Business Analyst who wants to define a set of features to be implemented.
They want to discuss WHAT features will be implemented and WHY (the goal).

Your goal is to fulfill the user's request by following this strict workflow:

1.  **PLANNING PHASE**:
    -   All user messages are initially treated as discussion and clarification of the plan.
    -   Discuss the features and requirements with the user in the chat.
    -   If the user's request is ambiguous, lacks detail, or you need more context to create a plan, ASK CLARIFYING QUESTIONS. Do not guess.
    -   **CRITICAL**: DO NOT PROCEED TO IMPLEMENTATION UNTIL THE USER EXPLICITLY APPROVES THE PLAN IN THE CHAT.
    -   Explicit approval is typically a short phrase like "ok", "proceed", "yes", "do it", "looks good".
    -   **EXCEPTION 1**: If the user explicitly asks to make changes "without planning", "no plan", or "fast mode", you may SKIP the planning phase and proceed directly to implementation.
    -   **EXCEPTION 2**: If you asked CLARIFYING QUESTIONS and the user provided clean answers that make the path forward clear, you may PROCEED directly to implementation without summarizing the plan again.

    -   **PLAN SUMMARY**:
        -   Before asking for approval, summarize the agreed-upon features in a clear, bulleted list in your chat message.
        -   For each feature, provide a clear description of the change and its goal. Use natural language (e.g., "Improve navigation by replacing the progress bar to make it more visible").
        -   Do NOT mention specific filenames or technical details in this summary.

2.  **IMPLEMENTATION PHASE**:
    -   ONLY when the user says "ok" or explicitly approves the plan (OR if the user requested "no plan"), proceed to implementation.
    -   Implement the changes in the code files ('index.html', etc.).
    -   When you start editing code files, the system will automatically create a NEW version.
    -   After code generation or image generation, you must re-verify the new plan with the user for the next steps.
    -   **NOTE**: If the previous step was executed in "fast mode" (without plan), the NEXT step MUST return to the default "PLANNING PHASE" workflow unless the user explicitly requests fast mode again.

3.  **COMPLETION AND SUMMARY**:
    -   When you have completed the requested changes or answered the user's question, provide a final text summary.
    -   **IMPORTANT**: Do NOT mention the planning mode (e.g. "fast mode", "no plan", "continuing without plan") in your final summary. Just describe the changes made.

Strategy:
- Use 'read_file' to inspect the code to inform your plan (check feasibility).
- Use 'edit_file' to apply changes to code files ONLY after confirmation.
- Use 'generate_variant' if asked for multiple options.
- Use 'read_subject' to check the current session topic if you are unsure or if it might be outdated.
- Use 'update_subject' to set a concise topic for the session if it is currently "..." or generic. Ensure the subject is in the user's language.

Rules:
- **NO PREAMBLE**: When using tools to apply changes, **DO NOT** output accompanying text like "I will now..." or "Applying changes...". JUST USE THE TOOL.
- **TEXT AFTER ACTION**: Only provide a text summary/response AFTER the tool usage is complete.
- **SESSION TITLE**:
    -   **MANDATORY**: Always check the session subject. If it is "..." or generic, **YOU MUST** use 'update_subject' to set a concise title (3-5 words) reflecting the user's request. Do this early.
- Preserve valid HTML/CSS/JS syntax.
- Do not output the full file content unless absolutely necessary (use 'edit_file').
- 'generate_variant' creates a NEW separate session.
- **IMAGES**:
    -   **ALWAYS** use the 'generate_image' tool to create ANY visual assets (photos, icons, illustrations) that the user did not provide.
    -   **NEVER** use external placeholder URLs (like 'via.placeholder.com', 'unsplash.com', etc.) or broken links. The user wants REAL generated images.
    -   If a user asks for "an image of a cat", GENERATE IT using 'generate_image'. Do NOT ask if they want to generate it, just do it.
`;

        if (rulesAndGoal) {
            prompt += `\n\nCONTEXT - PROJECT RULES AND GOAL:\n"${rulesAndGoal}"`;
        }

        if (imageGenerationPref) {
            prompt += `\n\nCONTEXT - IMAGE GENERATION PREFERENCES:\n"${imageGenerationPref}"`;
        }


        return prompt;
    }

    protected formatError(error: unknown): string {
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String(
                (error as { message: unknown }).message || 'unknown error',
            );
        }
        return 'unknown error';
    }

    protected getHistorySummaryPrompt(): string {
        return `You are a helpful assistant. Summarize the progress of the conversation and the reasoning behind the changes made so far. 
Focus on WHAT was done and why, and what is currently being discussed. 
Keep the summary concise but informative (max 2-3 paragraphs). 
The summary will be used as a context for future steps. 
Respond ONLY with the summary text.`;
    }

    // Helper to create tool implementations since they need access to member functions and request context
    protected getToolImplementations(request: GeneratePageRequest, currentFiles: SessionFiles) {
        return {
            read_file: async ({
                file,
                summary,
            }: {
                file: 'index.html' | 'styles.css' | 'script.js';
                summary: string;
            }) => {
                const content = currentFiles[file];
                if (content !== undefined) return content;
                return 'File not found';
            },
            edit_file: async ({
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
                // Logic for Workflow:
                // 1. If editing code files, we MUST ensure a new version exists.
                //    This matches the FIRST code edit in this turn.

                if (this.targetVersion === undefined) {
                    this.ensureNextVersion(request.sessionId);
                }

                const versionToUpdate = this.targetVersion !== undefined ? this.targetVersion : request.currentVersion;

                let content = currentFiles[file] || '';
                if (!content && (file === 'styles.css' || file === 'script.js')) {
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
            update_subject: async ({ subject }: { subject: string }) => {
                this.sessionStore.upsert(request.sessionId, { subject });
                if (request.onPatch) {
                    request.onPatch({ subject });
                }
                return `Session subject updated to: "${subject}"`;
            },
            read_subject: async ({ summary }: { summary?: string }) => {
                const currentSubject = request.subject || '...';
                return `Current Session Subject: "${currentSubject}"`;
            },
            list_images: async ({ summary }: { summary: string }) => {
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
            image_info: async ({ filename, summary }: { filename: string; summary: string }) => {
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
            generate_image: async ({ description, summary }: { description: string; summary: string }) => {
                try {
                    const nextVersion = this.ensureNextVersion(request.sessionId);
                    const filename = await this.imageService.generateAndSave(request.sessionId, description, nextVersion, undefined, request.abortSignal, request.trackImageTokenUsage);
                    return `Image generated successfully: ${filename}`;
                } catch (error: any) {
                    return `Failed to generate image: ${error.message}`;
                }
            },
            edit_image: async ({ filename, description, summary }: { filename: string; description: string; summary: string }) => {
                try {
                    const nextVersion = this.ensureNextVersion(request.sessionId);
                    // Use currentVersion as source, nextVersion as target
                    const savedFilename = await this.imageService.editAndSave(request.sessionId, filename, description, request.currentVersion, nextVersion, request.abortSignal, request.trackImageTokenUsage);
                    return `Image edited successfully: ${savedFilename}`;
                } catch (error: any) {
                    return `Failed to edit image: ${error.message}`;
                }
            },
            generate_variant: async (args: {
                instruction: string;
            }) => {
                if (request.onVariantRequest) {
                    return await request.onVariantRequest(args.instruction);
                }
                return 'Variant generation not supported in this context.';
            }
        };
    }
}
