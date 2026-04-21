import React from 'react';
import classNames from 'classnames';
import styles from './UiButton.module.css';

export enum ButtonVariant {
    PRIMARY = 'primary',
    SECONDARY = 'secondary',
    GHOST = 'ghost',
    GHOST_ACTIVE = 'ghost-active',
    DANGER = 'danger'
}

export enum ButtonSize {
    SMALL = 'small',
    MEDIUM = 'medium',
    ICON = 'icon'
}

export interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children?: React.ReactNode;
}

export class UiButton extends React.Component<UiButtonProps> {
    static defaultProps = {
        type: 'button',
        variant: ButtonVariant.SECONDARY,
        size: ButtonSize.MEDIUM,
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
                [styles.primary]: variant === ButtonVariant.PRIMARY,
                [styles.secondary]: variant === ButtonVariant.SECONDARY,
                [styles.ghost]: variant === ButtonVariant.GHOST,
                [styles.ghostActive]: variant === ButtonVariant.GHOST_ACTIVE,
                [styles.danger]: variant === ButtonVariant.DANGER,
                [styles.small]: size === ButtonSize.SMALL,
                [styles.icon]: size === ButtonSize.ICON,
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
