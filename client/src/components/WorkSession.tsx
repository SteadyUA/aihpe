import React from 'react';
import { Chat } from './Chat';
import { Preview } from './Preview';
import { Session } from '../types';
import { ElementPicker } from '../lib/ElementPicker';

interface WorkSessionProps {
    session: Session;
    isVisible: boolean;
    onSend: (text: string) => void;
    onUpdateSession: (updates: Partial<Session>) => void;
    onCloneTurn: (turn: number) => void;
    onPreviewTurn: (turn: number) => void;
    onToggleImageGeneration: (allowed: boolean) => void;
    onUndo?: () => Promise<any>;
}

export class WorkSession extends React.Component<WorkSessionProps> {
    private picker: ElementPicker;
    private previewRef: React.RefObject<Preview | null>;

    constructor(props: WorkSessionProps) {
        super(props);
        this.picker = new ElementPicker();
        this.previewRef = React.createRef();
    }

    componentDidUpdate(prevProps: WorkSessionProps) {
        // 1. Handle Session Switch (Visibility Change)
        if (prevProps.isVisible && !this.props.isVisible) {
            this.stopPicking();
        } else if (!prevProps.isVisible && this.props.isVisible && this.props.session.selection) {
            // Became visible -> restore selection
            const selector = this.props.session.selection;
            setTimeout(() => {
                this.visualizeSelection(selector);
            }, 100);
        }

        // 2. Handle Turn Switch
        const prevTurn = prevProps.session.activeTurn ?? prevProps.session.currentTurn;
        const currentTurn = this.props.session.activeTurn ?? this.props.session.currentTurn;

        if (prevTurn !== currentTurn) {
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

        // 4. Handle Selection Restoration (e.g. after Undo)
        if (this.props.session.selection && this.props.session.selection !== prevProps.session.selection) {
            // We need to wait for iframe to be ready/rendered if turn also changed?
            // But usually preview is persistent.
            // We use a small timeout to let the iframe settle if it was reloading? 
            // Or just call selection restoration logic.
            // We can reuse `restoreSelection` logic but without updating session (since it's already updated).
            // Actually `restoreSelection` updates session. We just want to visualize it.
            const selector = this.props.session.selection;
            // Use timeout to ensure DOM is ready if it's a new turn
            setTimeout(() => {
                this.visualizeSelection(selector);
            }, 500);
        }
    }

    visualizeSelection = (selector: string) => {
        const previewInstance = this.previewRef.current;
        if (!previewInstance) return;
        const iframe = previewInstance.getIframe();
        if (!iframe) return;

        this.picker.selectBySelector(iframe, selector);
    };

    handlePreviewTabChange = (tab: any) => {
        // 3. Handle Preview Tab Switch
        if (tab !== 'preview') {
            this.stopPicking();
        } else if (this.props.session.selection) {
            // Restore selection if returning to preview
            const selector = this.props.session.selection;
            setTimeout(() => {
                this.visualizeSelection(selector);
            }, 100);
        }
    };

    componentWillUnmount() {
        this.picker.stop();
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

        this.picker.start(iframe, (selector) => {
            this.props.onUpdateSession({ selection: selector, isPicking: false });
        });
    };

    stopPicking = () => {
        this.picker.stop();
        this.props.onUpdateSession({ isPicking: false });
    };

    restoreSelection = (selector: string) => {
        this.visualizeSelection(selector);
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
            onToggleImageGeneration,
            onUndo
        } = this.props;

        if (session.status === 'pending') {
            return (
                <div style={{
                    display: isVisible ? 'flex' : 'none',
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#666'
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
                    imageGenerationAllowed={session.imageGenerationAllowed ?? true}
                    onToggleImageGeneration={onToggleImageGeneration}
                    onUndo={onUndo}
                />

                <Preview
                    ref={this.previewRef}
                    sessionId={session.id}
                    turn={currentTurn}
                    onTabChange={this.handlePreviewTabChange}
                />
            </div>
        );
    }
}

