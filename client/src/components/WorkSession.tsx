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
    onUpload?: (file: File) => Promise<ChatAttachment>;
    onDeleteAttachment?: (attachment: ChatAttachment) => void;
    onAttachmentChange: (attachment?: ChatAttachment) => void;
    unsentInput?: string;
    onSaveUnsent?: (data: { input?: string | null }) => void;
    onResizeStart?: (e: React.MouseEvent) => void;
    isResizing?: boolean;
}

export class WorkSession extends React.Component<WorkSessionProps> {
    private picker: ElementPicker;
    private previewRef: React.RefObject<Workarea | null>;

    constructor(props: WorkSessionProps) {
        super(props);
        this.picker = new ElementPicker();
        this.picker.setOnSelect(this.handleElementSelected);
        this.previewRef = React.createRef();
    }

    getSnapshotBeforeUpdate(prevProps: WorkSessionProps) {
        // Prepare to hide: Save scroll position before display becomes none
        if (prevProps.isVisible && !this.props.isVisible) {
            this.previewRef.current?.saveScroll();
        }
        return null;
    }

    componentDidUpdate(prevProps: WorkSessionProps) {
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

        // 3. Handle Explicit Cache Refresh (e.g. on Turn completion)
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

    handleElementSelected = (selector: string) => {
        // If we were in picking mode, stop it now
        if (this.props.session.isPicking) {
            this.picker.stop();
            this.props.onUpdateSession({ isPicking: false });
        }

        // Update selection (e.g. from picking or from passive parent click)
        this.props.onUpdateSession({ selection: selector });

        // Ensure visualization is correct (especially after stop() clears it)
        this.visualizeSelection(selector);
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
            onSaveUnsent
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

        return (
            <div style={{ display: isVisible ? 'contents' : 'none' }}>
                <Chat
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
                    onUpload={onUpload}
                    onDeleteAttachment={onDeleteAttachment}
                    attachment={session.attachment}
                    onAttachmentChange={onAttachmentChange}
                    unsentInput={unsentInput}
                    onSaveUnsent={onSaveUnsent}
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
                    turn={currentTurn}
                    activeTab={session.activeTab}
                    onTabChange={(tab: any) => this.props.onUpdateSession({ activeTab: tab })}
                    onLoad={this.handlePreviewLoad}
                    isResizing={this.props.isResizing}
                />
            </div>
        );
    }
}

