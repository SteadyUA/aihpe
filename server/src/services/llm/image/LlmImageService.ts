
export interface TokenUsageData {
    prompt: number;
    completion: number;
    total: number;
    model: string;
    agent: string;
}

export abstract class LlmImageService {
    public modelId = 'gemini-2.5-flash-image';
    public agentName = 'image';

    abstract generateRaw(prompt: string, abortSignal?: AbortSignal, aspectRatio?: string): Promise<{ base64: string, usage?: TokenUsageData }>;
    abstract editRaw(imageBuffer: Buffer, mimeType: string, prompt: string, currentDescription?: string, abortSignal?: AbortSignal): Promise<{ base64: string, description?: string, usage?: TokenUsageData }>;
    abstract describeRaw(imageBuffer: Buffer, mimeType: string, prompt: string, abortSignal?: AbortSignal): Promise<{ description: string, usage?: TokenUsageData }>;
}
