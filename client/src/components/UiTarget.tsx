import React from 'react';
import styles from './UiTarget.module.css';

export interface UiTargetProps {
    children?: React.ReactNode;
    onRemove?: () => void;
    removeTitle?: string;
    className?: string;
    disabled?: boolean;
}

export class UiTarget extends React.Component<UiTargetProps> {
    render() {
        const { children, onRemove, removeTitle, className, disabled } = this.props;
        return (
            <div className={`${styles.container} ${className || ''}`.trim()}>
                <div className={styles.content}>
                    {children}
                </div>
                {onRemove && (
                    <button
                        type="button"
                        className={styles.removeButton}
                        onClick={onRemove}
                        title={removeTitle || "Remove"}
                        disabled={disabled}
                    >
                        ×
                    </button>
                )}
            </div>
        );
    }
}
