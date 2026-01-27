import { Service } from 'typedi';
import { ImageService, TokenUsageData } from './ImageService';

@Service()
export class GoogleImageService extends ImageService {
    protected async generateRaw(prompt: string, abortSignal?: AbortSignal): Promise<{ base64: string, usage?: TokenUsageData }> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        console.log(`Generating image via Google for description: ${prompt}`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;
        const body = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortSignal,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        let base64Data: string | undefined;

        if (data.candidates?.[0]?.content?.parts) {
            const parts = data.candidates[0].content.parts;
            const imagePart = parts.find((p: any) => p.inlineData);
            if (imagePart) {
                base64Data = imagePart.inlineData.data;
            }
        }

        if (!base64Data) {
            throw new Error(`No image data found in response. Raw response: ${JSON.stringify(data).substring(0, 200)}...`);
        }

        let usage: TokenUsageData | undefined;
        if (data.usageMetadata) {
            usage = {
                prompt: data.usageMetadata.promptTokenCount || 0,
                completion: data.usageMetadata.candidatesTokenCount || 0,
                total: data.usageMetadata.totalTokenCount || 0,
                model: this.modelId,
            };
        }

        return { base64: base64Data, usage };
    }

    protected async editRaw(imageBuffer: Buffer, mimeType: string, prompt: string, currentDescription?: string, abortSignal?: AbortSignal): Promise<{ base64: string, description?: string, usage?: TokenUsageData }> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        console.log(`Editing image via Google with prompt: ${prompt}`);

        const base64Data = imageBuffer.toString('base64');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;

        // Augment prompt to ask for description
        const augmentedPrompt = `${prompt}\n\nAlso describe it in a single sentence so that I can use this description for alt-text or generating a similar image.`;

        const body = {
            contents: [{
                parts: [
                    { text: augmentedPrompt },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    }
                ]
            }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"]
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortSignal,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        let newBase64Data: string | undefined;
        let newDescription: string | undefined;

        if (data.candidates?.[0]?.content?.parts) {
            const parts = data.candidates[0].content.parts;

            const imagePart = parts.find((p: any) => p.inlineData);
            if (imagePart) {
                newBase64Data = imagePart.inlineData.data;
            }

            const textPart = parts.find((p: any) => p.text);
            if (textPart) {
                newDescription = textPart.text;
            }
        }

        if (!newBase64Data) {
            throw new Error(`No image data found in response. Raw response: ${JSON.stringify(data).substring(0, 200)}...`);
        }

        if (!newBase64Data) {
            throw new Error(`No image data found in response. Raw response: ${JSON.stringify(data).substring(0, 200)}...`);
        }

        let usage: TokenUsageData | undefined;
        if (data.usageMetadata) {
            usage = {
                prompt: data.usageMetadata.promptTokenCount || 0,
                completion: data.usageMetadata.candidatesTokenCount || 0,
                total: data.usageMetadata.totalTokenCount || 0,
                model: this.modelId,
            };
        }

        return { base64: newBase64Data, description: newDescription, usage };
    }

    protected async describeRaw(imageBuffer: Buffer, mimeType: string, abortSignal?: AbortSignal): Promise<{ description: string, usage?: TokenUsageData }> {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        const base64Image = imageBuffer.toString('base64');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;

        const body = {
            contents: [{
                parts: [
                    { text: 'Analyze this image. Describe it in a single sentence so that I can use this description for alt-text or generating a similar image.' },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Image
                        }
                    }
                ]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortSignal,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            let usage: TokenUsageData | undefined;
            if (data.usageMetadata) {
                usage = {
                    prompt: data.usageMetadata.promptTokenCount || 0,
                    completion: data.usageMetadata.candidatesTokenCount || 0,
                    total: data.usageMetadata.totalTokenCount || 0,
                    model: this.modelId,
                };
            }
            return { description: data.candidates[0].content.parts[0].text, usage };
        }

        throw new Error('No description text found in response');
    }
}
