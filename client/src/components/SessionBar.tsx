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

    onProjectSettings: () => void;
    projectName?: string;
}

interface SessionBarState { }

export class SessionBar extends React.Component<
    SessionBarProps,
    SessionBarState
> {
    private tabsRef = React.createRef<HTMLDivElement>();

    componentDidUpdate(prevProps: SessionBarProps) {
        if (this.props.activeSessionId !== prevProps.activeSessionId && this.props.activeSessionId) {
            this.scrollToActiveTab();
        }
    }

    private scrollToActiveTab() {
        if (this.tabsRef.current && this.props.activeSessionId) {
            const container = this.tabsRef.current;
            const activeTab = container.querySelector(`.${styles.active}`) as HTMLElement;
            if (activeTab) {
                const containerRect = container.getBoundingClientRect();
                const tabRect = activeTab.getBoundingClientRect();
                const margin = activeTab.offsetWidth / 2;

                const isComfortablyVisible =
                    tabRect.left >= containerRect.left + margin &&
                    tabRect.right <= containerRect.right - margin;

                if (!isComfortablyVisible) {
                    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }
        }
    }
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
            projectName,
        } = this.props;

        return (
            <div className={styles.sessionBar}>

                <div className={styles.projectContext}>
                    {projectName && (
                        <span className={styles.projectName} title={projectName}>
                            {projectName}
                        </span>
                    )}
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
                </div>
                <div
                    ref={this.tabsRef}
                    className={styles.sessionTabs}
                    onWheel={(e) => {
                        if (e.deltaY !== 0) {
                            e.currentTarget.scrollLeft += e.deltaY;
                        }
                    }}
                >
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
                                    {status === 'error' && (
                                        <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="#ef4444"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="12" y1="8" x2="12" y2="12"></line>
                                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                        </svg>
                                    )}
                                    {!isBusy && status !== 'error' && (
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
