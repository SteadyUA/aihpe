import { ChatAttachment, SessionFiles, ChatMessage, TokenUsage, ContextUsage } from '../../types/chat';

export { ChatAttachment, SessionFiles, ChatMessage, TokenUsage, ContextUsage };

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
    usage?: TokenUsage;
    contextUsage?: ContextUsage;
}

export interface LlmClient {
    generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
    summarizeHistory(request: SummarizeHistoryRequest): Promise<string>;
}
