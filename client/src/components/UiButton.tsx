import React from 'react';
import classNames from 'classnames';
import styles from './UiButton.module.css';

export interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'ghost-active' | 'danger';
    size?: 'small' | 'medium' | 'icon';
    children?: React.ReactNode;
}

export class UiButton extends React.Component<UiButtonProps> {
    static defaultProps = {
        type: 'button',
        variant: 'secondary',
        size: 'medium',
    };

    render() {
        const {
            variant,
            size,
            className,
            children,
            ...rest
        } = this.props;

        const buttonClass = classNames(
            styles.button,
            {
                [styles.primary]: variant === 'primary',
                [styles.secondary]: variant === 'secondary',
                [styles.ghost]: variant === 'ghost',
                [styles.ghostActive]: variant === 'ghost-active',
                [styles.danger]: variant === 'danger',
                [styles.small]: size === 'small',
                [styles.icon]: size === 'icon',
            },
            className
        );

        return (
            <button className={buttonClass} {...rest}>
                {children}
            </button>
        );
    }
}
