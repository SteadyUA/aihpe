import { ChatAttachment, SessionFiles } from '../../types/chat';

export interface GeneratePageRequest {
    sessionId: string;
    instructions: string;
    files: SessionFiles;
    conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
    attachments?: ChatAttachment[];
    allowVariants?: boolean;
}

export interface VariantRequest {
    count: number;
    instructions: string[];
}

export interface GeneratePageResult {
    summary: string;
    files: SessionFiles;
    variantRequest?: VariantRequest;
}

export interface LlmClient {
    generatePage(request: GeneratePageRequest): Promise<GeneratePageResult>;
}
