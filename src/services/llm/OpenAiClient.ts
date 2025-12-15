import OpenAI from 'openai';
import { Service } from 'typedi';
import { ChatAttachment, SessionFiles } from '../../types/chat';
import { GeneratePageRequest, GeneratePageResult, LlmClient, VariantRequest } from './types';

const FALLBACK_RESPONSE: GeneratePageResult = {
    summary:
        'API key not configured. Returning existing files without modifications. Set OPENAI_API_KEY to enable GPT-powered generation.',
    files: {
        html: '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Preview Unavailable</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <h1>Enable GPT Integration</h1>\n    <p>Provide an OPENAI_API_KEY to generate content.</p>\n    <script src="script.js"></script>\n  </body>\n</html>',
        css: 'body {\n  font-family: system-ui, sans-serif;\n  max-width: 720px;\n  margin: 0 auto;\n  padding: 3rem 1.5rem;\n}\n',
        js: 'console.warn("GPT integration disabled. Enable OPENAI_API_KEY to generate content.");\n',
    },
};

@Service()
export class OpenAiClient implements LlmClient {
    private readonly client?: OpenAI;
    private readonly model: string;

    constructor() {
        this.model = process.env.MODEL?.trim() || 'gpt-5.1-codex';
        const apiKey = process.env.OPENAI_API_KEY;
        if (apiKey) {
            this.client = new OpenAI({ apiKey });
        }
    }

    async generatePage(request: GeneratePageRequest): Promise<GeneratePageResult> {
        if (!this.client) {
            return FALLBACK_RESPONSE;
        }

        const prompt = this.buildPrompt(request);
        const tools: any[] = [];

        if (request.allowVariants) {
            tools.push({
                type: 'function',
                name: 'generate_variants',
                description: 'Generate multiple variants of the page based on user request. Use this tool when the user asks for multiple variations, alternatives, or different styles/designs of the page. Do NOT implement in-page switchers for this purpose.',
                parameters: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'number',
                            description: 'Number of variants to generate (max 5)',
                            minimum: 2,
                            maximum: 5,
                        },
                        instructions: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Specific instructions for each variant. Must match the count.',
                        },
                    },
                    required: ['count', 'instructions'],
                    additionalProperties: false,
                },
                strict: true,
            });
        }

        try {
            const response = await this.client.responses.create({
                model: this.model,
                input: prompt,
                tools: tools.length > 0 ? tools : undefined,
                text: {
                    format: {
                        type: "json_object"
                    },
                },
            } as any);

            console.log('User Instructions:', request.instructions);
            console.log('OpenAI Token Usage:', JSON.stringify(response.usage, null, 2));

            // Check for tool calls first
            const toolCall = this.extractToolCall(response);
            if (toolCall) {
                return {
                    summary: 'Generating variants...',
                    files: request.files, // Return original files
                    variantRequest: toolCall,
                };
            }

            const text = this.extractText(response) ?? '';
            const parsed = this.parseResponse(text, request.files);
            return parsed;
        } catch (error) {
            console.error('Failed to generate page with OpenAI', error);
            return {
                summary: `Не удалось получить ответ от модели: ${this.formatError(error)}. Предыдущая версия страницы сохранена.`,
                files: request.files,
            };
        }
    }

    private buildPrompt({ instructions, files, conversation, attachments }: GeneratePageRequest): string {
        const history = conversation
            .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
            .join('\n');
        const attachmentsSection = this.formatAttachments(attachments);

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

Previous conversation (oldest first):
${history || 'None yet.'}

Attached screenshots:
${attachmentsSection}

Current files:
[index.html]
${files.html}

[styles.css]
${files.css}

[script.js]
${files.js}

Latest user instructions:
${instructions}
`;
    }

    private extractToolCall(response: any): VariantRequest | undefined {
        if (!response || !response.output) return undefined;

        for (const item of response.output) {
            if (item.type === 'function_call' && item.name === 'generate_variants') {
                try {
                    const args = JSON.parse(item.arguments);
                    return {
                        count: Math.min(Math.max(args.count || 2, 2), 5),
                        instructions: Array.isArray(args.instructions) ? args.instructions : [],
                    };
                } catch (e) {
                    console.warn('Failed to parse tool arguments', e);
                }
            }
        }
        return undefined;
    }

    private extractText(response: any): string | undefined {
        if (!response) {
            return undefined;
        }

        const collected: string[] = [];

        const outputText = (response as { output_text?: string | string[] }).output_text;
        if (typeof outputText === 'string') {
            collected.push(outputText);
        } else if (Array.isArray(outputText)) {
            collected.push(...outputText);
        }

        const output = response.output;
        if (Array.isArray(output)) {
            for (const item of output) {
                if (item?.type === 'message' && Array.isArray(item.content)) {
                    for (const part of item.content) {
                        if (part?.type === 'text' && typeof part.text === 'string') {
                            collected.push(part.text);
                        }
                    }
                }
            }
        }

        const content = response.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    collected.push(part.text);
                }
            }
        }

        return collected.length > 0 ? collected.join('\n').trim() || undefined : undefined;
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

    private formatAttachments(attachments?: ChatAttachment[]): string {
        if (!attachments || attachments.length === 0) {
            return 'None.';
        }

        return attachments
            .map((attachment, index) => {
                const truncated = this.truncateDataUrl(attachment.dataUrl);
                return `${index + 1}. type: ${attachment.type}\n   selector: ${attachment.selector}\n   dataUrl: ${truncated}`;
            })
            .join('\n');
    }

    private truncateDataUrl(dataUrl: string): string {
        if (!dataUrl) {
            return 'N/A';
        }
        const MAX_LENGTH = 150_000;
        if (dataUrl.length <= MAX_LENGTH) {
            return dataUrl;
        }
        const omitted = dataUrl.length - MAX_LENGTH;
        return `${dataUrl.slice(0, MAX_LENGTH)}… (truncated ${omitted} chars)`;
    }

    private extractJsonBlock(content: string): string | undefined {
        // 1. Try strict markdown code block with 'json' identifier
        const matchJson = content.match(/```json\s*([\s\S]*?)\s*```/i);
        if (matchJson) {
            return matchJson[1];
        }

        // 2. Try generic markdown code block
        const matchGeneric = content.match(/```\s*([\s\S]*?)\s*```/i);
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
