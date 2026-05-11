import React from 'react';
import { SessionStatus } from '../types';
import classNames from 'classnames';
import styles from './SessionBar.module.css';
import { SettingsIcon, AlertCircleIcon, MessageSquareIcon, PlusIcon } from '../icons';
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
    versions: Record<string, number>;
}

interface SessionBarState {
    dropTargetIndex: number | null;
    isHovering: boolean;
    showLeftScroll: boolean;
    showRightScroll: boolean;
    hoveredTabId: string | null;
}

export class SessionBar extends React.Component<
    SessionBarProps,
    SessionBarState
> {
    private tabsRef = React.createRef<HTMLDivElement>();
    private containerRef = React.createRef<HTMLDivElement>();
    private resizeObserver: ResizeObserver | null = null;
    private sessionPreviewTimestamps: Record<string, number> = {};

    constructor(props: SessionBarProps) {
        super(props);
        this.state = {
            dropTargetIndex: null,
            isHovering: false,
            showLeftScroll: false,
            showRightScroll: false,
            hoveredTabId: null,
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

        for (const id of this.props.sessions) {
            if (
                prevProps.statusMap[id] === SessionStatus.BUSY &&
                this.props.statusMap[id] === SessionStatus.IDLE
            ) {
                this.sessionPreviewTimestamps[id] = Date.now();
            }
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
            versions,
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
                        <SettingsIcon size={16} />
                    </button>
                </div>

                <div
                    ref={this.containerRef}
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
                        onScroll={(e) => {
                            this.handleScroll();
                            (e.currentTarget as HTMLDivElement).style.setProperty('--scroll-x', `${e.currentTarget.scrollLeft}px`);
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
                                        onMouseEnter={(e) => {
                                            const tabWidth = e.currentTarget.offsetWidth;
                                            if (this.containerRef.current) {
                                                this.containerRef.current.style.setProperty('--tab-width', `${tabWidth}px`);
                                            }
                                            this.setState({ hoveredTabId: id });
                                        }}
                                        onMouseLeave={() => {
                                            this.setState({ hoveredTabId: null });
                                        }}
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
                                                <AlertCircleIcon size={12} stroke="#ef4444" />
                                            )}
                                            {!isBusy && status !== SessionStatus.ERROR && (
                                                <MessageSquareIcon size={12} fill="currentColor" />
                                            )}
                                        </span>
                                        <span className={styles.sessionTitle}>
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
                                        <div className={classNames(styles.previewTooltip, {
                                            [styles.visible]: this.state.hoveredTabId === id
                                        })}>
                                            <img
                                                src={`${import.meta.env.BASE_URL}api/sessions/${id}/${versions[id] || 0}/preview${this.sessionPreviewTimestamps[id] ? `?t=${this.sessionPreviewTimestamps[id]}` : ''}`}
                                                alt="Preview"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="130" height="220" fill="none" stroke="%23ccc"><rect width="130" height="220" rx="4"/></svg>';
                                                }}
                                            />
                                        </div>
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
                            <PlusIcon size={16} />
                        </button>
                    </div>
                </div>
            </div >
        );
    }
}
