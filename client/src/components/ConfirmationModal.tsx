import React from 'react';
import classNames from 'classnames';
import styles from './ConfirmationModal.module.css';

interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export class ConfirmationModal extends React.Component<ConfirmationModalProps> {
    render() {
        const { isOpen, title, message, onConfirm, onCancel } = this.props;

        if (!isOpen) return null;

        return (
            <div className={styles.overlay} onClick={onCancel}>
                <div
                    className={styles.modal}
                    onClick={(e) => e.stopPropagation()} // Prevent click through to overlay
                >
                    <h3 className={styles.title}>{title}</h3>
                    <p className={styles.message}>{message}</p>
                    <div className={styles.actions}>
                        <button
                            className={classNames(styles.button, styles.cancelButton)}
                            onClick={onCancel}
                        >
                            Cancel
                        </button>
                        <button
                            className={classNames(styles.button, styles.confirmButton)}
                            onClick={onConfirm}
                        >
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
