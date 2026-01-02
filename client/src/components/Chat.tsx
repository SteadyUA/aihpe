import React from 'react';
import { marked } from 'marked';
import classNames from 'classnames';
import { ElementPicker } from './ElementPicker';
import { UiButton } from './UiButton';
import { UiTarget } from './UiTarget';
import { ProviderSelector } from './ProviderSelector';
import styles from './Chat.module.css';
import { ConfirmationModal } from './ConfirmationModal';
import { RichInput } from './RichInput';


marked.setOptions({ breaks: true });

marked.setOptions({ breaks: true });
import { MessageData, LlmProvider, ChatAttachment } from '../types';

interface MessageProps {
    msg: MessageData;
    onSelectChip?: (selector: string) => void;
    onCloneTurn?: (turn: number) => void;
    onPreviewTurn?: (turn: number) => void;
    isActiveTurn?: boolean;
    isDimmed?: boolean;
    isLastAssistant?: boolean;
    status?: string;
    onUndo?: () => void;
}

const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

class Message extends React.Component<MessageProps> {
    render() {
        const {
            msg,
            onSelectChip,
            onCloneTurn,
            onPreviewTurn,
            isActiveTurn,
            isDimmed,
            isLastAssistant,
            status,
            onUndo,
        } = this.props;
        const isUser = msg.role === 'user';
        const isAssistant = msg.role === 'assistant';
        const isSystem = msg.role === 'system';

        const hasTurn = isAssistant && typeof msg.turn === 'number';

        const messageClass = classNames(styles.message, {
            [styles.user]: isUser,
            [styles.assistant]: isAssistant,
            [styles.system]: isSystem,
            [styles.hasVersion]: hasTurn,
            [styles.activeVersion]: isActiveTurn,
            [styles.dimmed]: isDimmed,
        });



        return (
            <div
                className={messageClass}
                onClick={
                    hasTurn && onPreviewTurn
                        ? () => onPreviewTurn(msg.turn!)
                        : undefined
                }
            >
                <div className={styles.messageContent}>
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

                    {/* Render Text Content */}
                    {/* Render Text Content */}
                    {(msg.content || (!msg.attachment && isUser)) && (
                        <div
                            className="message-text"
                            dangerouslySetInnerHTML={{
                                __html: marked.parse(msg.content) as string,
                            }}
                        />
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
                                    window.open(msg.attachment!.url, '_blank');
                                }}
                            />
                        </div>
                    )}

                </div>
                {/* Message Actions */}
                <div className={styles.messageActions}>
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
}

interface ChatState {
    isLoading: boolean;
    error: string | null;
    input: string;
    elapsedSeconds: number;
    showUndoConfirmation: boolean;
    isUploading: boolean;
}

export class Chat extends React.Component<ChatProps, ChatState> {
    private messagesEndRef: React.RefObject<HTMLDivElement | null>;
    private fileInputRef: React.RefObject<HTMLInputElement | null>;
    private timerInterval: any = null;

    constructor(props: ChatProps) {
        super(props);
        this.state = {
            isLoading: false,
            error: null,
            input: '',
            isUploading: false,
            elapsedSeconds: 0,
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
        this.scrollToBottom();
        this.updateTimer();
    }

    componentDidUpdate(prevProps: ChatProps) {
        if (
            prevProps.messages.length !== this.props.messages.length ||
            prevProps.statusMessages?.length !== this.props.statusMessages?.length ||
            prevProps.status !== this.props.status
        ) {
            this.scrollToBottom();
        }

        if (prevProps.startTime !== this.props.startTime || prevProps.status !== this.props.status) {
            this.updateTimer();
        }

        if (prevProps.unsentInput !== this.props.unsentInput && this.props.unsentInput !== undefined) {
            // Only update if it's different and not just undefined (or maybe blank string is valid)
            // Beware of overriding user input if they are typing?
            // Usually unsentInput updates come from LOAD or UNDO.
            // If local input is different?
            // Let's assume unsentInput prop is the truth from server/store.
            if (this.props.unsentInput !== this.state.input) {
                this.setState({ input: this.props.unsentInput });
            }
        }
    }

    componentWillUnmount() {
        if (this.timerInterval) clearInterval(this.timerInterval);
    }

    updateTimer = () => {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = null;

        if (this.props.status === 'busy' && this.props.startTime) {
            const tick = () => {
                const now = Date.now();
                const start = this.props.startTime || now;
                this.setState({ elapsedSeconds: Math.floor((now - start) / 1000) });
            };
            tick();
            this.timerInterval = setInterval(tick, 1000);
        } else {
            this.setState({ elapsedSeconds: 0 });
        }
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
        // 1. Check for files in clipboard
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            // Find the first image file
            const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
            if (file) {
                e.preventDefault(); // Prevent default paste behavior (e.g. pasting file name)
                await this.performUpload(file);
                return;
            }
        }

        // 2. Check items if no direct file object (sometimes screenshots are items but not "files" property in some contexts, though typically they appear in files)
        // Usually items API covers it.
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    e.preventDefault();
                    await this.performUpload(blob);
                    return;
                }
            }
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
            onProviderChange,
            onUpload,
            attachment,
            // Restore missing ones
            onClearSelection,
            onSelectChip,
        } = this.props;
        const { input, elapsedSeconds, isUploading, isLoading } = this.state;
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

        return (
            <div className={styles.chatPanel}>
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
                                key={i}
                                msg={m}
                                onSelectChip={onSelectChip}
                                onCloneTurn={onCloneTurn}
                                onPreviewTurn={onPreviewTurn}
                                isActiveTurn={isTurnMatch}
                                isDimmed={shouldDim}
                                isLastAssistant={i === lastAssistantIndex}
                                onUndo={this.handleUndo}
                            />
                        );
                    })}
                    {status === 'busy' && (
                        <div
                            className={classNames(
                                styles.message,
                                styles.assistant,
                                styles.pending,
                            )}
                        >
                            <div className={styles.messageContent}>
                                {statusMessages && statusMessages.length > 0 ? (
                                    (() => {
                                        const maxItems = 3;
                                        const start = Math.max(0, statusMessages.length - maxItems);
                                        const visibleMessages = statusMessages.slice(start);
                                        const startIndex = start + 1; // 1-based index for <ol>

                                        return (
                                            <ol className={styles.statusList} start={startIndex}>
                                                {visibleMessages.map((msg, idx) => (
                                                    <li key={start + idx}>{msg}</li>
                                                ))}
                                            </ol>
                                        );
                                    })()
                                ) : (
                                    <p>Thinking...</p>
                                )}
                            </div>
                            <div className={styles.messageActions}>
                                <span className={styles.spinner}></span>
                                <span className={styles.timer}>
                                    {elapsedSeconds > 0 ? `${elapsedSeconds}s` : ''}
                                </span>
                            </div>
                        </div>
                    )}
                    <div ref={this.messagesEndRef} />
                </div>

                <form className={styles.chatForm} onSubmit={this.handleSubmit}>

                    {/* Attachment Preview (Above Toolbar) */}
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

                    {/* Toolbar */}
                    <div className={styles.toolbar}>
                        {onUpload && (
                            <>
                                <input
                                    type="file"
                                    ref={this.fileInputRef}
                                    style={{ display: 'none' }}
                                    onChange={this.handleFileChange}
                                    accept="image/*"
                                />
                                <UiButton
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    onClick={() => this.fileInputRef.current?.click()}
                                    disabled={isFormDisabled || isUploading || !!attachment} // Disable if attachment exists
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
                            </>
                        )}

                        <ElementPicker
                            selection={selection ?? null}
                            isPicking={isPicking}
                            onPick={onPickElement}
                            onCancel={onCancelPick}
                            onClear={onClearSelection}
                            disabled={isFormDisabled}
                            className={styles.elementPicker}
                        />
                    </div>

                    <RichInput
                        value={input}
                        onChange={this.handleRichInputChange}
                        onPaste={this.handlePaste}
                        placeholder={isFormDisabled ? "Please wait..." : "Describe changes..."}
                        disabled={isFormDisabled}
                        tabIndex={1}
                        onBlur={() => {
                            if (this.props.onSaveUnsent) {
                                this.props.onSaveUnsent({ input: this.state.input });
                            }
                        }}
                    />
                    <div
                        className={styles.formActions}
                    >
                        {onProviderChange && (
                            <ProviderSelector
                                value={provider}
                                onChange={onProviderChange}
                                disabled={isFormDisabled || isLoading || isUploading}
                                className={styles.imageToggle}
                            />
                        )}
                        <UiButton
                            type="submit"
                            variant="primary"
                            disabled={isFormDisabled}
                            tabIndex={2}
                        >
                            Send
                        </UiButton>
                    </div>
                </form>

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
