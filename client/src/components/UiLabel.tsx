import React from 'react';
import classNames from 'classnames';
import styles from './UiLabel.module.css';

interface UiLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    children: React.ReactNode;
}

export const UiLabel: React.FC<UiLabelProps> = ({ children, className, ...props }) => {
    return (
        <label className={classNames(styles.label, className)} {...props}>
            {children}
        </label>
    );
};
