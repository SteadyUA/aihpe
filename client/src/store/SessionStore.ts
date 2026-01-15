export class SessionStore {
    private static PROJECT_ID_KEY = 'projectId';
    // Project ID persistence removed - now handled via URL/app state
    static loadProjectId(): string | null {
        try {
            return localStorage.getItem(this.PROJECT_ID_KEY) || null;
        } catch (e) {
            console.error('Failed to load project id', e);
            return null;
        }
    }

    static saveProjectId(id: string) {
        try {
            localStorage.setItem(this.PROJECT_ID_KEY, id);
        } catch (e) {
            console.error('Failed to save project id', e);
        }
    }

    static clearProjectId() {
        try {
            localStorage.removeItem(this.PROJECT_ID_KEY);
        } catch (e) {
            console.error('Failed to clear project id', e);
        }
    }

    // Deprecated/Removed legacy session list storage methods
}
