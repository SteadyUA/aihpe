import React, { useState } from 'react';
import { UiModal } from './UiModal';
import { UiButton, ButtonVariant } from './UiButton';
import { UiInput } from './UiInput';
import { UiDropdown } from './UiDropdown';
import { UiLabel } from './UiLabel';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProjectCreationModalProps {
    isOpen: boolean;
    onCreate: (defaultProvider: LlmProvider, name: string, file?: File) => Promise<void>;
    onClose?: () => void;
}

export const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({ isOpen, onCreate, onClose }) => {
    const [name, setName] = useState('');
    const [defaultProvider, setDefaultProvider] = useState<LlmProvider>(LlmProvider.OPENAI);
    const [file, setFile] = useState<File | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            await onCreate(defaultProvider, name, file || undefined);
        } finally {
            setIsCreating(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    return (
        <UiModal
            isOpen={isOpen}
            title="Create Project"
            onClose={() => onClose?.()}
            actions={
                <>
                    <UiButton
                        onClick={() => onClose?.()}
                        variant={ButtonVariant.SECONDARY}
                        disabled={isCreating}
                    >
                        Cancel
                    </UiButton>
                    <UiButton
                        onClick={handleCreate}
                        variant={ButtonVariant.PRIMARY}
                        disabled={isCreating}
                    >
                        {isCreating ? 'Creating...' : 'Create'}
                    </UiButton>
                </>
            }
            className={styles.modal}
        >
            <div className={styles.field}>
                <UiLabel>Project Name</UiLabel>
                <UiInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter project name"
                    autoFocus
                />
            </div>
            <div className={styles.field}>
                <UiLabel>HTML Archive (ZIP)</UiLabel>
                <UiInput
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    onChange={handleFileChange}
                />
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '-0.2rem' }}>
                    Optional: Upload an archive containing index.html, styles, and images.
                </div>
            </div>
            <div className={styles.field}>
                <UiLabel>Default Provider</UiLabel>
                <UiDropdown
                    value={defaultProvider}
                    onChange={(val) => setDefaultProvider(val as LlmProvider)}
                    options={LLM_PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                    fullWidth
                />
            </div>
        </UiModal>
    );
};
