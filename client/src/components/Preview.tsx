import React from 'react';
import classNames from 'classnames';
import Editor from '@monaco-editor/react';
import { UiCheckbox } from './UiCheckbox';
import styles from './Preview.module.css';

// Define IDisposable locally to avoid deep import issues
interface IDisposable {
    dispose(): void;
}

interface PreviewProps {
    sessionId: string | null;
    turn: number;
    onTabChange?: (tab: TabType) => void;
}

interface ImageMetadata {
    filename: string;
    description: string;
    createdAt: string;
    model: string;
}

interface Device {
    name: string;
    width: number;
    height: number;
}

const DEVICES: Device[] = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone 12/13/14', width: 390, height: 844 },
    { name: 'Pixel 7 / Samsung S20 Ultra', width: 412, height: 915 },
    { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
    { name: 'iPad Mini', width: 768, height: 1024 },
    { name: 'iPad Air', width: 820, height: 1180 },
];

const FILENAME_MAP: Record<AssetType, string> = {
    html: 'index.html',
    css: 'styles.css',
    js: 'script.js',
};

type AssetType = 'html' | 'css' | 'js';
type TabType = 'preview' | 'images' | AssetType;

interface PreviewState {
    isMobile: boolean;
    deviceIndex: number;
    activeTab: TabType;
    iframeKey: number;
    // Cache per turn: turnId -> { html: ..., css: ... }
    turnCache: Record<number, Record<AssetType, string | null>>;
    loading: Record<AssetType, boolean> & { images: boolean };
    unsavedContent: Record<AssetType, string | null>;
    isSaving: boolean;
    images: ImageMetadata[];
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
            turnCache: {}, // Initialize empty
            loading: { html: false, css: false, js: false, images: false },
            unsavedContent: { html: null, css: null, js: null },
            isSaving: false,
            images: [],
        };
        this.iframeRef = React.createRef();
    }

    private preservedScroll: { x: number; y: number } | null = null;

    getSnapshotBeforeUpdate(prevProps: PreviewProps, prevState: PreviewState) {
        // If we are about to switch version within the same session
        if (
            prevProps.sessionId === this.props.sessionId &&
            prevProps.turn !== this.props.turn &&
            prevState.activeTab === 'preview'
        ) {
            const iframe = this.iframeRef.current;
            if (iframe && iframe.contentWindow) {
                try {
                    return {
                        x: iframe.contentWindow.scrollX,
                        y: iframe.contentWindow.scrollY,
                    };
                } catch (e) {
                    // Ignored (cross-origin etc)
                }
            }
        }
        return null;
    }

    private monacoConfigured = false;

    componentDidUpdate(
        prevProps: PreviewProps,
        _prevState: PreviewState,
        snapshot: any,
    ) {
        if (
            prevProps.sessionId !== this.props.sessionId ||
            prevProps.turn !== this.props.turn
        ) {
            const isSessionSwitch = prevProps.sessionId !== this.props.sessionId;
            const nextActiveTab = isSessionSwitch ? 'preview' : this.state.activeTab;

            // When switching turn, we should:
            // 1. Clear unsaved content (as we moved away)
            // 2. Not clear cache (we keep it)
            // 3. Start fetching if we are on a code tab and missing cache for new turn

            this.setState(
                {
                    loading: { html: false, css: false, js: false, images: false }, // Reset loading only
                    unsavedContent: { html: null, css: null, js: null },
                    activeTab: nextActiveTab,
                    iframeKey: this.state.iframeKey + 1,
                },
                () => {
                    // Fetch content for the new version if we stayed on a non-preview tab
                    // And only if missing from cache (handled by fetchFile)
                    if (!isSessionSwitch && nextActiveTab !== 'preview') {
                        if (nextActiveTab === 'images') {
                            this.fetchImages();
                        } else {
                            this.fetchFile(nextActiveTab as AssetType);
                        }
                    }
                },
            );

            if (snapshot) {
                this.preservedScroll = snapshot;
            } else {
                this.preservedScroll = null;
            }
        }
    }

    handleIframeLoad = () => {
        if (this.preservedScroll) {
            const iframe = this.iframeRef.current;
            if (iframe && iframe.contentWindow) {
                try {
                    iframe.contentWindow.scrollTo(
                        this.preservedScroll.x,
                        this.preservedScroll.y,
                    );
                } catch (e) {
                    // Ignored
                }
            }
            this.preservedScroll = null;
        }
    };

    componentWillUnmount() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.monacoConfigured = false;
    }

    public clearCache = (turn: number) => {
        this.setState(prev => {
            const newCache = { ...prev.turnCache };
            delete newCache[turn];
            return {
                turnCache: newCache,
                // If we are currently viewing this turn, we might want to trigger a reload?
                // If active turn == cleared turn, and active tab != preview, we should re-fetch.
                // But simplified: next interaction/render will fetch if missing.
                iframeKey: prev.iframeKey + 1 // Force iframe refresh just in case
            };
        }, () => {
            // Re-fetch if current
            const { turn, sessionId } = this.props;
            const { activeTab } = this.state;
            if (turn === turn && activeTab !== 'preview' && activeTab !== 'images' && sessionId) {
                this.fetchFile(activeTab as AssetType);
            }
        });
    }

    fetchFile = async (type: AssetType) => {
        const { sessionId, turn } = this.props;
        if (!sessionId) return;

        // Check cache for THIS turn
        const currentTurnCache = this.state.turnCache[turn];
        if (currentTurnCache && currentTurnCache[type] !== null && currentTurnCache[type] !== undefined) {
            return;
        }

        // Check loading
        if (this.state.loading[type]) {
            return;
        }

        this.setState((prev) => ({
            loading: { ...prev.loading, [type]: true },
        }));

        const filenameMap: Record<AssetType, string> = FILENAME_MAP;

        try {
            const res = await fetch(
                `/api/sessions/${sessionId}/turns/${turn}/static/${filenameMap[type]}`,
            );
            if (!res.ok) throw new Error('Failed to fetch file');
            const text = await res.text();

            this.setState((prev) => {
                const turnCache = prev.turnCache[turn] || { html: null, css: null, js: null };
                return {
                    turnCache: {
                        ...prev.turnCache,
                        [turn]: { ...turnCache, [type]: text }
                    },
                    loading: { ...prev.loading, [type]: false },
                };
            });
        } catch (error) {
            console.error(`Failed to load ${type}`, error);
            this.setState((prev) => {
                const turnCache = prev.turnCache[turn] || { html: null, css: null, js: null };
                return {
                    turnCache: {
                        ...prev.turnCache,
                        [turn]: { ...turnCache, [type]: 'Error loading content' },
                    },
                    loading: { ...prev.loading, [type]: false },
                };
            });
        }
    };

    fetchImages = async () => {
        const { sessionId, turn } = this.props;
        if (!sessionId) return;

        // Images are not cached in turnCache for now (as user asked for file cache specifically?)
        // Or should we? The existing code had `images: ImageMetadata[]` in state.
        // Let's keep images ephemeral per turn for simplicity unless needed.
        // Or we can cache them too, but state structure is different.
        // Existing logic: checks loading.

        if (this.state.loading.images) return;

        this.setState((prev) => ({
            loading: { ...prev.loading, images: true },
        }));

        try {
            const res = await fetch(
                `/api/sessions/${sessionId}/turns/${turn}/images`,
            );
            if (!res.ok) throw new Error('Failed to fetch images');
            const images = await res.json();
            this.setState((prev) => ({
                images,
                loading: { ...prev.loading, images: false },
            }));
        } catch (error) {
            console.error('Failed to load images', error);
            this.setState((prev) => ({
                images: [],
                loading: { ...prev.loading, images: false },
            }));
        }
    };

    handleTabChange = async (tab: TabType) => {
        // Auto-save if switching AWAY from an editor
        const { activeTab, unsavedContent } = this.state;
        // activeTab is the OLD tab
        if (activeTab !== 'preview' && activeTab !== 'images' && unsavedContent[activeTab as AssetType] !== null) {
            await this.handleSave(activeTab as AssetType);
        }

        this.setState({ activeTab: tab });
        this.props.onTabChange?.(tab);

        if (tab === 'images') {
            this.fetchImages();
        } else if (tab !== 'preview') {
            this.fetchFile(tab);
        }
    };

    handleEditorChange = (type: AssetType) => (value: string | undefined) => {
        if (value === undefined) return;

        this.setState((prev) => ({
            unsavedContent: {
                ...prev.unsavedContent,
                [type]: value,
            },
        }));
    };

    handleSave = async (targetType?: AssetType) => {
        const { sessionId, turn } = this.props;
        const { activeTab, unsavedContent } = this.state;

        // Use targetType if provided, otherwise activeTab
        const typeToSave = targetType || activeTab;

        if (typeToSave === 'preview' || typeToSave === 'images') return;
        const content = unsavedContent[typeToSave as AssetType];
        if (content === null) return; // No changes

        if (!sessionId) return;

        this.setState({ isSaving: true });

        try {
            const filenameMap: Record<AssetType, string> = FILENAME_MAP;
            const filename = filenameMap[typeToSave as AssetType];

            const res = await fetch(
                `/api/sessions/${sessionId}/turns/${turn}/static/${filename}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: content,
                },
            );

            if (!res.ok) {
                // Try to read error message if possible
                let errorMessage = 'Unknown error';
                try {
                    const text = await res.text();
                    errorMessage = text || res.statusText;
                } catch (e) { }

                alert(`Error saving: ${errorMessage}`);
                throw new Error(errorMessage);
            }

            // Update cache with saved content and clear unsaved state
            this.setState((prev) => {
                const turnCache = prev.turnCache[turn] || { html: null, css: null, js: null };
                return {
                    turnCache: {
                        ...prev.turnCache,
                        [turn]: { ...turnCache, [typeToSave]: content }
                    },
                    unsavedContent: {
                        ...prev.unsavedContent,
                        [typeToSave]: null,
                    },
                    isSaving: false,
                    iframeKey: prev.iframeKey + 1, // Force iframe reload
                };
            });
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
            default:
                return 'plaintext';
        }
    };

    handleDownload = async () => {
        const { sessionId, turn } = this.props;
        if (!sessionId) return;

        try {
            const response = await fetch(
                `/api/sessions/${encodeURIComponent(sessionId)}/turns/${turn}/archive`,
            );
            if (!response.ok) throw new Error('Failed to download');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `session-${sessionId.slice(0, 8)}-turn-${turn}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed', error);
        }
    };

    handleNewWindow = () => {
        const { sessionId, turn } = this.props;
        if (!sessionId) return;

        const url = `/api/sessions/${sessionId}/turns/${turn}/static/index.html`;
        window.open(url, '_blank');
    };

    handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        this.setState({ deviceIndex: Number(e.target.value) });
    };

    toggleMobile = (checked: boolean) => {
        this.setState({ isMobile: checked });
    };

    handleEditorDidMount = (type: AssetType) => (editor: any, monaco: any) => {
        // Per-editor config

        // Auto-save on blur
        editor.onDidBlurEditorText(() => {
            this.handleSave(type);
        });

        // Ctrl+S shortcut
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.handleSave(type);
        });

        // Global config (Providers) - run once
        if (this.monacoConfigured) return;
        this.monacoConfigured = true;

        // Dispose old providers if any (from previous session of this component?)
        // Actually if we just set flag true, we assume we never need to re-register unless we unmount.
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
                    // Need to check CACHE for css?
                    // We need active turn.
                    const currTurn = this.props.turn;
                    const cache = this.state.turnCache[currTurn];

                    const cssContent =
                        this.state.unsavedContent?.css ??
                        cache?.css ??
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
                    const currTurn = this.props.turn;
                    const cache = this.state.turnCache[currTurn];

                    const htmlContent =
                        this.state.unsavedContent?.html ??
                        cache?.html ??
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
    };

    render() {
        const { sessionId, turn } = this.props;
        const {
            isMobile,
            deviceIndex,
            activeTab,
            turnCache,
            loading,
            unsavedContent,
            iframeKey,
        } = this.state;
        const device = DEVICES[deviceIndex];
        const isCodeView = activeTab !== 'preview' && activeTab !== 'images';

        const previewUrl =
            sessionId && typeof turn === 'number'
                ? `/api/sessions/${sessionId}/turns/${turn}/static/index.html`
                : 'about:blank';

        const visibleImages = this.state.images;

        // Resolve content for current turn
        const currentFiles = turnCache[turn] || { html: null, css: null, js: null };

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
                    <button
                        className={classNames(styles.assetTab, {
                            [styles.active]: activeTab === 'images',
                        })}
                        onClick={() => this.handleTabChange('images')}
                    >
                        Images
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

                {/* IMAGES TAB CONTAINER */}
                <div className={styles.imagesPanel} style={{ display: activeTab === 'images' ? 'block' : 'none' }}>
                    {loading.images ? (
                        <div className={styles.loading}>Loading images...</div>
                    ) : visibleImages.length === 0 ? (
                        <div className={styles.noImages}>
                            No images found for this version
                        </div>
                    ) : (
                        <div className={styles.imageGrid}>
                            {visibleImages.map((img) => (
                                <div
                                    key={img.filename}
                                    className={styles.imageTile}
                                >
                                    <img
                                        src={`/api/sessions/${sessionId}/turns/${turn}/static/${img.filename}`}
                                        alt={img.description}
                                        className={styles.imageThumb}
                                    />
                                    <div className={styles.imageDesc}>
                                        {img.description}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* PREVIEW TAB CONTAINER */}
                <div style={{ display: activeTab === 'preview' ? 'flex' : 'none', flexDirection: 'column', height: '100%', flex: 1, overflow: 'hidden' }}>
                    <div className={styles.toolbar}>
                        <div className={styles.deviceControls}>
                            <UiCheckbox
                                checked={isMobile}
                                onChange={this.toggleMobile}
                                label="Mobile"
                            />
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
                            onLoad={this.handleIframeLoad}
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
                </div>

                {/* EDITORS (Persistent) */}
                {(['html', 'css', 'js'] as const).map(type => {
                    const content = unsavedContent[type] ?? currentFiles[type] ?? '';
                    const language = this.getEditorLanguage(type);

                    return (
                        <div key={type} className={styles.assetsPanels} style={{ display: activeTab === type ? 'flex' : 'none' }}>
                            {loading[type] ? (
                                <div className={styles.loading}>Loading...</div>
                            ) : (
                                <Editor
                                    height="100%"
                                    defaultLanguage={language}
                                    language={language}
                                    value={content}
                                    theme="light"
                                    onMount={this.handleEditorDidMount(type)}
                                    onChange={this.handleEditorChange(type)}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        wordWrap: 'on',
                                        padding: { top: 16, bottom: 16 },
                                    }}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    public getIframe = (): HTMLIFrameElement | null => {
        return this.iframeRef.current;
    };
}
