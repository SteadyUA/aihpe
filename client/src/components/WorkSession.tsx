import React from 'react';
import { Chat } from './Chat';
import { Workarea } from './Workarea';
import { Session, LlmProvider, ChatAttachment } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { ElementPicker } from '../lib/ElementPicker';

interface WorkSessionProps {
    session: Session;
    isVisible: boolean;
    onSend: (text: string) => void;
    onUpdateSession: (updates: Partial<Session>) => void;
    onCloneTurn: (turn: number) => void;
    onPreviewTurn: (turn: number) => void;

    onProviderChange: (provider: LlmProvider) => void;
    onUndo?: () => Promise<any>;
    onStop?: () => Promise<{ restoredInput?: string } | void>;
    onUpload?: (file: File) => Promise<ChatAttachment>;
    onDeleteAttachment?: (attachment: ChatAttachment) => void;
    onAttachmentChange: (attachment?: ChatAttachment) => void;
    unsentInput?: string;
    onSaveUnsent?: (data: { input?: string | null; fastMode?: boolean }) => void;
    onResizeStart?: (e: React.MouseEvent) => void;
    isResizing?: boolean;
    sessionIds: string[];
    onSwitchSession: (id: string) => void;
}

export class WorkSession extends React.Component<WorkSessionProps> {
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
    }

    componentDidMount() {
        if (this.props.isVisible) {
            this.chatRef.current?.focus();
        }
    }

    getVersionForTurn = (turn: number): number => {
        const { session } = this.props;
        // Look backwards from the end of history to find the first message with a version <= turn
        // Just like the server does
        const relevantHistory = session.messages.filter(m => m.turn <= turn);
        if (relevantHistory.length === 0) return 0;

        for (let i = relevantHistory.length - 1; i >= 0; i--) {
            const msg = relevantHistory[i];
            if (typeof msg.version === 'number') {
                return msg.version;
            }
        }
        return 0;
    };

    getSnapshotBeforeUpdate(prevProps: WorkSessionProps) {
        // Prepare to hide: Save scroll position before display becomes none
        if (prevProps.isVisible && !this.props.isVisible) {
            this.previewRef.current?.saveScroll();
        }
        return null;
    }

    componentDidUpdate(prevProps: WorkSessionProps) {
        // 0. Handle Initial Scroll on Visibility Reveal (For background loaded sessions)
        if (this.props.isVisible && !this.hasInitialScrollHappened && this.chatRef.current) {
            // If we have an active turn, scroll to it, otherwise bottom
            if (this.props.session.activeTurn !== null && this.props.session.activeTurn !== undefined) {
                this.chatRef.current.scrollToTurn(this.props.session.activeTurn);
            } else {
                this.chatRef.current.scrollToBottom();
            }
            this.hasInitialScrollHappened = true;
        }

        // 1. Handle Session Switch (Visibility Change)
        if (prevProps.isVisible && !this.props.isVisible) {
            this.stopPicking();
        } else if (!prevProps.isVisible && this.props.isVisible) {
            // Became visible -> restore scroll & selection
            this.previewRef.current?.restoreScroll();

            if (this.props.session.selection) {
                // We interpret visibility change as "show existing iframe", so we try to restore immediately.
                // If the iframe reloads upon becoming visible, onLoad will also fire, which is fine (redundant but harmless).
                this.visualizeSelection(this.props.session.selection);
            }
            this.chatRef.current?.focus();
        } else if (this.props.isVisible) {
            // If already visible, check if it just finished loading
            const wasLoading = prevProps.session.status === 'pending' || prevProps.session.status === 'unloaded';
            const isLoaded = this.props.session.status !== 'pending' && this.props.session.status !== 'unloaded';
            if (wasLoading && isLoaded) {
                this.chatRef.current?.focus();
            }
        } else if (prevProps.isVisible && this.props.isVisible && this.props.session.selection && !prevProps.session.selection) {
            // Just selection added while visible? (Handled in step 4 usually, but original code had a check here?)
            // Original: } else if (!prevProps.isVisible && this.props.isVisible && this.props.session.selection) {
            // My change above covered the "became visible" part. 
            // The original code mixed visibility and selection check.
        }

        // 2. Handle Turn Switch
        const prevTurn = prevProps.session.activeTurn ?? prevProps.session.currentTurn;
        const currentTurn = this.props.session.activeTurn ?? this.props.session.currentTurn;
        const turnChanged = prevTurn !== currentTurn;

        if (turnChanged) {
            this.stopPicking();
        }

        // 3. Handle Explicit Cache Refresh (e.g. on Turn completion or File Change)
        if (this.props.session.pendingRefreshTurn !== null) {
            const turnToRefresh = this.props.session.pendingRefreshTurn;
            // Clear cache for this turn
            this.previewRef.current?.clearCache(turnToRefresh);
            // Acknowledge event by clearing the flag in session state
            this.props.onUpdateSession({ pendingRefreshTurn: null });
        }

        // 4. Handle Selection Restoration (e.g. after Undo or Picking)
        if (this.props.session.selection && this.props.session.selection !== prevProps.session.selection) {
            // If selection changed WITHOUT a turn change or tab change, we must update manually.
            // If turn/tab changed, the iframe will reload and trigger onLoad, so we don't need to do anything here.
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
                // Switching TO preview. The iframe is preserved (hidden), so onLoad won't fire.
                // We must manually restore the selection overlay.
                if (this.props.session.selection) {
                    this.visualizeSelection(this.props.session.selection);
                }
            }
        }
    }

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

    componentWillUnmount() {
        this.picker.stop();
    }

    handleElementSelected = (selector: string | null) => {
        // If we were in picking mode, stop it now
        if (this.props.session.isPicking) {
            this.picker.stop();
            this.props.onUpdateSession({ isPicking: false });
        }

        // Update selection (e.g. from picking or from passive parent click)
        this.props.onUpdateSession({ selection: selector });

        // Ensure visualization is correct
        if (selector) {
            this.visualizeSelection(selector);
        } else {
            // If cleared (selector is null), we don't need to call visualizeSelection(null) 
            // because clearSelection() in picker handles it, or picker is already stopped/cleared.
            // But if we want to be safe or if clearing came from outside, we can force clear:
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
            onSend,
            onCloneTurn,
            onPreviewTurn,

            onProviderChange,
            onUndo,
            onUpload,
            onDeleteAttachment,
            onAttachmentChange,
            unsentInput,
            onSaveUnsent,
            sessionIds,
            onSwitchSession
        } = this.props;

        if (session.status === 'pending' || session.status === 'unloaded') {
            return (
                <div style={{
                    display: isVisible ? 'flex' : 'none',
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#666',
                    gridColumn: '1 / -1' // Span all columns to center in the full view
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

        // Calculate current turn for Preview
        const currentTurn = session.activeTurn ?? session.currentTurn;
        // Check if we are at the latest turn
        const isLatest = (session.activeTurn === undefined || session.activeTurn === null || session.activeTurn === session.currentTurn);

        return (
            <div style={{ display: isVisible ? 'contents' : 'none' }}>
                <Chat
                    ref={this.chatRef}
                    sessionId={session.id}
                    messages={session.messages || []}
                    onSend={onSend}
                    status={session.status || 'idle'}
                    statusMessages={session.statusMessages || []}
                    startTime={session.requestStartTime}
                    onPickElement={this.startPicking}
                    onCancelPick={this.stopPicking}
                    selection={session.selection || null}
                    isPicking={session.isPicking || false}
                    onClearSelection={this.clearSelection}
                    onSelectChip={this.restoreSelection}
                    onCloneTurn={onCloneTurn}
                    activeTurn={session.activeTurn}
                    onPreviewTurn={onPreviewTurn}

                    provider={session.provider}
                    onProviderChange={onProviderChange}
                    onUndo={onUndo}
                    onStop={this.props.onStop}
                    onUpload={onUpload}
                    onDeleteAttachment={onDeleteAttachment}
                    attachment={session.attachment}
                    onAttachmentChange={onAttachmentChange}
                    unsentInput={unsentInput}
                    onSaveUnsent={onSaveUnsent}
                    sessionIds={sessionIds}
                    onSwitchSession={onSwitchSession}
                    fastMode={session.unsent?.fastMode ?? session.fastMode}
                    onFastModeChange={(val) => onSaveUnsent?.({ fastMode: val })}
                    sessionTitle={session.subject}
                    tokenUsage={session.tokenUsage}
                />

                {this.props.onResizeStart && (
                    <ResizeHandle
                        onMouseDown={this.props.onResizeStart}
                        isActive={this.props.isResizing}
                    />
                )}

                <Workarea
                    ref={this.previewRef}
                    sessionId={session.id}
                    version={this.getVersionForTurn(currentTurn)}
                    activeTab={session.activeTab}
                    onTabChange={(tab: any) => this.props.onUpdateSession({ activeTab: tab })}
                    onLoad={this.handlePreviewLoad}
                    isResizing={this.props.isResizing}
                    onProceed={this.handleProceed}
                    isBusy={session.status === 'busy'}
                    isLatest={isLatest}
                    displayedTurn={currentTurn}
                    fastMode={session.unsent?.fastMode ?? session.fastMode}
                />
            </div>
        );
    }
}