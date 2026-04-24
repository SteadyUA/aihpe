import React from 'react';
import { UiModal } from '../UiModal';
import { UiButton } from '../UiButton';
import { apiAuth } from '../../utils/api';

interface MemoryModalProps {
    sessionId: string;
    isOpen: boolean;
    onClose: () => void;
    initialVersion: number;
    maxVersion: number;
}

interface MemoryModalState {
    memoryContent: string;
    memoryVersion: number;
    isLoading: boolean;
}

export class MemoryModal extends React.Component<MemoryModalProps, MemoryModalState> {
    constructor(props: MemoryModalProps) {
        super(props);
        this.state = {
            memoryContent: '',
            memoryVersion: props.initialVersion,
            isLoading: false,
        };
    }

    componentDidUpdate(prevProps: MemoryModalProps) {
        if (!prevProps.isOpen && this.props.isOpen) {
            // Reset state and fetch when opened
            this.setState({ memoryVersion: this.props.initialVersion }, () => {
                this.fetchMemoryForVersion(this.props.initialVersion);
            });
        } else if (prevProps.isOpen && !this.props.isOpen) {
            // Clear content when closed
            this.setState({ memoryContent: '' });
        }
    }

    fetchMemoryForVersion = async (targetVersion: number) => {
        const { sessionId } = this.props;
        this.setState({ isLoading: true, memoryContent: 'Loading...', memoryVersion: targetVersion });
        
        try {
            const res = await apiAuth.fetch(`/api/sessions/${sessionId}/${targetVersion}/memory`);
            if (res.ok) {
                const data = await res.json();
                this.setState({
                    memoryContent: data.memory || 'No memory available yet.',
                    isLoading: false
                });
            } else {
                this.setState({ memoryContent: 'Failed to fetch memory.', isLoading: false });
            }
        } catch (e) {
            this.setState({ memoryContent: 'Error fetching memory.', isLoading: false });
        }
    };

    handlePrevMemory = () => {
        if (this.state.memoryVersion > 1) {
            this.fetchMemoryForVersion(this.state.memoryVersion - 1);
        }
    };

    handleNextMemory = () => {
        if (this.state.memoryVersion < this.props.maxVersion) {
            this.fetchMemoryForVersion(this.state.memoryVersion + 1);
        }
    };

    render() {
        const { isOpen, onClose, maxVersion } = this.props;
        const { memoryContent, memoryVersion } = this.state;

        return (
            <UiModal
                isOpen={isOpen}
                title={`Memory Files v${memoryVersion}`}
                onClose={onClose}
                actions={
                    <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'space-between' }}>
                        <div>
                            <UiButton onClick={this.handlePrevMemory} disabled={memoryVersion <= 1}>Prev</UiButton>
                            <UiButton onClick={this.handleNextMemory} disabled={memoryVersion >= maxVersion} style={{ marginLeft: '8px' }}>Next</UiButton>
                        </div>
                        <UiButton onClick={onClose}>Close</UiButton>
                    </div>
                }
            >
                <div style={{ whiteSpace: 'pre-wrap' }}>
                    {memoryContent}
                </div>
            </UiModal>
        );
    }
}
