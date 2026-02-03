
import React, { createContext } from 'react';
import { apiAuth } from '../utils/api';
import { Session, TabType } from '../types';
import { withRouter, RouterProps } from '../components/withRouter';

interface SessionContextType {
    sessions: Record<string, Session>;
    sessionOrder: string[];
    activeSessionId: string | null;
    isConnected: boolean;
    stableSessionIds: string[];
    sessionToDelete: string | null;
    notFoundSessionId: string | null;

    fetchSession: (id: string, isCompletion?: boolean) => Promise<any>;
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
            activeSessionId: null,
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
        // window.addEventListener('app:chat-status', ...); // Chat specific handling if needed here or in child
    }

    componentDidUpdate(prevProps: SessionProviderProps, prevState: SessionProviderState) {
        this.handleUrlSync(prevProps, prevState);
    }

    componentWillUnmount() {
        window.removeEventListener('app:session-created', this.onSessionCreated);
        window.removeEventListener('app:session-update', this.onSessionUpdate);
    }

    onSessionCreated = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail.projectId && detail.projectId !== this.props.projectId) return; // Ignore irrelevant sessions
        this.handleSessionCreated(detail);
    }

    onSessionUpdate = (e: Event) => {
        const payload = (e as CustomEvent).detail;
        if (payload.sessionId) {
            this.setState((prevState) => {
                const session = prevState.sessions[payload.sessionId];
                if (!session) return null;
                return {
                    sessions: {
                        ...prevState.sessions,
                        [payload.sessionId]: {
                            ...session,
                            subject: payload.subject ?? session.subject
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

                if (session.activeTurn !== targetTurn || session.activeTab !== targetTab) {
                    this.updateSession(sessionIdQuery, { activeTurn: targetTurn, activeTab: targetTab });
                }
                this.setState({ activeSessionId: sessionIdQuery }, () => {
                    if (!this.state.stableSessionIds.includes(sessionIdQuery)) {
                        this.setState(prev => ({ stableSessionIds: [...prev.stableSessionIds, sessionIdQuery] }));
                    }
                });
            } else {
                this.fetchSession(sessionIdQuery).then(data => {
                    if (data && !data.notFound) {
                        // Ensure it belongs to this project?
                        // fetchSession check?
                        this.setState({ activeSessionId: sessionIdQuery }, () => {
                            this.setState(prev => {
                                const newStable = prev.stableSessionIds.includes(sessionIdQuery) ? prev.stableSessionIds : [...prev.stableSessionIds, sessionIdQuery];
                                const newOrder = prev.sessionOrder.includes(sessionIdQuery) ? prev.sessionOrder : [...prev.sessionOrder, sessionIdQuery];
                                return { stableSessionIds: newStable, sessionOrder: newOrder };
                            });
                        });
                    }
                });
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

    fetchSession = async (id: string, isCompletion: boolean = false) => {
        try {
            const res = await apiAuth.fetch(`/api/sessions/${id}`);
            if (res.status === 404) {
                this.setState({ notFoundSessionId: id });
                return { notFound: true };
            }
            if (!res.ok) throw new Error('Failed to fetch session');

            const data = await res.json();

            // Validate project?
            // if (data.projectId !== this.props.projectId) ... logic?

            const lastTurn = data.lastTurn ?? 0;

            this.setState((prevState) => {
                const session = prevState.sessions[id];
                const baseSession: Session = session || {
                    id,
                    projectId: data.projectId,
                    status: 'idle',
                    lastTurn: 0,
                    activeTurn: null,
                    activeTab: 'preview',
                    selection: null,
                    isPicking: false,
                    group: data.group ?? 0,
                    pendingRefreshTurn: null,
                    input: undefined,
                    subject: data.subject || '...',
                };

                return {
                    sessions: {
                        ...prevState.sessions,
                        [id]: {
                            ...baseSession,
                            currentVersion: data.currentVersion,
                            lastTurn: lastTurn,
                            activeTurn: (baseSession.activeTurn !== null && baseSession.activeTurn > lastTurn) ? null : baseSession.activeTurn,
                            projectId: data.projectId ?? baseSession.projectId,
                            status: (data.status === 'started' || data.status === 'generating') ? 'busy' :
                                (data.status === 'error') ? 'error' : 'idle',
                            pendingRefreshTurn: isCompletion ? lastTurn : (session ? session.pendingRefreshTurn : null),
                            input: data.unsent?.input || (session ? session.input : undefined),
                            selection: (data.unsent?.selection) ?? (session ? session.selection : null),
                            tokenUsage: data.tokenUsage ?? (session ? session.tokenUsage : undefined),
                            attachment: (data.unsent?.attachment) ?? (session ? session.attachment : undefined),
                            provider: (data.unsent?.provider) ?? data.provider ?? 'openai',
                            fastMode: (data.unsent?.fastMode) ?? data.fastMode ?? false,
                            subject: data.subject || '...',
                        }
                    }
                };
            });
            return data;
        } catch (error) {
            console.error('Failed to fetch session', error);
            return null;
        }
    };

    handleSessionCreated = (sessionData: any, sourceSessionId?: string) => {
        this.setState((prevState) => {
            const exists = prevState.sessions[sessionData.id];
            if (exists) return null;

            const newSession: Session = {
                id: sessionData.id,
                status: 'idle',
                projectId: sessionData.projectId ?? this.props.projectId ?? '',
                lastTurn: sessionData.lastTurn ?? 0,
                currentVersion: sessionData.currentVersion ?? 0,
                activeTurn: 0,
                activeTab: 'preview',
                selection: null,
                isPicking: false,
                provider: sessionData.provider,
                group: sessionData.group ?? 0,
                pendingRefreshTurn: null,
                input: sessionData.unsent?.input,
                subject: sessionData.subject || '...',
            };

            let newOrder = [...prevState.sessionOrder];
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

            const newStable = prevState.stableSessionIds.includes(sessionData.id)
                ? prevState.stableSessionIds
                : [...prevState.stableSessionIds, sessionData.id];

            return {
                sessions: { ...prevState.sessions, [sessionData.id]: newSession },
                sessionOrder: newOrder,
                stableSessionIds: newStable,
                activeSessionId: sessionData.id
            };
        });

        this.fetchSession(sessionData.id);
    };

    createSession = async () => {
        if (this.creatingSessionPromise) {
            try {
                const session = await this.creatingSessionPromise;
                this.handleSessionCreated(session);
                return;
            } catch (e) {
                this.creatingSessionPromise = null;
            }
        }

        try {
            this.creatingSessionPromise = apiAuth.fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: this.props.projectId })
            }).then(res => res.json());

            const session = await this.creatingSessionPromise;
            this.handleSessionCreated(session);
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
            this.handleSessionCreated(session, activeSessionId);
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

            projectSessions.forEach(({ sessionId, group, subject, status: serverStatus, lastTurn }) => {
                order.push(sessionId);
                fetchedIds.add(sessionId);

                const mappedStatus = (serverStatus === 'started' || serverStatus === 'generating') ? 'busy' :
                    (serverStatus === 'error') ? 'error' : 'idle';

                const existing = prev.sessions[sessionId];

                sessionsMap[sessionId] = {
                    id: sessionId,
                    projectId: this.props.projectId || '',
                    status: existing ? (mappedStatus === 'idle' ? (existing.status || 'idle') : mappedStatus) : mappedStatus,
                    lastTurn: lastTurn ?? 0,
                    activeTurn: lastTurn ?? 0, // Default active
                    activeTab: existing?.activeTab || 'preview',
                    selection: existing?.selection || null,
                    isPicking: existing?.isPicking || false,
                    pendingRefreshTurn: null,
                    group: group ?? 0,
                    provider: 'openai',
                    subject: subject || (existing?.subject || '...'),
                    input: existing?.input,
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
                fetchSession: this.fetchSession,
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

export const SessionProvider = withRouter(SessionProviderInternal);
