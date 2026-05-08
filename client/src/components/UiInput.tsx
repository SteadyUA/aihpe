import React, { forwardRef } from 'react';
import classNames from 'classnames';
import styles from './UiInput.module.css';

export interface UiInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    hasError?: boolean;
}

export const UiInput = forwardRef<HTMLInputElement, UiInputProps>(
    ({ className, hasError, ...props }, ref) => {
        return (
            <input
                ref={ref}
                className={classNames(
                    styles.input,
                    {
                        [styles.error]: hasError,
                    },
                    className
                )}
                {...props}
            />
        );
    }
);

UiInput.displayName = 'UiInput';
