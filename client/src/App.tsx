import React from 'react';
import { SessionBar } from './components/SessionBar';


import { WorkSession } from './components/WorkSession';

import { SessionStore } from './store/SessionStore';
import { ConfirmationModal } from './components/ConfirmationModal';
import styles from './App.module.css';

import { ProjectCreationModal } from './components/ProjectCreationModal';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { withRouter, RouterProps } from './components/withRouter';
import { ChatAttachment, TabType, Session, Project, LlmProvider } from './types';

interface AppProps extends RouterProps { }

interface AppState {
    sessions: Record<string, Session>;
    sessionOrder: string[]; // To maintain list order
    activeSessionId: string | null;
    isConnected: boolean;
    sessionToDelete: string | null;
    // Project State
    projectId: string | null;
    projectRulesAndGoal: string;
    projectImageGenerationPref?: string;
    projectDefaultProvider?: LlmProvider;
    showProjectCreation: boolean;
    showProjectSettings: boolean;
    chatWidth: number;
    isResizing: boolean;
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
            projectId: null,
            projectRulesAndGoal: '',
            projectImageGenerationPref: '',
            projectDefaultProvider: 'openai',
            showProjectCreation: false,
            showProjectSettings: false,
            chatWidth: parseInt(localStorage.getItem('chatWidth') || '400', 10),
            isResizing: false,
        };

    }

    componentDidMount() {
        // Load Project ID
        const projectId = SessionStore.loadProjectId();

        if (projectId) {
            this.setState({ projectId }, () => {
                this.fetchProject(projectId);
            });
        } else {
            this.setState({ showProjectCreation: true });
        }

        // Setup persistent SSE connection
        this.setupSse();
    }

    fetchProject = async (projectId: string) => {
        try {
            // Fetch project details
            const res = await fetch(`/api/projects/${projectId}`);
            if (!res.ok) throw new Error('Failed to fetch project');

            // Expected response: { rulesAndGoal: string, imageGenerationPref?: string, defaultProvider?: LlmProvider, sessions: { sessionId: string; group: number }[] }
            const data: { id: string; rulesAndGoal: string; imageGenerationPref?: string; defaultProvider?: LlmProvider; sessions: { sessionId: string; group: number }[] } = await res.json();

            const sessionsMap: Record<string, Session> = {};
            const sessionOrder: string[] = [];

            data.sessions.forEach(({ sessionId, group }) => {
                sessionOrder.push(sessionId);
                sessionsMap[sessionId] = {
                    id: sessionId,
                    projectId,
                    status: 'unloaded',
                    messages: [],
                    statusMessages: [],
                    requestStartTime: null,
                    currentTurn: 0,
                    activeTurn: null,
                    activeTab: 'preview',
                    selection: null,
                    isPicking: false,
                    pendingRefreshTurn: null,
                    group: group ?? 0,
                    unsent: {},
                    provider: 'openai'
                };
            });

            this.setState({
                sessions: sessionsMap,
                sessionOrder,
                projectId,
                projectRulesAndGoal: data.rulesAndGoal || '',
                projectImageGenerationPref: data.imageGenerationPref,
                projectDefaultProvider: data.defaultProvider
            }, () => {
                const activeSessionId = this.handleInitialRouting();

                // If no sessions, create one
                if (sessionOrder.length === 0) {
                    this.createSession();
                } else if (!activeSessionId && sessionOrder.length > 0) {
                    // If routing didn't pick one (e.g. root URL), pick first
                    this.switchSession(sessionOrder[0]);
                }
            });

        } catch (e) {
            console.error('Failed to load project', e);
            // If failed (e.g. 404), maybe reset project ID?
            // For now, assume network error or valid project.
        }
    }

    handleInitialRouting = (): string | null => {
        const { searchParams } = this.props.router;
        const params = this.props.router.params as Record<string, string | undefined>;
        const sessionIdFromUrl = params['sessionId'];
        const turnFromUrl = searchParams.get('turn');
        const tabFromUrl = searchParams.get('tab') as TabType;

        let targetSessionId: string | null = null;

        // Verify URL session exists in project
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
            return targetSessionId;
        } else if (sessionIdFromUrl) {
            // URL session invalid for this project -> redirect to first if available
            // Handled by calling function
            return null;
        }
        return null;
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
            // Removed localStorage persistence for activeSessionId
            if (activeSessionId) {
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

        // Persistence removed (SessionStore.saveSessions/saveGroups deleted)
    }

    handleCreateProject = async (rulesAndGoal: string, imageGenerationPref: string, defaultProvider: LlmProvider) => {
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rulesAndGoal, imageGenerationPref, defaultProvider })
            });
            if (!res.ok) throw new Error('Failed to create project');

            const project: Project = await res.json();
            SessionStore.saveProjectId(project.id);

            this.setState({
                projectId: project.id,
                showProjectCreation: false,
                projectRulesAndGoal: project.rulesAndGoal,
                projectImageGenerationPref: project.imageGenerationPref,
                projectDefaultProvider: project.defaultProvider
            }, () => {
                // Fetch to init session list (will be empty, then createSession)
                this.fetchProject(project.id);
            });
        } catch (e) {
            console.error('Failed to create project', e);
        }
    };

    handleUpdateProject = async (rulesAndGoal: string, imageGenerationPref: string, defaultProvider: LlmProvider) => {
        const { projectId } = this.state;
        if (!projectId) return;

        try {
            const res = await fetch(`/api/projects/${projectId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rulesAndGoal, imageGenerationPref, defaultProvider })
            });
            if (!res.ok) throw new Error('Failed to update project');

            // Update local state
            this.setState({
                projectRulesAndGoal: rulesAndGoal,
                projectImageGenerationPref: imageGenerationPref,
                projectDefaultProvider: defaultProvider
            });
        } catch (e) {
            console.error('Failed to update project', e);
        }
    };

    toggleProjectSettings = () => {
        this.setState(prev => ({ showProjectSettings: !prev.showProjectSettings }));
    };

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
                    projectId: data.projectId ?? this.state.projectId ?? '',
                    status: 'idle',
                    messages: [],
                    statusMessages: [],
                    requestStartTime: null,
                    currentTurn: 0,
                    activeTurn: null,

                    activeTab: 'preview',
                    selection: null,
                    isPicking: false,
                    // provider: 'openai', // REMOVED default
                    group: data.group ?? 0,
                    pendingRefreshTurn: null,
                    unsent: {}
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

                            // If status was pending or unloaded, now it is definitively idle/ready
                            status: (session.status === 'pending' || session.status === 'unloaded') ? 'idle' : session.status,
                            // Set pendingRefreshTurn only if completion triggered this fetch
                            pendingRefreshTurn: isCompletion ? lastTurn : session.pendingRefreshTurn,
                            unsent: data.unsent || session.unsent || {},

                            // Restore unsent state if present and currently empty/default
                            selection: (data.unsent?.selection) ?? session.selection,
                            attachment: (data.unsent?.attachment) ?? session.attachment,
                            // Use server data as authority. Unsent overrides persisted.
                            provider: (data.unsent?.provider) ?? data.provider ?? 'openai',
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

            App.creatingSessionPromise = fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: this.state.projectId })
            }).then(res => res.json());
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
                projectId: sessionData.projectId ?? this.state.projectId!, // Use created/source project ID
                messages: [],
                statusMessages: [],
                requestStartTime: null,
                currentTurn: sessionData.currentTurn ?? 0,
                activeTurn: null,

                activeTab: 'preview',
                selection: null,
                isPicking: false,
                provider: sessionData.provider,
                group: sessionData.group ?? 0,
                pendingRefreshTurn: null,
                unsent: sessionData.unsent ?? {}
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
        }), () => {
            // Auto-save triggers
            if (updates.selection !== undefined) {
                // Pass null to clear if updates.selection is null/empty, otherwise value
                this.handleSaveUnsent(id, { selection: updates.selection ? updates.selection : null });
            }
        });
    }

    handleSaveUnsent = async (sessionId?: string, data?: { input?: string | null, attachment?: ChatAttachment | null, selection?: string | null, provider?: LlmProvider | null }) => {
        const targetId = sessionId || this.state.activeSessionId;
        if (!targetId || !data) return;

        // Optimistic update of unsent in state
        this.setState(prev => {
            const session = prev.sessions[targetId];
            if (!session) return null;

            // Helper to merge unsent data: if val is null, remove key. if val is undefined, keep. if val defined, update.
            const currentUnsent = { ...(session.unsent || {}) };
            if (data.input !== undefined) {
                if (data.input === null) delete currentUnsent.input;
                else currentUnsent.input = data.input;
            }
            if (data.attachment !== undefined) {
                if (data.attachment === null) delete currentUnsent.attachment;
                else currentUnsent.attachment = data.attachment;
            }
            if (data.selection !== undefined) {
                if (data.selection === null) delete currentUnsent.selection;
                else currentUnsent.selection = data.selection;
            }
            if (data.provider !== undefined) {
                if (data.provider === null) delete currentUnsent.provider;
                else currentUnsent.provider = data.provider;
            }

            return {
                sessions: {
                    ...prev.sessions,
                    [targetId]: {
                        ...session,
                        unsent: currentUnsent
                    }
                }
            };
        });

        try {
            await fetch(`/api/sessions/${targetId}/unsent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) {
            console.error('Failed to save unsent data', e);
        }
    };

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
                    this.updateSession(activeSessionId, { selection: data.restoredSelection });
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

        const optimisticContent = text;

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
            // Explicitly clear unsent data via API or handled by server?
            // Server ChatService should clear it.
            // Client state should also be cleared to reflect that.
            // But if we want to be safe, we can clear it.
            // However, ChatService handles it.
            // Wait, if we rely on ChatService clearing it, we need to know WHEN it's cleared.
            // Since we receive SSE status updates, maybe we don't need to manually clear unsent here if we fetch?
            // But to be responsive, we should clear it.
            this.setState(prev => {
                const s = prev.sessions[activeSessionId];
                return {
                    sessions: {
                        ...prev.sessions,
                        [activeSessionId]: {
                            ...s,
                            unsent: undefined
                        }
                    }
                };
            });
        } catch (e) {
            this.updateSession(activeSessionId, { status: 'error' });
        }
    };

    handleUpload = async (file: File): Promise<ChatAttachment> => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) throw new Error("No active session");

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/sessions/${activeSessionId}/uploads`, {
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

    handleDeleteAttachment = async (attachment: ChatAttachment) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        try {
            await fetch(`/api/sessions/${activeSessionId}/uploads/${attachment.filename}`, {
                method: 'DELETE'
            });

            // Clear from state
            this.updateSession(activeSessionId, { attachment: undefined });
            // Clear from unsent explicitly to ensure server sync
            this.handleSaveUnsent(activeSessionId, { attachment: null });

        } catch (error) {
            console.error('Failed to delete attachment', error);
        }
    };

    handleAttachmentChange = (attachment?: ChatAttachment) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        this.updateSession(activeSessionId, { attachment });
        this.handleSaveUnsent(activeSessionId, { attachment: attachment ?? null });
    };

    handleProviderChange = async (provider: LlmProvider) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        this.updateSession(activeSessionId, { provider });
        this.handleSaveUnsent(activeSessionId, { provider });
    };

    // Resize Handlers
    handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        this.setState({ isResizing: true });
        window.addEventListener('mousemove', this.handleResizeMove);
        window.addEventListener('mouseup', this.handleResizeEnd);
    };

    handleResizeMove = (e: MouseEvent) => {
        // Calculate new width based on mouse X relative to viewport
        // Assuming session bar is roughly fixed or we can calculate offset?
        // Session bar width is not fixed, but we can assume the grid starts after session bar?
        // Wait, session bar is top or left?
        // App.module.css says: grid-template-columns: 400px 1fr;
        // The session bar is a separate component?
        // Looking at App.tsx render: SessionBarWrapper grid-column: 1 / -1. It's properly on top/left depending on layout?
        // Wrapper says grid-column: 1 / -1.
        // App grid: rows: auto 1fr. Session bar is row 1.
        // WorkSession (Chat+Workarea) is row 2?
        // WorkSession display: contents.
        // So Chat is col 1, Workarea is col 2.

        // Mouse X is absolute.
        // If there's no sidebar to the left of Chat, then Chat width approx MouseX.
        // But let's be safer: get chat panel via ref? or just use e.clientX
        // Since the App covers the screen and Chat is the first column, X coordinate roughly equals width.
        // Constraints: min 200, max 800.

        let newWidth = e.clientX;
        if (newWidth < 250) newWidth = 250;
        if (newWidth > 800) newWidth = 800; // or window.innerWidth * 0.6

        this.setState({ chatWidth: newWidth });
    };

    handleResizeEnd = () => {
        this.setState({ isResizing: false });
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeEnd);
        localStorage.setItem('chatWidth', this.state.chatWidth.toString());
    };





    render() {
        const {
            showProjectCreation,
            showProjectSettings,
            projectId,
            projectRulesAndGoal,
            projectImageGenerationPref,
            projectDefaultProvider,
            activeSessionId,
            isConnected,
            sessionToDelete,
            sessionOrder,
            sessions
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
            <div
                className={styles.app}
                style={{
                    gridTemplateColumns: `${this.state.chatWidth}px auto 1fr`,
                    cursor: this.state.isResizing ? 'col-resize' : 'default',
                    userSelect: this.state.isResizing ? 'none' : 'auto'
                } as React.CSSProperties}
            >
                {/* Modals */}
                <ProjectCreationModal
                    isOpen={showProjectCreation}
                    onCreate={this.handleCreateProject}
                />

                {projectId && (
                    <ProjectSettingsModal
                        isOpen={showProjectSettings}
                        projectId={projectId}
                        currentRulesAndGoal={projectRulesAndGoal}
                        currentImageGenerationPref={projectImageGenerationPref}
                        currentDefaultProvider={projectDefaultProvider}
                        onUpdate={this.handleUpdateProject}
                        onClose={this.toggleProjectSettings}
                    />
                )}
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
                        onProjectSettings={this.toggleProjectSettings}
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
                                onDeleteAttachment={this.handleDeleteAttachment}
                                onAttachmentChange={this.handleAttachmentChange}
                                unsentInput={session.unsent?.input ?? undefined}
                                onSaveUnsent={(data) => this.handleSaveUnsent(sessionId, data)}

                                onResizeStart={this.handleResizeStart}
                                isResizing={this.state.isResizing}
                                sessionIds={Object.keys(sessions)}
                                onSwitchSession={this.switchSession}
                            />
                        );
                    })
                }
            </div>
        );
    }
}

export default withRouter(App);
