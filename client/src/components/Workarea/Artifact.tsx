import React from 'react';
import { marked } from 'marked';
import { Toolbar } from './Toolbar';
import { UiButton } from '../UiButton';
import styles from './Artifact.module.css';

interface ArtifactProps {
    content: string;
    onProceed: () => void;
    active: boolean;
    busy?: boolean;
    isLatest?: boolean;
}

export class Artifact extends React.Component<ArtifactProps> {
    render() {
        const { content, onProceed, active, busy, isLatest } = this.props;

        if (!active) return null;

        const htmlContent = marked.parse(content || '') as string;

        const isContentEmpty = !content || content.trim() === '' || content.includes('No plan');

        return (
            <div className={styles.artifactContainer}>
                <Toolbar
                    left={
                        isLatest ? (
                            <UiButton
                                variant="primary" // Or another variant if preferred for the main action
                                onClick={onProceed}
                                disabled={isContentEmpty || busy}
                            >
                                Proceed
                            </UiButton>
                        ) : (
                            <span className={styles.implementedLabel}>Implemented</span>
                        )
                    }
                />
                <div
                    className={styles.content}
                    dangerouslySetInnerHTML={{ __html: htmlContent }}
                />
            </div>
        );
    }
}
