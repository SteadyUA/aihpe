import React from 'react';
import { SessionBar } from './components/SessionBar';


import { WorkSession } from './components/WorkSession';

import { SessionStore } from './store/SessionStore';
import { ConfirmationModal } from './components/ConfirmationModal';
import styles from './App.module.css';

import { withRouter, RouterProps } from './components/withRouter';
import { Session, TabType, LlmProvider, ChatAttachment } from './types';

interface AppProps extends RouterProps { }

interface AppState {
    sessions: Record<string, Session>;
    sessionOrder: string[]; // To maintain list order
    activeSessionId: string | null;
    isConnected: boolean;
    sessionToDelete: string | null;
}

class App extends React.Component<AppProps, AppState> {
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
                        status: 'unloaded',
                        messages: [],
                        statusMessages: [],
                        requestStartTime: null,
                        currentTurn: 0,
                        activeTurn: null,

                        activeTab: 'preview',
                        selection: null,
                        provider: 'openai', // Default to openai locally until fetched? Or just optional
                        isPicking: false,
                        pendingRefreshTurn: null,
                        group: groups[id] ?? 0 // Default to 0 if missing from store
                    };
                });

                this.setState({
                    sessions: sessionsMap,
                    sessionOrder: sessionIds,
                    activeSessionId, // Will be overridden by URL if present
                }, () => {
                    this.handleInitialRouting();
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

    handleInitialRouting = () => {
        const { searchParams } = this.props.router;
        const params = this.props.router.params as Record<string, string | undefined>;
        const sessionIdFromUrl = params['sessionId'];
        const turnFromUrl = searchParams.get('turn');
        const tabFromUrl = searchParams.get('tab') as TabType;

        let targetSessionId = sessionIdFromUrl || this.state.activeSessionId;

        // If URL has session ID, use it. If not, rely on state (loaded from store) or default.
        if (sessionIdFromUrl && this.state.sessions[sessionIdFromUrl]) {
            targetSessionId = sessionIdFromUrl;
        }

        if (targetSessionId) {
            // Apply URL params to the session state immediately
            if (this.state.sessions[targetSessionId]) {
                const updates: Partial<Session> = {};
                if (turnFromUrl) updates.activeTurn = parseInt(turnFromUrl, 10);
                if (tabFromUrl) updates.activeTab = tabFromUrl;

                if (Object.keys(updates).length > 0) {
                    this.updateSession(targetSessionId, updates);
                }
            }

            // Set active and fetch
            this.setState({ activeSessionId: targetSessionId }, () => {
                this.handleSessionChange(targetSessionId);
            });
        }
    }

    componentDidUpdate(prevProps: AppProps, prevState: AppState) {
        const { activeSessionId, sessions } = this.state;
        const { router } = this.props;

        // 1. Handle URL Changes (Back/Forward) => Sync to State
        if (prevProps.router.location !== router.location) {
            const params = router.params as Record<string, string | undefined>;
            const newSessionId = params['sessionId'];
            const newTurn = router.searchParams.get('turn');
            const newTab = router.searchParams.get('tab') as TabType;

            // Session change via URL
            if (newSessionId && newSessionId !== activeSessionId && sessions[newSessionId]) {
                this.setState({ activeSessionId: newSessionId });
            }

            // Turn/Tab change via URL for current session
            if (activeSessionId && sessions[activeSessionId]) {
                const session = sessions[activeSessionId];
                const cleanTurn = newTurn ? parseInt(newTurn, 10) : null;
                const cleanTab = newTab || 'preview';

                if (session.activeTurn !== cleanTurn || session.activeTab !== cleanTab) {
                    this.updateSession(activeSessionId, {
                        activeTurn: cleanTurn,
                        activeTab: cleanTab
                    });
                }
            }
        }

        // 2. Handle State Changes => Sync to URL
        // Active Session changed
        if (prevState.activeSessionId !== activeSessionId) {
            SessionStore.saveActiveSessionId(activeSessionId);
            if (activeSessionId) {
                // If we switched session, we want to replace the URL entirely to match that session's state
                // However, we might just want to push new session ID and keep default query params?
                // Or restore query params if we store them in session state?
                // The implementation plan says sync state -> URL.
                // If I click a session, activeSessionId changes.
                // I should navigate to `/session/${activeSessionId}` + params from that session state.
                const session = sessions[activeSessionId];
                if (session) {
                    this.handleSessionChange(activeSessionId);

                    // Only navigate if URL doesn't match (avoid double nav)
                    const params = router.params as Record<string, string | undefined>;
                    if (params['sessionId'] !== activeSessionId) {
                        this.updateUrl(activeSessionId, session.activeTurn, session.activeTab);
                    }
                }
            }
        }

        // Session State (Turn/Tab) changed
        if (activeSessionId && sessions[activeSessionId]) {
            const prevSession = prevState.sessions[activeSessionId];
            const currSession = sessions[activeSessionId];

            if (prevSession && (prevSession.activeTurn !== currSession.activeTurn || prevSession.activeTab !== currSession.activeTab)) {
                this.updateUrl(activeSessionId, currSession.activeTurn, currSession.activeTab);
            }
        }

        // Persistence
        if (prevState.sessionOrder !== this.state.sessionOrder) {
            SessionStore.saveSessions(this.state.sessionOrder);
            if (this.state.sessionOrder.length === 0 && prevState.sessionOrder.length > 0) {
                this.createSession();
            }
        }

        const prevGroups = this.extractGroups(prevState.sessions);
        const currGroups = this.extractGroups(this.state.sessions);
        if (JSON.stringify(prevGroups) !== JSON.stringify(currGroups)) {
            SessionStore.saveGroups(currGroups);
        }
    }

    updateUrl = (sessionId: string, turn: number | null, tab: TabType) => {
        const params = new URLSearchParams();
        if (turn !== null) params.set('turn', turn.toString());
        if (tab && tab !== 'preview') params.set('tab', tab); // Default tab is preview, unnecessary to show

        // Use replace if just tab changed? Use push if session changed?
        // Let's use navigate.
        const path = `/session/${sessionId}`;
        const search = params.toString() ? `?${params.toString()}` : '';

        // Check if we need to update to avoid redundant pushes
        const currentPath = this.props.router.location.pathname;
        const currentSearch = this.props.router.location.search;

        if (currentPath !== path || currentSearch !== search) {
            this.props.router.navigate(`${path}${search}`);
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

                    activeTab: 'preview',
                    selection: null,
                    isPicking: false,
                    provider: 'openai',
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

            // Fetch history is now included in the main session endpoint
            // New API always returns full history, no version needed
            const history = data.history || [];
            // Use currentTurn directly from API
            const lastTurn = data.currentTurn ?? 0;

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
                            provider: data.provider ?? 'openai',
                            // If status was pending or unloaded, now it is definitively idle/ready
                            status: (session.status === 'pending' || session.status === 'unloaded') ? 'idle' : session.status,
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

                activeTab: 'preview',
                selection: null,
                isPicking: false,
                provider: sessionData.provider ?? 'openai',
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
            // handleSessionChange call is now redundant here if we rely on componentDidUpdate/URL sync
            // But for immediate response we can keep it, or just let the URL update trigger it.
            // Let's let the URL update trigger clean routing.
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

        const attachment = session.attachment;

        const selectionData = session.selection ? { selector: session.selection } : undefined;

        let optimisticContent = text;
        if (attachment) {
            optimisticContent += '\n\n' + `[Вложение: image ${attachment.originalName || attachment.filename}]`;
        }

        // Optimistic update
        this.updateSession(activeSessionId, {
            status: 'busy',
            messages: [
                ...session.messages,
                {
                    role: 'user',
                    content: optimisticContent,
                    selection: selectionData,
                    turn: session.currentTurn + 1,
                    attachment: attachment, // Include attachment for immediate rendering
                    createdAt: new Date().toISOString() // Include timestamp
                }
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
                    attachment,
                    selection: selectionData,
                    provider: session.provider,
                }),
            });
            this.updateSession(activeSessionId, { attachment: undefined }); // Clear attachment
        } catch (e) {
            this.updateSession(activeSessionId, { status: 'error' });
        }
    };

    handleUpload = async (file: File): Promise<ChatAttachment> => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) throw new Error("No active session");

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/sessions/${activeSessionId}/images`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error('Upload failed');
        }

        const data = await res.json();
        return {
            type: 'image',
            filename: data.filename,
            url: data.url,
            id: data.filename,
            originalName: data.originalName
        };
    };

    handleAttachmentChange = (attachment?: ChatAttachment) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        this.updateSession(activeSessionId, { attachment });
    };

    handleProviderChange = async (provider: LlmProvider) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        this.updateSession(activeSessionId, { provider });
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

                                onProviderChange={this.handleProviderChange}
                                onUndo={this.handleUndo}
                                onUpload={this.handleUpload}
                                onAttachmentChange={this.handleAttachmentChange}
                            />
                        );
                    })
                }
            </div>
        );
    }
}

export default withRouter(App);
