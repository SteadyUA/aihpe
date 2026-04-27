import React from 'react';
import classNames from 'classnames';
import { createMarkedInstance } from '../utils/markdownUtils';

import { UiButton, ButtonVariant, ButtonSize } from './UiButton';
import { UiDropdown } from './UiDropdown';
import { UiTarget } from './UiTarget';
import { ProviderSelector } from './ProviderSelector';
import { DropdownVariant } from './UiDropdown';
import styles from './Chat.module.css';
import { ConfirmationModal } from './ConfirmationModal';
import { RichInput } from './RichInput';
import { MessageData, LlmProvider, ChatAttachment, TokenUsage, Turn, Session, UnsentData, SessionStatus, ChatRole } from '../types';
import { apiAuth } from '../utils/api';
import { UiModal } from './UiModal';
import { ContextMenu } from './ContextMenu';

interface MessageProps {
    msg: MessageData;
    id?: string;
    onSelectChip?: (selector: string) => void;
    onCloneTurn?: (turn: number) => void;
    onPreviewTurn?: (turn: number) => void;
    isActiveTurn?: boolean;
    isDimmed?: boolean;
    isLastAssistant?: boolean;
    status?: SessionStatus;
    onUndo?: () => void;
    sessionIds?: string[];
    onSwitchSession?: (id: string) => void;
    isPending?: boolean;
    statusMessages?: string[];
    startTime?: number;
    sessionId: string;
    onImageLoad?: () => void;
    onQuoteActionClick?: (quoteText: string, rect: DOMRect) => void;
}

const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const DurationTimer: React.FC<{ startTime?: number }> = ({ startTime }) => {
    const [elapsed, setElapsed] = React.useState(0);

    React.useEffect(() => {
        if (!startTime) {
            setElapsed(0);
            return;
        }

        const update = () => {
            const now = Date.now();
            setElapsed(Math.floor((now - startTime) / 1000));
        };

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [startTime]);

    if (!startTime || elapsed <= 0) return null;

    const formatDuration = (totalSeconds: number) => {
        if (totalSeconds < 60) return `${totalSeconds}s`;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m${seconds}s`;
    };

    return (
        <span className={styles.timer}>
            {formatDuration(elapsed)}
        </span>
    );
};

const processContent = (text: string, sessionIds: string[] = [], isLastAssistant: boolean = false) => {
    if (!text) return '';

    let processedText = text;

    if (isLastAssistant) {
        const parts = processedText.split(/\n\n+/);
        if (parts.length > 0) {
            const lastPart = parts.pop() || '';
            const processedLastPart = lastPart.replace(/(?:«([^»]+)»|"([^"]+)")/g, (match, p1, p2) => {
                const word = p1 || p2;
                if (!word) return match;
                return `<span class="${styles.actionableQuote}" data-quote="${word}">${match}</span>`;
            });
            parts.push(processedLastPart);
            processedText = parts.join('\n\n');
        }
    }

    // Simplified Regex to find partial or full session IDs (start with 8 hex chars)
    return processedText.replace(/(`)?\b([0-9a-fA-F]{8}[0-9a-fA-F-]*)(?![0-9a-fA-F-])(?:\.{3}|…)?(`)?/g, (match, _bt1, id, _bt2) => {
        // Case insensitive check
        const matchLower = id.toLowerCase();

        const foundId = sessionIds.find(existingId => {
            const idLower = existingId.toLowerCase();
            return idLower === matchLower || idLower.startsWith(matchLower);
        });

        if (foundId) {
            return `[${id.substring(0, 8)}](#session-${foundId})`;
        }
        return match;
    });
};

const areArraysEqual = (a?: any[], b?: any[]) => {
    if (a === b) return true;
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

class Message extends React.Component<MessageProps> {
    shouldComponentUpdate(nextProps: MessageProps) {
        const { msg, sessionIds, sessionId, statusMessages, ...otherProps } = this.props;
        const { msg: nextMsg, sessionIds: nextSessionIds, sessionId: nextSessionId, statusMessages: nextStatusMessages, ...nextOtherProps } = nextProps;

        // 1. Primitive props check (shallow comparison of the rest)
        const keys = Object.keys(otherProps) as (keyof typeof otherProps)[];
        for (const key of keys) {
            if (otherProps[key] !== nextOtherProps[key]) return true;
        }
        // Also check if nextProps has new keys (though unlikely with TS)
        if (Object.keys(nextOtherProps).length !== keys.length) return true;

        if (sessionId !== nextSessionId) return true;

        // 2. Message content check
        if (msg.content !== nextMsg.content) return true;
        if (msg.role !== nextMsg.role) return true;
        if (msg.turn !== nextMsg.turn) return true;
        if (msg.version !== nextMsg.version) return true;

        // Attachment check (reference or value if needed, simpler to ref check for now)
        if (msg.attachment !== nextMsg.attachment) return true;
        if (msg.selection?.selector !== nextMsg.selection?.selector) return true;

        // 3. Array checks
        if (!areArraysEqual(sessionIds, nextSessionIds)) return true;
        if (!areArraysEqual(statusMessages, nextStatusMessages)) return true;

        return false;
    }

    render() {
        const {
            msg,
            sessionId,
            onSelectChip,
            onCloneTurn,
            onPreviewTurn,
            isActiveTurn,
            isDimmed,
            isLastAssistant,
            status,
            onUndo,
            isPending,
            statusMessages,
            startTime,
        } = this.props;
        const isUser = msg.role === 'user';
        const isAssistant = msg.role === 'assistant';

        const messageClass = classNames(styles.message, {
            [styles.user]: isUser,
            [styles.assistant]: isAssistant,
            [styles.activeTurn]: isActiveTurn,
            [styles.dimmed]: isDimmed,
            [styles.pending]: isPending,
        });

        let statusList = statusMessages || [];
        if (isPending) {
            if (statusList.length === 0) {
                statusList = ['Thinking...'];
            }
        }

        return (
            <div
                id={`msg-session-${sessionId}-turn-${msg.turn}-${msg.role}`}
                className={messageClass}
                onClick={
                    isAssistant && onPreviewTurn
                        ? () => onPreviewTurn(msg.turn!)
                        : undefined
                }
            >
                <div
                    className={styles.messageContent}
                    onClick={(e) => {
                        const target = e.target as HTMLElement;
                        
                        // Check if click was on an actionable quote
                        const quoteSpan = target.closest(`.${styles.actionableQuote}`) as HTMLElement;
                        if (quoteSpan && this.props.onQuoteActionClick) {
                            e.preventDefault();
                            e.stopPropagation();
                            const quoteText = quoteSpan.getAttribute('data-quote');
                            if (quoteText) {
                                this.props.onQuoteActionClick(quoteText, quoteSpan.getBoundingClientRect());
                            }
                            return;
                        }

                        // Check if click was on a session link
                        if (target.tagName === 'A') {
                            const href = target.getAttribute('href');
                            if (href && href.startsWith('#session-')) {
                                e.preventDefault();
                                e.stopPropagation();
                                const sessionId = href.replace('#session-', '');
                                if (this.props.onSwitchSession) {
                                    this.props.onSwitchSession(sessionId);
                                }
                            }
                        }
                    }}
                >
                    {msg.selection && (
                        <div
                            className={styles.selectionChip}
                            onClick={() =>
                                onSelectChip?.(msg.selection!.selector)
                            }
                            title="Click to restore selection"
                        >
                            {msg.selection.selector}
                        </div>
                    )}

                    {/* Render Content */}
                    {isPending ? (
                        (() => {
                            const maxItems = 3;
                            const start = Math.max(0, statusList.length - maxItems);
                            const visibleMessages = statusList.slice(start);
                            const startIndex = start + 1;

                            return (
                                <ol start={startIndex} className={styles.statusList}>
                                    {visibleMessages.map((msg, idx) => (
                                        <li key={start + idx}>{msg}</li>
                                    ))}
                                </ol>
                            );
                        })()
                    ) : (
                        (msg.content || isAssistant || (!msg.attachment && isUser)) && (
                            <div
                                className="message-text"
                                dangerouslySetInnerHTML={{
                                    __html: createMarkedInstance(styles as any).parse(processContent(msg.content || (isAssistant ? '_Changes implemented._' : ''), this.props.sessionIds, isLastAssistant)) as string,
                                }}
                            />
                        )
                    )}

                    {/* Render Attachment as Thumbnail */}
                    {msg.attachment && (
                        <div className={styles.messageAttachments}>
                            <img
                                src={`${import.meta.env.BASE_URL}api/sessions/${this.props.sessionId}/uploads/${msg.attachment.filename}`}
                                alt={msg.attachment.originalName || msg.attachment.filename}
                                className={styles.messageThumbnail}
                                title={msg.attachment.originalName || msg.attachment.filename}
                                onLoad={this.props.onImageLoad}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (msg.attachment) {
                                        window.open(`${import.meta.env.BASE_URL}api/sessions/${this.props.sessionId}/uploads/${msg.attachment.filename}`, '_blank');
                                    }
                                }}
                            />
                        </div>
                    )}

                </div>
                {/* Message Actions */}
                <div className={styles.messageActions}>
                    {isPending && (
                        <>
                            <span className={styles.spinner}></span>
                            <DurationTimer startTime={startTime} />
                        </>
                    )}
                    {/* Timestamp for user messages */}
                    {isUser && msg.createdAt && (
                        <div className={styles.messageMeta}>
                            {formatTime(msg.createdAt)}
                        </div>
                    )}
                    {/* Undo Button for Last Assistant Message */}
                    {isAssistant && isLastAssistant && status !== SessionStatus.BUSY && (
                        <button
                            className={styles.undoButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onUndo) onUndo();
                            }}
                            title="Undo this changes"
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
                                <path d="M9 14 4 9l5-5" />
                                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
                            </svg>
                        </button>
                    )}

                    {/* Clone Turn Button for Assistant Messages */}
                    {isAssistant &&
                        msg.turn !== undefined &&
                        onCloneTurn && (
                            <button
                                className={styles.cloneButton}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloneTurn(msg.turn!);
                                }}
                                title={`Clone from turn ${msg.turn}`}
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <rect
                                        x="9"
                                        y="9"
                                        width="13"
                                        height="13"
                                        rx="2"
                                        ry="2"
                                    ></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                        )}
                    {/* Timestamp for assistant messages */}
                    {isAssistant && !isPending && msg.createdAt && (
                        <div className={styles.messageMeta}>
                            {formatTime(msg.createdAt)}
                        </div>
                    )}
                </div>
            </div>
        );
    }
}

interface ChatProps {
    status: SessionStatus;
    sessionId: string;
    onPickElement?: () => void;
    onCancelPick?: () => void;
    selection?: string | null;
    isPicking?: boolean;
    onClearSelection?: () => void;
    onSelectChip?: (selector: string) => void;
    onCloneTurn?: (turn: number) => void;
    onPreviewTurn?: (turn: number) => void;
    activeTurn: number | null;
    lastTurn: number;
    disabled?: boolean;
    provider?: LlmProvider;
    attachment?: ChatAttachment;
    unsentInput?: string;
    sessionIds?: string[];
    onSwitchSession?: (id: string) => void;
    fastMode?: boolean;
    sessionTitle?: string;
    tokenUsage?: TokenUsage;
    onUpdateSession: (updates: Partial<Session>) => void;
    isVisible?: boolean;
}

interface ChatState {
    isLoading: boolean;
    error: string | null;
    input: string;
    showUndoConfirmation: boolean;
    isUploading: boolean;
    showSummaryModal: boolean;
    summaryContent: string;
    historyLoaded: boolean;
    turns: Turn[];
    statusMessages: string[];
    startTime: number | null;
    contextMenu: { type: 'quote' | 'send'; x: number; y: number; text: string } | null;
}

export class Chat extends React.Component<ChatProps, ChatState> {
    private fileInputRef: React.RefObject<HTMLInputElement | null>;
    private richInputRef = React.createRef<RichInput>();
    private lastSavedUnsent: UnsentData = {};
    private messagesRef = React.createRef<HTMLDivElement>();

    constructor(props: ChatProps) {
        super(props);
        this.fileInputRef = React.createRef();
        this.state = {
            isLoading: false,
            error: null,
            input: props.unsentInput || '',
            isUploading: false,
            showUndoConfirmation: false,
            showSummaryModal: false,
            summaryContent: '',
            historyLoaded: false,

            turns: [],
            statusMessages: [],
            startTime: null,
            contextMenu: null
        };

        this.lastSavedUnsent = {
            input: props.unsentInput || '',
            attachment: props.attachment,
            selection: props.selection
        };
    }

    private isLastTurn(): boolean {
        const { activeTurn, lastTurn } = this.props;
        const effectiveTurn = activeTurn ?? lastTurn;
        return effectiveTurn === lastTurn;
    }

    componentDidMount() {
        if (this.props.sessionId && this.props.isVisible && this.props.status !== SessionStatus.PENDING) {
            this.fetchTurns();
        }

        window.addEventListener('processed-chat-event', this.handleServerMessage as EventListener);
        window.addEventListener('app:turn-completed', this.handleTurnCompleted as EventListener);
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('mousedown', this.handleMouseDown);
    }

    handleTurnCompleted = (event: CustomEvent) => {
        const data = event.detail;
        if (data.sessionId !== this.props.sessionId) return;

        const assistantMsg = data.message;
        if (!assistantMsg) return;

        this.setState(prevState => {
            const turns = [...prevState.turns];
            const index = turns.findIndex(t => t.turn === assistantMsg.turn);
            if (index !== -1) {
                turns[index] = {
                    ...turns[index],
                    ...assistantMsg,
                    response: assistantMsg.content,
                    endTime: assistantMsg.createdAt
                };
            }
            return { turns };
        }, () => {
            this.syncVersion(null);
            this.props.onUpdateSession({ lastTurn: assistantMsg.turn });
            // Scroll to the new message
            setTimeout(() => {
                this.scrollToActiveTurn('smooth', 'end');
            }, 100);
        });
    }

    handleServerMessage = (event: CustomEvent) => {
        const data = event.detail;
        if (data.sessionId !== this.props.sessionId) return;

        if (data.status === 'started') {
            this.setState({
                startTime: Date.now(),
                statusMessages: []
            });
            this.props.onUpdateSession({ status: SessionStatus.BUSY });
        } else if (data.status === 'generating') {
            if (data.message) {
                this.setState(prevState => ({
                    statusMessages: [...prevState.statusMessages, data.message]
                }));
            }
        } else if (data.status === 'idle') {
            this.setState({
                startTime: null,
                statusMessages: []
            });

            const updates: Partial<Session> = { status: SessionStatus.IDLE };
            this.props.onUpdateSession(updates);
        } else if (data.status === 'error') {
            this.setState({ startTime: null });
            if (data.message) {
                this.setState(prevState => ({
                    statusMessages: [...prevState.statusMessages, data.message]
                }));
            }
            this.props.onUpdateSession({ status: SessionStatus.ERROR });
        }
    }


    componentDidUpdate(prevProps: ChatProps, prevState: ChatState) {
        if (prevProps.sessionId !== this.props.sessionId) {
            this.setState({ historyLoaded: false, turns: [] });
            this.fetchTurns();
            return;
        }

        // if (this.props.status === 'idle' && prevProps.status !== 'idle') {
        //     if (this.skipNextFetch) {
        //         this.skipNextFetch = false;
        //     } else {
        //         this.fetchTurns();
        //     }
        // }

        if (!prevProps.isVisible && this.props.isVisible && !this.state.historyLoaded) {
            this.fetchTurns();
        }

        if (prevProps.unsentInput !== this.props.unsentInput && this.props.unsentInput !== undefined) {
            if (this.props.unsentInput !== this.state.input) {
                this.setState({ input: this.props.unsentInput });
            }
        }

        if (prevProps.selection !== this.props.selection) {
            this.handleSaveUnsent({ selection: this.props.selection });
        }

        const statusMessagesChanged = !areArraysEqual(prevState.statusMessages, this.state.statusMessages);
        if (statusMessagesChanged && this.isLastTurn()) {
            this.scrollToActiveTurn('smooth', 'nearest');
        }

        if (prevProps.attachment !== this.props.attachment) {
            this.handleSaveUnsent({ attachment: this.props.attachment });
        }

        const turnChanged = prevProps.activeTurn !== this.props.activeTurn;
        const historyJustLoaded = !prevState.historyLoaded && this.state.historyLoaded;

        if (turnChanged) {
            this.scrollToActiveTurn('smooth', 'nearest');
            this.syncVersion(this.props.activeTurn);
        } else if (historyJustLoaded) {
            this.scrollToActiveTurn('auto', 'nearest');
            this.syncVersion(this.props.activeTurn);
        }
    }

    syncVersion = (activeTurnProp: number | null) => {
        const targetTurn = activeTurnProp ?? this.props.lastTurn;
        const turn = this.state.turns.find(t => t.turn === targetTurn);
        const version = turn?.version ?? 0;

        const lastTurnObj = this.state.turns.find(t => t.turn === this.props.lastTurn);
        const latestVersion = lastTurnObj?.version ?? 0;

        this.props.onUpdateSession({ currentVersion: version, latestVersion });
    }

    scrollToActiveTurn = (behavior: ScrollBehavior = 'smooth', block: ScrollLogicalPosition = 'start', attempts = 0) => {
        const effectiveTurn = this.props.activeTurn ?? this.props.lastTurn;

        // Verify turn exists in data
        const turnExists = this.state.turns.some(t => t.turn === effectiveTurn);
        if (!turnExists && effectiveTurn !== 0) {
            return;
        }

        let el = document.getElementById(`msg-session-${this.props.sessionId}-turn-${effectiveTurn}-assistant`);
        if (!el) {
            el = document.getElementById(`msg-session-${this.props.sessionId}-turn-${effectiveTurn}-user`);
        }

        // Check if element is visible (offsetParent is null if display: none or not in DOM tree)
        const isVisible = el && el.offsetParent !== null;

        if (el && isVisible) {
            el.scrollIntoView({ behavior, block });
        } else if (attempts < 10) {
            // Element might exist but be hidden (e.g. inside a display:none container or before layout)
            // Retry with exponential backoff or just rAF
            setTimeout(() => this.scrollToActiveTurn(behavior, block, attempts + 1), 50 * (attempts + 1));
        }
    };

    componentWillUnmount() {
        window.removeEventListener('processed-chat-event', this.handleServerMessage as EventListener);
        window.removeEventListener('app:turn-completed', this.handleTurnCompleted as EventListener);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('mousedown', this.handleMouseDown);
    }

    handleMouseDown = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('#chat-context-menu')) {
            return;
        }
        if (target.closest(`.${styles.actionableQuote}`)) {
            return;
        }
        if (this.state.contextMenu) {
            this.setState({ contextMenu: null });
        }
    };

    handleMouseUp = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest(`.${styles.actionableQuote}`)) {
            return;
        }

        setTimeout(() => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim() !== '' && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const node = selection.anchorNode;
                
                if (this.messagesRef.current && node && this.messagesRef.current.contains(node)) {
                    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
                    if (element && element.closest('[id$="-assistant"]')) {
                        const rect = range.getBoundingClientRect();
                        this.setState({
                            contextMenu: {
                                type: 'quote',
                                x: rect.right,
                                y: rect.bottom,
                                text: selection.toString()
                            }
                        });
                        return;
                    }
                }
            }
            if (this.state.contextMenu) {
                this.setState({ contextMenu: null });
            }
        }, 10);
    };

    handleQuoteActionClick = (quoteText: string, rect: DOMRect) => {
        if (this.state.contextMenu && this.state.contextMenu.text === quoteText) {
            this.setState({ contextMenu: null });
        } else {
            this.setState({
                contextMenu: {
                    type: 'send',
                    x: rect.right,
                    y: rect.bottom,
                    text: quoteText
                }
            });
        }
    };

    handleUndo = () => {
        this.setState({ showUndoConfirmation: true });
    };

    confirmUndo = async () => {
        this.setState({ showUndoConfirmation: false });
        const { sessionId } = this.props;
        if (!sessionId) return;

        // Optimistic update
        const prevTurns = [...this.state.turns];
        const lastTurnIndex = prevTurns.length - 1;
        if (lastTurnIndex >= 0) {
            const newTurns = prevTurns.slice(0, lastTurnIndex);
            this.setState({ turns: newTurns });
            const prevTurnNum = Math.max(0, this.props.lastTurn - 1);
            this.props.onUpdateSession({
                activeTurn: prevTurnNum,
                lastTurn: prevTurnNum,
            });
        }

        try {
            const res = await apiAuth.fetch(`/api/sessions/${sessionId}/undo`, { method: 'POST' });
            if (!res.ok) throw new Error('Undo failed');
            const data = await res.json();

            if (data.success) {
                // If successful, we arguably don't need to refetch if our optimistic update was correct.
                // But we should sync the input/selection state.

                if (data.restoredInput) {
                    this.setState({ input: data.restoredInput });
                }

                if (data.restoredSelection) {
                    this.props.onUpdateSession({ selection: data.restoredSelection });
                }

                if (data.restoredAttachment) {
                    this.props.onUpdateSession({ attachment: data.restoredAttachment });
                }

                this.props.onUpdateSession({ status: SessionStatus.IDLE });
                this.syncVersion(null);
            } else {
                // Revert optimistic update?
                this.setState({ turns: prevTurns });
                this.props.onUpdateSession({
                    activeTurn: this.props.lastTurn, // Restore (though props might not have updated yet if we did it via onUpdateSession... this is tricky without controlled props)
                });
                // Actually, onUpdateSession updates parent state which flows back down.
                // So we need to undo that.
            }
        } catch (error) {
            console.error('Failed to undo', error);
            // Revert optimistic update
            this.setState({ turns: prevTurns });
            // TODO: Signal error to user
        }

        this.richInputRef.current?.focus(true);
    };

    cancelUndo = () => {
        this.setState({ showUndoConfirmation: false });
    };

    public focus(toEnd: boolean = false) {
        this.richInputRef.current?.focus(toEnd);
    }

    fetchTurns = async (beforeTurn?: number): Promise<{ count: number; hasMore: boolean }> => {
        const id = this.props.sessionId;
        if (!id) return { count: 0, hasMore: false };

        this.setState({ isLoading: true });

        try {
            const url = `/api/sessions/${id}/turns` + (beforeTurn !== undefined ? `?before=${beforeTurn}` : '');
            const res = await apiAuth.fetch(url);
            if (!res.ok) throw new Error('Failed to fetch turns');
            const data: { turns: Turn[] } = await res.json();
            const newlyFetched = data.turns;

            let finalTurns: Turn[];
            if (beforeTurn !== undefined) {
                finalTurns = [...newlyFetched, ...this.state.turns];
                this.setState({ turns: finalTurns, historyLoaded: true, isLoading: false }, () => {
                    this.syncVersion(this.props.activeTurn);
                });
            } else {
                finalTurns = newlyFetched;
                this.setState({ turns: finalTurns, historyLoaded: true, isLoading: false }, () => {
                    this.syncVersion(this.props.activeTurn);
                });
            }

            return { count: newlyFetched.length, hasMore: newlyFetched.length > 0 };
        } catch (e) {
            console.error('Failed to fetch turns', e);
            this.setState({ isLoading: false });
            return { count: 0, hasMore: false };
        }
    };

    handleSaveUnsent = async (data: { input?: string | null, attachment?: ChatAttachment | null, selection?: string | null, provider?: LlmProvider | null, fastMode?: boolean }) => {
        const { sessionId } = this.props;
        if (!sessionId) return;

        let hasChanges = false;
        const keys = Object.keys(data) as (keyof typeof data)[];

        for (const key of keys) {
            const newValue = data[key];
            const oldValue = this.lastSavedUnsent[key];

            if (key === 'attachment') {
                const newAtt = newValue as ChatAttachment | null | undefined;
                const oldAtt = oldValue as ChatAttachment | null | undefined;
                if (newAtt?.filename !== oldAtt?.filename) {
                    hasChanges = true;
                    break;
                }
            } else if (key === 'input') {
                const newIn = ((newValue as string | null | undefined) || '').trim();
                const oldIn = ((oldValue as string | null | undefined) || '').trim();
                if (newIn !== oldIn) {
                    hasChanges = true;
                    break;
                }
            } else {
                if (newValue !== oldValue) {
                    hasChanges = true;
                    break;
                }
            }
        }

        if (!hasChanges) return;

        try {
            await apiAuth.fetch(`/api/sessions/${sessionId}/unsent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            this.lastSavedUnsent = { ...this.lastSavedUnsent, ...data };
        } catch (e) {
            console.error('Failed to save unsent data', e);
        }

        if (data.input !== undefined) {
            // Only update session if the input hasn't changed in the meantime (e.g. cleared by sendMessage)
            const currentInput = (this.state.input || '').trim();
            const savedInput = (data.input || '').trim();
            if (currentInput === savedInput) {
                this.props.onUpdateSession({ input: data.input || undefined });
            }
        }
    };

    sendMessage = async (text: string) => {
        const { sessionId, provider, fastMode, selection, attachment } = this.props;
        if (!sessionId) return;

        const selectionData = selection ? { selector: selection } : undefined;
        const nextTurn = this.props.lastTurn + 1;

        const optimisticTurn: Turn = {
            turn: nextTurn,
            beginTime: new Date().toISOString(),
            request: text,
            response: '',
            provider: provider,
            fastMode: fastMode,
            selection: selectionData,
            attachment: attachment,
            version: (this.state.turns.find(t => t.turn === this.props.lastTurn)?.version || 0)
        };

        const newTurns = [...this.state.turns, optimisticTurn];

        this.setState({ turns: newTurns });

        this.props.onUpdateSession({
            status: SessionStatus.BUSY,
            selection: null,
            activeTurn: nextTurn,
            lastTurn: nextTurn,
            attachment: undefined,
            input: undefined
        });

        this.setState({ input: '' });

        try {
            const res = await apiAuth.fetch(`/api/sessions/${sessionId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    attachment,
                    selection: selectionData,
                    provider: provider,
                    fastMode: fastMode,
                }),
            });

            const data = await res.json();

            this.props.onUpdateSession({
                lastTurn: data.turn,
                activeTurn: data.turn,
            });

        } catch (e) {
            console.error('Failed to send message', e);
            this.props.onUpdateSession({ status: SessionStatus.ERROR });
        }
    };

    handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (this.props.disabled) return;

        if (this.state.input.trim() || this.props.attachment) {
            this.sendMessage(this.state.input);
        }
    };

    handleParallelGeneration = async (count: number, overrideText?: string) => {
        const { sessionId, provider, fastMode, selection, attachment } = this.props;
        if (!sessionId) return;

        const selectionData = selection ? { selector: selection } : undefined;
        const text = overrideText !== undefined ? overrideText : this.state.input;

        // Clear UI state as the messages are sent
        if (overrideText === undefined) {
            this.setState({ input: '' });
        }
        this.props.onUpdateSession({
            selection: null,
            attachment: undefined,
            input: undefined
        });

        try {
            const res = await apiAuth.fetch(`/api/sessions/${sessionId}/parallel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    attachment,
                    selection: selectionData,
                    provider: provider,
                    fastMode: fastMode,
                    count: count
                }),
            });

            if (!res.ok) {
                console.error('Failed to start parallel generation');
            }
        } catch (e) {
            console.error('Error starting parallel generation', e);
        }
    };

    handleRichInputChange = (value: string) => {
        this.setState({ input: value });
    };

    performUpload = async (file: File) => {
        const { sessionId } = this.props;
        if (!sessionId) return;

        this.setState({ isUploading: true });
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await apiAuth.fetch(`/api/sessions/${sessionId}/uploads`, {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();

            const attachment: ChatAttachment = {
                type: 'image',
                filename: data.filename,
                id: data.id ? data.id.toString() : undefined,
                originalName: data.originalName
            };

            this.props.onUpdateSession({ attachment });
        } catch (error) {
            console.error('Upload failed', error);
        } finally {
            this.setState({ isUploading: false });
        }
    }

    handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (
            e.target.files &&
            e.target.files.length > 0
        ) {
            const file = e.target.files[0];
            await this.performUpload(file);
            if (this.fileInputRef.current) {
                this.fileInputRef.current.value = '';
            }
        }
    };

    handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                if (blob) {
                    e.preventDefault();
                    await this.performUpload(blob);
                    return;
                }
            }
        }

        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
            if (file) {
                e.preventDefault();
                await this.performUpload(file);
                return;
            }
        }
    };

    handleImageSrcPaste = async (src: string) => {
        try {
            let blob: Blob | null = null;
            let filename = 'pasted-image.png';

            if (src.startsWith('data:')) {
                const res = await fetch(src);
                blob = await res.blob();
                const type = blob.type;
                const ext = type.split('/')[1] || 'png';
                filename = `pasted-image.${ext}`;
            } else {
                try {
                    const res = await fetch(src);
                    if (res.ok) {
                        blob = await res.blob();
                        const urlParts = src.split('/');
                        const lastPart = urlParts[urlParts.length - 1];
                        if (lastPart) filename = lastPart.split('?')[0];
                    }
                } catch (e) {
                    console.warn('Failed to fetch pasted image src', src, e);
                    return;
                }
            }

            if (blob) {
                const file = new File([blob], filename, { type: blob.type });
                this.performUpload(file);
            }
        } catch (e) {
            console.error('Error handling pasted image src', e);
        }
    };

    handleStop = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const { sessionId } = this.props;
        if (!sessionId) return;

        // Optimistic update: Remove the partial/pending turn
        const prevTurns = [...this.state.turns];
        const lastTurnIndex = prevTurns.length - 1;
        let newTurns = prevTurns;

        if (lastTurnIndex >= 0) {
            newTurns = prevTurns.slice(0, lastTurnIndex);
        }

        this.setState({ turns: newTurns });

        const prevTurnNum = Math.max(0, this.props.lastTurn - 1);
        const prevSessionState = {
            status: this.props.status,
            activeTurn: this.props.activeTurn,
            lastTurn: this.props.lastTurn
        };

        this.props.onUpdateSession({
            status: SessionStatus.IDLE,
            activeTurn: prevTurnNum,
            lastTurn: prevTurnNum
        });

        try {
            const res = await apiAuth.fetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
            if (!res.ok) throw new Error('Stop failed');
            const data = await res.json();

            if (data.success) {
                if (data.restoredInput) {
                    this.setState({ input: data.restoredInput });
                }

                if (data.restoredSelection) {
                    this.props.onUpdateSession({ selection: data.restoredSelection });
                }

                if (data.restoredAttachment) {
                    this.props.onUpdateSession({ attachment: data.restoredAttachment });
                }

                this.syncVersion(null);
            } else {
                // Revert if server says failed
                throw new Error('Stop returned success=false');
            }
        } catch (error) {
            console.error('Failed to stop', error);
            // Revert state
            this.setState({ turns: prevTurns });
            this.props.onUpdateSession(prevSessionState as Partial<Session>);
        }
    };

    removeAttachment = async () => {
        const { sessionId, attachment } = this.props;
        if (attachment) {
            // 1. Explicitly clear unsent state via the /unsent endpoint
            this.handleSaveUnsent({ attachment: null });

            // 2. Perform actual file deletion
            if (sessionId) {
                try {
                    await apiAuth.fetch(`/api/sessions/${sessionId}/uploads/${attachment.filename}`, {
                        method: 'DELETE'
                    });
                } catch (error) {
                    console.error('Failed to delete attachment', error);
                }
            }
        }
        this.props.onUpdateSession({ attachment: undefined });
    };

    public submit = (text: string) => {
        if (this.props.disabled) return;
        this.sendMessage(text);
        this.props.onUpdateSession({ attachment: undefined });
    };

    handlePreviewTurn = (turn: number) => {
        if (this.props.onPreviewTurn) {
            this.props.onPreviewTurn(turn);
        }
    };

    handleContainerClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const interactiveTags = ['SELECT'];

        let el: HTMLElement | null = target;
        while (el && el !== e.currentTarget) {
            if (interactiveTags.includes(el.tagName)) {
                return;
            }
            if (el.getAttribute('contenteditable') === 'true') return;
            el = el.parentElement;
        }

        this.richInputRef.current?.focus();
    };



    handleSessionTitleClick = async () => {
        if (!this.props.sessionId) return;

        try {
            const res = await apiAuth.fetch(`/api/sessions/${this.props.sessionId}/summary`);
            if (res.ok) {
                const data = await res.json();
                this.setState({
                    summaryContent: data.summary || 'No summary available yet.',
                    showSummaryModal: true
                });
            } else {
                console.error('Failed to fetch summary');
            }
        } catch (e) {
            console.error('Error fetching summary', e);
        }
    };

    closeSummaryModal = () => {
        this.setState({ showSummaryModal: false });
    };

    private imageLoadTimeout: ReturnType<typeof setTimeout> | null = null;
    handleImageLoad = () => {
        if (this.imageLoadTimeout) {
            clearTimeout(this.imageLoadTimeout);
        }
        this.imageLoadTimeout = setTimeout(() => {
            if (this.isLastTurn()) {
                this.scrollToActiveTurn('auto', 'end');
            } else {
                this.scrollToActiveTurn('auto', 'start');
            }
        }, 100);
    };

    render() {
        const {
            status,
            onPickElement,
            onCancelPick,
            selection,
            isPicking,
            activeTurn,
            onCloneTurn,
            onPreviewTurn,
            disabled,
            provider,
            attachment,
            onClearSelection,
            onSelectChip,
            sessionIds,
            onSwitchSession,
            sessionTitle,

        } = this.props;
        const { input, isUploading, isLoading, showSummaryModal, summaryContent, turns } = this.state;
        const isFormDisabled = status === SessionStatus.BUSY || disabled;

        const messages: MessageData[] = [];
        turns.forEach(t => {
            messages.push({
                role: ChatRole.USER,
                content: t.request,
                turn: t.turn,
                createdAt: t.beginTime,
                selection: t.selection,
                attachment: t.attachment
            });
            if (t.response || t.endTime) {
                messages.push({
                    role: ChatRole.ASSISTANT,
                    content: t.response,
                    turn: t.turn,
                    version: t.version,
                    createdAt: t.endTime
                });
            }
        });

        let foundActive = false;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                break;
            }
        }

        const latestTurn = this.props.lastTurn;
        const isPendingActive = this.isLastTurn();
        const shouldPendingDim = foundActive && !isPendingActive;

        return (
            <div className={styles.chatPanel}>
                <div className={styles.sessionHeader}>
                    <span
                        className={styles.sessionTitle}
                        onClick={this.handleSessionTitleClick}
                        title={sessionTitle}
                    >
                        {sessionTitle || '...'}
                    </span>
                    {(this.props.tokenUsage && this.props.tokenUsage.capacity) && (
                        <div className={styles.tokenUsage}>
                            <span>
                                Context: {(((this.props.tokenUsage.request || this.props.tokenUsage.total) / this.props.tokenUsage.capacity) * 100).toFixed(1)}%
                            </span>
                            <div className={styles.tokenTooltip}>
                                <div>Context: {(this.props.tokenUsage.request || this.props.tokenUsage.total).toLocaleString()} / {this.props.tokenUsage.capacity.toLocaleString()}</div>
                                <hr style={{ margin: '4px 0', borderColor: 'rgba(255,255,255,0.1)' }} />
                                <div>Prompt: {this.props.tokenUsage.prompt.toLocaleString()}</div>
                                <div>Completion: {this.props.tokenUsage.completion.toLocaleString()}</div>
                                <hr style={{ margin: '4px 0', borderColor: 'rgba(255,255,255,0.1)' }} />
                                <div>Total: {this.props.tokenUsage.total.toLocaleString()}</div>
                            </div>
                        </div>
                    )}
                </div>
                <div className={styles.messages}>
                    <div ref={this.messagesRef} className={styles.messagesContent}>
                        {isLoading && <div className={styles.spinner} />}
                        <div>
                            {messages.map((m, i) => {
                                const effectiveActiveTurn = activeTurn ?? this.props.lastTurn;
                                const isTurnMatch =
                                    m.role === 'assistant' &&
                                    typeof m.turn === 'number' &&
                                    m.turn === effectiveActiveTurn;

                                if (isTurnMatch) foundActive = true;


                                return (
                                    <Message
                                        id={
                                            m.role === 'assistant' && typeof m.turn === 'number'
                                                ? `msg-turn-${m.turn}`
                                                : undefined
                                        }
                                        key={i}
                                        msg={m}
                                        sessionIds={this.props.sessionIds}
                                        sessionId={this.props.sessionId}
                                        onSelectChip={onSelectChip}
                                        onCloneTurn={onCloneTurn}
                                        onPreviewTurn={onPreviewTurn}
                                        isActiveTurn={effectiveActiveTurn === m.turn}
                                        isDimmed={effectiveActiveTurn !== null && m.turn! > effectiveActiveTurn}
                                        isLastAssistant={i === messages.length - 1 && m.role === 'assistant'}
                                        status={status}
                                        onUndo={this.handleUndo}
                                        isPending={false}
                                        statusMessages={this.state.statusMessages}
                                        startTime={this.state.startTime ?? undefined}
                                        onSwitchSession={onSwitchSession}
                                        onQuoteActionClick={this.handleQuoteActionClick}
                                    />
                                );
                            })}
                        </div>
                        {status === SessionStatus.BUSY && (
                            <Message
                                id={
                                    latestTurn
                                        ? `msg-turn-${latestTurn}`
                                        : undefined
                                }
                                msg={{
                                    role: ChatRole.ASSISTANT,
                                    content: '',
                                    turn: latestTurn,
                                    version: 0,
                                }}
                                sessionId={this.props.sessionId}
                                statusMessages={this.state.statusMessages}
                                startTime={this.state.startTime || undefined}
                                isPending={true}
                                isActiveTurn={isPendingActive}
                                isDimmed={shouldPendingDim}
                                onPreviewTurn={onPreviewTurn}
                                sessionIds={sessionIds}
                                onSwitchSession={onSwitchSession}
                                onQuoteActionClick={this.handleQuoteActionClick}
                            />
                        )}
                    </div>
                </div>

                {status === SessionStatus.ERROR ? (
                    <div className={styles.chatForm}>
                        <div className={styles.errorContainer}>
                            <div className={styles.errorMessage}>
                                <h3>An error occurred</h3>
                                <p>{this.state.statusMessages && this.state.statusMessages.length > 0 ? this.state.statusMessages[this.state.statusMessages.length - 1] : 'Unknown error'}</p>
                            </div>
                            <UiButton
                                variant={ButtonVariant.SECONDARY}
                                onClick={this.handleUndo}
                            >
                                Undo last turn
                            </UiButton>
                        </div>
                    </div>
                ) : (
                    <form className={styles.chatForm} onSubmit={this.handleSubmit}>
                        <div className={classNames(styles.inputContainer, { [styles.busy]: status === SessionStatus.BUSY })} onClick={this.handleContainerClick}>
                            <div className={styles.selections}>
                                {selection && (
                                    <div className={styles.pickerContainer}>
                                        <UiTarget onRemove={onClearSelection} removeTitle="Clear selection" disabled={isFormDisabled}>
                                            <code className={styles.selectionValue}>{selection}</code>
                                        </UiTarget>
                                    </div>
                                )}

                                {attachment && (
                                    <div className={styles.attachmentList}>
                                        <UiTarget onRemove={this.removeAttachment} removeTitle="Remove attachment" disabled={isFormDisabled}>
                                            <img
                                                src={`${import.meta.env.BASE_URL}api/sessions/${this.props.sessionId}/uploads/${attachment.filename}`}
                                                alt={attachment.originalName || attachment.filename}
                                                className={styles.imagePreview}
                                                title={attachment.originalName || attachment.filename}
                                            />
                                        </UiTarget>
                                    </div>
                                )}
                            </div>

                            <RichInput
                                ref={this.richInputRef}
                                value={input}
                                onChange={this.handleRichInputChange}
                                onPaste={this.handlePaste}
                                onImagePaste={this.handleImageSrcPaste}
                                placeholder={isFormDisabled ? "Please wait..." : "Describe changes..."}
                                disabled={isFormDisabled}
                                tabIndex={1}
                                className={styles.headlessInput}
                                editorClassName={styles.headlessEditor}
                                onBlur={() => {
                                    this.handleSaveUnsent({ input: this.state.input });
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        this.handleSubmit(e);
                                    }
                                }}
                            />

                            <div className={styles.inputControls}>
                                <div className={styles.inputControlsLeft}>
                                    <UiButton
                                        type="button"
                                        variant={isPicking ? ButtonVariant.GHOST_ACTIVE : ButtonVariant.GHOST}
                                        size={ButtonSize.ICON}
                                        onClick={isPicking ? onCancelPick : onPickElement}
                                        disabled={isFormDisabled}
                                        title={isPicking ? "Cancel selection" : "Select element"}
                                    >
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M1 1h4" />
                                            <path d="M1 1v4" />
                                            <path d="M1 23v-4" />
                                            <path d="M1 23h4" />
                                            <path d="M23 1h-4" />
                                            <path d="M23 1v4" />
                                            <path d="M10 1h4" />
                                            <path d="M1 10v4" />
                                            <path d="M23 10v4" />
                                            <path d="M10 23h4" />
                                            <path d="M21 21l-9-9" />
                                            <path d="M12 12l8 3" />
                                            <path d="M12 12l3 8" />
                                        </svg>
                                    </UiButton>

                                    <div>
                                        <input
                                            type="file"
                                            ref={this.fileInputRef}
                                            style={{ display: 'none' }}
                                            onChange={this.handleFileChange}
                                            accept="image/*"
                                        />
                                        <UiButton
                                            type="button"
                                            variant={ButtonVariant.GHOST}
                                            size={ButtonSize.ICON}
                                            onClick={() => this.fileInputRef.current?.click()}
                                            disabled={isFormDisabled || isUploading || !!attachment}
                                            title={!!attachment ? "Only one attachment allowed" : "Attach image"}
                                        >
                                            {isUploading ? (
                                                <span className={styles.spinner} style={{ width: 14, height: 14, margin: 0, borderWidth: 2 }}></span>
                                            ) : (
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
                                                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                                </svg>
                                            )}
                                        </UiButton>
                                    </div>

                                    <UiDropdown
                                        value={this.props.fastMode ? 'fast' : 'plan'}
                                        options={[
                                            { value: 'plan', label: 'Planning' },
                                            { value: 'fast', label: 'Fast mode' }
                                        ]}
                                        onChange={(val) => {
                                            this.props.onUpdateSession({ fastMode: val === 'fast' });
                                            this.handleSaveUnsent({ fastMode: val === 'fast' });
                                        }}
                                        disabled={isFormDisabled}
                                        variant={DropdownVariant.GHOST}
                                    />
                                    <ProviderSelector
                                        value={provider}
                                        onChange={(p) => {
                                            this.props.onUpdateSession({ provider: p });
                                            this.handleSaveUnsent({ provider: p });
                                        }}
                                        disabled={isFormDisabled || isLoading || isUploading}
                                        className={styles.imageToggle}
                                        variant={DropdownVariant.GHOST}
                                    />
                                </div>

                                <div className={styles.inputControlsRight}>
                                    {status === SessionStatus.BUSY ? (
                                        <UiButton
                                            type="button"
                                            variant={ButtonVariant.SECONDARY}
                                            size={ButtonSize.ICON}
                                            onClick={this.handleStop}
                                            title="Stop generation"
                                            className={styles.stopButton}
                                        >
                                            <svg
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                                stroke="currentColor"
                                                strokeWidth="0"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                                            </svg>
                                        </UiButton>
                                    ) : (
                                        <div className={styles.sendButtonGroup}>
                                            <UiButton
                                                type="submit"
                                                variant={ButtonVariant.PRIMARY}
                                                size={ButtonSize.ICON}
                                                disabled={isFormDisabled || (!input.trim() && !attachment)}
                                                tabIndex={2}
                                                onClick={this.handleSubmit}
                                                className={styles.mainSendButton}
                                                title="Send"
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
                                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                                </svg>
                                            </UiButton>
                                            <div className={classNames(styles.parallelButtonWrapper, { [styles.disabledWrapper]: isFormDisabled || (!input.trim() && !attachment) })}>
                                                <select
                                                    className={styles.parallelSelect}
                                                    title="Run generation in new sessions"
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val) {
                                                            this.handleParallelGeneration(parseInt(val));
                                                            e.target.value = '';
                                                        }
                                                    }}
                                                    value=""
                                                    disabled={isFormDisabled || (!input.trim() && !attachment)}
                                                >
                                                    <option value="" disabled hidden></option>
                                                    {[1, 2, 3, 4, 5].map(num => (
                                                        <option key={num} value={num}>{num} {num === 1 ? 'session' : 'sessions'}</option>
                                                    ))}
                                                </select>
                                                <div className={styles.parallelIcon}>
                                                    <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    >
                                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </form>
                )}

                <UiModal
                    isOpen={showSummaryModal}
                    title={sessionTitle || 'Session Summary'}
                    onClose={this.closeSummaryModal}
                    actions={
                        <UiButton onClick={this.closeSummaryModal}>Close</UiButton>
                    }
                >
                    <div style={{ whiteSpace: 'pre-wrap' }}>
                        {summaryContent}
                    </div>
                </UiModal>

                <ConfirmationModal
                    isOpen={this.state.showUndoConfirmation}
                    title="Undo Changes"
                    message="Are you sure you want to undo the last change? This will revert the conversation and files to the previous state."
                    onConfirm={this.confirmUndo}
                    onCancel={this.cancelUndo}
                />

                {this.state.contextMenu && (
                    <ContextMenu
                        x={this.state.contextMenu.x + 5}
                        y={this.state.contextMenu.y + 5}
                        onClose={() => this.setState({ contextMenu: null })}
                        items={(() => {
                            const text = this.state.contextMenu?.text || '';
                            if (this.state.contextMenu?.type === 'send') {
                                return [
                                    {
                                        id: 'send',
                                        label: 'Send',
                                        icon: (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                            </svg>
                                        ),
                                        onClick: () => {
                                            this.setState({ contextMenu: null }, () => this.submit(text));
                                        }
                                    },
                                    {
                                        id: 'run-parallel',
                                        label: 'Run parallel',
                                        icon: (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                <path d="M5 15H4a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2h9a2 2 0 0 1 2 2v1"></path>
                                            </svg>
                                        ),
                                        subItems: [1, 2, 3, 4, 5].map(num => ({
                                            id: `parallel-${num}`,
                                            label: `${num} sessions`,
                                            onClick: () => {
                                                this.setState({ contextMenu: null }, () => {
                                                    this.handleParallelGeneration(num, text);
                                                });
                                            }
                                        }))
                                    }
                                ];
                            } else {
                                return [
                                    {
                                        id: 'quote',
                                        label: 'Quote',
                                        icon: (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                                <path d="M8 12a2 2 0 0 0 2-2V8H8"/>
                                                <path d="M14 12a2 2 0 0 0 2-2V8h-2"/>
                                            </svg>
                                        ),
                                        onClick: () => {
                                            if (text) {
                                                const quoteLines = text.split('\n').map(line => `> ${line}`).join('\n');
                                                const quoteMd = `${quoteLines}\n\n`;
                                                const currentInput = this.state.input.trim();
                                                const newInput = currentInput ? `${currentInput}\n\n${quoteMd}` : quoteMd;
                                                
                                                this.setState({ input: newInput, contextMenu: null }, () => {
                                                    this.handleSaveUnsent({ input: newInput });
                                                    this.richInputRef.current?.focus(true);
                                                });
                                            } else {
                                                this.setState({ contextMenu: null });
                                            }
                                        }
                                    }
                                ];
                            }
                        })()}
                    />
                )}
            </div>
        );
    }
}
