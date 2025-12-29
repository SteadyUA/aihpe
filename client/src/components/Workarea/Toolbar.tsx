import React from 'react';
import classNames from 'classnames';
import styles from './Toolbar.module.css';

interface ToolbarProps {
    left?: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
    children?: React.ReactNode;
}

export class Toolbar extends React.Component<ToolbarProps> {
    render() {
        const { left, right, className, children } = this.props;

        return (
            <div className={classNames(styles.toolbar, className)}>
                <div className={styles.deviceControls}>
                    {left}
                </div>
                {children}
                <div className={styles.actions}>
                    {right}
                </div>
            </div>
        );
    }
}
