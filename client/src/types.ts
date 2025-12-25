export interface MessageData {
    role: 'user' | 'assistant' | 'system';
    content: string;
    version?: number;
    createdAt?: string; // Appears to be used in App.tsx for maxDate logic, though we removed maxDate, keeping it for correctness if needed
    selection?: { selector: string };
}

export interface Session {
    id: string;
    status: 'idle' | 'pending' | 'busy' | 'error';
    messages: MessageData[];
    statusMessages: string[];
    requestStartTime: number | null;

    currentVersion: number;
    activeVersion: number | null;

    imageGenerationAllowed: boolean;

    // UI selections per session
    selection: string | null;
    isPicking: boolean;

    group: number;
}
