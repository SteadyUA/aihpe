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
    version?: number;
    createdAt: Date;
}

export interface SessionData {
    id: string;
    files: SessionFiles;
    history: ChatMessage[];
    updatedAt: Date;
    group: number;
    currentVersion: number;
}

export interface ScreenshotAttachment {
    type: 'screenshot';
    selector: string;
    dataUrl: string;
    id?: string;
}

export type ChatAttachment = ScreenshotAttachment;
