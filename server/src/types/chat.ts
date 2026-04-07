import { ChatStatus } from '../services/SseService';

export type SessionStatus = ChatStatus | 'idle';

export type SessionFiles = Record<string, string>;

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
    role: ChatRole;
    content: any;
    selection?: { selector: string };
    attachment?: ChatAttachment;
    version: number;
    turn: number;
    createdAt: Date;
    providerData?: Record<string, any>;
}

export type LlmProvider = 'openai' | 'google';

export interface Project {
    id: string;
    accountId?: number;
    name: string;
    rulesAndGoal: string;
    imageGenerationPref?: string;
    defaultProvider?: LlmProvider;
    sessionIds: string[];
    createdAt: Date;
    updatedAt: Date;
    lastAssignedSessionGroup?: number;
    activeSessionId?: string;
    modelRole?: string;
}

export interface SessionMetadata {
    id: string;
    projectId: string;
    updatedAt: Date;
    group: number;
    currentVersion: number;
    lastTurn?: number;
    provider?: LlmProvider;
    fastMode?: boolean;

    status: SessionStatus;
    errorMessage?: string; // Persisted error message
    subject?: string;

    // Conversation Summary Management
    summary?: string; // Cumulative summary of "dropped" history
    summaryTurn?: number; // The last turn included in the summary
}

export interface TokenUsage {
    prompt: number;
    completion: number;
    total: number;
    request: number;
    capacity: number;
}


export interface Turn {
    turn: number;
    beginTime: Date;
    endTime?: Date;
    request: string;
    response: string;
    provider: LlmProvider;
    fastMode: boolean;
    selection?: { selector: string };
    attachment?: ChatAttachment;
    version: number;
}

export interface ImageAttachment {
    type: 'image';
    filename: string;
    originalName?: string;
    id?: string;
    dataUrl?: string; // Populated by server for LLM
}

export type ChatAttachment = ImageAttachment;




export interface UnsentData {
    input?: string | null;
    attachment?: ChatAttachment | null;
    selection?: string | null;
    provider?: LlmProvider | null;
    fastMode?: boolean | null;
}
