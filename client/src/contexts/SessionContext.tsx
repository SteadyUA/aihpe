
import React, { createContext } from 'react';
import { apiAuth } from '../utils/api';
import { Session, TabType, SessionStatus } from '../types';
import { withRouter, RouterProps } from '../components/withRouter';

interface SessionContextType {
    sessions: Record<string, Session>;
    sessionOrder: string[];
    activeSessionId: string | null;
    isConnected: boolean;
    stableSessionIds: string[];
    sessionToDelete: string | null;
    notFoundSessionId: string | null;

    // fetchSession: (id: string, isCompletion?: boolean) => Promise<any>; // Removed
    createSession: () => Promise<void>;
    switchSession: (id: string) => void;
    updateSession: (id: string, updates: Partial<Session>) => void;
    removeSession: (id: string) => void;
    cancelDeleteSession: () => void;
    confirmDeleteSession: () => void;
    handleSessionReorder: (newOrder: string[]) => void;
    cloneTurn: (turn: number) => Promise<void>;
    previewTurn: (turn: number) => Promise<void>;
    syncProjectSessions: (projectSessions: any[], activeId?: string) => void;
}

const SessionContext = createContext<SessionContextType | null>(null);
export const SessionConsumer = SessionContext.Consumer;
export interface SessionContextProps extends SessionContextType { }

export function withSession<P extends SessionContextProps>(
    Component: React.ComponentType<P>
) {
    return function ComponentWithSessionProp(props: Omit<P, keyof SessionContextProps>) {
        return (
            <SessionConsumer>
                {context => {
                    if (!context) {
                        throw new Error('withSession must be used within a SessionProvider');
                    }
                    return <Component {...props as P} {...context} />;
                }}
            </SessionConsumer>
        );
    };
}

interface SessionProviderProps extends RouterProps {
    children: React.ReactNode;
    projectId: string | null;
    initialActiveSessionId?: string | null;
}

interface SessionProviderState {
    sessions: Record<string, Session>;
    sessionOrder: string[];
    activeSessionId: string | null;
    isConnected: boolean;
    sessionToDelete: string | null;
    stableSessionIds: string[];
    notFoundSessionId: string | null;
}

class SessionProviderInternal extends React.Component<SessionProviderProps, SessionProviderState> {
    private creatingSessionPromise: Promise<any> | null = null;

    constructor(props: SessionProviderProps) {
        super(props);
        this.state = {
            sessions: {},
            sessionOrder: [],
            activeSessionId: props.initialActiveSessionId || null,
            isConnected: true, // Assumed handled by Global App, can listen to disconnect if needed
            sessionToDelete: null,
            stableSessionIds: [],
            notFoundSessionId: null,
        };
    }

    componentDidMount() {
        this.handleUrlCheck();
        window.addEventListener('app:session-created', this.onSessionCreated);
        window.addEventListener('app:session-update', this.onSessionUpdate);
        window.addEventListener('app:token-usage', this.onTokenUsage);
        window.addEventListener('app:chat-status', this.onChatStatus as EventListener);
    }

    componentDidUpdate(prevProps: SessionProviderProps, prevState: SessionProviderState) {
        this.handleUrlSync(prevProps, prevState);
    }

    componentWillUnmount() {
        window.removeEventListener('app:session-created', this.onSessionCreated);
        window.removeEventListener('app:session-update', this.onSessionUpdate);
        window.removeEventListener('app:token-usage', this.onTokenUsage);
        window.removeEventListener('app:chat-status', this.onChatStatus as EventListener);
    }

    onSessionCreated = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail.projectId && detail.projectId !== this.props.projectId) return; // Ignore irrelevant sessions
        this.handleSessionCreated(detail, detail.sourceSessionId, false);
    }

    onSessionUpdate = (e: Event) => {
        const payload = (e as CustomEvent).detail;
        if (payload.sessionId) {
            this.setState((prevState) => {
                const session = prevState.sessions[payload.sessionId];
                if (!session) return null;
                
                const newLastTurn = payload.lastTurn ?? session.lastTurn;
                const newActiveTurn = session.activeTurn === session.lastTurn ? newLastTurn : session.activeTurn;

                return {
                    sessions: {
                        ...prevState.sessions,
                        [payload.sessionId]: {
                            ...session,
                            subject: payload.subject ?? session.subject,
                            lastTurn: newLastTurn,
                            activeTurn: newActiveTurn,
                        }
                    }
                };
            });
        }
    }

    onChatStatus = (e: Event) => {
        const payload = (e as CustomEvent).detail;
        if (payload.sessionId && payload.status) {
            this.setState((prevState) => {
                const session = prevState.sessions[payload.sessionId];
                if (!session) return null;
                
                const mappedStatus = (payload.status === 'started' || payload.status === 'generating') ? SessionStatus.BUSY :
                    (payload.status === 'error') ? SessionStatus.ERROR : SessionStatus.IDLE;

                return {
                    sessions: {
                        ...prevState.sessions,
                        [payload.sessionId]: {
                            ...session,
                            status: mappedStatus,
                            errorMessage: payload.status === 'error' ? payload.message : session.errorMessage
                        }
                    }
                };
            });
        }
    }

    onTokenUsage = (e: Event) => {
        const payload = (e as CustomEvent).detail;
        if (payload.sessionId && payload.tokenUsage) {
            this.setState((prevState) => {
                const session = prevState.sessions[payload.sessionId];
                if (!session) return null;
                return {
                    sessions: {
                        ...prevState.sessions,
                        [payload.sessionId]: {
                            ...session,
                            tokenUsage: payload.tokenUsage
                        }
                    }
                };
            });
        }
    }

    handleUrlCheck = () => {
        const { searchParams } = this.props.router;

        // OLD: params['sessionId'] -> NEW: searchParams.get('sessionId')
        const sessionIdQuery = searchParams.get('sessionId');

        const turnFromUrl = searchParams.get('turn');
        const tabFromUrl = searchParams.get('tab') as TabType;

        if (sessionIdQuery && sessionIdQuery !== this.state.activeSessionId) {
            const { sessions } = this.state;
            if (sessions[sessionIdQuery]) {
                const session = sessions[sessionIdQuery];
                const targetTurn = turnFromUrl ? parseInt(turnFromUrl, 10) : session.lastTurn;
                const targetTab = tabFromUrl || 'preview';

                // Session found in state, update activeTurn/tab if needed
                if (session.activeTurn !== targetTurn || session.activeTab !== targetTab) {
                    this.updateSession(sessionIdQuery, { activeTurn: targetTurn, activeTab: targetTab });
                }
                this.setState({ activeSessionId: sessionIdQuery }, () => {
                    if (!this.state.stableSessionIds.includes(sessionIdQuery)) {
                        this.setState(prev => ({ stableSessionIds: [...prev.stableSessionIds, sessionIdQuery] }));
                    }
                });
            } else {
                // Session not found in project sessions. 
                // Since project load provides all sessions, this is likely a 404 or invalid ID.
                this.setState({ notFoundSessionId: sessionIdQuery });
            }
        } else if (sessionIdQuery && sessionIdQuery === this.state.activeSessionId) {
            // Same session, but check if turn/tab changed (e.g. back/forward nav)
            const { sessions } = this.state;
            const session = sessions[sessionIdQuery];
            if (session) {
                const targetTurn = turnFromUrl ? parseInt(turnFromUrl, 10) : session.lastTurn;
                const targetTab = tabFromUrl || 'preview';

                if (session.activeTurn !== targetTurn || session.activeTab !== targetTab) {
                    console.log('[SessionContext] Syncing history state', { targetTurn, targetTab });
                    this.updateSession(sessionIdQuery, { activeTurn: targetTurn, activeTab: targetTab });
                }
            }
        }
        /* 
           ProjectWorkspace handles the case where sessionIdQuery is MISSING.
           It finds default and navigates.
           SessionContext handles REACTING to the parameter being present.
        */
    }

    handleUrlSync = (prevProps: SessionProviderProps, prevState: SessionProviderState) => {
        const { activeSessionId, sessions } = this.state;
        const { router, projectId } = this.props;
        const { searchParams, location, navigate } = router;

        if (prevProps.router.location !== location) {
            this.handleUrlCheck();
        }

        if (activeSessionId && sessions[activeSessionId]) {
            if (activeSessionId !== prevState.activeSessionId && projectId) {
                apiAuth.fetch(`/api/projects/${projectId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ activeSessionId })
                }).catch(e => console.error('Failed to save active session', e));

                // Update URL to reflect active session
                const newParams = new URLSearchParams(searchParams);
                newParams.set('sessionId', activeSessionId);

                // Keep other params? like turn?
                // Logic below handles turn/tab sync
            }

            const session = sessions[activeSessionId];
            const prevSession = prevState.sessions[activeSessionId];

            const needsUpdate =
                activeSessionId !== prevState.activeSessionId ||
                (prevSession && (session.activeTurn !== prevSession.activeTurn || session.activeTab !== prevSession.activeTab));

            if (needsUpdate) {
                const newParams = new URLSearchParams(searchParams);
                newParams.set('sessionId', activeSessionId); // Always set session ID

                if (session.activeTurn !== null) newParams.set('turn', session.activeTurn.toString());
                else newParams.delete('turn');

                if (session.activeTab && session.activeTab !== 'preview') newParams.set('tab', session.activeTab);
                else newParams.delete('tab');

                const newSearch = `?${newParams.toString()}`;

                if (location.search !== newSearch) {
                    // Determine if we should REPLACE (normalization/defaults) or PUSH (user navigation)
                    // 1. If we had no active session before (initial load), REPLACE.
                    // 2. If we are just filling in a missing 'turn' param for the current session, REPLACE.
                    // 3. Otherwise (switching sessions, changing turns explicitly), PUSH.

                    const isInitialLoad = !prevState.activeSessionId;
                    const isFillingDefaults =
                        activeSessionId === prevState.activeSessionId &&
                        !searchParams.has('turn') &&
                        session.activeTurn !== null;

                    const shouldReplace = isInitialLoad || isFillingDefaults;

                    navigate(`${location.pathname}${newSearch}`, { replace: shouldReplace });
                }
            }
        }
    }

    // fetchSession removed as per requirement to stop using GET /api/sessions/:id

    handleSessionCreated = (sessionData: any, sourceSessionId?: string, autoSwitch: boolean = false) => {
        this.setState((prevState) => {
            const exists = prevState.sessions[sessionData.id];

            // If session exists and is NOT pending, we ignore it (duplicate event).
            // If it IS pending, we need to update it with the confirm data (status: idle, etc).
            if (exists && exists.status !== SessionStatus.PENDING) return null;

            const lastTurn = sessionData.lastTurn ?? sessionData.currentTurn ?? 0;

            const status = sessionData.status ?? SessionStatus.IDLE;

            const newSession: Session = {
                ...(exists || {}), // Keep existing props if merging
                id: sessionData.id,
                status: status,
                projectId: sessionData.projectId ?? this.props.projectId ?? (exists?.projectId || ''),
                lastTurn: lastTurn,
                currentVersion: sessionData.currentVersion ?? 0,
                // Preserve activeTurn if exists (optimistic), else use lastTurn
                activeTurn: (exists && exists.activeTurn !== null) ? exists.activeTurn : lastTurn,
                activeTab: exists?.activeTab || 'preview',
                selection: exists?.selection || null,
                isPicking: exists?.isPicking || false,
                provider: sessionData.provider ?? exists?.provider,
                fastMode: sessionData.fastMode ?? exists?.fastMode,
                group: sessionData.group ?? 0,
                pendingRefreshTurn: null,
                input: sessionData.unsent?.input ?? exists?.input,
                subject: sessionData.subject || exists?.subject || '...',
            };

            let newOrder = [...prevState.sessionOrder];
            if (!exists) {
                const sourceId = sourceSessionId || (sessionData.sourceSessionId);

                if (sourceId && sourceId !== 'system') {
                    const sourceIndex = newOrder.indexOf(sourceId);
                    if (sourceIndex !== -1) {
                        newOrder.splice(sourceIndex + 1, 0, sessionData.id);
                    } else {
                        newOrder.push(sessionData.id);
                    }
                } else {
                    newOrder.push(sessionData.id);
                }
            }

            const newStable = prevState.stableSessionIds.includes(sessionData.id)
                ? prevState.stableSessionIds
                : [...prevState.stableSessionIds, sessionData.id];

            return {
                sessions: { ...prevState.sessions, [sessionData.id]: newSession },
                sessionOrder: newOrder,
                stableSessionIds: newStable,
                activeSessionId: (!exists && autoSwitch) ? sessionData.id : prevState.activeSessionId
            };
        });

        // Since we don't fetch session anymore, rely on creation data + defaults
        // If we strictly follow "don't use GET /api/sessions/:id", we can't fetch.
        // The SSE event (onSessionCreated) or POST response should ideally provide needed info.
        // For now, we assume defaults are enough or data is provided.
    };

    createSession = async () => {
        if (this.creatingSessionPromise) {
            try {
                // Wait for existing promise
                const sessionData = await this.creatingSessionPromise;
                if (sessionData) {
                    // Start pending session from existing data
                    this.handleSessionCreated({ ...sessionData, status: SessionStatus.PENDING }, undefined, true);
                }
                return;
            } catch (e) {
                this.creatingSessionPromise = null;
            }
        }

        try {
            const projectId = this.props.projectId;
            this.creatingSessionPromise = apiAuth.fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId })
            }).then(res => {
                if (!res.ok) throw new Error('Failed to create session');
                return res.json();
            });

            const sessionData = await this.creatingSessionPromise;

            // Start optimistic pending session
            this.handleSessionCreated({ ...sessionData, status: SessionStatus.PENDING }, undefined, true);

            this.creatingSessionPromise = null;

        } catch (error) {
            console.error('Failed to create session', error);
            this.creatingSessionPromise = null;
        }
    };

    updateSession = (id: string, updates: Partial<Session>) => {
        this.setState(prev => ({
            sessions: {
                ...prev.sessions,
                [id]: { ...prev.sessions[id], ...updates }
            }
        }));
    };

    switchSession = (id: string) => {
        this.setState(prev => {
            const session = prev.sessions[id];
            if (session && session.activeTurn === null) {
                return {
                    sessions: {
                        ...prev.sessions,
                        [id]: { ...session, activeTurn: session.lastTurn }
                    },
                    activeSessionId: id
                } as unknown as Pick<SessionProviderState, "sessions" | "activeSessionId">;
            }
            return { activeSessionId: id } as unknown as Pick<SessionProviderState, "sessions" | "activeSessionId">;
        });
    };

    removeSession = (id: string) => {
        this.setState({ sessionToDelete: id });
    };

    cancelDeleteSession = () => {
        this.setState({ sessionToDelete: null });
    };

    confirmDeleteSession = () => {
        const id = this.state.sessionToDelete;
        if (!id) return;

        apiAuth.fetch(`/api/sessions/${id}`, { method: 'DELETE' })
            .catch(err => console.error('Failed to delete session on server', err));

        this.setState(prev => {
            const index = prev.sessionOrder.indexOf(id);
            const newOrder = prev.sessionOrder.filter(s => s !== id);

            const { [id]: removed, ...rest } = prev.sessions;

            let newActive: string | null = prev.activeSessionId;
            if (newActive === id) {
                if (newOrder.length === 0) newActive = null;
                else if (index > 0) newActive = newOrder[index - 1];
                else newActive = newOrder[0];
            }

            return {
                sessions: rest,
                sessionOrder: newOrder,
                activeSessionId: newActive,
                sessionToDelete: null
            };
        });
    };

    handleSessionReorder = (newOrder: string[]) => {
        this.setState({ sessionOrder: newOrder });
        if (this.props.projectId) {
            apiAuth.fetch(`/api/projects/${this.props.projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionIds: newOrder })
            }).catch(e => console.error('Failed to save session order', e));
        }
    };

    cloneTurn = async (turn: number) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;
        try {
            const res = await apiAuth.fetch(
                `/api/sessions/${activeSessionId}/clone/${turn}`,
                { method: 'POST' },
            );
            if (!res.ok) throw new Error('Clone turn failed');
            const session = await res.json();
            // Force status to pending so Chat knows to wait for SSE (and then refetch turns)
            this.handleSessionCreated({ ...session, status: SessionStatus.PENDING }, activeSessionId, true);
        } catch (error) {
            console.error('Failed to clone turn', error);
        }
    };

    previewTurn = async (turn: number) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;
        this.updateSession(activeSessionId, { activeTurn: turn });
    };

    syncProjectSessions = (projectSessions: any[], activeId?: string) => {
        this.setState(prev => {
            const sessionsMap: Record<string, Session> = { ...prev.sessions };
            const order: string[] = [];
            const fetchedIds = new Set<string>();

            projectSessions.forEach((s) => {
                // Server now returns 'id', not 'sessionId'
                const sId = s.id || s.sessionId;
                if (!sId) return;

                order.push(sId);
                fetchedIds.add(sId);

                const serverStatus = s.status;
                const mappedStatus = (serverStatus === 'started' || serverStatus === 'generating') ? SessionStatus.BUSY :
                    (serverStatus === 'error') ? SessionStatus.ERROR : SessionStatus.IDLE;

                const existing = prev.sessions[sId];

                // Create full session object using new enriched data from server
                sessionsMap[sId] = {
                    id: sId,
                    projectId: this.props.projectId || s.projectId || '',
                    status: existing ? (mappedStatus === SessionStatus.IDLE ? (existing.status || SessionStatus.IDLE) : mappedStatus) : mappedStatus,

                    lastTurn: s.lastTurn ?? 0,
                    activeTurn: existing ? (existing.activeTurn ?? s.lastTurn ?? 0) : (s.lastTurn ?? 0),
                    activeTab: existing?.activeTab || 'preview',
                    selection: (s.unsent?.selection) ?? (existing ? existing.selection : null),
                    isPicking: existing?.isPicking || false,
                    pendingRefreshTurn: null,

                    group: s.group ?? 0,
                    provider: (s.unsent?.provider) ?? s.provider ?? 'openai',
                    fastMode: (s.unsent?.fastMode) ?? s.fastMode ?? false,
                    subject: s.subject || '...', // Fallback to ... if no subject, but we don't rely on existing subject blindly if server sends one? Server sends undefined if none.

                    input: s.unsent?.input || (existing ? existing.input : undefined),
                    attachment: (s.unsent?.attachment) ?? (existing ? existing.attachment : undefined),

                    tokenUsage: s.tokenUsage,
                    currentVersion: s.currentVersion,
                };
            });

            const newStable = prev.stableSessionIds.filter(id => fetchedIds.has(id));
            order.forEach(id => {
                if (!newStable.includes(id)) newStable.push(id);
            });

            return {
                sessions: sessionsMap,
                sessionOrder: order,
                stableSessionIds: newStable,
                activeSessionId: activeId || prev.activeSessionId
            };
        });
    };

    render() {
        return (
            <SessionContext.Provider value={{
                ...this.state,
                // fetchSession: this.fetchSession, // Removed
                createSession: this.createSession,
                switchSession: this.switchSession,
                updateSession: this.updateSession,
                removeSession: this.removeSession,
                cancelDeleteSession: this.cancelDeleteSession,
                confirmDeleteSession: this.confirmDeleteSession,
                handleSessionReorder: this.handleSessionReorder,
                cloneTurn: this.cloneTurn,
                previewTurn: this.previewTurn,
                syncProjectSessions: this.syncProjectSessions
            }}>
                {this.props.children}
            </SessionContext.Provider>
        );
    }
}

export const SessionProvider = withRouter<SessionProviderProps>(SessionProviderInternal);
