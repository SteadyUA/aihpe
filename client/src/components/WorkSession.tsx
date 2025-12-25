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
    onCloneVersion: (version: number) => void;
    onPreviewVersion: (version: number) => void;
    onToggleImageGeneration: (allowed: boolean) => void;
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
        }

        // 2. Handle Version Switch
        const prevVersion = prevProps.session.activeVersion ?? prevProps.session.currentVersion;
        const currentVersion = this.props.session.activeVersion ?? this.props.session.currentVersion;

        if (prevVersion !== currentVersion) {
            this.stopPicking();
        }
    }

    handlePreviewTabChange = () => {
        // 3. Handle Preview Tab Switch
        this.stopPicking();
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
        const previewInstance = this.previewRef.current;
        if (!previewInstance) return;
        const iframe = previewInstance.getIframe();
        if (!iframe) {
            alert('Preview not ready');
            return;
        }

        this.picker.selectBySelector(iframe, selector);
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
            onCloneVersion,
            onPreviewVersion,
            onToggleImageGeneration
        } = this.props;

        // Calculate current version for Preview
        const currentVersion = session.activeVersion ?? session.currentVersion;

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
                    onCloneVersion={onCloneVersion}
                    activeVersion={session.activeVersion}
                    onPreviewVersion={onPreviewVersion}
                    disabled={session.status === 'pending'}
                    imageGenerationAllowed={session.imageGenerationAllowed ?? true}
                    onToggleImageGeneration={onToggleImageGeneration}
                />

                <Preview
                    ref={this.previewRef}
                    sessionId={session.id}
                    version={currentVersion}
                    onTabChange={this.handlePreviewTabChange}
                />
            </div>
        );
    }
}

