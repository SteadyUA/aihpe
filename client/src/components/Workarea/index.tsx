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
    fastMode?: boolean;
    displayedTurn: number;
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
    // Cache per turn for artifacts: turn -> { plan: ... }
    artifactCache: Record<number, Record<string, string | null>>;
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
            artifactCache: {},
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
    ) {

        const sessionChanged = prevProps.sessionId !== this.props.sessionId;
        const versionChanged = prevProps.version !== this.props.version;
        const activeTurnChanged = prevProps.displayedTurn !== this.props.displayedTurn;
        const tabChanged = prevProps.activeTab !== this.props.activeTab;

        if (sessionChanged || versionChanged || activeTurnChanged) {
            // Full reset for new turn/session
            this.setState(
                (prev) => {
                    const newState: Partial<WorkareaState> = {
                        loading: { html: false, css: false, js: false, plan: false },
                        unsavedContent: { html: null, css: null, js: null, plan: null },
                        iframeKey: prev.iframeKey + 1,
                    };

                    if (activeTurnChanged) {
                        newState.hasUnreadPlanChanges = false;
                    }

                    return newState as WorkareaState;
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

    public clearCache = (version: number, filename?: string, turn?: number) => {
        this.setState(prev => {
            const newCache = { ...prev.versionCache };
            const newArtifactCache = { ...prev.artifactCache };
            let hasUnreadPlanChanges = prev.hasUnreadPlanChanges;

            if (filename) {
                // Clear specific file
                const type = (Object.keys(FILENAME_MAP) as AssetType[]).find(k => FILENAME_MAP[k] === filename);

                // Handle Plan (Artifact)
                if (type === 'plan' && turn !== undefined) {
                    const isPlanActive = this.props.activeTab === 'plan';
                    const isCurrentTurn = turn === this.props.displayedTurn;

                    if (!isPlanActive && isCurrentTurn) {
                        // Don't clear cache, just mark as unread
                        hasUnreadPlanChanges = true;
                        // We keep the OLD content in cache so the dot appears (checked via hasPlan in render)
                    } else {
                        // Active or other turn -> clear it
                        if (newArtifactCache[turn]) {
                            // We must properly delete the key or set to null to force refetch
                            newArtifactCache[turn] = { ...newArtifactCache[turn], plan: null };
                        }
                    }
                }
                // Handle Standard Files
                else if (type && newCache[version]) {
                    newCache[version] = { ...newCache[version], [type]: null };
                }

            } else {
                // Clear all for version (legacy/full refresh)
                delete newCache[version];
                // For artifacts, we might need to clear current turn too if version matches?
                // But usually this acts on versioned files.
                // If we need to clear artifacts, we'd expect specific calls.
            }

            return {
                versionCache: newCache,
                artifactCache: newArtifactCache,
                hasUnreadPlanChanges,
                iframeKey: prev.iframeKey + 1
            };
        }, () => {
            // Re-fetch if current and matching active tab
            const { version: currentVersion, sessionId, activeTab } = this.props;

            // If we are on the plan tab, and we just cleared it (because we were acting on it), fetch again
            if (activeTab === 'plan' && filename === FILENAME_MAP['plan'] && turn === this.props.displayedTurn) {
                this.fetchFile('plan');
                return;
            }

            if (version === currentVersion && activeTab !== 'preview' && activeTab !== 'images' && sessionId && activeTab !== 'plan') {
                // Standard file fetch
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

    fetchFile = async (type: AssetType, force: boolean = false) => {
        const { sessionId, version, displayedTurn } = this.props;
        if (!sessionId) return;

        // Check loading
        if (this.state.loading[type]) {
            return;
        }

        const filenameMap: Record<AssetType, string> = FILENAME_MAP;
        const filename = filenameMap[type];

        // SPECIAL HANDLING FOR PLAN (ARTIFACT)
        if (type === 'plan') {
            const currentArtifactCache = this.state.artifactCache[displayedTurn];
            // If we have a value AND force is false, use cache.
            // Note: We ignored hasUnreadPlanChanges here intentionally - we want cache unless forced.
            if (!force && currentArtifactCache && currentArtifactCache[type] !== null && currentArtifactCache[type] !== undefined) {
                return; // Already cached
            }

            this.setState((prev) => ({
                loading: { ...prev.loading, [type]: true },
            }));

            try {
                const res = await fetch(
                    `/api/sessions/${sessionId}/artifacts/${displayedTurn}/${filename}`,
                );

                let text: string;
                if (!res.ok) {
                    if (res.status === 404) {
                        // Should not happen as server returns default, but handle gracefullly
                        text = '# No plan';
                    } else {
                        throw new Error('Failed to fetch artifact');
                    }
                } else {
                    text = await res.text();
                }

                this.setState((prev) => {
                    const artifactCache = prev.artifactCache[displayedTurn] || {};
                    return {
                        artifactCache: {
                            ...prev.artifactCache,
                            [displayedTurn]: { ...artifactCache, [type]: text }
                        },
                        loading: { ...prev.loading, [type]: false },
                    };
                });
            } catch (error) {
                console.error(`Failed to load artifact ${type}`, error);
                this.setState((prev) => {
                    const artifactCache = prev.artifactCache[displayedTurn] || {};
                    return {
                        artifactCache: {
                            ...prev.artifactCache,
                            [displayedTurn]: { ...artifactCache, [type]: 'Error loading content' }
                        },
                        loading: { ...prev.loading, [type]: false },
                    };
                });
            }
            return;
        }

        // STANDARD HANDLING FOR OTHER FILES (VERSION CACHE)

        // Check cache for THIS version
        const currentVersionCache = this.state.versionCache[version];
        if (currentVersionCache && currentVersionCache[type] !== null && currentVersionCache[type] !== undefined) {
            return;
        }

        this.setState((prev) => ({
            loading: { ...prev.loading, [type]: true },
        }));

        try {
            const res = await fetch(
                `/api/sessions/${sessionId}/${version}/files/${filename}`,
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
        const { sessionId, version, activeTab, onLoad, fastMode, displayedTurn } = this.props;
        const {
            versionCache,
            loading,
            unsavedContent,
            iframeKey,
            hasUnreadPlanChanges,
            artifactCache,
        } = this.state;
        const isCodeView = activeTab !== 'preview' && activeTab !== 'images';

        // Resolve content for current version
        const currentFiles = versionCache[version] || { html: null, css: null, js: null, plan: null };

        // Resolve artifact for current turn
        const currentArtifacts = artifactCache[displayedTurn] || { plan: null };

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
                    {/* {!fastMode && (
                        <button
                            className={classNames(styles.assetTab, {
                                [styles.active]: activeTab === 'plan',
                            })}
                            onClick={() => this.handleTabChange('plan')}
                        >
                            {hasUnreadPlanChanges && <span className={styles.notificationDot}></span>}
                            Implementation plan
                        </button>
                    )} */}
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

                {/* <Artifact
                    content={unsavedContent['plan'] ?? currentArtifacts['plan'] ?? currentFiles['plan'] ?? ''}
                    onProceed={this.handleProceed}
                    active={activeTab === 'plan'}
                    busy={this.props.isBusy}
                    isLatest={this.props.isLatest}
                /> */}

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
