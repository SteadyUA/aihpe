import { ChatAttachment, SessionFiles, ChatMessage } from '../../types/chat';

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
}



export interface GeneratePageResult {
    summary: string;
    files: SessionFiles;
    newMessages?: ChatMessage[];
    targetVersion?: number;
}

export interface LlmClient {
    generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
}
