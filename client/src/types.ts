export interface MessageData {
    role: 'user' | 'assistant' | 'system';
    content: string;
    turn: number;
    createdAt?: string;
    selection?: { selector: string };
}

export interface Session {
    id: string;
    status: 'idle' | 'pending' | 'busy' | 'error';
    messages: MessageData[];
    statusMessages: string[];
    requestStartTime: number | null;

    currentTurn: number;
    activeTurn: number | null;

    imageGenerationAllowed: boolean;
    pendingRefreshTurn: number | null;

    // UI selections per session
    selection: string | null;
    isPicking: boolean;

    group: number;
}
