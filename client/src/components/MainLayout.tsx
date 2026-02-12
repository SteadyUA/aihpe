import React from 'react';
import styles from './MainLayout.module.css';
import { AppHeader } from './AppHeader';
import classNames from 'classnames';

interface MainLayoutProps {
    children: React.ReactNode;
    headerContent?: React.ReactNode;
    /**
     * If true, the content area will not scroll (overflow: hidden).
     * Use this if the child component manages its own scrolling (e.g. Workspace/Chat).
     */
    noScroll?: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, headerContent, noScroll = false }) => {
    return (
        <div className={styles.layout}>
            <div className={styles.headerWrapper}>
                <AppHeader>
                    {headerContent}
                </AppHeader>
            </div>
            <div className={classNames(styles.content, { [styles.noScroll]: noScroll })}>
                {children}
            </div>
        </div>
    );
};
