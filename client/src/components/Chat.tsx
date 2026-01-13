import React from 'react';
import classNames from 'classnames';
import { createMarkedInstance } from '../utils/markdownUtils';

import { UiButton } from './UiButton';
import { UiDropdown } from './UiDropdown';
import { UiTarget } from './UiTarget';
import { ProviderSelector } from './ProviderSelector';
import styles from './Chat.module.css';
import { ConfirmationModal } from './ConfirmationModal';
import { RichInput } from './RichInput';
import { MessageData, LlmProvider, ChatAttachment } from '../types';



interface MessageProps {
    msg: MessageData;
    id?: string;
    onSelectChip?: (selector: string) => void;
    onCloneTurn?: (turn: number) => void;
    onPreviewTurn?: (turn: number) => void;
    isActiveTurn?: boolean;
    isDimmed?: boolean;
    isLastAssistant?: boolean;
    status?: string;
    onUndo?: () => void;
    sessionIds?: string[];
    onSwitchSession?: (id: string) => void;
    isPending?: boolean;
    statusMessages?: string[];
    startTime?: number;
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

    return (
        <span className={styles.timer}>
            {`${elapsed}s`}
        </span>
    );
};

const processContent = (text: string, sessionIds: string[] = []) => {
    if (!text) return '';

    // Simplified Regex to find partial or full session IDs (start with 8 hex chars)
    return text.replace(/(`)?\b([0-9a-fA-F]{8}[0-9a-fA-F-]*)(?![0-9a-fA-F-])(?:\.{3}|…)?(`)?/g, (match, _bt1, id, _bt2) => {
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
        const { msg, sessionIds, statusMessages, ...otherProps } = this.props;
        const { msg: nextMsg, sessionIds: nextSessionIds, statusMessages: nextStatusMessages, ...nextOtherProps } = nextProps;

        // 1. Primitive props check (shallow comparison of the rest)
        const keys = Object.keys(otherProps) as (keyof typeof otherProps)[];
        for (const key of keys) {
            if (otherProps[key] !== nextOtherProps[key]) return true;
        }
        // Also check if nextProps has new keys (though unlikely with TS)
        if (Object.keys(nextOtherProps).length !== keys.length) return true;

        // 2. Message content check
        if (msg.content !== nextMsg.content) return true;
        if (msg.role !== nextMsg.role) return true;
        if (msg.turn !== nextMsg.turn) return true;
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
            id,
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

        return (
            <div
                id={id}
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
                        // Check if click was on a session link
                        const target = e.target as HTMLElement;
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
                        statusMessages && statusMessages.length > 0 ? (
                            (() => {
                                const maxItems = 3;
                                const start = Math.max(0, statusMessages.length - maxItems);
                                const visibleMessages = statusMessages.slice(start);
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
                            <span className={styles.blinkingCursor}>▋</span>
                        )
                    ) : (
                        (msg.content || (!msg.attachment && isUser)) && (
                            <div
                                className="message-text"
                                dangerouslySetInnerHTML={{
                                    __html: createMarkedInstance(styles as any).parse(processContent(msg.content, this.props.sessionIds)) as string,
                                }}
                            />
                        )
                    )}

                    {/* Render Attachment as Thumbnail */}
                    {msg.attachment && (
                        <div className={styles.messageAttachments}>
                            <img
                                src={msg.attachment.url}
                                alt={msg.attachment.originalName || msg.attachment.filename}
                                className={styles.messageThumbnail}
                                title={msg.attachment.originalName || msg.attachment.filename}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (msg.attachment) {
                                        window.open(msg.attachment.url, '_blank');
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
                    {isAssistant && isLastAssistant && status !== 'busy' && (
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
                </div>
            </div>
        );
    }
}

interface ChatProps {
    messages: MessageData[];
    onSend: (text: string) => void;
    status: string;
    statusMessages?: string[]; // Renamed from statusMessage, now array
    startTime?: number | null; // For timer
    // New props for toolbar features
    onPickElement?: () => void;
    onCancelPick?: () => void;
    selection?: string | null;
    isPicking?: boolean;
    onClearSelection?: () => void;
    onSelectChip?: (selector: string) => void;
    onCloneTurn?: (turn: number) => void;
    onPreviewTurn?: (turn: number) => void;
    activeTurn?: number | null;
    disabled?: boolean;

    provider?: LlmProvider;
    onProviderChange?: (provider: LlmProvider) => void;
    onUndo?: () => Promise<{ restoredInput?: string } | void>;
    onUpload?: (file: File) => Promise<ChatAttachment>;
    onDeleteAttachment?: (attachment: ChatAttachment) => void;
    attachment?: ChatAttachment;
    onAttachmentChange?: (attachment?: ChatAttachment) => void;
    unsentInput?: string;
    onSaveUnsent?: (data: { input?: string | null }) => void;
    sessionIds?: string[];
    onSwitchSession?: (id: string) => void;
    fastMode?: boolean;
    onFastModeChange?: (value: boolean) => void;
    sessionTitle?: string;

}

interface ChatState {
    isLoading: boolean;
    error: string | null;
    input: string;
    showUndoConfirmation: boolean;
    isUploading: boolean;
}

export class Chat extends React.Component<ChatProps, ChatState> {
    private messagesEndRef: React.RefObject<HTMLDivElement | null>;
    private fileInputRef: React.RefObject<HTMLInputElement | null>;
    private isUserScroll = false;
    private richInputRef = React.createRef<RichInput>();

    constructor(props: ChatProps) {
        super(props);
        this.state = {
            isLoading: false,
            error: null,
            input: '',
            isUploading: false,
            showUndoConfirmation: false,
        };
        if (props.unsentInput) {
            this.state = {
                ...this.state,
                input: props.unsentInput
            };
        }
        this.messagesEndRef = React.createRef();
        this.fileInputRef = React.createRef();
    }

    componentDidMount() {
        if (this.props.activeTurn !== null && this.props.activeTurn !== undefined) {
            this.scrollToTurn(this.props.activeTurn);
        } else {
            this.scrollToBottom();
        }
    }

    componentDidUpdate(prevProps: ChatProps) {
        const lastMsg = this.props.messages[this.props.messages.length - 1];
        const prevLastMsg = prevProps.messages[prevProps.messages.length - 1];
        const contentChanged = lastMsg?.content !== prevLastMsg?.content;

        if (
            prevProps.messages.length !== this.props.messages.length ||
            prevProps.statusMessages?.length !== this.props.statusMessages?.length ||
            prevProps.status !== this.props.status ||
            contentChanged
        ) {
            const isAtBottom = this.props.activeTurn === null || this.props.activeTurn === undefined;
            const isLatestTurnActive = lastMsg && typeof lastMsg.turn === 'number' && this.props.activeTurn === lastMsg.turn;

            if (isAtBottom || isLatestTurnActive) {
                this.scrollToBottom();
            }
        }

        if (prevProps.activeTurn !== this.props.activeTurn) {
            if (this.isUserScroll) {
                this.isUserScroll = false;
            } else if (this.props.activeTurn !== null && this.props.activeTurn !== undefined) {
                this.scrollToTurn(this.props.activeTurn);
            } else {
                this.scrollToBottom();
            }
        }

        if (prevProps.unsentInput !== this.props.unsentInput && this.props.unsentInput !== undefined) {
            if (this.props.unsentInput !== this.state.input) {
                this.setState({ input: this.props.unsentInput });
            }
        }

        const justFinishedPicking = prevProps.isPicking && !this.props.isPicking;
        const justClearedSelection = prevProps.selection && !this.props.selection;
        const attachmentChanged = prevProps.attachment !== this.props.attachment;
        const providerChanged = prevProps.provider !== this.props.provider;
        const fastModeChanged = prevProps.fastMode !== this.props.fastMode;

        if (justFinishedPicking || justClearedSelection || (attachmentChanged && !this.state.isUploading) || providerChanged || fastModeChanged) {
            this.richInputRef.current?.focus();
        }
    }

    componentWillUnmount() {
    }


    handleUndo = () => {
        this.setState({ showUndoConfirmation: true });
    };

    confirmUndo = async () => {
        this.setState({ showUndoConfirmation: false });
        if (this.props.onUndo) {
            const result = await this.props.onUndo();
            if (result && typeof result.restoredInput === 'string') {
                this.setState({ input: result.restoredInput });
            }
        }
    };

    cancelUndo = () => {
        this.setState({ showUndoConfirmation: false });
    };

    scrollToBottom = () => {
        this.messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    scrollToTurn = (turn: number) => {
        // Use timeout to allow render to complete if necessary
        setTimeout(() => {
            const el = document.getElementById(`msg-turn-${turn}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    };

    public submit = (text: string) => {
        if (this.props.disabled) return;
        this.props.onSend(text);
        if (this.props.onAttachmentChange) {
            this.props.onAttachmentChange(undefined);
        }
    };

    handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (this.props.disabled) return;

        if (this.state.input.trim() || this.props.attachment) {
            this.props.onSend(this.state.input);
            this.setState({ input: '' });
            // Clear attachment after sending
            if (this.props.onAttachmentChange) {
                this.props.onAttachmentChange(undefined);
            }
        }
    };

    handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        this.setState({ input: e.target.value });
    };

    handleRichInputChange = (value: string) => {
        this.setState({ input: value });
    };

    performUpload = async (file: File) => {
        if (!this.props.onUpload) return;

        this.setState({ isUploading: true });
        try {
            const attachment = await this.props.onUpload(file);
            // Single file limit: Replace any existing
            if (this.props.onAttachmentChange) {
                this.props.onAttachmentChange(attachment);
            }
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
            // Reset input
            if (this.fileInputRef.current) {
                this.fileInputRef.current.value = '';
            }
        }
    };

    handlePaste = async (e: React.ClipboardEvent) => {
        // Prioritize finding images in clipboard items (covers screenshots and files)
        const items = e.clipboardData.items;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            // Check for image type (e.g., image/png, image/jpeg)
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                if (blob) {
                    e.preventDefault();
                    await this.performUpload(blob);
                    return;
                }
            }
        }

        // Fallback: Check for files array directly if items recursion didn't catch it
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
                // Data URI
                const res = await fetch(src);
                blob = await res.blob();
                // extract ext from type?
                const type = blob.type;
                const ext = type.split('/')[1] || 'png';
                filename = `pasted-image.${ext}`;
            } else {
                // Public URL?
                // Try to fetch (might fail due to CORS)
                try {
                    const res = await fetch(src);
                    if (res.ok) {
                        blob = await res.blob();
                        const urlParts = src.split('/');
                        const lastPart = urlParts[urlParts.length - 1];
                        if (lastPart) filename = lastPart.split('?')[0]; // simple attempt
                    }
                } catch (e) {
                    console.warn('Failed to fetch pasted image src', src, e);
                    // We silently fail upload, but image is stripped from text effectively.
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

    removeAttachment = () => {
        if (this.props.attachment && this.props.onDeleteAttachment) {
            this.props.onDeleteAttachment(this.props.attachment);
        }
        if (this.props.onAttachmentChange) {
            this.props.onAttachmentChange(undefined);
        }
    };

    handlePreviewTurn = (turn: number) => {
        this.isUserScroll = true;
        if (this.props.onPreviewTurn) {
            this.props.onPreviewTurn(turn);
        }
    };

    handleContainerClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        // const interactiveTags = ['SELECT', 'BUTTON', 'INPUT', 'TEXTAREA', 'A'];
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

    render() {
        const {
            messages,
            status,
            statusMessages,
            onPickElement,
            onCancelPick,
            selection,
            isPicking,
            activeTurn,
            onCloneTurn,
            onPreviewTurn,
            disabled,
            provider,
            onProviderChange = () => { },
            // onUpload, // Accessed via this.props.onUpload
            attachment,
            // Restore missing ones
            onClearSelection,
            onSelectChip,
            sessionIds,
            onSwitchSession,
            sessionTitle
        } = this.props;
        const { input, isUploading, isLoading } = this.state;
        const isFormDisabled = status === 'busy' || disabled;

        let effectiveActiveTurn = activeTurn;
        if (
            effectiveActiveTurn === null ||
            effectiveActiveTurn === undefined
        ) {
            // Find last message with a turn
            for (let i = messages.length - 1; i >= 0; i--) {
                if (typeof messages[i].turn === 'number') {
                    effectiveActiveTurn = messages[i].turn;
                    break;
                }
            }
        }

        let foundActive = false;

        // Find the index of the last assistant message
        let lastAssistantIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                lastAssistantIndex = i;
                break;
            }
        }

        let latestTurn = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (typeof messages[i].turn === 'number') {
                latestTurn = messages[i].turn!;
                break;
            }
        }

        const isPendingActive = latestTurn === effectiveActiveTurn;
        const shouldPendingDim = foundActive && !isPendingActive;

        return (
            <div className={styles.chatPanel}>
                <div className={styles.sessionHeader}>
                    {sessionTitle || '...'}
                </div>
                <div className={styles.messages} id="messages">
                    {messages.map((m, i) => {
                        // Use strict equality for safely finding the match
                        // Ensure ONLY assistant messages are marked active
                        const isTurnMatch =
                            m.role === 'assistant' &&
                            typeof m.turn === 'number' &&
                            m.turn === effectiveActiveTurn;

                        // Dimming logic
                        if (isTurnMatch) foundActive = true;
                        const shouldDim = foundActive && !isTurnMatch;

                        return (
                            <Message
                                id={
                                    m.role === 'assistant' && typeof m.turn === 'number'
                                        ? `msg-turn-${m.turn}`
                                        : undefined
                                }
                                key={i}
                                msg={m}
                                onSelectChip={onSelectChip}
                                onCloneTurn={onCloneTurn}
                                onPreviewTurn={this.handlePreviewTurn}
                                isActiveTurn={isTurnMatch}
                                isDimmed={shouldDim}
                                isLastAssistant={i === lastAssistantIndex}
                                onUndo={this.handleUndo}
                                sessionIds={sessionIds}
                                onSwitchSession={onSwitchSession}
                            />
                        );
                    })}
                    {status === 'busy' && (
                        <Message
                            id={
                                latestTurn
                                    ? `msg-turn-${latestTurn}`
                                    : undefined
                            }
                            msg={{
                                role: 'assistant',
                                content: '',
                                turn: latestTurn,
                                version: 0,
                            }}
                            statusMessages={statusMessages}
                            startTime={this.props.startTime || undefined}
                            isPending={true}
                            isActiveTurn={isPendingActive}
                            isDimmed={shouldPendingDim}
                            // Mimic props required for interaction
                            onPreviewTurn={onPreviewTurn}
                            // Additional props
                            sessionIds={sessionIds}
                            onSwitchSession={onSwitchSession}
                        />
                    )}
                    <div ref={this.messagesEndRef} />
                </div>

                {status === 'error' ? (
                    <div className={styles.chatForm}>
                        <div className={styles.errorContainer}>
                            <div className={styles.errorMessage}>
                                <h3>An error occurred</h3>
                                <p>{statusMessages && statusMessages.length > 0 ? statusMessages[statusMessages.length - 1] : 'Unknown error'}</p>
                            </div>
                            <UiButton
                                variant="secondary"
                                onClick={this.props.onUndo}
                            >
                                Undo last turn
                            </UiButton>
                        </div>
                    </div>
                ) : (
                    <form className={styles.chatForm} onSubmit={this.handleSubmit}>

                        {/* Unified Input Container */}
                        <div className={styles.inputContainer} onClick={this.handleContainerClick}>
                            <div className={styles.selections}>
                                {/* Element Picker (Top) */}
                                {selection && (
                                    <div className={styles.pickerContainer}>
                                        <UiTarget onRemove={onClearSelection} removeTitle="Clear selection" disabled={isFormDisabled}>
                                            <code className={styles.selectionValue}>{selection}</code>
                                        </UiTarget>
                                    </div>
                                )}

                                {/* Attachment Preview */}
                                {attachment && (
                                    <div className={styles.attachmentList}>
                                        <UiTarget onRemove={this.removeAttachment} removeTitle="Remove attachment" disabled={isFormDisabled}>
                                            <img
                                                src={attachment.url}
                                                alt={attachment.originalName || attachment.filename}
                                                className={styles.imagePreview}
                                                title={attachment.originalName || attachment.filename}
                                            />
                                        </UiTarget>
                                    </div>
                                )}
                            </div>

                            {/* Rich Input */}
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
                                    if (this.props.onSaveUnsent) {
                                        this.props.onSaveUnsent({ input: this.state.input });
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        this.handleSubmit(e);
                                    }
                                }}
                            />

                            {/* Input Controls Footer */}
                            <div className={styles.inputControls}>
                                <div className={styles.inputControlsLeft}>
                                    {/* Pick Element Button */}
                                    <UiButton
                                        type="button"
                                        variant={isPicking ? 'ghost-active' : 'ghost'}
                                        size="icon"
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

                                    {/* Upload Button */}
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
                                            variant="ghost"
                                            size="icon"
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

                                    {/* Mode Toggle */}
                                    <UiDropdown
                                        value={this.props.fastMode ? 'fast' : 'plan'}
                                        options={[
                                            { value: 'plan', label: 'Planning' },
                                            { value: 'fast', label: 'Fast mode' }
                                        ]}
                                        onChange={(val) => this.props.onFastModeChange?.(val === 'fast')}
                                        disabled={isFormDisabled}
                                        variant="ghost"
                                    />
                                    <ProviderSelector
                                        value={provider}
                                        onChange={onProviderChange}
                                        disabled={isFormDisabled || isLoading || isUploading}
                                        className={styles.imageToggle}
                                        variant="ghost"
                                    />
                                </div>

                                <div className={styles.inputControlsRight}>
                                    {/* Send Button */}
                                    <UiButton
                                        type="submit"
                                        variant="primary"
                                        size="icon"
                                        disabled={isFormDisabled || !input.trim()}
                                        tabIndex={2}
                                        onClick={this.handleSubmit}
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
                                </div>
                            </div>
                        </div>
                    </form>
                )}

                <ConfirmationModal
                    isOpen={this.state.showUndoConfirmation}
                    title="Undo Changes"
                    message="Are you sure you want to undo the last change? This will revert the conversation and files to the previous state."
                    onConfirm={this.confirmUndo}
                    onCancel={this.cancelUndo}
                />

            </div>
        );
    }
}
