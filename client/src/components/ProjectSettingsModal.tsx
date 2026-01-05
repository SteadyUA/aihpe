import React, { useState, useEffect } from 'react';
import { UiModal } from './UiModal';
import { UiButton } from './UiButton';
import { RichInput } from './RichInput';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProjectSettingsModalProps {
    isOpen: boolean;
    projectId: string; // Kept for reference if needed, though not used directly in logic below
    currentRulesAndGoal: string;
    currentImageGenerationPref?: string;
    currentDefaultProvider?: LlmProvider;
    onUpdate: (rulesAndGoal: string, imageGenerationPref: string, defaultProvider: LlmProvider) => Promise<void>;
    onClose: () => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
    isOpen,
    currentRulesAndGoal,
    currentImageGenerationPref,
    currentDefaultProvider,
    onUpdate,
    onClose
}) => {
    const [rulesAndGoal, setRulesAndGoal] = useState(currentRulesAndGoal || '');
    const [imageGenerationPref, setImageGenerationPref] = useState(currentImageGenerationPref || '');
    const [defaultProvider, setDefaultProvider] = useState<LlmProvider>(currentDefaultProvider || 'openai');
    const [isSaving, setIsSaving] = useState(false);

    // Sync state when props change or modal opens
    useEffect(() => {
        if (isOpen) {
            setRulesAndGoal(currentRulesAndGoal || '');
            setImageGenerationPref(currentImageGenerationPref || '');
            setDefaultProvider(currentDefaultProvider || 'openai');
        }
    }, [isOpen, currentRulesAndGoal, currentImageGenerationPref, currentDefaultProvider]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onUpdate(rulesAndGoal, imageGenerationPref, defaultProvider);
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

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
                        onClick={handleSave}
                        variant="primary"
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </UiButton>
                </>
            }
            className={styles.modal}
        >
            <div className={styles.field}>
                <label className={styles.label}>Rules and Goal</label>
                <RichInput
                    value={rulesAndGoal}
                    onChange={setRulesAndGoal}
                    placeholder="Describe your project goal and any specific rules..."
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
