import React, { ChangeEvent } from 'react';
import classNames from 'classnames';
import styles from './UiDropdown.module.css';
import { ChevronDownIcon } from '../icons';

interface UiDropdownOption {
    value: string;
    label: string;
}

export enum DropdownVariant {
    STANDARD = 'standard',
    GHOST = 'ghost'
}

interface UiDropdownProps {
    value: string;
    options: UiDropdownOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    title?: string;
    variant?: DropdownVariant;
}

export class UiDropdown extends React.Component<UiDropdownProps> {
    handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
        const { onChange, disabled } = this.props;
        if (disabled) return;
        onChange(e.target.value);
    };

    render() {
        const { value, options, disabled, className, title, variant = DropdownVariant.STANDARD } = this.props;

        return (
            <div className={classNames(styles.container, className, { [styles.ghost]: variant === DropdownVariant.GHOST })} title={title}>
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
                <ChevronDownIcon className={styles.arrow} />
            </div>
        );
    }
}
