import { ChatMessage } from '../types/chat';

export function formatContentForUi(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    }
    return ''; // Fallback for unknown objects to empty string (hidden)
}

export function sanitizeHistoryForUi(history: any[]): ChatMessage[] {
    return history
        .map((entry) => ({
            ...entry,
            content: formatContentForUi(entry.content),
            createdAt: new Date(entry.createdAt),
            version: typeof entry.version === 'number' ? entry.version : 0,
            turn: typeof entry.turn === 'number' ? entry.turn : 0,
        }))
        .filter((entry) => {
            // Filter out empty messages (usually tool calls/results hidden from UI)
            // But always keep user messages to avoid confusion
            if (entry.role === 'user') return true;
            return typeof entry.content === 'string' && entry.content.trim().length > 0;
        });
}
