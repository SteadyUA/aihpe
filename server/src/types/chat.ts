export enum SessionStatus {
    IDLE = 'idle',
    STARTED = 'started',
    GENERATING = 'generating',
    ERROR = 'error'
}

export enum ProjectStatus {
    INITIALIZATION = 'initialization',
    READY = 'ready'
}

export enum TaskStatus {
    PENDING = 'pending',
    PLANNING = 'planning',
    EXECUTING = 'executing',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export enum ChatRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system',
    TOOL = 'tool'
}

export interface ChatMessage {
    role: ChatRole;
    content: any;
    selection?: { selector: string };
    attachment?: ChatAttachment;
    resource?: string;
    version: number;
    turn: number;
    createdAt: Date;
    providerData?: Record<string, any>;
}

export enum LlmProvider {
    OPENAI = 'openai',
    GOOGLE = 'google'
}

export interface Project {
    id: string;
    accountId?: number;
    name: string;
    defaultProvider?: LlmProvider;
    sessionIds: string[];
    createdAt: Date;
    updatedAt: Date;
    lastAssignedSessionGroup?: number;
    activeSessionId?: string;
    status: ProjectStatus;
    taskId?: string;
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
    resource?: string;
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
    resource?: string | null;
    provider?: LlmProvider | null;
    fastMode?: boolean | null;
}
