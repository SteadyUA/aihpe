import React from 'react';
import { SessionStatus } from '../types';
import classNames from 'classnames';
import styles from './SessionBar.module.css';

interface SessionBarProps {
    sessions: string[];
    activeSessionId: string | null;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    statusMap: Record<string, SessionStatus>;
    groups: Record<string, number>; // Map sessionId -> groupId
    subjects: Record<string, string>; // Map sessionId -> subject
    onRemove: (id: string) => void;
    pendingSessions: string[];

    onProjectSettings: () => void;
    projectName?: string;
    onReorder: (newOrder: string[]) => void;
}

interface SessionBarState {
    dropTargetIndex: number | null;
    isHovering: boolean;
    showLeftScroll: boolean;
    showRightScroll: boolean;
}

export class SessionBar extends React.Component<
    SessionBarProps,
    SessionBarState
> {
    private tabsRef = React.createRef<HTMLDivElement>();
    private resizeObserver: ResizeObserver | null = null;

    constructor(props: SessionBarProps) {
        super(props);
        this.state = {
            dropTargetIndex: null,
            isHovering: false,
            showLeftScroll: false,
            showRightScroll: false,
        };
    }

    componentDidMount() {
        setTimeout(() => this.scrollToActiveTab('auto'), 0);
        this.checkScroll();

        if (this.tabsRef.current) {
            this.resizeObserver = new ResizeObserver(() => {
                this.checkScroll();
            });
            this.resizeObserver.observe(this.tabsRef.current);
            this.tabsRef.current.addEventListener('scroll', this.handleScroll);
        }
        window.addEventListener('resize', this.handleScroll);
    }

    componentWillUnmount() {
        if (this.tabsRef.current) {
            this.resizeObserver?.disconnect();
            this.tabsRef.current.removeEventListener('scroll', this.handleScroll);
        }
        window.removeEventListener('resize', this.handleScroll);
    }

    componentDidUpdate(prevProps: SessionBarProps) {
        if (
            (this.props.activeSessionId !== prevProps.activeSessionId && this.props.activeSessionId) ||
            (this.props.sessions.length !== prevProps.sessions.length)
        ) {
            setTimeout(() => {
                this.scrollToActiveTab('auto');
                this.checkScroll();
            }, 0);
        } else if (this.props.sessions !== prevProps.sessions) {
            this.checkScroll();
        }
    }

    private handleScroll = () => {
        this.checkScroll();
    };

    private checkScroll = () => {
        if (this.tabsRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = this.tabsRef.current;
            const showLeftScroll = scrollLeft > 0;
            // Use a small epsilon for float comparison safety, though typically int
            const showRightScroll = scrollLeft < scrollWidth - clientWidth - 1;

            if (
                this.state.showLeftScroll !== showLeftScroll ||
                this.state.showRightScroll !== showRightScroll
            ) {
                this.setState({ showLeftScroll, showRightScroll });
            }
        }
    };

    private scrollToActiveTab(behavior: ScrollBehavior = 'smooth') {
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
                    activeTab.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
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

        const { dropTargetIndex, showLeftScroll, showRightScroll } = this.state;

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
                    className={styles.tabsContainer}
                    onMouseEnter={() => this.setState({ isHovering: true })}
                    onMouseLeave={() => this.setState({ isHovering: false })}
                >
                    <div
                        className={classNames(styles.scrollIndicator, styles.scrollIndicatorLeft, {
                            [styles.scrollIndicatorVisible]: showLeftScroll,
                        })}
                    />
                    <div
                        className={classNames(styles.scrollIndicator, styles.scrollIndicatorRight, {
                            [styles.scrollIndicatorVisible]: showRightScroll,
                        })}
                    />

                    <div
                        ref={this.tabsRef}
                        className={classNames(styles.sessionTabs, {
                            [styles.scrolling]: this.state.isHovering,
                        })}
                        onWheel={(e) => {
                            if (e.deltaY !== 0) {
                                e.currentTarget.scrollLeft += e.deltaY;
                            }
                        }}
                        onDragLeave={(e) => {
                            const container = this.tabsRef.current;
                            // specific check to see if we really left the container
                            if (container && !container.contains(e.relatedTarget as Node)) {
                                // Check if we also left the window or similar (optional), 
                                // but mainly we just want to clear drop target
                                this.setState({ dropTargetIndex: null });
                            }
                        }}

                        onDrop={(e) => {
                            e.preventDefault();
                            const { dropTargetIndex } = this.state;
                            // If dropTargetIndex is null, we don't know where to drop.
                            if (dropTargetIndex === null) return;

                            this.setState({ dropTargetIndex: null });
                            const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                            if (isNaN(sourceIndex)) return;

                            const { sessions, onReorder } = this.props;
                            const newOrder = [...sessions];
                            // If sourceIndex is the same as the target insertion index (logically), we might not need to move?
                            // But let's run the logic.

                            const [moved] = newOrder.splice(sourceIndex, 1);
                            let targetIndex = dropTargetIndex;
                            if (sourceIndex < targetIndex) {
                                targetIndex -= 1;
                            }
                            newOrder.splice(targetIndex, 0, moved);
                            onReorder(newOrder);
                        }}
                    >
                        {sessions.map((id, index) => {
                            const isActive = id === activeSessionId;
                            const status = statusMap?.[id] || SessionStatus.IDLE;
                            const isPending = pendingSessions.includes(id);
                            const isBusy = status === SessionStatus.BUSY || isPending;
                            const groupId = groups?.[id];
                            // Access dynamic group class from styles module
                            const groupClass =
                                groupId !== undefined
                                    ? styles[`sessionGroup${groupId % 12}`]
                                    : undefined;

                            const isDropTarget = dropTargetIndex === index;

                            return (
                                <React.Fragment key={id}>
                                    {isDropTarget && <div className={styles.dropIndicator} />}
                                    <div
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', index.toString());
                                            e.dataTransfer.effectAllowed = 'move';
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';

                                            // Set drop target to current index (insert before this item)
                                            if (this.state.dropTargetIndex !== index) {
                                                this.setState({ dropTargetIndex: index });
                                            }
                                        }}

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
                                            {status === SessionStatus.ERROR && (
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
                                            {!isBusy && status !== SessionStatus.ERROR && (
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
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
                                </React.Fragment>
                            );
                        })}
                        {/* Add one last drop target for appending to end? */}
                        {dropTargetIndex === sessions.length && <div className={styles.dropIndicator} />}
                        {/* We need a transparent filler to catch "append" drags if we want to drag to empty space?
                        Or just handle onDragOver on the container?
                    */}
                        <button
                            className={styles.sessionTabNew}
                            onClick={onCreate}
                            title="New Chat"
                            onDragOver={(e) => {
                                e.preventDefault();
                                if (this.state.dropTargetIndex !== sessions.length) {
                                    this.setState({ dropTargetIndex: sessions.length });
                                }
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                this.setState({ dropTargetIndex: null });
                                const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                                if (isNaN(sourceIndex)) return;

                                // Append to end
                                const newOrder = [...sessions];
                                const [moved] = newOrder.splice(sourceIndex, 1);
                                newOrder.push(moved);

                                this.props.onReorder(newOrder);
                            }}
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
            </div >
        );
    }
}
