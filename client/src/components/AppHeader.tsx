import React, { useState, useRef, useEffect } from 'react';
import styles from './AppHeader.module.css';
import classNames from 'classnames';
import { apiAuth } from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { useConnection } from '../contexts/ConnectionContext';
import { MenuIcon, GridIcon, UserIcon, SettingsIcon, LogOutIcon } from '../icons';

interface AppHeaderProps {
    children: React.ReactNode;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ children }) => {
    const { isConnected } = useConnection();
    const navigate = useNavigate();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const avatarRef = useRef<HTMLDivElement>(null);
    const appMenuRef = useRef<HTMLDivElement>(null);
    const hamburgerRef = useRef<HTMLDivElement>(null);

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
    const toggleAppMenu = () => setIsAppMenuOpen(!isAppMenuOpen);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // User Menu
            if (
                isMenuOpen &&
                menuRef.current &&
                !menuRef.current.contains(event.target as Node) &&
                avatarRef.current &&
                !avatarRef.current.contains(event.target as Node)
            ) {
                setIsMenuOpen(false);
            }

            // App Menu
            if (
                isAppMenuOpen &&
                appMenuRef.current &&
                !appMenuRef.current.contains(event.target as Node) &&
                hamburgerRef.current &&
                !hamburgerRef.current.contains(event.target as Node)
            ) {
                setIsAppMenuOpen(false);
            }
        };

        if (isMenuOpen || isAppMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMenuOpen, isAppMenuOpen]);

    return (
        <div className={styles.wrapper}>
            <div className={styles.leftSide}>
                <div
                    className={styles.hamburger}
                    onClick={toggleAppMenu}
                    ref={hamburgerRef}
                    title="Menu"
                >
                    <MenuIcon />
                </div>
                {isAppMenuOpen && (
                    <div className={classNames(styles.menu, styles.left)} ref={appMenuRef}>
                        <button
                            className={styles.menuItem}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsAppMenuOpen(false);
                                navigate('/projects');
                            }}
                        >
                            <GridIcon size={16} />
                            Projects
                        </button>
                    </div>
                )}
            </div>
            <div className={styles.center}>
                {children}
            </div>
            <div className={styles.rightSide}>
                <div
                    className={styles.avatar}
                    onClick={toggleMenu}
                    ref={avatarRef}
                    title="User Menu"
                >
                    {/* Placeholder SVG for user avatar */}
                    <UserIcon size={20} />
                    <div
                        className={classNames(styles.statusIndicator, {
                            [styles.connected]: isConnected,
                        })}
                        title={isConnected ? 'Online' : 'Reconnecting...'}
                    />
                    {isMenuOpen && (
                        <div className={classNames(styles.menu, styles.right)} ref={menuRef}>
                            <button
                                className={styles.menuItem}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsMenuOpen(false);
                                    navigate('/settings');
                                }}
                            >
                                <SettingsIcon size={16} />
                                Settings
                            </button>
                            <button
                                className={styles.menuItem}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsMenuOpen(false);
                                    apiAuth.logout();
                                }}
                            >
                                <LogOutIcon size={16} />
                                Sign Out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
