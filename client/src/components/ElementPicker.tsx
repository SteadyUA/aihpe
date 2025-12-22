import React from 'react';
import styles from './ElementPicker.module.css';

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
        } = this.props;

        if (selection) {
            return (
                <div className={styles.pickerContainer}>
                    <div className={styles.selectionBanner}>
                        <code className={styles.selectionValue}>{selection}</code>
                        <button type="button" onClick={onClear} className={styles.clearButton} title="Clear selection">×</button>
                    </div>
                </div>
            );
        }

        return (
            <div className={styles.pickerContainer}>
                {isPicking ? (
                    <button
                        type="button"
                        className={styles.pickerButton}
                        onClick={onCancel}
                        title="Cancel selection"
                        style={{
                            borderColor: 'var(--danger)',
                            color: 'var(--danger)',
                        }}
                        disabled={disabled}
                    >
                        <span>Cancel Selection</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        className={styles.pickerButton}
                        onClick={onPick}
                        title="Select an element in preview"
                        disabled={disabled}
                    >
                        <span>Pick Element</span>
                    </button>
                )}
            </div>
        );
    }
}
