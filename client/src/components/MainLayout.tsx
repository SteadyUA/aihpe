import React from 'react';
import styles from './MainLayout.module.css';
import { AppHeader } from './AppHeader';

interface MainLayoutProps {
    children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    return (
        <div className={styles.layout}>
            <div className={styles.headerWrapper}>
                <AppHeader>
                    <div id="header-portal-target" style={{ width: '100%', display: 'flex', alignItems: 'center' }} />
                </AppHeader>
            </div>
            <div id="layout-content" className={styles.content}>
                {children}
            </div>
        </div>
    );
};
