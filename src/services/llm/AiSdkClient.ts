import { generateText, streamText, tool, ModelMessage, ImagePart, TextPart, LanguageModel } from 'ai';
import { z } from 'zod';
import { SessionFiles } from '../../types/chat';
import { GeneratePageRequest, GeneratePageResult, LlmClient, VariantRequest } from './types';

const FALLBACK_RESPONSE: GeneratePageResult = {
    summary:
        'API key not configured. Returning existing files without modifications. Configure OPENAI_API_KEY or GEMINI_API_KEY.',
    files: {
        html: '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Preview Unavailable</title>\n  </head>\n  <body>\n    <h1>Enable LLM Integration</h1>\n    <p>Provide an API key to generate content.</p>\n  </body>\n</html>',
        css: '',
        js: '',
    },
};

export class AiSdkClient implements LlmClient {
    constructor(
        private readonly model?: LanguageModel,
        private readonly modelId?: string
    ) {}

    async generatePage(request: GeneratePageRequest): Promise<GeneratePageResult> {
        if (!this.model) {
            console.warn('No LanguageModel provided to AiSdkClient');
            return FALLBACK_RESPONSE;
        }

        const systemPrompt = this.buildSystemPrompt(request.files);
        const messages: ModelMessage[] = this.buildMessages(request);

        const tools: Record<string, any> = {};
        if (request.allowVariants) {
            tools.generate_variants = tool({
                description: 'Generate multiple variants of the page based on user request. Use this tool when the user asks for multiple variations, alternatives, or different styles/designs of the page. Do NOT implement in-page switchers for this purpose.',
                inputSchema: z.object({
                    count: z.number().min(2).max(5).describe('Number of variants to generate (max 5)'),
                    instructions: z.array(z.string()).describe('Specific instructions for each variant. Must match the count.'),
                }),
            });
        }

        try {
            const result = streamText({
                model: this.model,
                system: systemPrompt,
                messages: messages,
                tools: request.allowVariants ? tools : undefined,
            });

            let fullText = '';
            for await (const chunk of result.textStream) {
                fullText += chunk;
                if (request.onProgress) {
                    request.onProgress(chunk);
                }
            }

            // We need to await the full tool calls resolution if any
            const toolCalls = await result.toolCalls;
            const variantCall = toolCalls.find((t) => t.toolName === 'generate_variants');

            if (variantCall) {
                return {
                    summary: 'Generating variants...',
                    files: request.files, // Return original files
                    variantRequest: variantCall.input as VariantRequest,
                };
            }

            if (this.modelId) {
                console.log('Model:', this.modelId);
            }
            console.log('User Instructions:', request.instructions);
            
            const usage = await result.usage;
            console.log('Token Usage:', JSON.stringify(usage, null, 2));

            const parsed = this.parseResponse(fullText, request.files);
            return parsed;
        } catch (error) {
            console.error(`Failed to generate page with ${this.modelId || 'unknown model'}`, error);
            return {
                summary: `Не удалось получить ответ от модели: ${this.formatError(error)}. Предыдущая версия страницы сохранена.`,
                files: request.files,
            };
        }
    }

    private buildSystemPrompt(files: SessionFiles): string {
        return `You are an assistant that generates or updates a simple web page composed of three files: index.html, styles.css, and script.js.
Respond to the latest user instructions by updating these files. Always return a valid JSON object with the following shape:

If the user asks for alternative versions, different styles, or options, you MUST use the 'generate_variants' tool if available, instead of implementing a switcher in the code.

\`\`\`json
{
  "summary": "Explain in natural language what changed.",
  "files": {
    "html": "...complete HTML...",
    "css": "...complete CSS...",
    "js": "...complete JavaScript..."
  }
}
\`\`\`

Rules:
- Preserve valid HTML/CSS/JS syntax.
- When updating, base your changes on the existing files provided below.
- Keep the summary short and actionable.
- Do not include additional commentary outside the JSON block.

Current files:
[index.html]
${files.html}

[styles.css]
${files.css}

[script.js]
${files.js}
`;
    }

    private buildMessages(request: GeneratePageRequest): ModelMessage[] {
        const messages: ModelMessage[] = [];

        // Add history
        for (const entry of request.conversation) {
            messages.push({
                role: entry.role === 'user' ? 'user' : 'assistant',
                content: entry.content,
            });
        }

        // Add current user message with attachments
        const content: (TextPart | ImagePart)[] = [
            { type: 'text', text: request.instructions }
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

    private parseResponse(content: string, fallback: SessionFiles): GeneratePageResult {
        const jsonBlock = this.extractJsonBlock(content);
        const candidates = [jsonBlock, content];

        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }
            const parsed = this.tryParseJson(candidate);
            if (parsed?.files) {
                return {
                    summary: String(parsed.summary ?? 'Updated page assets.'),
                    files: {
                        html: String(parsed.files.html ?? fallback.html),
                        css: String(parsed.files.css ?? fallback.css),
                        js: String(parsed.files.js ?? fallback.js),
                    },
                };
            }
        }

        const fallbackSummary = content.trim()
            ? content.trim().slice(0, 500)
            : 'Не удалось обработать ответ от модели. Предыдущая версия страницы сохранена.';

        return {
            summary: fallbackSummary,
            files: fallback,
        };
    }

    private extractJsonBlock(content: string): string | undefined {
        // 1. Try strict markdown code block with 'json' identifier
        const matchJson = content.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/i);
        if (matchJson) {
            return matchJson[1];
        }

        // 2. Try generic markdown code block
        const matchGeneric = content.match(/\`\`\`\s*([\s\S]*?)\s*\`\`\`/i);
        if (matchGeneric) {
            return matchGeneric[1];
        }

        // 3. Fallback: try to find the outermost JSON object
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return content.substring(start, end + 1);
        }

        return undefined;
    }

    private tryParseJson(raw: string): any | undefined {
        try {
            return JSON.parse(raw);
        } catch {
            return undefined;
        }
    }

    private formatError(error: unknown): string {
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object' && 'message' in error) {
            return String((error as { message: unknown }).message || 'неизвестная ошибка');
        }
        return 'неизвестная ошибка';
    }
}
