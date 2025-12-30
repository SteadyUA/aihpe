import React from 'react';
import styles from './ElementPicker.module.css';
import { UiButton } from './UiButton';
import { UiTarget } from './UiTarget';

export interface ElementPickerProps {
    /** The currently selected element selector, if any */
    selection: string | null;
    /** Whether the user is currently in "picking" mode */
    isPicking?: boolean;
    /** Callback when user clicks "Pick Element" */
    onPick?: () => void;
    /** Callback when user cancels picking mode */
    onCancel?: () => void;
    /** Callback to clear the current selection */
    onClear?: () => void;
    /** Whether the picker is disabled */
    disabled?: boolean;
    /** Optional class name */
    className?: string;
}

export class ElementPicker extends React.Component<ElementPickerProps> {
    render() {
        const {
            selection,
            isPicking,
            onPick,
            onCancel,
            onClear,
            disabled,
            className,
        } = this.props;

        const containerClass = `${styles.pickerContainer} ${className || ''}`.trim();

        if (selection) {
            return (
                <div className={containerClass}>
                    <UiTarget onRemove={onClear} removeTitle="Clear selection" disabled={disabled}>
                        <code className={styles.selectionValue}>{selection}</code>
                    </UiTarget>
                </div>
            );
        }

        return (
            <div className={containerClass}>
                {isPicking ? (
                    <UiButton
                        type="button"
                        variant="danger"
                        onClick={onCancel}
                        title="Cancel selection"
                        disabled={disabled}
                        className={styles.pickerButtonFull}
                    >
                        <span>Cancel Selection</span>
                    </UiButton>
                ) : (
                    <UiButton
                        type="button"
                        variant="secondary"
                        onClick={onPick}
                        title="Select an element in preview"
                        disabled={disabled}
                        className={styles.pickerButtonFull}
                    >
                        <span>Pick Element</span>
                    </UiButton>
                )}
            </div>
        );
    }
}
