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
    subjects: Record<string, string>; // Map sessionId -> subject
    onRemove: (id: string) => void;
    pendingSessions: string[];
    isConnected: boolean;
    onProjectSettings: () => void;
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
                    <button
                        className={styles.sessionTabNew}
                        onClick={this.props.onProjectSettings}
                        title="Project Settings"
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
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                    </button>
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
                                <span className={styles.sessionTitle} title={id}>
                                    {this.props.subjects[id] || id.slice(0, 8)}
                                </span>
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
