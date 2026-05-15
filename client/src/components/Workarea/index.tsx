import React from 'react';
import classNames from 'classnames';
import styles from './Workarea.module.css';

// Define IDisposable locally to avoid deep import issues
interface IDisposable {
    dispose(): void;
}

import { TabType } from '../../types';
import { Preview } from './Preview';
import { Resources } from './Resources';
import { Editor } from './Editor';
import { MemoryModal } from './MemoryModal';

import { apiAuth } from '../../utils/api';

interface WorkareaProps {
    sessionId: string | null;
    version?: number;
    activeTab: TabType;
    onTabChange?: (tab: TabType) => void;
    onLoad?: () => void;
    isResizing?: boolean;
    onProceed?: () => void;
    isBusy?: boolean;
    isLatest?: boolean;
    latestVersion?: number;
    displayedTurn: number;
    onSelectResource?: (filename: string | null) => void;
    selectedResource?: string | null;
    onPickElement?: () => void;
    onCancelPick?: () => void;
    isPicking?: boolean;
    selection?: string | null;
    onSelectElement?: (selector: string | null) => void;
}

export enum AssetType {
    HTML = 'html',
    CSS = 'css',
    JS = 'js'
}

const FILENAME_MAP: Record<AssetType, string> = {
    [AssetType.HTML]: 'index.html',
    [AssetType.CSS]: 'styles.css',
    [AssetType.JS]: 'script.js'
};

interface WorkareaState {
    previewCache: number[];
    versionReloadKeys: Record<number, number>;
    // Cache per version: version -> { html: ..., css: ... }
    versionCache: Record<number, Record<AssetType, string | null>>;
    loading: Record<AssetType, boolean>;
    unsavedContent: Record<AssetType, string | null>;
    isSaving: boolean;
    showMemoryModal: boolean;


}

export class Workarea extends React.Component<WorkareaProps, WorkareaState> {
    private previewRef: React.RefObject<Preview | null>;
    private disposables: IDisposable[] = [];

    constructor(props: WorkareaProps) {
        super(props);
        this.state = {
            previewCache: props.version !== undefined ? [props.version] : [],
            versionReloadKeys: {},
            versionCache: {}, // Initialize empty
            loading: { [AssetType.HTML]: false, [AssetType.CSS]: false, [AssetType.JS]: false } as Record<AssetType, boolean>,
            unsavedContent: { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null } as Record<AssetType, string | null>,
            isSaving: false,
            showMemoryModal: false,
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
        const tabChanged = prevProps.activeTab !== this.props.activeTab;

        if (sessionChanged) {
            // Full reset for new session
            this.setState(
                (_prev) => {
                    const newState: Partial<WorkareaState> = {
                        loading: { [AssetType.HTML]: false, [AssetType.CSS]: false, [AssetType.JS]: false } as Record<AssetType, boolean>,
                        unsavedContent: { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null } as Record<AssetType, string | null>,
                        previewCache: this.props.version !== undefined ? [this.props.version] : [],
                        versionReloadKeys: {},
                    };



                    return newState as WorkareaState;
                },
                () => {
                    this.loadContent();
                },
            );
        } else if (versionChanged) {
            // Add to cache
            this.setState(
                (prev) => {
                    const newVersion = this.props.version;
                    let newCache = [...prev.previewCache];
                    if (newVersion !== undefined) {
                        if (!newCache.includes(newVersion)) {
                            newCache.push(newVersion);
                            if (newCache.length > 5) {
                                newCache.shift();
                            }
                        }
                    }

                    const newState: Partial<WorkareaState> = {
                        loading: { [AssetType.HTML]: false, [AssetType.CSS]: false, [AssetType.JS]: false } as Record<AssetType, boolean>,
                        unsavedContent: { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null } as Record<AssetType, string | null>,
                        previewCache: newCache
                    };



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
        if (activeTab === TabType.PREVIEW || activeTab === TabType.RESOURCES) return;

        this.fetchFile(activeTab as unknown as AssetType);
    };

    componentWillUnmount() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.monacoConfigured = false;
    }



    handleVersionClick = () => {
        this.setState({ showMemoryModal: true });
    };

    closeMemoryModal = () => {
        this.setState({ showMemoryModal: false });
    };

    public restoreScroll = () => {
        this.previewRef.current?.restoreScroll();
    }

    public visualizeSelection = (selector: string, scrollTo: boolean = false) => {
        this.previewRef.current?.visualizeSelection(selector, scrollTo);
    };

    public clearCache = (version: number, filename?: string) => {
        this.setState(prev => {
            const newCache = { ...prev.versionCache };

            if (filename) {
                // Clear specific file
                const type = (Object.keys(FILENAME_MAP) as AssetType[]).find(k => FILENAME_MAP[k] === filename);

                // Handle Plan (Artifact)
                if (type && newCache[version]) {
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
                versionReloadKeys: {
                    ...prev.versionReloadKeys,
                    [version]: (prev.versionReloadKeys[version] || 0) + 1
                }
            };
        }, () => {
            // Re-fetch if current and matching active tab
            const { version: currentVersion, sessionId, activeTab } = this.props;



            if (version === currentVersion && activeTab !== TabType.PREVIEW && activeTab !== TabType.RESOURCES && sessionId) {
                // Standard file fetch
                if (filename) {
                    const type = (Object.keys(FILENAME_MAP) as AssetType[]).find(k => FILENAME_MAP[k] === filename);
                    if (type === activeTab as unknown as AssetType) {
                        this.fetchFile(activeTab as unknown as AssetType);
                    }
                } else {
                    this.fetchFile(activeTab as unknown as AssetType);
                }
            }
        });
    }

    fetchFile = async (type: AssetType) => {
        const { sessionId, version } = this.props;
        if (!sessionId || version === undefined) return;

        // Check loading
        if (this.state.loading[type]) {
            return;
        }

        const filenameMap: Record<AssetType, string> = FILENAME_MAP;
        const filename = filenameMap[type];



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
            const res = await apiAuth.fetch(
                `/api/sessions/${sessionId}/${version}/files/${filename}`,
            );
            if (!res.ok) throw new Error('Failed to fetch file');
            const text = await res.text();

            this.setState((prev) => {
                const versionCache = prev.versionCache[version] || { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null };
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
                const versionCache = prev.versionCache[version] || { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null };
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
        if (activeTab !== TabType.PREVIEW && activeTab !== TabType.RESOURCES && unsavedContent[activeTab as unknown as AssetType] !== null) {
            await this.handleSave(activeTab as unknown as AssetType);
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
        const typeToSave = targetType || activeTab as unknown as AssetType;

        if (version === undefined) return;

        if (typeToSave === TabType.PREVIEW as unknown as AssetType || typeToSave === TabType.RESOURCES as unknown as AssetType) return;
        const content = unsavedContent[typeToSave as AssetType];
        if (content === null) return; // No changes

        if (!sessionId) return;

        this.setState({ isSaving: true });

        try {
            const filenameMap: Record<AssetType, string> = FILENAME_MAP;
            const filename = filenameMap[typeToSave as AssetType];

            const res = await apiAuth.fetch(
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
            // Update cache with saved content and clear unsaved state
            this.setState((prev) => {
                const versionCache = prev.versionCache[version] || { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null };
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
                    versionReloadKeys: {
                        ...prev.versionReloadKeys,
                        [version]: (prev.versionReloadKeys[version] || 0) + 1
                    }, // Force iframe refresh in Preview
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
                    if (currVersion === undefined) return { suggestions: [] };
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
                    if (currVersion === undefined) return { suggestions: [] };
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
            previewCache,
            versionReloadKeys
        } = this.state;
        const isCodeView = activeTab !== TabType.PREVIEW && activeTab !== TabType.RESOURCES;

        if (version === undefined) {
            return (
                <div className={classNames(styles.panel, { [styles.codeView]: isCodeView })}>
                    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
                        <div className="loader">Resolving version...</div>
                    </div>
                </div>
            );
        }

        // Resolve content for current version
        const currentFiles = versionCache[version] || { [AssetType.HTML]: null, [AssetType.CSS]: null, [AssetType.JS]: null };

        return (
            <div
                className={classNames(styles.panel, {
                    [styles.codeView]: isCodeView,
                })}
            >
                <div className={styles.assetsTabs}>
                    <button
                        className={classNames(styles.assetTab, {
                            [styles.active]: activeTab === TabType.PREVIEW,
                        })}
                        onClick={() => this.handleTabChange(TabType.PREVIEW)}
                    >
                        Preview
                    </button>
                    <button
                        className={classNames(styles.assetTab, {
                            [styles.active]: activeTab === TabType.RESOURCES,
                        })}
                        onClick={() => this.handleTabChange(TabType.RESOURCES)}
                    >Resources</button>
                    <span
                        className={styles.versionLabel}
                        style={{ cursor: 'pointer' }}
                        onClick={this.handleVersionClick}
                        title="View Memory Files"
                    >
                        v{version}
                    </span>

                    <div className={styles.assetsSpacer}></div>
                    {([AssetType.HTML, AssetType.CSS, AssetType.JS]).map((type) => (
                        <button
                            key={type}
                            className={classNames(styles.assetTab, {
                                [styles.active]: activeTab as unknown as AssetType === type,
                            })}
                            onClick={() => this.handleTabChange(type as unknown as TabType)}
                        >
                            {FILENAME_MAP[type]}
                            {unsavedContent[type] !== null && ' *'}
                        </button>
                    ))}
                </div>

                {previewCache.map((cachedVersion) => {
                    const isPreviewActive = activeTab === TabType.PREVIEW && cachedVersion === version;
                    return (
                        <Preview
                            key={`preview-${cachedVersion}`}
                            ref={cachedVersion === version ? this.previewRef : undefined}
                            sessionId={sessionId}
                            version={cachedVersion}
                            active={isPreviewActive}
                            onLoad={cachedVersion === version ? onLoad : undefined}
                            reloadTrigger={versionReloadKeys[cachedVersion] || 0}
                            isResizing={this.props.isResizing}
                            onPickElement={cachedVersion === version ? this.props.onPickElement : undefined}
                            onCancelPick={cachedVersion === version ? this.props.onCancelPick : undefined}
                            isPicking={cachedVersion === version ? this.props.isPicking : undefined}
                            selection={cachedVersion === version ? this.props.selection : undefined}
                            onSelectElement={cachedVersion === version ? this.props.onSelectElement : undefined}
                        />
                    );
                })}

                <Resources
                    sessionId={sessionId}
                    version={version}
                    active={activeTab === TabType.RESOURCES}
                    onSelectResource={this.props.onSelectResource}
                    selectedResource={this.props.selectedResource}
                />



                {
                    ([AssetType.HTML, AssetType.CSS, AssetType.JS]).map(type => {
                        const content = unsavedContent[type] ?? currentFiles[type] ?? '';
                        const language = this.getEditorLanguage(type);

                        return (
                            <Editor
                                key={type}
                                language={language}
                                value={content}
                                loading={loading[type]}
                                active={activeTab as unknown as AssetType === type}
                                onChange={this.handleEditorChange(type)}
                                onMount={this.handleEditorDidMount(type)}
                            />
                        );
                    })
                }

                {sessionId && (
                    <MemoryModal
                        sessionId={sessionId}
                        isOpen={this.state.showMemoryModal}
                        onClose={this.closeMemoryModal}
                        initialVersion={version}
                        maxVersion={this.props.latestVersion ?? version}
                    />
                )}
            </div >
        );
    }
}
