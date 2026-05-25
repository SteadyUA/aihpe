export enum LlmRole {
    SYSTEM = 'system',
    USER = 'user',
    ASSISTANT = 'assistant',
    TOOL = 'tool'
}

export interface LlmMessage {
    role: LlmRole;
    content: string | LlmContentPart[];
    toolCalls?: LlmToolCall[];
    toolCallId?: string;
    providerData?: any;
}

export type LlmContentPart = 
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'tool-result'; toolCallId: string; result: string };

export interface LlmToolCall {
    id: string;
    name: string;
    arguments: string; // JSON string
}

export interface LlmTool {
    name: string;
    description: string;
    parameters: any;
    execute: (args: any) => Promise<string>;
}

export interface LlmRequest {
    messages: LlmMessage[];
    tools?: LlmTool[];
    maxSteps?: number;
    abortSignal?: AbortSignal;
    onChunkContent?: (chunk: string) => void;
    onToolCall?: (toolName: string, args: any) => void;
    onNewMessage?: (message: LlmMessage) => Promise<void> | void;
    onTokenUsage?: (agentName: string, modelId: string, prompt: number, completion: number, total: number) => Promise<void>;
}

export interface LlmResult {
    text: string;
}

export interface LlmClient {
    generate(request: LlmRequest): Promise<LlmResult>;
}

export class ToolAbortError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolAbortError';
    }
}
