import React from 'react';
import { marked } from 'marked';
import classNames from 'classnames';
import styles from './Chat.module.css';

marked.setOptions({ breaks: true });

interface MessageData {
    role: 'user' | 'assistant' | 'system';
    content: string;
    version?: number; // Added version
    selection?: { selector: string };
}

interface MessageProps {
    msg: MessageData;
    onSelectChip?: (selector: string) => void;
    onCloneVersion?: (version: number) => void;
    onPreviewVersion?: (version: number) => void;
    isActiveVersion?: boolean;
    isDimmed?: boolean;
}

class Message extends React.Component<MessageProps> {
    render() {
        const {
            msg,
            onSelectChip,
            onCloneVersion,
            onPreviewVersion,
            isActiveVersion,
            isDimmed,
        } = this.props;
        const isUser = msg.role === 'user';
        const isAssistant = msg.role === 'assistant';
        const isSystem = msg.role === 'system';

        const hasVersion = isAssistant && typeof msg.version === 'number';

        const messageClass = classNames(styles.message, {
            [styles.user]: isUser,
            [styles.assistant]: isAssistant,
            [styles.system]: isSystem,
            [styles.hasVersion]: hasVersion,
            [styles.activeVersion]: isActiveVersion,
            [styles.dimmed]: isDimmed,
        });

        return (
            <div
                className={messageClass}
                onClick={
                    hasVersion && onPreviewVersion
                        ? () => onPreviewVersion(msg.version!)
                        : undefined
                }
            >
                <div className="message-content">
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
                    {isAssistant ? (
                        <div
                            className="message-text"
                            dangerouslySetInnerHTML={{
                                __html: marked.parse(msg.content) as string,
                            }}
                        />
                    ) : (
                        <div className="message-text">{msg.content}</div>
                    )}

                    {/* Clone Version Button for Assistant Messages */}
                    {isAssistant &&
                        msg.version !== undefined &&
                        onCloneVersion && (
                            <button
                                className={styles.cloneButton}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloneVersion(msg.version!);
                                }}
                                title={`Clone from version ${msg.version}`}
                                style={{
                                    position: 'absolute',
                                    top: '4px',
                                    right: '4px',
                                    // background: 'transparent', // style moved to css
                                    // border: 'none',
                                    // cursor: 'pointer',
                                    // opacity: 0.5,
                                    // padding: '4px'
                                    // NOTE: The inline styles were overrides in the original code.
                                    // I should respect them or move them to CSS.
                                    // The original CSS had .message-version-clone styles, but the inline styles here OVERRIDE them (e.g. background transparent).
                                    // Actually, lines 60-69 in original contained inline styles.
                                    // If I move to module, I should probably put these in the module `cloneButton` class or keep them inline?
                                    // The original CSS `message-version-clone` had background white. The inline has transparent.
                                    // I'll keep inline styles for now to ensure exact visual parity, or merge them into CSS class if strict refactor.
                                    // I will keep them to be safe, as they position the button.
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    opacity: 0.5,
                                    padding: '4px',
                                }}
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
    statusMessage?: string | null;
    // New props for toolbar features
    onPickElement?: () => void;
    onCancelPick?: () => void;
    onCloneSession?: () => void;
    selection?: string | null;
    isPicking?: boolean;
    onClearSelection?: () => void;
    onSelectChip?: (selector: string) => void;
    onCloneVersion?: (version: number) => void;
    onPreviewVersion?: (version: number) => void;
    activeVersion?: number | null;
    disabled?: boolean;
}

interface ChatState {
    input: string;
}

export class Chat extends React.Component<ChatProps, ChatState> {
    private messagesEndRef: React.RefObject<HTMLDivElement | null>;

    constructor(props: ChatProps) {
        super(props);
        this.state = {
            input: '',
        };
        this.messagesEndRef = React.createRef();
    }

    componentDidMount() {
        this.scrollToBottom();
    }

    componentDidUpdate(prevProps: ChatProps) {
        if (
            prevProps.messages.length !== this.props.messages.length ||
            prevProps.status !== this.props.status
        ) {
            this.scrollToBottom();
        }
    }

    scrollToBottom = () => {
        this.messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (this.props.disabled) return;
        if (!this.state.input.trim()) return;
        this.props.onSend(this.state.input);
        this.setState({ input: '' });
    };

    handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        this.setState({ input: e.target.value });
    };

    render() {
        const {
            messages,
            status,
            statusMessage,
            onPickElement,
            onCancelPick,
            onCloneSession,
            selection,
            isPicking,
            onClearSelection,
            onSelectChip,
            onCloneVersion,
            activeVersion,
            onPreviewVersion,
            disabled,
        } = this.props;
        const { input } = this.state;

        // Logic to determine dimmed state
        let effectiveActiveVersion = activeVersion;
        if (
            effectiveActiveVersion === null ||
            effectiveActiveVersion === undefined
        ) {
            // Find last message with a version
            for (let i = messages.length - 1; i >= 0; i--) {
                if (typeof messages[i].version === 'number') {
                    effectiveActiveVersion = messages[i].version;
                    break;
                }
            }
        }

        let foundActive = false;

        return (
            <div className={styles.chatPanel}>
                <div className={styles.messages} id="messages">
                    {messages.map((m, i) => {
                        // Use strict equality for safely finding the match
                        // Ensure ONLY assistant messages are marked active
                        const isVersionMatch =
                            m.role === 'assistant' &&
                            typeof m.version === 'number' &&
                            m.version === effectiveActiveVersion;

                        // Dimming logic
                        if (isVersionMatch) foundActive = true;
                        const shouldDim = foundActive && !isVersionMatch;

                        return (
                            <Message
                                key={i}
                                msg={m}
                                onSelectChip={onSelectChip}
                                onCloneVersion={onCloneVersion}
                                onPreviewVersion={onPreviewVersion}
                                isActiveVersion={isVersionMatch}
                                isDimmed={shouldDim}
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
                            <span className={styles.spinner}></span>
                            <span className="message-status">
                                {statusMessage || 'Готовлю ответ...'}
                            </span>
                        </div>
                    )}
                    <div ref={this.messagesEndRef} />
                </div>

                <form className={styles.chatForm} onSubmit={this.handleSubmit}>
                    {/* Toolbar above input */}

                    {/* Show Picker button ONLY if no selection is active */}
                    {!selection && (
                        <div style={{ marginBottom: '8px' }}>
                            {isPicking ? (
                                <button
                                    type="button"
                                    className={styles.pickerButton}
                                    onClick={onCancelPick}
                                    title="Cancel selection"
                                    style={{
                                        borderColor: 'var(--danger)',
                                        color: 'var(--danger)',
                                    }}
                                    disabled={disabled}
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
                                        <line
                                            x1="18"
                                            y1="6"
                                            x2="6"
                                            y2="18"
                                        ></line>
                                        <line
                                            x1="6"
                                            y1="6"
                                            x2="18"
                                            y2="18"
                                        ></line>
                                    </svg>
                                    <span>Cancel Selection</span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={styles.pickerButton}
                                    onClick={onPickElement}
                                    title="Select an element in preview"
                                    disabled={disabled}
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
                                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                                    </svg>
                                    <span>Pick Element</span>
                                </button>
                            )}
                        </div>
                    )}

                    {selection && (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'rgba(37, 99, 235, 0.1)',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                marginBottom: '8px',
                                fontSize: '0.85rem',
                                border: '1px solid rgba(37, 99, 235, 0.2)',
                            }}
                        >
                            <span style={{ fontWeight: 600, color: '#2563eb' }}>
                                Selected:
                            </span>
                            <span style={{ fontFamily: 'monospace' }}>
                                {selection}
                            </span>
                            <button
                                type="button"
                                onClick={onClearSelection}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    color: '#666',
                                    marginLeft: 'auto',
                                    padding: '0 4px',
                                    fontSize: '1.2rem',
                                    lineHeight: '1',
                                }}
                            >
                                ×
                            </button>
                        </div>
                    )}

                    <textarea
                        value={input}
                        onChange={this.handleInputChange}
                        placeholder={disabled ? "Create a session to start chatting..." : "Describe changes..."}
                        rows={3}
                        disabled={disabled}
                    />
                    <div
                        className={styles.formActions}
                        style={{ marginTop: '8px' }}
                    >
                        <button
                            type="submit"
                            disabled={status === 'busy' || disabled}
                            className={styles.submitButton}
                        >
                            Send
                        </button>
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={onCloneSession}
                            title="Clone this chat"
                            style={{ padding: '0.5rem', width: 'auto' }}
                            disabled={disabled}
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
                    </div>
                </form>
            </div>
        );
    }
}
