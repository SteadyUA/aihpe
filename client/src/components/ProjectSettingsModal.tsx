import React, { Component } from 'react';
import { UiModal } from './UiModal';
import { UiButton } from './UiButton';
import { RichInput } from './RichInput';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProjectSettingsModalProps {
    isOpen: boolean;
    projectId: string;
    currentGoal: string;
    currentImageGenerationPref?: string;
    currentDefaultProvider?: LlmProvider;
    onUpdate: (goal: string, imageGenerationPref: string, defaultProvider: LlmProvider) => Promise<void>;
    onClose: () => void;
}

interface ProjectSettingsModalState {
    goal: string;
    imageGenerationPref: string;
    defaultProvider: LlmProvider;
    isSaving: boolean;
}

export class ProjectSettingsModal extends Component<ProjectSettingsModalProps, ProjectSettingsModalState> {
    constructor(props: ProjectSettingsModalProps) {
        super(props);
        this.state = {
            goal: props.currentGoal,
            imageGenerationPref: props.currentImageGenerationPref || '',
            defaultProvider: props.currentDefaultProvider || 'openai',
            isSaving: false,
        };
    }

    componentDidUpdate(prevProps: ProjectSettingsModalProps) {
        if (prevProps.isOpen !== this.props.isOpen && this.props.isOpen) {
            this.setState({
                goal: this.props.currentGoal,
                imageGenerationPref: this.props.currentImageGenerationPref || '',
                defaultProvider: this.props.currentDefaultProvider || 'openai'
            });
        }
    }

    handleSave = async () => {
        const { goal, imageGenerationPref, defaultProvider } = this.state;
        if (!goal.trim()) return;

        this.setState({ isSaving: true });
        try {
            await this.props.onUpdate(goal, imageGenerationPref, defaultProvider);
            this.props.onClose();
        } finally {
            this.setState({ isSaving: false });
        }
    };

    render() {
        const { isOpen, onClose } = this.props;
        const { goal, imageGenerationPref, defaultProvider, isSaving } = this.state;

        return (
            <UiModal
                isOpen={isOpen}
                title="Project Settings"
                onClose={onClose}
                actions={
                    <>
                        <UiButton onClick={onClose} variant="secondary" disabled={isSaving}>
                            Cancel
                        </UiButton>
                        <UiButton
                            onClick={this.handleSave}
                            variant="primary"
                            disabled={!goal.trim() || isSaving}
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </UiButton>
                    </>
                }
                className={styles.modal}
            >
                <div className={styles.field}>
                    <label className={styles.label}>Project Goal</label>
                    <RichInput
                        value={goal}
                        onChange={(value) => this.setState({ goal: value })}
                        placeholder="Describe the goal of this project..."
                        rows={2}
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
                        {LLM_PROVIDERS.map(provider => (
                            <option key={provider.value} value={provider.value}>
                                {provider.label}
                            </option>
                        ))}
                    </select>
                </div>
            </UiModal>
        );
    }
}
