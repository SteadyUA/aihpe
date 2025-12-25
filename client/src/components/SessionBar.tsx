import React from 'react';
import classNames from 'classnames';
import styles from './SessionBar.module.css';

interface SessionBarProps {
    sessions: string[];
    activeSessionId: string | null;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    statusMap: Record<string, string>;
    groups: Record<string, number>; // Map sessionId -> groupId
    onRemove: (id: string) => void;
    pendingSessions: string[];
    isConnected: boolean;
}

interface SessionBarState { }

export class SessionBar extends React.Component<
    SessionBarProps,
    SessionBarState
> {
    render() {
        const {
            sessions,
            activeSessionId,
            onSwitch,
            onCreate,
            statusMap,
            onRemove,
            groups,
            pendingSessions,
            isConnected,
        } = this.props;

        return (
            <div className={styles.sessionBar}>
                <div
                    className={classNames(styles.connectionStatus, {
                        [styles.connected]: isConnected,
                    })}
                    title={isConnected ? 'Online' : 'Reconnecting...'}
                />
                <div className={styles.sessionTabs}>
                    {sessions.map((id) => {
                        const isActive = id === activeSessionId;
                        const status = statusMap?.[id] || 'idle';
                        const isPending = pendingSessions.includes(id);
                        const isBusy = status === 'busy' || isPending;
                        const groupId = groups?.[id];
                        // Access dynamic group class from styles module
                        const groupClass =
                            groupId !== undefined
                                ? styles[`sessionGroup${groupId % 12}`]
                                : undefined;

                        return (
                            <div
                                key={id}
                                className={classNames(
                                    styles.sessionTab,
                                    {
                                        [styles.active]: isActive,
                                        [styles.pending]: isPending,
                                    },
                                    groupClass,
                                )}
                                onClick={() => onSwitch(id)}
                            // style={isPending ? { cursor: 'not-allowed', opacity: 0.7 } : undefined} // Removed restriction
                            >
                                <span
                                    className={classNames(
                                        styles.sessionTabStatus,
                                        {
                                            [styles.busy]: isBusy,
                                        },
                                    )}
                                >
                                    {!isBusy && (
                                        <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                        </svg>
                                    )}
                                </span>
                                <span>{id.slice(0, 8)}</span>
                                <span
                                    className={styles.sessionTabClose}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemove(id);
                                    }}
                                >
                                    ×
                                </span>
                            </div>
                        );
                    })}
                    <button
                        className={styles.sessionTabNew}
                        onClick={onCreate}
                        title="New Chat"
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            </div>
        );
    }
}
