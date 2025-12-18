import { ChatAttachment, SessionFiles, ChatMessage } from '../../types/chat';

export interface GeneratePageRequest {
    sessionId: string;
    instructions: string;
    files: SessionFiles;
    conversation: ChatMessage[];
    attachments?: ChatAttachment[];
    allowVariants?: boolean;
    onProgress?: (chunk: string) => void;
}

export interface VariantRequest {
    count: number;
    instructions: string[];
}

export interface GeneratePageResult {
    summary: string;
    files: SessionFiles;
    variantRequest?: VariantRequest;
    newMessages?: ChatMessage[];
}

export interface LlmClient {
    generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
}
