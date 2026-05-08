export enum TabType {
    PREVIEW = 'preview',
    RESOURCES = 'resources',
    HTML = 'html',
    CSS = 'css',
    JS = 'js',
    PLAN = 'plan'
}

export interface MessageData {
    role: ChatRole;
    content: string;
    turn: number;
    version?: number;
    createdAt?: string;
    selection?: { selector: string };
    attachment?: ChatAttachment;
    resource?: string;
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
    defaultProvider?: LlmProvider;
    sessionIds: string[];
    activeSessionId?: string;
    status?: ProjectStatus;
    taskId?: string;
    createdAt: string;
    updatedAt: string;
    sessions?: any[];
}

export interface UnsentData {
    input?: string | null;
    attachment?: ChatAttachment | null;
    selection?: string | null;
    resource?: string | null;
    provider?: LlmProvider | null;
    fastMode?: boolean;
}



export enum LlmProvider {
    OPENAI = 'openai',
    GOOGLE = 'google'
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

export enum SessionStatus {
    IDLE = 'idle',
    PENDING = 'pending',
    BUSY = 'busy',
    ERROR = 'error',
    UNLOADED = 'unloaded'
}

export interface Session {
    id: string;
    projectId: string; // New field
    subject?: string;
    status: SessionStatus;
    errorMessage?: string;
    // messages: MessageData[]; // DEPRECATED
    // turns: Turn[]; // MOVED TO CHAT COMPONENT STATE

    currentVersion?: number;
    latestVersion?: number;
    lastTurn: number;
    activeTurn: number | null;
    activeTab: TabType;

    provider?: LlmProvider;
    fastMode?: boolean;
    pendingRefreshTurn: number | null;

    // UI selections per session
    selection: string | null;
    attachment?: ChatAttachment | null;
    resource?: string | null;
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
    resource?: string;
    version?: number;
}

export interface TokenUsage {
    prompt: number;
    completion: number;
    total: number;
    request?: number;
    capacity?: number;
}
