import React from 'react';
import classNames from 'classnames';
import styles from './Preview.module.css';

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

type AssetType = 'html' | 'css' | 'js';
type TabType = 'preview' | AssetType;

interface PreviewState {
    isMobile: boolean;
    deviceIndex: number;
    activeTab: TabType;
    iframeKey: number;
    fileCache: Record<AssetType, string | null>;
    loading: Record<AssetType, boolean>;
}

export class Preview extends React.Component<PreviewProps, PreviewState> {
    private iframeRef: React.RefObject<HTMLIFrameElement | null>;

    constructor(props: PreviewProps) {
        super(props);
        this.state = {
            isMobile: false,
            deviceIndex: 0,
            activeTab: 'preview',
            iframeKey: 0,
            fileCache: { html: null, css: null, js: null },
            loading: { html: false, css: false, js: false },
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
                },
                () => {
                    // If we are on a code tab, we need to re-fetch correctly
                    if (this.state.activeTab !== 'preview') {
                        this.fetchFile(this.state.activeTab);
                    }
                },
            );
        }
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

        const filenameMap: Record<AssetType, string> = {
            html: 'index.html',
            css: 'styles.css',
            js: 'script.js',
        };

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

    handleTabChange = (tab: TabType) => {
        this.setState({ activeTab: tab });
        if (tab !== 'preview') {
            this.fetchFile(tab);
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

    getCodeContent = () => {
        const { activeTab, fileCache, loading } = this.state;
        if (activeTab === 'preview') return null;

        if (loading[activeTab]) {
            return 'Loading...';
        }
        return fileCache[activeTab] || '';
    };

    render() {
        const { sessionId, version } = this.props;
        const { isMobile, deviceIndex, activeTab } = this.state;
        const device = DEVICES[deviceIndex];
        const isCodeView = activeTab !== 'preview';

        const previewUrl =
            sessionId && typeof version === 'number'
                ? `/api/sessions/${sessionId}/versions/${version}/static/index.html`
                : 'about:blank';

        return (
            <div
                className={classNames(styles.panel, {
                    [styles.codeView]: isCodeView,
                })}
            >
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

                <div className={styles.assets}>
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
                                {type.toUpperCase()}
                            </button>
                        ))}
                        {isCodeView && (
                            <button
                                className={styles.assetClose}
                                onClick={() => this.handleTabChange('preview')}
                                title="Close Code View"
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
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        )}
                    </div>
                    {isCodeView && (
                        <div className={styles.assetsPanels}>
                            <pre>{this.getCodeContent()}</pre>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    public getIframe = (): HTMLIFrameElement | null => {
        return this.iframeRef.current;
    };
}
