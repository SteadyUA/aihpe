import React, { useState, useEffect } from 'react';
import { UiModal } from './UiModal';
import { UiButton, ButtonVariant } from './UiButton';
import { UiInput } from './UiInput';
import { UiDropdown } from './UiDropdown';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProjectSettingsModalProps {
    isOpen: boolean;
    currentName?: string;
    currentDefaultProvider?: LlmProvider;
    onUpdate: (defaultProvider: LlmProvider, name: string) => Promise<void>;
    onClose: () => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
    isOpen,
    currentName,
    currentDefaultProvider,
    onUpdate,
    onClose
}) => {
    const [name, setName] = useState(currentName || '');
    const [defaultProvider, setDefaultProvider] = useState<LlmProvider>(currentDefaultProvider || LlmProvider.OPENAI);
    const [isSaving, setIsSaving] = useState(false);

    // Sync state when props change or modal opens
    useEffect(() => {
        if (isOpen) {
            setName(currentName || '');
            setDefaultProvider(currentDefaultProvider || LlmProvider.OPENAI);
        }
    }, [isOpen, currentName, currentDefaultProvider]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onUpdate(defaultProvider, name);
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
                    <UiButton onClick={onClose} variant={ButtonVariant.SECONDARY} disabled={isSaving}>
                        Cancel
                    </UiButton>
                    <UiButton
                        onClick={handleSave}
                        variant={ButtonVariant.PRIMARY}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </UiButton>
                </>
            }
            className={styles.modal}
        >
            <div className={styles.field}>
                <label className={styles.label}>Project Name</label>
                <UiInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter project name"
                />
            </div>
            <div className={styles.field}>
                <label className={styles.label}>Default Provider</label>
                <UiDropdown
                    value={defaultProvider}
                    onChange={(val) => setDefaultProvider(val as LlmProvider)}
                    options={LLM_PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                />
            </div>
        </UiModal>
    );
};
