import React, { ChangeEvent } from 'react';
import classNames from 'classnames';
import styles from './UiCheckbox.module.css';

interface UiCheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
    title?: string;
    className?: string; // Allow external override/positioning
}

export class UiCheckbox extends React.Component<UiCheckboxProps> {
    handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { onChange, disabled } = this.props;
        if (disabled) return;
        onChange(e.target.checked);
    };

    render() {
        const { checked, label, disabled, title, className } = this.props;

        return (
            <label
                className={classNames(styles.container, className, {
                    [styles.disabled]: disabled,
                })}
                title={title}
            >
                <input
                    type="checkbox"
                    className={styles.input}
                    checked={checked}
                    onChange={this.handleChange}
                    disabled={disabled}
                />
                <span className={styles.switch}></span>
                {label && <span className={styles.label}>{label}</span>}
            </label>
        );
    }
}
