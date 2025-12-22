import React from 'react';
import { marked } from 'marked';
import classNames from 'classnames';
import { ElementPicker } from './ElementPicker';
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

                </div>
                {/* Clone Version Button for Assistant Messages */}
                {isAssistant &&
                    msg.version !== undefined &&
                    onCloneVersion && (
                        <div className={styles.messageActions}>
                            <button
                                className={styles.cloneButton}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloneVersion(msg.version!);
                                }}
                                title={`Clone from version ${msg.version}`}
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
                        </div>
                    )}
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

                    {/* Toolbar above input */}
                    <ElementPicker
                        selection={selection ?? null}
                        isPicking={isPicking}
                        onPick={onPickElement}
                        onCancel={onCancelPick}
                        onClear={onClearSelection}
                        disabled={disabled}
                    />

                    <textarea
                        value={input}
                        onChange={this.handleInputChange}
                        placeholder={disabled ? "Create a session to start chatting..." : "Describe changes..."}
                        rows={4}
                        disabled={disabled}
                    />
                    <div
                        className={styles.formActions}
                    >
                        <button
                            type="submit"
                            disabled={status === 'busy' || disabled}
                            className={styles.submitButton}
                        >
                            Send
                        </button>
                    </div>
                </form>
            </div>
        );
    }
}
