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
    trackRequestTokenUsage?: (usage: { prompt: number, completion: number, total: number, model: string }) => Promise<void>;
    trackImageTokenUsage?: (usage: { prompt: number, completion: number, total: number, model: string }) => Promise<void>;
}

export interface SummarizeHistoryRequest {
    sessionId: string;
    conversation: ChatMessage[];
    rulesAndGoal?: string;
    modelRole?: string;
    abortSignal?: AbortSignal;
}



export interface GeneratePageResult {
    summary: string;
    files: SessionFiles;
    newMessages?: ChatMessage[];
    targetVersion?: number;
}

export interface LlmClient {
    generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
    summarizeHistory(request: SummarizeHistoryRequest): Promise<string>;
    getCapacity(): number;
}
