import React from 'react';

import { UiModal } from './UiModal';
import { UiButton, ButtonVariant} from './UiButton';
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

        const actions = (
            <>
                <UiButton
                    variant={ButtonVariant.SECONDARY}
                    onClick={onCancel}
                >
                    Cancel
                </UiButton>
                <UiButton
                    variant={ButtonVariant.DANGER}
                    onClick={onConfirm}
                >
                    Confirm
                </UiButton>
            </>
        );

        return (
            <UiModal
                isOpen={isOpen}
                title={title}
                actions={actions}
                onClose={onCancel}
            >
                <p className={styles.message}>{message}</p>
            </UiModal>
        );
    }
}
