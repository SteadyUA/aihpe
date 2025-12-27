export type TabType = 'preview' | 'images' | 'html' | 'css' | 'js';

export interface MessageData {
    role: 'user' | 'assistant' | 'system';
    content: string;
    turn: number;
    createdAt?: string;
    selection?: { selector: string };
    attachment?: ChatAttachment;
}

export interface ImageAttachment {
    type: 'image';
    filename: string;
    originalName?: string;
    url: string;
    id?: string;
}

export type ChatAttachment = ImageAttachment;

export type LlmProvider = 'openai' | 'google';

export interface Session {
    id: string;
    status: 'idle' | 'pending' | 'busy' | 'error' | 'unloaded';
    messages: MessageData[];
    statusMessages: string[];
    requestStartTime: number | null;

    currentTurn: number;
    activeTurn: number | null;
    activeTab: TabType;

    provider?: LlmProvider;
    pendingRefreshTurn: number | null;

    // UI selections per session
    selection: string | null;
    attachment?: ChatAttachment;
    isPicking: boolean;

    group: number;
}
