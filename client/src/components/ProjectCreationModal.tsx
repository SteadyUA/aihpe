import React, { useState } from 'react';
import { UiModal } from './UiModal';
import { UiButton, ButtonVariant} from './UiButton';
import { RichInput } from './RichInput';
import styles from './ProjectModal.module.css';
import { LlmProvider } from '../types';
import { LLM_PROVIDERS } from '../constants';

interface ProjectCreationModalProps {
    isOpen: boolean;
    onCreate: (rulesAndGoal: string, imageGenerationPref: string, defaultProvider: LlmProvider, name: string, modelRole: string, file?: File) => Promise<void>;
    onClose?: () => void;
}

export const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({ isOpen, onCreate, onClose }) => {
    const [name, setName] = useState('');
    const [rulesAndGoal, setRulesAndGoal] = useState('');
    const [imageGenerationPref, setImageGenerationPref] = useState('');
    const [defaultProvider, setDefaultProvider] = useState<LlmProvider>(LlmProvider.OPENAI);
    const [modelRole, setModelRole] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            await onCreate(rulesAndGoal, imageGenerationPref, defaultProvider, name, modelRole, file || undefined);
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
                <label className={styles.label}>Project Name</label>
                <input
                    className={styles.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter project name"
                    autoFocus
                />
            </div>
            <div className={styles.field}>
                <label className={styles.label}>HTML Archive (ZIP)</label>
                <input
                    type="file"
                    className={styles.input}
                    accept=".zip"
                    onChange={handleFileChange}
                />
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
                    Optional: Upload an archive containing index.html, styles, and images.
                </div>
            </div>
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
            <div className={styles.field}>
                <label className={styles.label}>Model Role</label>
                <textarea
                    className={styles.input}
                    value={modelRole}
                    onChange={(e) => setModelRole(e.target.value)}
                    placeholder="e.g. You are an expert web developer"
                    rows={2}
                />
            </div>
        </UiModal>
    );
};
