import React from 'react';
import { SessionBar } from './components/SessionBar';
import { Chat } from './components/Chat';
import { Preview } from './components/Preview';
import { ElementPicker } from './lib/ElementPicker';
import styles from './App.module.css';

interface AppProps { }

interface AppState {
    sessions: string[];
    activeSessionId: string | null;
    groups: Record<string, number>;
    messages: any[];
    utilStatus: string;
    utilMessage: string | null;
    activeVersion: number | null;
    currentVersion: number;
    activeVersions: Record<string, number | null>; // Map sessionId -> activeVersion

    // UI states
    selection: string | null;
    isPicking: boolean;
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
            utilMessage: null,
            activeVersion: null,
            currentVersion: 0,
            activeVersions: {},
            selection: null,
            isPicking: false,
        };
        this.picker = new ElementPicker();
        this.previewRef = React.createRef();
    }

    componentDidMount() {
        // Load from localStorage
        try {
            const savedSessions = localStorage.getItem('sessions');
            const savedActiveId = localStorage.getItem('activeSessionId');
            const savedGroups = localStorage.getItem('sessionGroups');

            if (savedSessions) {
                const sessions = JSON.parse(savedSessions);
                const groups = savedGroups ? JSON.parse(savedGroups) : {};
                this.setState({
                    sessions,
                    groups,
                    activeSessionId: savedActiveId || null,
                });
            }
        } catch (e) {
            console.error('Failed to load from localStorage', e);
        }
    }

    componentDidUpdate(_prevProps: AppProps, prevState: AppState) {
        if (prevState.activeSessionId !== this.state.activeSessionId) {
            localStorage.setItem(
                'activeSessionId',
                this.state.activeSessionId || '',
            );
            this.handleSessionChange();
        }

        if (prevState.sessions !== this.state.sessions) {
            localStorage.setItem(
                'sessions',
                JSON.stringify(this.state.sessions),
            );
        }

        if (prevState.groups !== this.state.groups) {
            localStorage.setItem(
                'sessionGroups',
                JSON.stringify(this.state.groups),
            );
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

        // Close previous connection
        if (this.evtSource) {
            this.evtSource.close();
            this.evtSource = null;
        }

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

        // Setup SSE
        this.evtSource = new EventSource('/api/sse');

        this.evtSource.addEventListener('chat-status', (e) => {
            const data = JSON.parse(e.data);
            if (data.sessionId !== activeSessionId) return;

            if (data.status === 'started' || data.status === 'generating') {
                this.setState({
                    utilStatus: 'busy',
                    utilMessage: data.message || null,
                });
            } else if (data.status === 'completed') {
                this.setState({ utilStatus: 'idle', utilMessage: null });
                this.fetchSession(activeSessionId).then(() => {
                    // Update current version if it increased (it should have)
                    // The fetchSession call will update state.currentVersion
                    // If we are viewing a specific version, ensure we keep seeing it
                    const { activeVersion } = this.state;
                    if (activeVersion !== null) {
                        this.previewVersion(activeVersion);
                    }
                });
            } else if (data.status === 'error') {
                this.setState({
                    utilStatus: 'error',
                    utilMessage: data.message || 'Error occurred',
                });
            }
        });

        this.evtSource.addEventListener('session-created', (e) => {
            const data = JSON.parse(e.data);
            // Avoid adding duplicate if this tab created it (already in state)
            this.setState((prevState) => {
                if (prevState.sessions.includes(data.newSessionId)) return null;

                const newGroups = { ...prevState.groups };
                if (data.group) {
                    newGroups[data.newSessionId] = data.group;
                }
                return {
                    sessions: [...prevState.sessions, data.newSessionId],
                    groups: newGroups,
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
            });
        } catch (error) {
            console.error('Failed to fetch session', error);
        }
    };

    createSession = async () => {
        try {
            const res = await fetch('/api/sessions', { method: 'POST' });
            const session = await res.json();
            this.setState((prevState) => ({
                sessions: [...prevState.sessions, session.id],
                activeSessionId: session.id,
                currentVersion: session.currentVersion ?? 0,
                groups: session.group
                    ? { ...prevState.groups, [session.id]: session.group }
                    : prevState.groups,
            }));
        } catch (error) {
            console.error('Failed to create session', error);
        }
    };

    cloneSession = async () => {
        const { activeSessionId } = this.state;
        if (!activeSessionId) return;

        try {
            // Assuming API supports this endpoint from Main.js logic
            const res = await fetch(`/api/sessions/${activeSessionId}/clone`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error('Clone failed');
            const session = await res.json();
            this.setState((prevState) => ({
                sessions: [...prevState.sessions, session.id],
                activeSessionId: session.id, // Switch to new session
                currentVersion: session.currentVersion ?? 0,
                groups: session.group
                    ? { ...prevState.groups, [session.id]: session.group }
                    : prevState.groups,
            }));
        } catch (error) {
            console.error('Failed to clone session', error);
            // Fallback if clone endpoint doesn't exist yet?
            // The user implies it existed.
        }
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
            this.setState((prevState) => ({
                sessions: [...prevState.sessions, session.id],
                activeSessionId: session.id,
                currentVersion: session.currentVersion ?? 0, // Should be same as version cloned
                groups: session.group
                    ? { ...prevState.groups, [session.id]: session.group }
                    : prevState.groups,
            }));
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
        this.setState((prevState) => ({
            sessions: prevState.sessions.filter((s) => s !== id),
            activeSessionId:
                prevState.activeSessionId === id
                    ? null
                    : prevState.activeSessionId,
        }));
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
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: activeSessionId,
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

    render() {
        const {
            sessions,
            activeSessionId,
            messages,
            utilStatus,
            selection,
            isPicking,
        } = this.state;

        const statusMap: Record<string, string> = {};
        if (activeSessionId) {
            statusMap[activeSessionId] = utilStatus;
        }

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
                    />
                </div>

                <Chat
                    messages={messages}
                    onSend={this.sendMessage}
                    status={utilStatus}
                    statusMessage={this.state.utilMessage}
                    onPickElement={this.startPicking}
                    onCancelPick={this.stopPicking}
                    onCloneSession={this.cloneSession}
                    selection={selection}
                    isPicking={isPicking}
                    onClearSelection={this.clearSelection}
                    onSelectChip={this.restoreSelection}
                    onCloneVersion={this.cloneVersion}
                    activeVersion={this.state.activeVersion}
                    onPreviewVersion={this.previewVersion}
                />

                <Preview
                    ref={this.previewRef}
                    sessionId={activeSessionId}
                    version={
                        this.state.activeVersion ?? this.state.currentVersion
                    }
                />
            </div>
        );
    }
}
