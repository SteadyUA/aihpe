import React, { Component, ReactNode } from 'react';
import styles from './UiModal.module.css';

interface UiModalProps {
    isOpen: boolean;
    title: string;
    children: ReactNode;
    actions: ReactNode;
    onClose: () => void;
    className?: string; // Allow extending basic modal styles
    style?: React.CSSProperties; // Allow overriding styles
}

export class UiModal extends Component<UiModalProps> {
    private mouseDownTarget: EventTarget | null = null;

    private handleMouseDown = (e: React.MouseEvent) => {
        this.mouseDownTarget = e.target;
    };

    private handleOverlayClick = (e: React.MouseEvent) => {
        // Only close if the mousedown also happened on the overlay, not a child
        if (this.mouseDownTarget === e.currentTarget) {
            this.props.onClose();
        }
        this.mouseDownTarget = null;
    };

    render() {
        const { isOpen, title, children, actions, className, style } = this.props;

        if (!isOpen) return null;

        return (
            <div
                className={styles.overlay}
                onMouseDown={this.handleMouseDown}
                onClick={this.handleOverlayClick}
            >
                <div
                    className={`${styles.modal} ${className || ''}`}
                    style={style}
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
