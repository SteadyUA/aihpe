import React from 'react';
import { SessionBar } from './components/SessionBar';
import { Chat } from './components/Chat';
import { Preview } from './components/Preview';
import { ElementPicker } from './lib/ElementPicker';
import { SessionStore } from './store/SessionStore';
import styles from './App.module.css';

interface AppProps { }

interface AppState {
    sessions: string[];
    activeSessionId: string | null;
    groups: Record<string, number>;
    messages: any[];
    utilStatus: string;
    utilMessages: string[];
    requestStartTime: number | null;
    utilMessage: string | null; // Keep for backward compatibility or simple status? Maybe remove if Chat handles list.
    // Actually Chat needs string[] now. But App checks utilMessage != null?
    // Let's keep utilMessage as null, and add utilMessages.
    // Or just rename. Let's rename to avoid confusion.
    // But other components might use it. Chat uses statusMessage.
    // Let's replace utilMessage with utilMessages in state and pass the list.
    activeVersion: number | null;
    currentVersion: number;
    imageGenerationAllowed: boolean;
    activeVersions: Record<string, number | null>; // Map sessionId -> activeVersion

    // UI states
    selection: string | null;
    isPicking: boolean;
    pendingSessions: string[];
    isConnected: boolean;
}

export default class App extends React.Component<AppProps, AppState> {
    private evtSource: EventSource | null = null;
    private picker: ElementPicker;
    private previewRef: React.RefObject<Preview | null>;

    constructor(props: AppProps) {
        super(props);
        this.state = {
            sessions: [],
            activeSessionId: null,
            groups: {},
            messages: [],
            utilStatus: 'idle',
            utilMessages: [],
            requestStartTime: null,
            utilMessage: null,
            activeVersion: null,
            currentVersion: 0,
            imageGenerationAllowed: true,
            activeVersions: {},

            selection: null,
            isPicking: false,
            pendingSessions: [],
            isConnected: false,
        };
        this.picker = new ElementPicker();
        this.previewRef = React.createRef();
    }

    componentDidMount() {
        // Load from SessionStore
        try {
            const sessions = SessionStore.loadSessions();
            const activeSessionId = SessionStore.loadActiveSessionId();
            const groups = SessionStore.loadGroups();

            if (sessions.length > 0) {
                this.setState({
                    sessions,
                    groups,
                    activeSessionId,
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
            this.handleSessionChange();
        }

        if (prevState.sessions !== this.state.sessions) {
            SessionStore.saveSessions(this.state.sessions);

            // Auto-create if all sessions were removed
            if (this.state.sessions.length === 0 && prevState.sessions.length > 0) {
                this.createSession();
            }
        }

        if (prevState.groups !== this.state.groups) {
            SessionStore.saveGroups(this.state.groups);
        }
    }

    componentWillUnmount() {
        if (this.evtSource) {
            this.evtSource.close();
        }
        this.picker.stop();
    }

    handleSessionChange = () => {
        const { activeSessionId } = this.state;

        if (!activeSessionId) {
            this.setState({
                messages: [],
                utilStatus: 'idle',
                utilMessage: null,
                selection: null,
                isPicking: false,
            });
            return;
        }

        // Fetch session data
        this.fetchSession(activeSessionId).then(() => {
            // If there is an active version restored, load ITS files instead of the latest
            const { activeVersion } = this.state;
            if (activeVersion !== null) {
                this.previewVersion(activeVersion);
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
            const { activeSessionId } = this.state;

            // Only handle status updates for the active session
            if (data.sessionId !== activeSessionId) return;

            if (data.status === 'started') {
                this.setState({
                    utilStatus: 'busy',
                    utilMessages: [data.message || 'Thinking...'],
                    requestStartTime: Date.now(),
                });
            } else if (data.status === 'generating') {
                // Append new status message if it's not effectively empty
                if (data.message) {
                    this.setState(prev => ({
                        utilMessages: [...prev.utilMessages, data.message]
                    }));
                }
            } else if (data.status === 'completed') {
                this.setState({
                    utilStatus: 'idle',
                    // Clear start time? Or keep it to show "Took X seconds"?
                    // User requirement implies showing duration while waiting. 
                    // Completed means we are done. 
                    requestStartTime: null
                });
                if (activeSessionId) {
                    this.fetchSession(activeSessionId).then(() => {
                        const { activeVersion } = this.state;
                        if (activeVersion !== null) {
                            this.previewVersion(activeVersion);
                        }
                    });
                }
            } else if (data.status === 'error') {
                this.setState({
                    utilStatus: 'error',
                    utilMessages: [...this.state.utilMessages, data.message || 'Error occurred'],
                    requestStartTime: null,
                });
            }
        });

        this.evtSource.addEventListener('session-created', (e) => {
            const data = JSON.parse(e.data);
            // Avoid adding duplicate if this tab created it (already in state)
            this.setState((prevState) => {
                if (prevState.sessions.includes(data.newSessionId)) {
                    // Even if in sessions, we might need to clear pending status
                    return {
                        sessions: prevState.sessions,
                        groups: prevState.groups,
                        pendingSessions: prevState.pendingSessions.filter(id => id !== data.newSessionId),
                    };
                }

                const newGroups = { ...prevState.groups };
                if (data.group) {
                    newGroups[data.newSessionId] = data.group;
                }
                return {
                    sessions: [...prevState.sessions, data.newSessionId],
                    groups: newGroups,
                    pendingSessions: prevState.pendingSessions.filter(id => id !== data.newSessionId),
                };
            });
        });
    };

    fetchSession = async (id: string) => {
        try {
            const res = await fetch(`/api/sessions/${id}`);
            const data = await res.json();
            this.setState({
                messages: data.history || [],
                currentVersion: data.currentVersion ?? 0,
                imageGenerationAllowed: data.imageGenerationAllowed ?? true,
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
                // If this instance is still mounted (or rather, just run the update), try to update state
                // Note: If multiple instances await, they all get the same session.
                // We should check if we already have it?
                // Actually, just proceeding to setState is fine. React handles dedup if strictly same?
                // But here we are pushing to array.
                // We need to avoid adding it twice if this function runs twice on the SAME instance?
                // But here the issue is TWO instances calls it.
                // If instance 1 calls it, makes promise.
                // Instance 2 calls it, awaits promise.
                // Promise resolves.
                // Instance 1 updates state (warns if unmounted).
                // Instance 2 updates state (works).
                // Result: 1 session in state. Correct.
                this.handleSessionCreated(session);
                return;
            } catch (e) {
                // If failed, maybe try again?
                App.creatingSessionPromise = null;
            }
        }

        try {
            App.creatingSessionPromise = fetch('/api/sessions', { method: 'POST' }).then(res => res.json());
            const session = await App.creatingSessionPromise;
            // Clear promise so future calls (e.g. user manually creating) make new ones
            App.creatingSessionPromise = null;

            this.handleSessionCreated(session);
        } catch (error) {
            console.error('Failed to create session', error);
            App.creatingSessionPromise = null;
        }
    };

    handleSessionCreated = (session: any) => {
        this.setState((prevState) => {
            // Even if it exists (e.g. from SSE), we should switch to it if this was a user action
            const exists = prevState.sessions.includes(session.id);
            if (exists) {
                return {
                    activeSessionId: session.id,
                } as any;
            }

            return {
                sessions: [...prevState.sessions, session.id],
                // Auto-activate immediately (it will show loader because it is pending)
                activeSessionId: session.id,
                currentVersion: session.currentVersion ?? 0,
                imageGenerationAllowed: session.imageGenerationAllowed ?? true,
                groups: session.group !== undefined
                    ? { ...prevState.groups, [session.id]: session.group }
                    : prevState.groups,
                pendingSessions: [...prevState.pendingSessions, session.id],
            };
        });
    };


    cloneVersion = async (version: number) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        try {
            const res = await fetch(
                `/api/sessions/${activeSessionId}/versions/${version}/clone`,
                { method: 'POST' },
            );
            if (!res.ok) throw new Error('Clone version failed');
            const session = await res.json();
            this.handleSessionCreated(session);
        } catch (error) {
            console.error('Failed to clone version', error);
        }
    };

    previewVersion = async (version: number) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        // If clicking same version, maybe toggle off? Or just reload.
        // For now, let's load it.

        try {
            this.setState((prevState) => ({
                activeVersion: version,
                utilStatus: 'busy',
                activeVersions: {
                    ...prevState.activeVersions,
                    [activeSessionId]: version,
                },
            }));

            this.setState({
                utilStatus: 'idle',
            });
        } catch (error) {
            console.error('Failed to preview version', error);
            this.setState({ utilStatus: 'error' });
        }
    };

    switchSession = (id: string) => {
        const nextVersion = this.state.activeVersions[id] ?? null;
        this.setState({ activeSessionId: id, activeVersion: nextVersion });
    };

    removeSession = (id: string) => {
        this.setState((prevState) => {
            const index = prevState.sessions.indexOf(id);
            if (index === -1) return null;

            const newSessions = prevState.sessions.filter((s) => s !== id);
            let newActiveId = prevState.activeSessionId;

            if (prevState.activeSessionId === id) {
                if (newSessions.length === 0) {
                    newActiveId = null;
                } else if (index > 0) {
                    // Activate left neighbor (which is at index-1 in newSessions because 
                    // the removed element was at 'index', so 0..index-1 are same)
                    // Wait, if we remove 'index', elements 0 to index-1 are unchanged.
                    // So newSessions[index-1] is the correct left neighbor.
                    // Example: [A, B, C], remove B (1). new: [A, C]. index-1=0 -> A. Correct.
                    newActiveId = newSessions[index - 1];
                } else {
                    // Was first element, activate new first (original second)
                    newActiveId = newSessions[0];
                }
            }

            return {
                sessions: newSessions,
                activeSessionId: newActiveId,
            };
        });
    };

    sendMessage = async (text: string) => {
        const { activeSessionId, selection } = this.state;
        if (!activeSessionId) return;

        // selection object to send
        const selectionData = selection ? { selector: selection } : undefined;

        this.setState((prevState) => ({
            utilStatus: 'busy',
            messages: [
                ...prevState.messages,
                { role: 'user', content: text, selection: selectionData },
            ],
            selection: null, // Clear selection after sending
            activeVersion: null, // Reset to follow latest
            activeVersions: {
                ...prevState.activeVersions,
                [activeSessionId]: null,
            },
        }));

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
            this.setState({ utilStatus: 'error' });
        }
    };

    startPicking = () => {
        const previewInstance = this.previewRef.current;
        if (!previewInstance) return;

        const iframe = previewInstance.getIframe();
        if (!iframe) {
            alert('Preview not ready');
            return;
        }

        this.setState({ isPicking: true });
        this.picker.start(iframe, (selector) => {
            this.setState({ selection: selector, isPicking: false });
        });
    };

    stopPicking = () => {
        this.picker.stop();
        this.setState({ isPicking: false });
    };

    restoreSelection = (selector: string) => {
        const previewInstance = this.previewRef.current;
        if (!previewInstance) return;
        const iframe = previewInstance.getIframe();
        if (!iframe) {
            alert('Preview not ready');
            return;
        }

        this.picker.selectBySelector(iframe, selector);
        this.setState({ selection: selector });
    };

    clearSelection = () => {
        this.picker.clearSelection();
        this.setState({ selection: null });
    };

    toggleImageGeneration = async (allowed: boolean) => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        // Optimistic update
        this.setState({ imageGenerationAllowed: allowed });

        try {
            await fetch(`/api/sessions/${activeSessionId}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageGenerationAllowed: allowed }),
            });
        } catch (error) {
            console.error('Failed to update session settings', error);
            // Revert on failure? 
            // For now, let's assume it works or next fetch corrects it.
        }
    };

    render() {
        const {
            sessions,
            activeSessionId,
            messages,
            utilStatus,
            selection,
            isPicking,
            pendingSessions,
        } = this.state;

        const isPending = activeSessionId ? pendingSessions.includes(activeSessionId) : false;

        const statusMap: Record<string, string> = {};
        if (activeSessionId) {
            statusMap[activeSessionId] = utilStatus;
        }

        const currentVersion = this.state.activeVersion ?? this.state.currentVersion;
        const nextVersionMsg = this.state.messages.find(
            (m) =>
                typeof m.version === 'number' && m.version > currentVersion,
        );
        // If there is a message with a higher version, use its date as cutoff.
        // Otherwise (we are at latest or no newer version exists), pass null/undefined to show all.
        const maxDate = nextVersionMsg ? nextVersionMsg.createdAt : undefined;

        return (
            <div className={styles.app}>
                <div className={styles.sessionBarWrapper}>
                    <SessionBar
                        sessions={sessions}
                        activeSessionId={this.state.activeSessionId}
                        onSwitch={this.switchSession}
                        onCreate={this.createSession}
                        onRemove={this.removeSession}
                        statusMap={Object.fromEntries(
                            this.state.sessions.map((id) => [
                                id,
                                id === this.state.activeSessionId
                                    ? this.state.utilStatus
                                    : 'idle',
                            ]),
                        )}
                        groups={this.state.groups}
                        pendingSessions={this.state.pendingSessions}
                        isConnected={this.state.isConnected}
                    />
                </div>



                {
                    isPending ? (
                        <div className={styles.mainLoader}>
                            <div className={styles.spinner}></div>
                            <div>Creating session...</div>
                        </div>
                    ) : (
                        <>
                            <Chat
                                messages={messages}
                                onSend={this.sendMessage}
                                status={utilStatus}
                                statusMessages={this.state.utilMessages}
                                startTime={this.state.requestStartTime}
                                onPickElement={this.startPicking}
                                onCancelPick={this.stopPicking}
                                selection={selection}
                                isPicking={isPicking}
                                onClearSelection={this.clearSelection}
                                onSelectChip={this.restoreSelection}
                                onCloneVersion={this.cloneVersion}
                                activeVersion={this.state.activeVersion}
                                onPreviewVersion={this.previewVersion}
                                disabled={!activeSessionId}
                                imageGenerationAllowed={this.state.imageGenerationAllowed}
                                onToggleImageGeneration={this.toggleImageGeneration}
                            />

                            <Preview
                                ref={this.previewRef}
                                sessionId={activeSessionId}
                                version={currentVersion}
                                maxDate={maxDate}
                            />
                        </>
                    )
                }
            </div>
        );
    }
}
