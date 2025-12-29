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

export interface Project {
    id: string;
    goal: string;
    imageGenerationPref?: string;
    defaultProvider?: LlmProvider;
    sessionIds: string[];
    createdAt: string;
    updatedAt: string;
}

export interface UnsentData {
    input?: string | null;
    attachment?: ChatAttachment | null;
    selection?: string | null;
    provider?: LlmProvider | null;
}

export type LlmProvider = 'openai' | 'google';

export interface Session {
    id: string;
    projectId: string; // New field
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

    unsent?: UnsentData;

    group: number;
}
