import React, { forwardRef } from 'react';
import classNames from 'classnames';
import styles from './UiInput.module.css';

export interface UiTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    hasError?: boolean;
}

export const UiTextarea = forwardRef<HTMLTextAreaElement, UiTextareaProps>(
    ({ className, hasError, ...props }, ref) => {
        return (
            <textarea
                ref={ref}
                className={classNames(
                    styles.input,
                    styles.textarea,
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

UiTextarea.displayName = 'UiTextarea';
