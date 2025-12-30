import React, { Component, ReactNode } from 'react';
import styles from './UiModal.module.css';

interface UiModalProps {
    isOpen: boolean;
    title: string;
    children: ReactNode;
    actions: ReactNode;
    onClose: () => void;
    className?: string; // Allow extending basic modal styles
}

export class UiModal extends Component<UiModalProps> {
    render() {
        const { isOpen, title, children, actions, onClose, className } = this.props;

        if (!isOpen) return null;

        return (
            <div className={styles.overlay} onClick={onClose}>
                <div
                    className={`${styles.modal} ${className || ''}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <h3 className={styles.title}>{title}</h3>
                    <div className={styles.content}>
                        {children}
                    </div>
                    {actions && (
                        <div className={styles.actions}>
                            {actions}
                        </div>
                    )}
                </div>
            </div>
        );
    }
}
