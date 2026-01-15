import React from 'react';
import classNames from 'classnames';
import styles from './ResizeHandle.module.css';

interface ResizeHandleProps {
    onMouseDown: (e: React.MouseEvent) => void;
    isActive?: boolean;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({ onMouseDown, isActive }) => {
    return (
        <div
            className={classNames(styles.handle, { [styles.active]: isActive })}
            onMouseDown={onMouseDown}
        >
        </div>
    );
};
