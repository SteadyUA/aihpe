import React, { useState } from 'react';
import { UiModal } from './UiModal';
import { UiButton } from './UiButton';
import { RichInput } from './RichInput';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProjectCreationModalProps {
    isOpen: boolean;
    onCreate: (rulesAndGoal: string, imageGenerationPref: string, defaultProvider: LlmProvider) => Promise<void>;
}

export const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({ isOpen, onCreate }) => {
    const [rulesAndGoal, setRulesAndGoal] = useState('');
    const [imageGenerationPref, setImageGenerationPref] = useState('');
    const [defaultProvider, setDefaultProvider] = useState<LlmProvider>('openai');
    const [isCreating, setIsCreating] = useState(false);

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            await onCreate(rulesAndGoal, imageGenerationPref, defaultProvider);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <UiModal
            isOpen={isOpen}
            title="Create Project"
            onClose={() => { }} // Not closeable
            actions={
                <UiButton
                    onClick={handleCreate}
                    variant="primary"
                    disabled={isCreating}
                >
                    {isCreating ? 'Creating...' : 'Create'}
                </UiButton>
            }
            className={styles.modal}
        >
            <div className={styles.field}>
                <label className={styles.label}>Rules and Goal</label>
                <RichInput
                    value={rulesAndGoal}
                    onChange={setRulesAndGoal}
                    placeholder="Describe your project goal and any specific rules..."
                    autoFocus
                    rows={2}
                />
            </div>
            <div className={styles.field}>
                <label className={styles.label}>Image Generation Preferences</label>
                <textarea
                    className={styles.input}
                    value={imageGenerationPref}
                    onChange={(e) => setImageGenerationPref(e.target.value)}
                    placeholder="E.g. strict realism, no text, vibrant colors..."
                    rows={2}
                />
            </div>
            <div className={styles.field}>
                <label className={styles.label}>Default Provider</label>
                <select
                    className={styles.input}
                    value={defaultProvider}
                    onChange={(e) => setDefaultProvider(e.target.value as LlmProvider)}
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
};
