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

export interface SessionData {
    id: string;
    projectId: string;
    files: SessionFiles;
    history: ChatMessage[];
    context: ChatMessage[];
    updatedAt: Date;
    group: number;
    currentVersion: number;
    lastTurn?: number;
    provider?: LlmProvider;
    fastMode?: boolean;
    unsent?: UnsentData;

    status: SessionStatus;
    errorMessage?: string; // Persisted error message
    subject?: string;
    tokenUsage?: TokenUsage;
    turns: Turn[];
}

export interface TokenUsage {
    prompt: number;
    completion: number;
    total: number;
    reasoning?: number;
    cached?: number;
}

export interface ContextUsage {
    total: number;
    capacity: number;
}

export interface Turn {
    turn: number;
    beginTime: Date;
    endTime: Date;
    request: string;
    response: string;
    provider: LlmProvider;
    fastMode: boolean;
    tokenUsage: TokenUsage;
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
    input?: string;
    attachment?: ChatAttachment;
    selection?: string;
    provider?: LlmProvider;
    fastMode?: boolean;
}
