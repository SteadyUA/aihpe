import { ChatAttachment, SessionFiles, ChatMessage, TokenUsage } from '../../types/chat';

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
}



export interface GeneratePageResult {
    summary: string;
    files: SessionFiles;
    newMessages?: ChatMessage[];
    targetVersion?: number;
    usage?: TokenUsage;
}

export interface LlmClient {
    generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
}
