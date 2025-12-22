import React from 'react';
import classNames from 'classnames';
import Editor, { OnMount } from '@monaco-editor/react';
import styles from './Preview.module.css';

// Define IDisposable locally to avoid deep import issues
interface IDisposable {
    dispose(): void;
}

interface PreviewProps {
    sessionId: string | null;
    version: number;
}

interface Device {
    name: string;
    width: number;
    height: number;
}

const DEVICES: Device[] = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone 12/13/14', width: 390, height: 844 },
    { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
    { name: 'Pixel 7', width: 412, height: 915 },
    { name: 'Samsung S20 Ultra', width: 412, height: 915 },
    { name: 'iPad Mini', width: 768, height: 1024 },
    { name: 'iPad Air', width: 820, height: 1180 },
];

const FILENAME_MAP: Record<AssetType, string> = {
    html: 'index.html',
    css: 'styles.css',
    js: 'script.js',
};

type AssetType = 'html' | 'css' | 'js';
type TabType = 'preview' | AssetType;

interface PreviewState {
    isMobile: boolean;
    deviceIndex: number;
    activeTab: TabType;
    iframeKey: number;
    fileCache: Record<AssetType, string | null>;
    loading: Record<AssetType, boolean>;
    unsavedContent: Record<AssetType, string | null>;
    isSaving: boolean;
}

export class Preview extends React.Component<PreviewProps, PreviewState> {
    private iframeRef: React.RefObject<HTMLIFrameElement | null>;
    private disposables: IDisposable[] = [];

    constructor(props: PreviewProps) {
        super(props);
        this.state = {
            isMobile: false,
            deviceIndex: 0,
            activeTab: 'preview',
            iframeKey: 0,
            fileCache: { html: null, css: null, js: null },
            loading: { html: false, css: false, js: false },
            unsavedContent: { html: null, css: null, js: null },
            isSaving: false,
        };
        this.iframeRef = React.createRef();
    }

    componentDidUpdate(prevProps: PreviewProps) {
        if (
            prevProps.sessionId !== this.props.sessionId ||
            prevProps.version !== this.props.version
        ) {
            // Reset cache when session or version changes
            this.setState(
                {
                    fileCache: { html: null, css: null, js: null },
                    loading: { html: false, css: false, js: false },
                    unsavedContent: { html: null, css: null, js: null },
                    activeTab: 'preview', // Reset to preview on version switch
                },
                () => {
                    // If we stayed on code tab (unlikely due to reset), re-fetch
                    if (this.state.activeTab !== 'preview') {
                        this.fetchFile(this.state.activeTab);
                    }
                },
            );
        }
    }

    componentWillUnmount() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    fetchFile = async (type: AssetType) => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;

        // Check if already loaded or loading
        if (this.state.fileCache[type] !== null || this.state.loading[type]) {
            return;
        }

        this.setState((prev) => ({
            loading: { ...prev.loading, [type]: true },
        }));

        const filenameMap: Record<AssetType, string> = FILENAME_MAP;

        try {
            const res = await fetch(
                `/api/sessions/${sessionId}/versions/${version}/static/${filenameMap[type]}`,
            );
            if (!res.ok) throw new Error('Failed to fetch file');
            const text = await res.text();
            this.setState((prev) => ({
                fileCache: { ...prev.fileCache, [type]: text },
                loading: { ...prev.loading, [type]: false },
            }));
        } catch (error) {
            console.error(`Failed to load ${type}`, error);
            this.setState((prev) => ({
                fileCache: {
                    ...prev.fileCache,
                    [type]: 'Error loading content',
                },
                loading: { ...prev.loading, [type]: false },
            }));
        }
    };

    handleTabChange = async (tab: TabType) => {
        // Auto-save if needed before switching
        const { activeTab, unsavedContent } = this.state;
        if (activeTab !== 'preview' && unsavedContent[activeTab] !== null) {
            await this.handleSave();
        }

        this.setState({ activeTab: tab });
        if (tab !== 'preview') {
            this.fetchFile(tab);
        }
    };

    handleEditorChange = (value: string | undefined) => {
        const { activeTab } = this.state;
        if (activeTab === 'preview' || value === undefined) return;

        this.setState((prev) => ({
            unsavedContent: {
                ...prev.unsavedContent,
                [activeTab]: value,
            },
        }));
    };

    handleSave = async () => {
        const { sessionId, version } = this.props;
        const { activeTab, unsavedContent } = this.state;

        if (activeTab === 'preview') return;
        const content = unsavedContent[activeTab];
        if (content === null) return; // No changes

        if (!sessionId) return;

        this.setState({ isSaving: true });

        try {
            const body = { [activeTab]: content };
            const res = await fetch(
                `/api/sessions/${sessionId}/versions/${version}/files`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );

            if (!res.ok) {
                const error = await res.json();
                alert(`Error saving: ${error.message}`);
                throw new Error(error.message);
            }

            // Update cache with saved content and clear unsaved state
            this.setState((prev) => ({
                fileCache: {
                    ...prev.fileCache,
                    [activeTab]: content,
                },
                unsavedContent: {
                    ...prev.unsavedContent,
                    [activeTab]: null,
                },
                isSaving: false,
                iframeKey: prev.iframeKey + 1, // Force iframe reload
            }));
        } catch (error) {
            console.error('Failed to save', error);
            this.setState({ isSaving: false });
        }
    };

    getEditorLanguage = (tab: AssetType) => {
        switch (tab) {
            case 'html':
                return 'html';
            case 'css':
                return 'css';
            case 'js':
                return 'javascript';
        }
    };

    handleDownload = async () => {
        const { sessionId } = this.props;
        if (!sessionId) return;

        try {
            const response = await fetch(
                `/api/sessions/${encodeURIComponent(sessionId)}/archive`,
            );
            if (!response.ok) throw new Error('Failed to download');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `session-${sessionId.slice(0, 8)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed', error);
        }
    };

    handleNewWindow = () => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;

        const url = `/api/sessions/${sessionId}/versions/${version}/static/index.html`;
        window.open(url, '_blank');
    };

    handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        this.setState({ deviceIndex: Number(e.target.value) });
    };

    toggleMobile = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ isMobile: e.target.checked });
    };

    handleEditorDidMount: OnMount = (editor, monaco) => {
        // Dispose old providers
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        // CSS Classes provider for HTML
        this.disposables.push(
            monaco.languages.registerCompletionItemProvider('html', {
                provideCompletionItems: (model: any, position: any) => {
                    const textUntilPosition: string = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                    });

                    // Trigger only if typing inside class="..."
                    if (!textUntilPosition.match(/class=["|'][\w- ]*$/)) {
                        return { suggestions: [] };
                    }

                    // Get CSS content
                    const cssContent =
                        this.state.unsavedContent?.css ??
                        this.state.fileCache?.css ??
                        '';
                    // Extract classes
                    const classRegex = /\.([a-zA-Z0-9-_]+)/g;
                    const classes = new Set<string>();
                    let match;
                    while ((match = classRegex.exec(cssContent)) !== null) {
                        classes.add(match[1]);
                    }

                    const suggestions = Array.from(classes).map((cls) => ({
                        label: cls,
                        kind: monaco.languages.CompletionItemKind.Class,
                        insertText: cls,
                        detail: 'from styles.css',
                    }));

                    return { suggestions };
                },
            }),
        );

        // HTML IDs and Classes provider for JS
        this.disposables.push(
            monaco.languages.registerCompletionItemProvider('javascript', {
                provideCompletionItems: (_model: any, _position: any) => {
                    // Start simple: always suggest known IDs and classes
                    const htmlContent =
                        this.state.unsavedContent?.html ??
                        this.state.fileCache?.html ??
                        '';

                    const suggestions: any[] = [];

                    // Extract IDs
                    const idRegex = /id=["|']([a-zA-Z0-9-_]+)["|']/g;
                    let idMatch;
                    while ((idMatch = idRegex.exec(htmlContent)) !== null) {
                        suggestions.push({
                            label: idMatch[1],
                            kind: monaco.languages.CompletionItemKind.Field,
                            insertText: idMatch[1],
                            detail: 'ID from index.html',
                        });
                    }

                    // Extract Classes
                    const classRegex = /class=["|']([a-zA-Z0-9-_ ]+)["|']/g;
                    let classMatch;
                    const seenClasses = new Set<string>();
                    while (
                        (classMatch = classRegex.exec(htmlContent)) !== null
                    ) {
                        const classes = classMatch[1].split(' ');
                        classes.forEach((c) => {
                            if (c && !seenClasses.has(c)) {
                                seenClasses.add(c);
                                suggestions.push({
                                    label: c,
                                    kind: monaco.languages.CompletionItemKind
                                        .Class,
                                    insertText: c,
                                    detail: 'Class from index.html',
                                });
                            }
                        });
                    }

                    return { suggestions };
                },
            }),
        );

        // Auto-save on blur
        editor.onDidBlurEditorText(() => {
            this.handleSave();
        });

        // Ctrl+S shortcut
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.handleSave();
        });
    };

    render() {
        const { sessionId, version } = this.props;
        const {
            isMobile,
            deviceIndex,
            activeTab,
            fileCache,
            loading,
            unsavedContent,
            iframeKey,
        } = this.state;
        const device = DEVICES[deviceIndex];
        const isCodeView = activeTab !== 'preview';

        const previewUrl =
            sessionId && typeof version === 'number'
                ? `/api/sessions/${sessionId}/versions/${version}/static/index.html`
                : 'about:blank';

        const currentContent =
            activeTab !== 'preview'
                ? unsavedContent[activeTab] ?? fileCache[activeTab] ?? ''
                : '';

        return (
            <div
                className={classNames(styles.panel, {
                    [styles.codeView]: isCodeView,
                })}
            >
                <div className={styles.assetsTabs}>
                    <button
                        className={classNames(styles.assetTab, {
                            [styles.active]: activeTab === 'preview',
                        })}
                        onClick={() => this.handleTabChange('preview')}
                    >
                        Preview
                    </button>
                    <div className={styles.assetsSpacer}></div>
                    {(['html', 'css', 'js'] as const).map((type) => (
                        <button
                            key={type}
                            className={classNames(styles.assetTab, {
                                [styles.active]: activeTab === type,
                            })}
                            onClick={() => this.handleTabChange(type)}
                        >
                            {FILENAME_MAP[type]}
                            {unsavedContent[type] !== null && ' *'}
                        </button>
                    ))}
                </div>

                {!isCodeView && (
                    <div className={styles.toolbar}>
                        <div className={styles.deviceControls}>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={isMobile}
                                    onChange={this.toggleMobile}
                                />
                                <span className={styles.toggleSwitch}></span>
                                <span className={styles.toggleHint}>
                                    Mobile
                                </span>
                            </label>
                            <select
                                className={styles.deviceSelect}
                                disabled={!isMobile}
                                value={deviceIndex}
                                onChange={this.handleDeviceChange}
                            >
                                {DEVICES.map((d, i) => (
                                    <option key={d.name} value={i}>
                                        {d.name} ({d.width}×{d.height})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.actions}>
                            <button
                                className={styles.action}
                                onClick={this.handleNewWindow}
                                title="Open in new window"
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
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                    <polyline points="15 3 21 3 21 9"></polyline>
                                    <line x1="10" y1="14" x2="21" y2="3"></line>
                                </svg>
                            </button>
                            <button
                                className={styles.action}
                                onClick={this.handleDownload}
                                title="Download ZIP"
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
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                            </button>
                        </div>
                    </div>
                )}

                {!isCodeView && (
                    <div
                        className={classNames(styles.frameWrapper, {
                            [styles.mobile]: isMobile,
                        })}
                    >
                        <iframe
                            key={iframeKey}
                            ref={this.iframeRef}
                            src={previewUrl}
                            title="Preview"
                            sandbox="allow-scripts allow-same-origin allow-modals"
                            style={
                                isMobile
                                    ? {
                                        width: `${device.width}px`,
                                        height: `${device.height}px`,
                                    }
                                    : {}
                            }
                        />
                    </div>
                )}

                {isCodeView && (
                    <div className={styles.assetsPanels}>
                        {loading[activeTab] ? (
                            <div className={styles.loading}>Loading...</div>
                        ) : (
                            <Editor
                                height="100%"
                                defaultLanguage={this.getEditorLanguage(
                                    activeTab,
                                )}
                                language={this.getEditorLanguage(activeTab)}
                                value={currentContent}
                                theme="light"
                                onMount={this.handleEditorDidMount}
                                onChange={this.handleEditorChange}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    wordWrap: 'on',
                                    padding: { top: 16, bottom: 16 },
                                }}
                            />
                        )}
                    </div>
                )}
            </div>
        );
    }
    public getIframe = (): HTMLIFrameElement | null => {
        return this.iframeRef.current;
    };
}
