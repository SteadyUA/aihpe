let refreshPromise: Promise<string> | null = null;

export const apiAuth = {
    async fetch(url: string, options: RequestInit = {}): Promise<Response> {
        let token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');

        // If 'Content-Type' is not explicitly set in options, we set it to json.
        // However, if body is FormData, we shouldn't set Content-Type.
        const baseHeaders: Record<string, string> = {};
        if (token) baseHeaders['Authorization'] = `Bearer ${token}`;

        let mergedHeaders = { ...baseHeaders, ...(options.headers as Record<string, string>) };

        if (!(options.body instanceof FormData) && !mergedHeaders['Content-Type']) {
            mergedHeaders['Content-Type'] = 'application/json';
        }

        if (url.startsWith('/')) {
            const base = import.meta.env.BASE_URL;
            const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
            url = `${cleanBase}${url}`;
        }

        let response = await fetch(url, { ...options, headers: mergedHeaders });

        if (response.status === 401) {
            if (!refreshPromise) {
                refreshPromise = (async () => {
                    try {
                        const refreshToken = localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken');
                        if (!refreshToken) {
                            throw new Error('No refresh token');
                        }

                        const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
                        const refreshRes = await fetch(`${baseUrl}api/account/refresh`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ refreshToken })
                        });

                        if (!refreshRes.ok) {
                            throw new Error('Refresh failed');
                        }

                        const data = await refreshRes.json();

                        // Update storage
                        const isLocal = !!localStorage.getItem('accessToken');
                        if (isLocal) {
                            localStorage.setItem('accessToken', data.accessToken);
                            localStorage.setItem('refreshToken', data.refreshToken);
                        } else {
                            sessionStorage.setItem('accessToken', data.accessToken);
                            sessionStorage.setItem('refreshToken', data.refreshToken);
                        }

                        notifyTokenListeners(data.accessToken);

                        return data.accessToken;
                    } catch (e) {
                        await apiAuth.logout();
                        throw e;
                    } finally {
                        refreshPromise = null;
                    }
                })();
            }

            try {
                const newAccessToken = await refreshPromise;
                // Retry original request with new token
                mergedHeaders['Authorization'] = `Bearer ${newAccessToken}`;
                response = await fetch(url, { ...options, headers: mergedHeaders });
            } catch (e) {
                // Refresh failed, already logged out.
                // We return the original 401 response or can throw. 
                // Returning original response usually lets the app handle unauthorized state in UI if needed, 
                // but we already called logout() which reloads the page, so this code might not even finish executing effectively.
                return response;
            }
        }

        return response;
    },

    async logout() {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        sessionStorage.removeItem('accessToken');
        sessionStorage.removeItem('refreshToken');
        // Reload to show login form
        window.location.reload();
    },

    addTokenListener(callback: (token: string) => void) {
        tokenListeners.push(callback);
    },

    removeTokenListener(callback: (token: string) => void) {
        tokenListeners = tokenListeners.filter(cb => cb !== callback);
    }
};

let tokenListeners: ((token: string) => void)[] = [];

function notifyTokenListeners(token: string) {
    tokenListeners.forEach(listener => listener(token));
}
