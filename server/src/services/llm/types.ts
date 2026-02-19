import { ChatAttachment, SessionFiles, ChatMessage, TokenUsage } from '../../types/chat';

export { ChatAttachment, SessionFiles, ChatMessage, TokenUsage };

export interface GeneratePageRequest {
    sessionId: string;
    instructions: string;
    files: SessionFiles;
    conversation: ChatMessage[];
    attachment?: ChatAttachment;
    allowVariants?: boolean;
    currentVersion: number;
    onProgress?: (chunk: string) => void;
    rulesAndGoal?: string;
    imageGenerationPref?: string;
    onVariantRequest?: (instruction: string) => Promise<string>;
    fastMode?: boolean;
    subject?: string;
    onPatch?: (patch: { subject?: string }) => void;
    modelRole?: string;
    abortSignal?: AbortSignal;
    trackRequestTokenUsage?: (usage: { prompt: number, completion: number, total: number, model: string, agent: string }) => Promise<void>;
    summary?: string; // Cumulative summary of previous conversation history (that might be excluded from 'conversation' list)
}

export interface SummarizeHistoryRequest {
    sessionId: string;
    conversation: ChatMessage[];
    rulesAndGoal?: string;
    modelRole?: string;
    abortSignal?: AbortSignal;
    previousSummary?: string; // The existing summary to be updated/extended
    trackRequestTokenUsage?: (usage: { prompt: number, completion: number, total: number, model: string, agent: string }) => Promise<void>;
}



export interface GeneratePageResult {
    summary: string;
    files: SessionFiles;
    newMessages?: ChatMessage[];
    targetVersion?: number;
}

export interface LlmClient<TRequest = any, TResult = any> {
    generate(request: TRequest): Promise<TResult>;
    getCapacity(): number;
}

export interface LlmTool<TContext = any> {
    name: string;
    description: string;
    parameters: any;
    execute: (args: any, context: TContext) => Promise<string>;
}

export interface LlmConfig<TRequest = any, TContext = any, TResult = any> {
    systemPrompt: (request: TRequest) => string;
    buildContext?: (request: TRequest) => TContext | Promise<TContext>;
    tools?: (
        request: TRequest,
        context: TContext
    ) => LlmTool<TContext>[];
    processOutput?: (output: string, messages: ChatMessage[], context: TContext) => TResult | Promise<TResult>;
    userMessage?: (request: TRequest) => string | any[];
}
