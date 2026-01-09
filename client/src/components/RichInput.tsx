import React from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import classNames from 'classnames';
import styles from './RichInput.module.css';

interface RichInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    onBlur?: () => void;
    onPaste?: (e: React.ClipboardEvent) => void;
    tabIndex?: number;
    autoFocus?: boolean;
    rows?: number;
    className?: string;
    editorClassName?: string;
}

interface RichInputState {
    isEmpty: boolean;
}

export class RichInput extends React.Component<RichInputProps, RichInputState> {
    private mainRef = React.createRef<HTMLDivElement>();
    private turndownService: TurndownService;
    private isLocked = false;

    constructor(props: RichInputProps) {
        super(props);
        this.state = {
            isEmpty: !props.value
        };
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*'
        });

        // Configure turndown to be minimal if needed, mostly defaults are okay for GFMish stuff.
        // We might want to ensure we don't output full html page structures.
    }

    componentDidMount() {
        this.updateContentFromProps();
        if (this.props.autoFocus && this.mainRef.current && !this.props.disabled) {
            this.mainRef.current.focus();
        }
    }

    componentDidUpdate(prevProps: RichInputProps) {
        // Only update if the incoming value is significantly different from our current parsed markdown
        // to avoid cursor jumping.
        // This is the "hidden markdown container" sync logic reverse direction (external update).
        if (prevProps.value !== this.props.value && !this.isLocked) {
            const currentMD = this.getMarkdownFromHTML();
            if (currentMD.trim() !== this.props.value.trim()) {
                this.updateContentFromProps();
            }
        }
    }

    checkIsEmpty = () => {
        if (!this.mainRef.current) return;
        const text = this.mainRef.current.innerText || "";
        const isEmpty = text.trim().length === 0;

        if (this.state.isEmpty !== isEmpty) {
            this.setState({ isEmpty });
        }
    }

    updateContentFromProps() {
        if (!this.mainRef.current) return;
        // Convert Markdown Prop -> HTML View
        if (!this.props.value) {
            this.mainRef.current.innerHTML = '';
            this.checkIsEmpty();
            return;
        }

        try {
            // marked.parse returns a string (Promise if async is on, but defaults off)
            const html = marked.parse(this.props.value) as string;
            this.mainRef.current.innerHTML = html;
            this.checkIsEmpty();
        } catch (e) {
            console.error("Failed to parse markdown for view", e);
        }
    }

    getMarkdownFromHTML(): string {
        if (!this.mainRef.current) return '';
        try {
            return this.turndownService.turndown(this.mainRef.current);
        } catch (e) {
            console.error("Failed to turndown html", e);
            return '';
        }
    }

    handleInput = () => {
        // Sync View -> Model
        // Lock updates to prevent loop
        this.isLocked = true;
        const md = this.getMarkdownFromHTML();
        this.props.onChange(md);

        // We can unlock immediately because React updates are async/batched usually, 
        // but safe way is to keep locked until next tick or verify in componentDidUpdate.
        // Actually, simpler: if we just emitted the change, we expect the prop to come back same.
        // The check in cDU handles the "same value" case.
        setTimeout(() => this.isLocked = false, 0);

        this.checkIsEmpty();
    };

    handlePaste = (e: React.ClipboardEvent) => {
        if (this.props.onPaste) {
            this.props.onPaste(e);
            // If parent handled it (e.g. image upload), they should have prevented default.
            if (e.isDefaultPrevented()) return;
        }

        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        const html = e.clipboardData.getData('text/html');

        let md = '';

        if (html) {
            // Turndown the pasted HTML
            md = this.turndownService.turndown(html);
        } else {
            md = text;
        }

        // Now we insert this markdown as HTML into our view
        // The requirement: "html -> md ... display md rich-text"
        // So we take the MD, render it to HTML, and insert that HTML.
        const renderedHtml = marked.parse(md) as string;

        // Insert at cursor
        document.execCommand('insertHTML', false, renderedHtml);

        // Trigger generic input handler
        this.handleInput();
    };

    handleKeyDown = (e: React.KeyboardEvent) => {
        if (this.props.onKeyDown) {
            this.props.onKeyDown(e);
        }
    };

    public focus = () => {
        if (this.mainRef.current) {
            this.mainRef.current.focus();
        }
    };

    render() {
        const { placeholder, disabled, onBlur, className, editorClassName } = this.props;

        return (
            <div
                className={classNames(styles.richInputContainer, className, {
                    [styles.disabled]: disabled
                })}
            >
                <div
                    ref={this.mainRef}
                    className={classNames(styles.richInputEditor, editorClassName, {
                        [styles.empty]: this.state.isEmpty
                    })}
                    contentEditable={!disabled}
                    onInput={this.handleInput}
                    onPaste={this.handlePaste}
                    onKeyDown={this.handleKeyDown}
                    onBlur={onBlur}
                    data-placeholder={placeholder}
                    role="textbox"
                    tabIndex={this.props.tabIndex}
                    style={{ minHeight: this.props.rows ? `calc(${this.props.rows} * 1.5em + 1.5rem)` : undefined }}
                />
            </div>
        );
    }
}
