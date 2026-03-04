export type TabType = 'preview' | 'images' | 'html' | 'css' | 'js' | 'plan';

export interface MessageData {
    role: 'user' | 'assistant' | 'system';
    content: string;
    turn: number;
    version?: number;
    createdAt?: string;
    selection?: { selector: string };
    attachment?: ChatAttachment;
}

export interface ImageAttachment {
    type: 'image';
    filename: string;
    originalName?: string;
    id?: string;
}

export type ChatAttachment = ImageAttachment;

export interface Project {
    id: string;
    name: string;
    rulesAndGoal: string;
    imageGenerationPref?: string;
    defaultProvider?: LlmProvider;
    sessionIds: string[];
    activeSessionId?: string;
    modelRole?: string;
    status?: 'initialization' | 'ready';
    taskId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface UnsentData {
    input?: string | null;
    attachment?: ChatAttachment | null;
    selection?: string | null;
    provider?: LlmProvider | null;
    fastMode?: boolean;
}



export type LlmProvider = 'openai' | 'google';

export interface Session {
    id: string;
    projectId: string; // New field
    subject?: string;
    status: 'idle' | 'pending' | 'busy' | 'error' | 'unloaded';
    // messages: MessageData[]; // DEPRECATED
    // turns: Turn[]; // MOVED TO CHAT COMPONENT STATE

    currentVersion?: number;
    lastTurn: number;
    activeTurn: number | null;
    activeTab: TabType;

    provider?: LlmProvider;
    fastMode?: boolean;
    pendingRefreshTurn: number | null;

    // UI selections per session
    selection: string | null;
    attachment?: ChatAttachment | null;
    isPicking: boolean;
    input?: string;

    group: number;
    tokenUsage?: TokenUsage;
}

export interface Turn {
    turn: number;
    beginTime: string; // ISO Date
    endTime?: string; // ISO Date, undefined/null = active/failed?
    request: string;
    response: string;
    provider?: LlmProvider;
    fastMode?: boolean;
    selection?: { selector: string };
    attachment?: ChatAttachment;
    version?: number;
}

export interface TokenUsage {
    prompt: number;
    completion: number;
    total: number;
    request?: number;
    capacity?: number;
}
