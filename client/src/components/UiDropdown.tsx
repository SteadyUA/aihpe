import React, { ChangeEvent } from 'react';
import classNames from 'classnames';
import styles from './UiDropdown.module.css';

interface UiDropdownOption {
    value: string;
    label: string;
}

interface UiDropdownProps {
    value: string;
    options: UiDropdownOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    title?: string;
}

export class UiDropdown extends React.Component<UiDropdownProps> {
    handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const { onChange, disabled } = this.props;
        if (disabled) return;
        onChange(e.target.value);
    };

    render() {
        const { value, options, disabled, className, title } = this.props;

        return (
            <div className={classNames(styles.container, className)} title={title}>
                <select
                    className={styles.select}
                    value={value}
                    onChange={this.handleChange}
                    disabled={disabled}
                >
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <svg
                    className={styles.arrow}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </div>
        );
    }
}
