import React from 'react';
import styles from './UiTarget.module.css';

export interface UiTargetProps {
    children?: React.ReactNode;
    onRemove?: () => void;
    removeTitle?: string;
    className?: string;
    disabled?: boolean;
    icon?: React.ReactNode;
}

export class UiTarget extends React.Component<UiTargetProps> {
    render() {
        const { children, onRemove, removeTitle, className, disabled, icon } = this.props;
        return (
            <div className={`${styles.container} ${className || ''}`.trim()}>
                {icon && (
                    <div className={styles.iconWrapper}>
                        {icon}
                    </div>
                )}
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
