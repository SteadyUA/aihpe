import React from 'react';
import classNames from 'classnames';
import styles from './Workarea.module.css';

// Define IDisposable locally to avoid deep import issues
interface IDisposable {
    dispose(): void;
}

import { TabType } from '../../types';
import { Preview } from './Preview';
import { Images } from './Images';
import { Editor } from './Editor';
import { Artifact } from './Artifact';

interface WorkareaProps {
    sessionId: string | null;
    version: number;
    activeTab: TabType;
    onTabChange?: (tab: TabType) => void;
    onLoad?: () => void;
    isResizing?: boolean;
    onProceed?: () => void;
    isBusy?: boolean;
    isLatest?: boolean;
}

const FILENAME_MAP: Record<AssetType, string> = {
    html: 'index.html',
    css: 'styles.css',
    js: 'script.js',
    plan: 'implementation_plan.md'
};

type AssetType = 'html' | 'css' | 'js' | 'plan';

interface WorkareaState {
    iframeKey: number;
    // Cache per version: version -> { html: ..., css: ... }
    versionCache: Record<number, Record<AssetType, string | null>>;
    loading: Record<AssetType, boolean>;
    unsavedContent: Record<AssetType, string | null>;
    isSaving: boolean;
    hasUnreadPlanChanges: boolean;
}

export class Workarea extends React.Component<WorkareaProps, WorkareaState> {
    private previewRef: React.RefObject<Preview | null>;
    private disposables: IDisposable[] = [];

    constructor(props: WorkareaProps) {
        super(props);
        this.state = {
            iframeKey: 0,
            versionCache: {}, // Initialize empty
            loading: { html: false, css: false, js: false, plan: false },
            unsavedContent: { html: null, css: null, js: null, plan: null },
            isSaving: false,
            hasUnreadPlanChanges: false,
        };
        this.previewRef = React.createRef();
    }

    componentDidMount() {
        const { sessionId } = this.props;
        if (sessionId) {
            this.loadContent();
        }
    }

    private monacoConfigured = false;

    componentDidUpdate(
        prevProps: WorkareaProps,
        _prevState: WorkareaState
    ) {
        const sessionChanged = prevProps.sessionId !== this.props.sessionId;
        const versionChanged = prevProps.version !== this.props.version;
        const tabChanged = prevProps.activeTab !== this.props.activeTab;

        if (sessionChanged || versionChanged) {
            // Full reset for new turn/session
            this.setState(
                {
                    loading: { html: false, css: false, js: false, plan: false },
                    unsavedContent: { html: null, css: null, js: null, plan: null },
                    // Increment iframeKey to force Preview reload if needed
                    // (Preview handles turn change internally for key derivation, but we can signal explicitly too)
                    iframeKey: this.state.iframeKey + 1,
                },
                () => {
                    this.loadContent();
                },
            );
        } else if (tabChanged) {
            // Just tab switch - load content if missing
            this.loadContent();
        }
    }

    loadContent = () => {
        const { activeTab } = this.props;
        if (activeTab === 'preview' || activeTab === 'images') return;

        this.fetchFile(activeTab as AssetType);
    };

    componentWillUnmount() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.monacoConfigured = false;
    }

    public saveScroll = () => {
        this.previewRef.current?.saveScroll();
    }

    public restoreScroll = () => {
        this.previewRef.current?.restoreScroll();
    }

    public clearCache = (version: number, filename?: string) => {
        this.setState(prev => {
            const newCache = { ...prev.versionCache };

            if (filename) {
                // Clear specific file
                // Find asset type for filename
                const type = (Object.keys(FILENAME_MAP) as AssetType[]).find(k => FILENAME_MAP[k] === filename);
                if (type && newCache[version]) {
                    newCache[version] = { ...newCache[version], [type]: null };
                }
            } else {
                // Clear all for version
                delete newCache[version];
            }

            return {
                versionCache: newCache,
                iframeKey: prev.iframeKey + 1 // Force iframe refresh
            };
        }, () => {
            // Check if we need to set unread flag for plan
            if (filename && filename === FILENAME_MAP['plan'] && this.props.activeTab !== 'plan') {
                this.setState({ hasUnreadPlanChanges: true });
            }

            // Re-fetch if current and matching active tab
            const { version: currentVersion, sessionId, activeTab } = this.props;

            if (version === currentVersion && activeTab !== 'preview' && activeTab !== 'images' && sessionId) {
                // Check if we cleared the active tab's file
                if (filename) {
                    const type = (Object.keys(FILENAME_MAP) as AssetType[]).find(k => FILENAME_MAP[k] === filename);
                    if (type === activeTab) {
                        this.fetchFile(activeTab as AssetType);
                    }
                } else {
                    this.fetchFile(activeTab as AssetType);
                }
            }
        });
    }

    fetchFile = async (type: AssetType) => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;

        // Check cache for THIS version
        const currentVersionCache = this.state.versionCache[version];
        if (currentVersionCache && currentVersionCache[type] !== null && currentVersionCache[type] !== undefined) {
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
                `/api/sessions/${sessionId}/${version}/files/${filenameMap[type]}`,
            );
            if (!res.ok) throw new Error('Failed to fetch file');
            const text = await res.text();

            this.setState((prev) => {
                const versionCache = prev.versionCache[version] || { html: null, css: null, js: null, plan: null };
                return {
                    versionCache: {
                        ...prev.versionCache,
                        [version]: { ...versionCache, [type]: text }
                    },
                    loading: { ...prev.loading, [type]: false },
                };
            });
        } catch (error) {
            console.error(`Failed to load ${type}`, error);
            this.setState((prev) => {
                const versionCache = prev.versionCache[version] || { html: null, css: null, js: null, plan: null };
                return {
                    versionCache: {
                        ...prev.versionCache,
                        [version]: { ...versionCache, [type]: 'Error loading content' },
                    },
                    loading: { ...prev.loading, [type]: false },
                };
            });
        }
    };

    handleTabChange = async (tab: TabType) => {
        // Auto-save if switching AWAY from an editor
        const { activeTab } = this.props;
        const { unsavedContent } = this.state;
        // activeTab is the OLD tab
        if (activeTab !== 'preview' && activeTab !== 'images' && unsavedContent[activeTab as AssetType] !== null) {
            await this.handleSave(activeTab as AssetType);
        }

        if (tab === 'plan') {
            this.setState({ hasUnreadPlanChanges: false });
        }

        this.props.onTabChange?.(tab);
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
        const { sessionId, version, activeTab } = this.props;
        const { unsavedContent } = this.state;

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
                `/api/sessions/${sessionId}/${version}/files/${filename}`,
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
                const versionCache = prev.versionCache[version] || { html: null, css: null, js: null, plan: null };
                return {
                    versionCache: {
                        ...prev.versionCache,
                        [version]: { ...versionCache, [typeToSave]: content }
                    },
                    unsavedContent: {
                        ...prev.unsavedContent,
                        [typeToSave]: null,
                    },
                    isSaving: false,
                    iframeKey: prev.iframeKey + 1, // Force iframe refresh in Preview
                };
            });
        } catch (error) {
            console.error('Failed to save', error);
            this.setState({ isSaving: false });
        }
    };

    handleProceed = () => {
        this.props.onProceed?.();
    };

    getEditorLanguage = (tab: AssetType) => {
        switch (tab) {
            case 'html': return 'html';
            case 'css': return 'css';
            case 'js': return 'javascript';
            case 'plan': return 'markdown';
            default: return 'plaintext';
        }
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

        // Dispose old providers if any
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
                    const currVersion = this.props.version;
                    const cache = this.state.versionCache[currVersion];
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
                    const currVersion = this.props.version;
                    const cache = this.state.versionCache[currVersion];

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

    public getIframe = (): HTMLIFrameElement | null => {
        return this.previewRef.current?.getIframe() ?? null;
    };

    render() {
        const { sessionId, version, activeTab, onLoad } = this.props;
        const {
            versionCache,
            loading,
            unsavedContent,
            iframeKey,
            hasUnreadPlanChanges,
        } = this.state;
        const isCodeView = activeTab !== 'preview' && activeTab !== 'images';

        // Resolve content for current version
        const currentFiles = versionCache[version] || { html: null, css: null, js: null, plan: null };

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
                    <span className={styles.versionLabel}>
                        v{version}
                    </span>
                    <button
                        className={classNames(styles.assetTab, {
                            [styles.active]: activeTab === 'plan',
                        })}
                        onClick={() => this.handleTabChange('plan')}
                    >
                        {hasUnreadPlanChanges && <span className={styles.notificationDot}></span>}
                        Implementation plan
                        {unsavedContent['plan'] !== null && ' *'}
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

                <Preview
                    ref={this.previewRef}
                    sessionId={sessionId}
                    version={version}
                    active={activeTab === 'preview'}
                    onLoad={onLoad}
                    reloadTrigger={iframeKey}
                    isResizing={this.props.isResizing}
                />

                <Images
                    sessionId={sessionId}
                    version={version}
                    active={activeTab === 'images'}
                />

                <Artifact
                    content={unsavedContent['plan'] ?? currentFiles['plan'] ?? ''}
                    onProceed={this.handleProceed}
                    active={activeTab === 'plan'}
                    busy={this.props.isBusy}
                    isLatest={this.props.isLatest}
                />

                {
                    (['html', 'css', 'js'] as const).map(type => {
                        const content = unsavedContent[type] ?? currentFiles[type] ?? '';
                        const language = this.getEditorLanguage(type);

                        return (
                            <Editor
                                key={type}
                                language={language}
                                value={content}
                                loading={loading[type]}
                                active={activeTab === type}
                                onChange={this.handleEditorChange(type)}
                                onMount={this.handleEditorDidMount(type)}
                            />
                        );
                    })
                }
            </div >
        );
    }
}
