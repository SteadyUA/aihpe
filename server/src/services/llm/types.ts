import { ChatAttachment, ChatMessage } from '../../types/chat';

export interface GeneratePageRequest {
    sessionId: string;
    instructions: string;
    conversation: ChatMessage[];
    attachment?: ChatAttachment;
    allowVariants?: boolean;
    currentVersion: number;
    onChunkContent?: (chunk: string) => void;
    onToolCall?: (toolName: string, args: any) => void;
    onNewMessage?: (message: ChatMessage) => Promise<void> | void;
    rulesAndGoal?: string;
    imageGenerationPref?: string;
    onVariantRequest?: (instruction: string) => Promise<string>;
    fastMode?: boolean;
    subject?: string;
    onPatch?: (patch: { subject?: string }) => void;
    modelRole?: string;
    abortSignal?: AbortSignal;
    summary?: string; // Cumulative summary of previous conversation history (that might be excluded from 'conversation' list)
    onTokenUsage?: (agentName: string, modelId: string, prompt: number, completion: number, total: number) => Promise<void>;
    maxSteps?: number;
}

export interface SummarizeHistoryRequest {
    sessionId: string;
    conversation: ChatMessage[];
    rulesAndGoal?: string;
    modelRole?: string;
    abortSignal?: AbortSignal;
    previousSummary?: string; // The existing summary to be updated/extended
    onTokenUsage?: (agentName: string, modelId: string, prompt: number, completion: number, total: number) => Promise<void>;
}

export interface GeneratePageResult {
    summary: string;
    targetVersion?: number;
}
