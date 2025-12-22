export class SessionStore {
    private static SESSIONS_KEY = 'sessions';
    private static ACTIVE_SESSION_KEY = 'activeSessionId';
    private static GROUPS_KEY = 'sessionGroups';

    static loadSessions(): string[] {
        try {
            const saved = localStorage.getItem(this.SESSIONS_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Failed to load sessions', e);
            return [];
        }
    }

    static saveSessions(sessions: string[]) {
        try {
            localStorage.setItem(this.SESSIONS_KEY, JSON.stringify(sessions));
        } catch (e) {
            console.error('Failed to save sessions', e);
        }
    }

    static loadActiveSessionId(): string | null {
        try {
            return localStorage.getItem(this.ACTIVE_SESSION_KEY) || null;
        } catch (e) {
            console.error('Failed to load active session id', e);
            return null;
        }
    }

    static saveActiveSessionId(id: string | null) {
        try {
            localStorage.setItem(this.ACTIVE_SESSION_KEY, id || '');
        } catch (e) {
            console.error('Failed to save active session id', e);
        }
    }

    static loadGroups(): Record<string, number> {
        try {
            const saved = localStorage.getItem(this.GROUPS_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error('Failed to load groups', e);
            return {};
        }
    }

    static saveGroups(groups: Record<string, number>) {
        try {
            localStorage.setItem(this.GROUPS_KEY, JSON.stringify(groups));
        } catch (e) {
            console.error('Failed to save groups', e);
        }
    }
}
