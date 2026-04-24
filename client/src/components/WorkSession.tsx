
import React from 'react';
import { Chat } from './Chat';
import { Workarea } from './Workarea';
import { Session, SessionStatus } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { ElementPicker } from '../lib/ElementPicker';

interface WorkSessionProps {
    session: Session;
    isVisible: boolean;
    onUpdateSession: (updates: Partial<Session>) => void;
    onCloneTurn: (turn: number) => void;
    onPreviewTurn: (turn: number) => void;
    sessionIds: string[];
    onSwitchSession: (id: string) => void;
}

interface WorkSessionState {
    chatWidth: number;
    isResizing: boolean;
}

export class WorkSession extends React.Component<WorkSessionProps, WorkSessionState> {
    private picker: ElementPicker;
    private previewRef: React.RefObject<Workarea | null>;
    private chatRef: React.RefObject<Chat | null>;
    private hasInitialScrollHappened = false;

    constructor(props: WorkSessionProps) {
        super(props);
        this.picker = new ElementPicker();
        this.picker.setOnSelect(this.handleElementSelected);
        this.previewRef = React.createRef();
        this.chatRef = React.createRef();

        const savedWidth = localStorage.getItem('chatWidth');
        this.state = {
            chatWidth: savedWidth ? parseInt(savedWidth, 10) : 400,
            isResizing: false
        };
    }

    componentDidMount() {
        if (this.props.isVisible) {
            this.chatRef.current?.focus();
        }
    }

    getSnapshotBeforeUpdate(prevProps: WorkSessionProps) {
        // Prepare to hide: Save scroll position before display becomes none
        if (prevProps.isVisible && !this.props.isVisible) {
            this.previewRef.current?.saveScroll();
        }
        return null;
    }

    componentDidUpdate(prevProps: WorkSessionProps) {
        // 0. Handle Initial Scroll on Visibility Reveal
        if (this.props.isVisible && !this.hasInitialScrollHappened && this.chatRef.current) {
            if (this.props.session.activeTurn !== null && this.props.session.activeTurn !== undefined) {
            } else {
            }
            this.hasInitialScrollHappened = true;
        }

        // 1. Handle Session Switch (Visibility Change)
        if (prevProps.isVisible && !this.props.isVisible) {
            this.stopPicking();
        } else if (!prevProps.isVisible && this.props.isVisible) {
            this.previewRef.current?.restoreScroll();
            if (this.props.session.selection) {
                this.visualizeSelection(this.props.session.selection);
            }
            this.chatRef.current?.focus();
        } else if (this.props.isVisible) {
            const wasLoading = prevProps.session.status === SessionStatus.PENDING || prevProps.session.status === SessionStatus.UNLOADED;
            const isLoaded = this.props.session.status !== SessionStatus.PENDING && this.props.session.status !== SessionStatus.UNLOADED;
            if (wasLoading && isLoaded) {
                this.chatRef.current?.focus();
            }
        }

        // 2. Handle Turn Switch
        const prevTurn = prevProps.session.activeTurn ?? prevProps.session.lastTurn;
        const currentTurn = this.props.session.activeTurn ?? this.props.session.lastTurn;
        const turnChanged = prevTurn !== currentTurn;

        if (turnChanged) {
            this.stopPicking();
        }

        // 3. Handle Explicit Cache Refresh
        if (this.props.session.pendingRefreshTurn !== null) {
            const turnToRefresh = this.props.session.pendingRefreshTurn;
            this.previewRef.current?.clearCache(turnToRefresh);
            this.props.onUpdateSession({ pendingRefreshTurn: null });
        }

        // 4. Handle Selection Restoration
        if (this.props.session.selection && this.props.session.selection !== prevProps.session.selection) {
            const tabChanged = prevProps.session.activeTab !== this.props.session.activeTab;
            if (!turnChanged && !tabChanged) {
                this.visualizeSelection(this.props.session.selection);
            }
        }

        // 5. Handle Tab Switch Side Effects
        if (prevProps.session.activeTab !== this.props.session.activeTab) {
            if (this.props.session.activeTab !== 'preview') {
                this.stopPicking();
            } else {
                if (this.props.session.selection) {
                    this.visualizeSelection(this.props.session.selection);
                }
            }
        }
    }

    componentWillUnmount() {
        this.picker.stop();
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeEnd);
    }

    /* RESIZE LOGIC */
    handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        this.setState({ isResizing: true });
        window.addEventListener('mousemove', this.handleResizeMove);
        window.addEventListener('mouseup', this.handleResizeEnd);
    };

    handleResizeMove = (e: MouseEvent) => {
        if (!this.state.isResizing) return;
        let newWidth = e.clientX;
        if (newWidth < 250) newWidth = 250;
        if (newWidth > 800) newWidth = 800;
        this.setState({ chatWidth: newWidth });
    };

    handleResizeEnd = () => {
        this.setState({ isResizing: false });
        localStorage.setItem('chatWidth', this.state.chatWidth.toString());
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeEnd);
    };

    /* SELECTION LOGIC */
    visualizeSelection = (selector: string, scrollTo: boolean = false) => {
        const previewInstance = this.previewRef.current;
        if (!previewInstance) return;
        const iframe = previewInstance.getIframe();
        if (!iframe) return;
        this.picker.selectBySelector(iframe, selector, scrollTo);
    };

    handlePreviewLoad = () => {
        if (this.props.session.selection) {
            this.visualizeSelection(this.props.session.selection);
        }
    };

    handleElementSelected = (selector: string | null) => {
        if (this.props.session.isPicking) {
            this.picker.stop();
            this.props.onUpdateSession({ isPicking: false });
        }
        this.props.onUpdateSession({ selection: selector });
        if (selector) {
            this.visualizeSelection(selector);
        } else {
            this.picker.clearSelection();
        }
    }

    startPicking = () => {
        const previewInstance = this.previewRef.current;
        if (!previewInstance) return;
        const iframe = previewInstance.getIframe();
        if (!iframe) {
            alert('Preview not ready');
            return;
        }
        this.props.onUpdateSession({ isPicking: true });
        this.picker.start(iframe);
    };

    stopPicking = () => {
        this.picker.stop();
        this.props.onUpdateSession({ isPicking: false });
    };

    restoreSelection = (selector: string) => {
        this.visualizeSelection(selector, true);
        this.props.onUpdateSession({ selection: selector });
    };

    clearSelection = () => {
        this.picker.clearSelection();
        this.props.onUpdateSession({ selection: null });
    };

    handleProceed = () => {
        this.chatRef.current?.submit('Proceed');
    };

    render() {
        const {
            session,
            isVisible,
            onCloneTurn,
            onPreviewTurn,
            sessionIds,
            onSwitchSession
        } = this.props;

        const { chatWidth, isResizing } = this.state;

        if (session.status === SessionStatus.PENDING || session.status === SessionStatus.UNLOADED) {
            return (
                <div style={{
                    display: isVisible ? 'flex' : 'none',
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#666',
                    gridColumn: '1 / -1'
                }}>
                    <div className="loader">Loading...</div>
                    <style>{`
                        .loader {
                            border: 4px solid #f3f3f3;
                            border-top: 4px solid #3498db;
                            border-radius: 50%;
                            width: 30px;
                            height: 30px;
                            animation: spin 1s linear infinite;
                            text-indent: -9999px;
                        }
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    `}</style>
                </div>
            );
        }

        const currentTurn = session.activeTurn ?? session.lastTurn;
        const isLatest = currentTurn === session.lastTurn;

        return (
            <div
                style={{
                    display: isVisible ? 'grid' : 'none',
                    gridTemplateColumns: `${chatWidth}px auto 1fr`,
                    height: '100%',
                    overflow: 'hidden'
                }}
            >
                <Chat
                    ref={this.chatRef}
                    sessionId={session.id}
                    onUpdateSession={this.props.onUpdateSession}
                    status={session.status || SessionStatus.IDLE}
                    isVisible={isVisible}
                    onPickElement={this.startPicking}
                    onCancelPick={this.stopPicking}
                    selection={session.selection || null}
                    isPicking={session.isPicking || false}
                    onClearSelection={this.clearSelection}
                    onSelectChip={this.restoreSelection}
                    onCloneTurn={onCloneTurn}
                    activeTurn={session.activeTurn}
                    lastTurn={session.lastTurn}
                    onPreviewTurn={onPreviewTurn}
                    provider={session.provider}
                    attachment={session.attachment || undefined}
                    unsentInput={session.input ?? undefined}
                    sessionIds={sessionIds}
                    onSwitchSession={onSwitchSession}
                    fastMode={session.fastMode}
                    sessionTitle={session.subject}
                    tokenUsage={session.tokenUsage}
                />

                <ResizeHandle
                    onMouseDown={this.handleResizeStart}
                    isActive={isResizing}
                />

                <Workarea
                    ref={this.previewRef}
                    sessionId={session.id}
                    version={session.currentVersion ?? 0}
                    latestVersion={session.latestVersion ?? 0}
                    activeTab={session.activeTab}
                    onTabChange={(tab: any) => this.props.onUpdateSession({ activeTab: tab })}
                    onLoad={this.handlePreviewLoad}
                    isResizing={isResizing}
                    onProceed={this.handleProceed}
                    isBusy={session.status === SessionStatus.BUSY}
                    isLatest={isLatest}
                    displayedTurn={currentTurn}
                />
            </div>
        );
    }
}