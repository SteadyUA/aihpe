export interface SessionFiles {
    html: string;
    css: string;
    js: string;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
    role: ChatRole;
    content: any;
    selection?: { selector: string };
    attachment?: ChatAttachment;
    version: number;
    turn: number;
    createdAt: Date;
}

export type LlmProvider = 'openai' | 'google';

export interface SessionData {
    id: string;
    files: SessionFiles;
    history: ChatMessage[];
    context: ChatMessage[];
    updatedAt: Date;
    group: number;
    currentVersion: number;
    lastTurn?: number;
    provider?: LlmProvider;
}

export interface ImageAttachment {
    type: 'image';
    filename: string;
    originalName?: string;
    url: string;
    id?: string;
    dataUrl?: string; // Populated by server for LLM
}

export type ChatAttachment = ImageAttachment;
