import { GoogleGenerativeAI, GenerativeModel, Part, SchemaType, FunctionDeclaration } from '@google/generative-ai';
import { Service } from 'typedi';
import { ChatAttachment, SessionFiles } from '../../types/chat';
import { GeneratePageRequest, GeneratePageResult, LlmClient, VariantRequest } from './types';

const FALLBACK_RESPONSE: GeneratePageResult = {
    summary:
        'Gemini API key not configured. Returning existing files without modifications. Set GEMINI_API_KEY to enable Gemini-powered generation.',
    files: {
        html: '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Preview Unavailable</title>\n  </head>\n  <body>\n    <h1>Enable Gemini Integration</h1>\n    <p>Provide a GEMINI_API_KEY to generate content.</p>\n  </body>\n</html>',
        css: '',
        js: '',
    },
};

@Service()
export class GeminiClient implements LlmClient {
    private readonly genAI?: GoogleGenerativeAI;
    private readonly modelName: string;

    constructor() {
        this.modelName = process.env.MODEL?.startsWith('gemini') ? process.env.MODEL : 'gemini-1.5-pro-002'; // Default to stable 1.5 pro if not specific
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
        }
    }

    async generatePage(request: GeneratePageRequest): Promise<GeneratePageResult> {
        if (!this.genAI) {
            return FALLBACK_RESPONSE;
        }

        const model = this.getGenerativeModel(request);
        const parts = this.buildParts(request);

        try {
            const result = await model.generateContent({
                contents: [{ role: 'user', parts }],
            });

            const response = result.response;

            // Check for function calls
            const functionCalls = response.functionCalls();
            if (functionCalls && functionCalls.length > 0) {
                const variantCall = functionCalls.find(fc => fc.name === 'generate_variants');
                if (variantCall) {
                    const args = variantCall.args as any;
                    return {
                        summary: 'Generating variants...',
                        files: request.files,
                        variantRequest: {
                            count: Math.min(Math.max(Number(args.count) || 2, 2), 5),
                            instructions: Array.isArray(args.instructions) ? args.instructions : [],
                        }
                    };
                }
            }

            const text = response.text();
            return this.parseResponse(text, request.files);
        } catch (error) {
            console.error('Failed to generate page with Gemini', error);
            return {
                summary: `Не удалось получить ответ от модели Gemini: ${this.formatError(error)}. Предыдущая версия страницы сохранена.`,
                files: request.files,
            };
        }
    }

    private getGenerativeModel(request: GeneratePageRequest): GenerativeModel {
        if (!this.genAI) throw new Error("Gemini not initialized");

        const tools = [];
        if (request.allowVariants) {
            tools.push({
                functionDeclarations: [{
                    name: 'generate_variants',
                    description: 'Generate multiple variants of the page based on user request. Use this tool when the user asks for multiple variations, alternatives, or different styles/designs of the page.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            count: {
                                type: SchemaType.NUMBER,
                                description: 'Number of variants to generate (max 5)',
                            },
                            instructions: {
                                type: SchemaType.ARRAY,
                                items: { type: SchemaType.STRING },
                                description: 'Specific instructions for each variant. Must match the count.',
                            },
                        },
                        required: ['count', 'instructions'],
                    },
                }] as FunctionDeclaration[],
            });
        }

        return this.genAI.getGenerativeModel({
            model: this.modelName,
            tools: tools.length > 0 ? tools : undefined,
            generationConfig: {
                responseMimeType: "application/json",
            }
        });
    }

    private buildParts(request: GeneratePageRequest): Part[] {
        const parts: Part[] = [];

        // 1. System instruction / context as text
        const systemPrompt = `You are an assistant that generates or updates a simple web page composed of three files: index.html, styles.css, and script.js.
Respond to the latest user instructions by updating these files. Always return a valid JSON object with the following shape:

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

Current files:
[index.html]
${request.files.html}

[styles.css]
${request.files.css}

[script.js]
${request.files.js}
`;
        parts.push({ text: systemPrompt });

        // 2. Chat history
        if (request.conversation.length > 0) {
            const historyText = request.conversation.map(c => `${c.role.toUpperCase()}: ${c.content}`).join('\n');
            parts.push({ text: `Previous conversation:\n${historyText}` });
        }

        // 3. User instructions
        parts.push({ text: `User instructions:\n${request.instructions}` });

        // 4. Attachments (images)
        if (request.attachments) {
            for (const att of request.attachments) {
                if (att.dataUrl && att.dataUrl.includes('base64,')) {
                    const base64Data = att.dataUrl.split('base64,')[1];
                    const mimeType = att.dataUrl.split(';')[0].split(':')[1];
                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: mimeType
                        }
                    });
                }
            }
        }

        return parts;
    }

    private parseResponse(content: string, fallback: SessionFiles): GeneratePageResult {
        // Gemini with responseMimeType: "application/json" should return pure JSON, but we'll be safe
        const jsonBlock = this.extractJsonBlock(content);
        const parsed = this.tryParseJson(jsonBlock || content);

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

        return {
            summary: 'Не удалось обработать ответ от модели. Предыдущая версия страницы сохранена.',
            files: fallback,
        };
    }

    private extractJsonBlock(content: string): string | undefined {
        const matchJson = content.match(/```json\s*([\s\S]*?)\s*```/i);
        if (matchJson) {
            return matchJson[1];
        }
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
        if (error instanceof Error) return error.message;
        return String(error);
    }
}
