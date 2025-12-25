import React from 'react';
import { SessionBar } from './components/SessionBar';


import { WorkSession } from './components/WorkSession';

import { SessionStore } from './store/SessionStore';
import { ConfirmationModal } from './components/ConfirmationModal';
import styles from './App.module.css';

interface AppProps { }

import { Session } from './types';

interface AppState {
    sessions: Record<string, Session>;
    sessionOrder: string[]; // To maintain list order
    activeSessionId: string | null;
    isConnected: boolean;
    sessionToDelete: string | null;
}

export default class App extends React.Component<AppProps, AppState> {
    private evtSource: EventSource | null = null;

    constructor(props: AppProps) {
        super(props);
        this.state = {
            sessions: {},
            sessionOrder: [],
            activeSessionId: null,
            isConnected: false,
            sessionToDelete: null,
        };

    }

    componentDidMount() {
        // Load from SessionStore
        try {
            const sessionIds = SessionStore.loadSessions();
            const activeSessionId = SessionStore.loadActiveSessionId();
            const groups = SessionStore.loadGroups();

            if (sessionIds.length > 0) {
                const sessionsMap: Record<string, Session> = {};

                sessionIds.forEach(id => {
                    sessionsMap[id] = {
                        id,
                        status: 'idle',
                        messages: [],
                        statusMessages: [],
                        requestStartTime: null,
                        currentTurn: 0,
                        activeTurn: null,
                        imageGenerationAllowed: true,
                        selection: null,
                        isPicking: false,
                        pendingRefreshTurn: null,
                        group: groups[id] ?? 0 // Default to 0 if missing from store
                    };
                });

                this.setState({
                    sessions: sessionsMap,
                    sessionOrder: sessionIds,
                    activeSessionId,
                }, () => {
                    // Fetch active session data after mounting
                    if (activeSessionId) {
                        this.handleSessionChange(activeSessionId);
                    }
                });
            } else {
                // Auto-create session on startup if none exist
                this.createSession();
            }
        } catch (e) {
            console.error('Failed to load from SessionStore', e);
        }

        // Setup persistent SSE connection
        this.setupSse();
    }

    componentDidUpdate(_prevProps: AppProps, prevState: AppState) {
        if (prevState.activeSessionId !== this.state.activeSessionId) {
            SessionStore.saveActiveSessionId(this.state.activeSessionId);
            // We handle data fetching in the switch method or here. 
            // Better to handle it when the switch actually happens or state updates.
        }

        if (prevState.sessionOrder !== this.state.sessionOrder) {
            SessionStore.saveSessions(this.state.sessionOrder);

            // Auto-create if all sessions were removed
            if (this.state.sessionOrder.length === 0 && prevState.sessionOrder.length > 0) {
                this.createSession();
            }
        }

        // Save groups whenever they change in any session
        // This is a bit expensive to check deep equality, but manageable for small number of sessions.
        // Or we can just save whenever sessions change.
        const prevGroups = this.extractGroups(prevState.sessions);
        const currGroups = this.extractGroups(this.state.sessions);
        if (JSON.stringify(prevGroups) !== JSON.stringify(currGroups)) {
            SessionStore.saveGroups(currGroups);
        }
    }

    extractGroups(sessions: Record<string, Session>): Record<string, number> {
        const groups: Record<string, number> = {};
        Object.values(sessions).forEach(s => {
            groups[s.id] = s.group;
        });
        return groups;
    }

    componentWillUnmount() {
        if (this.evtSource) {
            this.evtSource.close();
        }

    }

    handleSessionChange = (newId: string | null) => {
        if (!newId) {
            // Should we just set active null?
            return; // managed primarily by switchSession
        }

        // Fetch session data
        this.fetchSession(newId).then(() => {
            // If there is an active turn restored/persisted in the object, load ITS files
            const session = this.state.sessions[newId];
            if (session && session.activeTurn !== null) {
                this.previewTurn(session.activeTurn);
            }
        });
    };

    setupSse = () => {
        if (this.evtSource) {
            this.evtSource.close();
        }

        this.evtSource = new EventSource('/api/sse');

        this.evtSource.onopen = () => {
            console.log('SSE Connected');
            this.setState({ isConnected: true });
        };

        this.evtSource.onerror = (err) => {
            console.error('SSE Error', err);
            this.setState({ isConnected: false });
            if (this.evtSource) {
                this.evtSource.close();
                this.evtSource = null;
            }
            // Reconnect after 1 second
            setTimeout(() => this.setupSse(), 1000);
        };

        this.evtSource.addEventListener('chat-status', (e) => {
            const data = JSON.parse(e.data);
            const { sessionId } = data;

            this.setState(prevState => {
                const session = prevState.sessions[sessionId];
                if (!session) return null; // Update for unknown session? Ignore.

                const updatedSession = { ...session };

                if (data.status === 'started') {
                    updatedSession.status = 'busy';
                    updatedSession.statusMessages = [data.message || 'Thinking...'];
                    updatedSession.requestStartTime = Date.now();
                } else if (data.status === 'generating') {
                    if (data.message) {
                        updatedSession.statusMessages = [...updatedSession.statusMessages, data.message];
                    }
                } else if (data.status === 'completed') {
                    updatedSession.status = 'idle';
                    updatedSession.requestStartTime = null;
                    updatedSession.requestStartTime = null;
                    // Trigger fetch to get latest messages/turn
                    setTimeout(() => this.fetchSession(sessionId, true), 0);
                } else if (data.status === 'error') {
                    updatedSession.status = 'error';
                    updatedSession.statusMessages = [...updatedSession.statusMessages, data.message || 'Error occurred'];
                    updatedSession.requestStartTime = null;
                }

                return {
                    sessions: {
                        ...prevState.sessions,
                        [sessionId]: updatedSession
                    }
                };
            });
        });

        this.evtSource.addEventListener('session-created', (e) => {
            const data = JSON.parse(e.data);
            // Verify if we already have it (e.g. created by this client)
            this.setState((prevState: Readonly<AppState>) => {
                if (prevState.sessions[data.newSessionId]) {
                    // Already exists, just ensure pending status is removed if it was pending
                    const s = prevState.sessions[data.newSessionId];
                    if (s.status === 'pending') {
                        return {
                            sessions: {
                                ...prevState.sessions,
                                [data.newSessionId]: { ...s, status: 'idle', group: data.group ?? 0 }
                            },
                            sessionOrder: prevState.sessionOrder
                        };
                    }
                    return null;
                }

                // New session from elsewhere
                const newSession: Session = {
                    id: data.newSessionId,
                    status: 'idle',
                    messages: [],
                    statusMessages: [],
                    requestStartTime: null,
                    currentTurn: 0,
                    activeTurn: null,
                    imageGenerationAllowed: true,
                    selection: null,
                    isPicking: false,
                    group: data.group ?? 0,
                    pendingRefreshTurn: null
                };

                // Calculate new order
                let newOrder = [...prevState.sessionOrder];
                console.log('[App] session-created', data, 'source:', data.sourceSessionId, 'order:', newOrder);

                if (data.sourceSessionId && data.sourceSessionId !== 'system') {
                    const sourceIndex = newOrder.indexOf(data.sourceSessionId);
                    if (sourceIndex !== -1) {
                        // Insert after source
                        newOrder.splice(sourceIndex + 1, 0, data.newSessionId);
                    } else {
                        // Source not found, append
                        newOrder.push(data.newSessionId);
                    }
                } else {
                    // System created or no source, append
                    newOrder.push(data.newSessionId);
                }

                return {
                    sessions: { ...prevState.sessions, [data.newSessionId]: newSession },
                    sessionOrder: newOrder
                } as Pick<AppState, 'sessions' | 'sessionOrder'>;
            }, () => {
                // Fetch the new session history after state update
                this.fetchSession(data.newSessionId);
            });
        });
    };

    fetchSession = async (id: string, isCompletion: boolean = false) => {
        try {
            const res = await fetch(`/api/sessions/${id}`);
            const data = await res.json();

            // Fetch history separately
            // New API always returns full history, no version needed
            const historyRes = await fetch(`/api/sessions/${id}/history`);
            let history = [];
            // Use currentTurn directly from API
            const lastTurn = data.currentTurn ?? 0;

            if (historyRes.ok) {
                history = await historyRes.json();
            } else {
                console.warn(`Failed to fetch history for session ${id}`);
            }

            this.setState(prevState => {
                const session = prevState.sessions[id];
                if (!session) return null; // Should probably create it if missing? For now stick to strict.

                // Only update if turn changed (to update lastUpdate? No, lastUpdate is mainly event driven)
                // But if we fetched new turn, we should probably ensure UI reflects it.

                return {
                    sessions: {
                        ...prevState.sessions,
                        [id]: {
                            ...session,
                            messages: history,
                            currentTurn: lastTurn,
                            imageGenerationAllowed: data.imageGenerationAllowed ?? true,
                            // If status was pending, now it is definitively idle/ready
                            status: session.status === 'pending' ? 'idle' : session.status,
                            // Set pendingRefreshTurn only if completion triggered this fetch
                            pendingRefreshTurn: isCompletion ? lastTurn : session.pendingRefreshTurn
                        }
                    }
                };
            });
        } catch (error) {
            console.error('Failed to fetch session', error);
        }
    };

    private static creatingSessionPromise: Promise<any> | null = null;

    createSession = async () => {
        if (App.creatingSessionPromise) {
            try {
                const session = await App.creatingSessionPromise;
                this.handleSessionCreated(session);
                return;
            } catch (e) {
                App.creatingSessionPromise = null;
            }
        }

        try {
            // Optimistic creation in UI?
            // User might want to see "Creating..." immediately. 
            // We can check if we want to show a temporary loader or just wait.
            // Previous code used 'pendingSessions' array. 
            // We can't really add a session to the map without an ID yet.
            // So we wait for the ID from server.

            App.creatingSessionPromise = fetch('/api/sessions', { method: 'POST' }).then(res => res.json());
            const session = await App.creatingSessionPromise;
            App.creatingSessionPromise = null;

            this.handleSessionCreated(session);
        } catch (error) {
            console.error('Failed to create session', error);
            App.creatingSessionPromise = null;
        }
    };

    handleSessionCreated = (sessionData: any, sourceSessionId?: string) => {
        this.setState((prevState) => {
            const exists = prevState.sessions[sessionData.id];

            if (exists) {
                // Just switch to it
                return { activeSessionId: sessionData.id } as any;
            }

            const newSession: Session = {
                id: sessionData.id,
                status: 'idle', // Ready to use
                messages: [],
                statusMessages: [],
                requestStartTime: null,
                currentTurn: sessionData.currentTurn ?? 0,
                activeTurn: null,
                imageGenerationAllowed: sessionData.imageGenerationAllowed ?? true,
                selection: null,
                isPicking: false,
                group: sessionData.group ?? 0,
                pendingRefreshTurn: null
            };

            // Calculate new order
            let newOrder = [...prevState.sessionOrder];

            // Use provided sourceSessionId or try to infer from data if available (though usually not in API response)
            const sourceId = sourceSessionId || (sessionData.sourceSessionId);

            if (sourceId && sourceId !== 'system') {
                const sourceIndex = newOrder.indexOf(sourceId);
                if (sourceIndex !== -1) {
                    // Insert after source
                    newOrder.splice(sourceIndex + 1, 0, sessionData.id);
                } else {
                    newOrder.push(sessionData.id);
                }
            } else {
                newOrder.push(sessionData.id);
            }

            return {
                sessions: { ...prevState.sessions, [sessionData.id]: newSession },
                sessionOrder: newOrder,
                activeSessionId: sessionData.id,
            };
        });
    };


    cloneTurn = async (turn: number) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        try {
            const res = await fetch(
                `/api/sessions/${activeSessionId}/turns/${turn}/clone`,
                { method: 'POST' },
            );
            if (!res.ok) throw new Error('Clone turn failed');
            const session = await res.json();
            // Pass the activeSessionId as the source
            this.handleSessionCreated(session, activeSessionId);
        } catch (error) {
            console.error('Failed to clone turn', error);
        }
    };

    previewTurn = async (turn: number) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        // Optimistic update
        this.updateSession(activeSessionId, {
            activeTurn: turn,
            // status? Preview doesn't really block interaction, but maybe show loading?
            // Previous code set utilStatus='busy' then 'idle'. 
        });
    };

    updateSession(id: string, updates: Partial<Session>) {
        this.setState(prev => ({
            sessions: {
                ...prev.sessions,
                [id]: { ...prev.sessions[id], ...updates }
            }
        }));
    }

    handleUndo = async () => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        try {
            const res = await fetch(`/api/sessions/${activeSessionId}/undo`, { method: 'POST' });
            if (!res.ok) throw new Error('Undo failed');
            const data = await res.json();

            if (data.success) {
                // If there's a selection restored, update it locally immediately so UI reflects it
                if (data.restoredSelection) {
                    this.updateSession(activeSessionId, { selection: data.restoredSelection.selector });
                }

                // Fetch updated session state (history, versions, etc.)
                await this.fetchSession(activeSessionId);

                // Explicitly reset activeTurn to null (HEAD) so the UI shows the new latest turn
                // as the current active one. If we don't do this, and we were previously time-travelling
                // or just had a stale state, it might not update correctly.
                this.updateSession(activeSessionId, { activeTurn: null });

                // If we went back a turn, we might want to refresh preview?
                // `fetchSession` updates `currentTurn`. `WorkSession` detects turn change and might refresh?
                // If `activeTurn` was null (HEAD), it becomes the new HEAD turn.
                // If `activeTurn` was set, we might need to reset it or keep it?
                // Usually undo means we go back to HEAD logic.
                // Let's force a preview refresh by ensuring activeTurn aligns.

                return { restoredInput: data.restoredInput };
            }
        } catch (error) {
            console.error('Failed to undo', error);
        }
    };

    switchSession = (id: string) => {
        this.setState({ activeSessionId: id }, () => {
            this.handleSessionChange(id);
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

        // 1. Delete from server
        fetch(`/api/sessions/${id}`, { method: 'DELETE' })
            .catch(err => console.error('Failed to delete session on server', err));

        // 2. Remove from UI
        this.setState((prevState) => {
            const index = prevState.sessionOrder.indexOf(id);
            if (index === -1) return null;

            const newOrder = prevState.sessionOrder.filter((s) => s !== id);
            // Create new sessions map without the key
            const { [id]: removed, ...newSessions } = prevState.sessions;

            let newActiveId = prevState.activeSessionId;

            if (prevState.activeSessionId === id) {
                if (newOrder.length === 0) {
                    newActiveId = null;
                } else if (index > 0) {
                    newActiveId = newOrder[index - 1];
                } else {
                    newActiveId = newOrder[0];
                }
            }

            return {
                sessions: newSessions,
                sessionOrder: newOrder,
                activeSessionId: newActiveId,
                sessionToDelete: null
            };
        }, () => {
            const { activeSessionId } = this.state;
            if (activeSessionId) {
                this.handleSessionChange(activeSessionId);
            }
        });
    };

    sendMessage = async (text: string) => {
        const { activeSessionId, sessions } = this.state;
        if (!activeSessionId) return;
        const session = sessions[activeSessionId];
        if (!session) return;

        const selectionData = session.selection ? { selector: session.selection } : undefined;

        // Optimistic update
        this.updateSession(activeSessionId, {
            status: 'busy',
            messages: [
                ...session.messages,
                { role: 'user', content: text, selection: selectionData, turn: session.currentTurn + 1 }
            ],
            selection: null, // Clear selection
            activeTurn: null // Reset time travel
        });

        try {
            await fetch(`/api/sessions/${activeSessionId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    selection: selectionData,
                }),
            });
        } catch (e) {
            this.updateSession(activeSessionId, { status: 'error' });
        }
    };

    toggleImageGeneration = async (allowed: boolean) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        this.updateSession(activeSessionId, { imageGenerationAllowed: allowed });

        try {
            await fetch(`/api/sessions/${activeSessionId}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageGenerationAllowed: allowed }),
            });
        } catch (error) {
            console.error('Failed to update session settings', error);
        }
    };





    render() {
        const {
            sessions,
            sessionOrder,
            activeSessionId,
            isConnected,
            sessionToDelete
        } = this.state;


        // Derive props for SessionBar
        const statusMap: Record<string, string> = {};
        const groups: Record<string, number> = {};
        const pendingSessions: string[] = [];

        sessionOrder.forEach(id => {
            const s = sessions[id];
            if (s) {
                statusMap[id] = s.status;
                groups[id] = s.group;
                if (s.status === 'pending') pendingSessions.push(id);
            }
        });


        return (
            <div className={styles.app}>
                <ConfirmationModal
                    isOpen={!!sessionToDelete}
                    title="Close Session"
                    message="Are you sure you want to close this session? This will permanently delete the session and all its files from the server."
                    onConfirm={this.confirmDeleteSession}
                    onCancel={this.cancelDeleteSession}
                />
                <div className={styles.sessionBarWrapper}>
                    <SessionBar
                        sessions={sessionOrder}
                        activeSessionId={activeSessionId}
                        onSwitch={this.switchSession}
                        onCreate={this.createSession}
                        onRemove={this.removeSession}
                        statusMap={statusMap}
                        groups={groups}
                        pendingSessions={pendingSessions}
                        isConnected={isConnected}
                    />
                </div>

                {
                    sessionOrder.map(sessionId => {
                        const session = sessions[sessionId];
                        if (!session) return null;
                        const isVisible = sessionId === activeSessionId;

                        return (
                            <WorkSession
                                key={sessionId}
                                session={session}
                                isVisible={isVisible}
                                onSend={this.sendMessage}
                                onUpdateSession={(updates) => this.updateSession(sessionId, updates)}
                                onCloneTurn={this.cloneTurn}
                                onPreviewTurn={this.previewTurn}
                                onToggleImageGeneration={this.toggleImageGeneration}
                                onUndo={this.handleUndo}
                            />
                        );
                    })
                }
            </div>
        );
    }
}
