import React, { Component } from 'react';
import { UiModal } from './UiModal';
import { UiButton } from './UiButton';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';

interface ProjectCreationModalProps {
    isOpen: boolean;
    onCreate: (goal: string, imageGenerationPref: string, defaultProvider: LlmProvider) => Promise<void>;
}

interface ProjectCreationModalState {
    goal: string;
    imageGenerationPref: string;
    defaultProvider: LlmProvider;
    isCreating: boolean;
}

export class ProjectCreationModal extends Component<ProjectCreationModalProps, ProjectCreationModalState> {
    constructor(props: ProjectCreationModalProps) {
        super(props);
        this.state = {
            goal: '',
            imageGenerationPref: '',
            defaultProvider: 'openai',
            isCreating: false,
        };
    }

    handleCreate = async () => {
        const { goal, imageGenerationPref, defaultProvider } = this.state;
        if (!goal.trim()) return;

        this.setState({ isCreating: true });
        try {
            await this.props.onCreate(goal, imageGenerationPref, defaultProvider);
        } finally {
            this.setState({ isCreating: false });
        }
    };

    render() {
        const { isOpen } = this.props;
        const { goal, imageGenerationPref, defaultProvider, isCreating } = this.state;

        return (
            <UiModal
                isOpen={isOpen}
                title="Create Project"
                onClose={() => { }} // Not closeable
                actions={
                    <UiButton
                        onClick={this.handleCreate}
                        variant="primary"
                        disabled={!goal.trim() || isCreating}
                    >
                        {isCreating ? 'Creating...' : 'Create'}
                    </UiButton>
                }
            >
                <div className={styles.field}>
                    <label className={styles.label}>Project Goal</label>
                    <textarea
                        className={styles.input}
                        value={goal}
                        onChange={(e) => this.setState({ goal: e.target.value })}
                        placeholder="Describe the goal of this project..."
                        rows={3}
                        autoFocus
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>Image Generation Preferences</label>
                    <textarea
                        className={styles.input}
                        value={imageGenerationPref}
                        onChange={(e) => this.setState({ imageGenerationPref: e.target.value })}
                        placeholder="E.g. strict realism, no text, vibrant colors..."
                        rows={2}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>Default Provider</label>
                    <select
                        className={styles.input}
                        value={defaultProvider}
                        onChange={(e) => this.setState({ defaultProvider: e.target.value as LlmProvider })}
                    >
                        <option value="openai">OpenAI</option>
                        <option value="google">Google</option>
                    </select>
                </div>
            </UiModal>
        );
    }
}
