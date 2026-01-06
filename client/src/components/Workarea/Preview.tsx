import React from 'react';
import classNames from 'classnames';
import { UiCheckbox } from '../UiCheckbox';
import { UiDropdown } from '../UiDropdown';
import { UiButton } from '../UiButton';
import { Toolbar } from './Toolbar';
import styles from './Preview.module.css';

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

interface PreviewProps {
    sessionId: string | null;
    version: number;
    active: boolean;
    onLoad?: () => void;
    reloadTrigger?: number;
    isResizing?: boolean;
}

interface PreviewState {
    isMobile: boolean;
    deviceIndex: number;
}

export class Preview extends React.Component<PreviewProps, PreviewState> {
    // Static store to persist scroll positions across unmounts/remounts per session
    private static scrollStore: Record<string, { x: number; y: number }> = {};
    private thottledScrollHandler: (() => void) | null = null;
    private iframeRef: React.RefObject<HTMLIFrameElement | null>;

    constructor(props: PreviewProps) {
        super(props);
        this.state = {
            isMobile: false,
            deviceIndex: 0,
        };
        this.iframeRef = React.createRef();
    }

    componentDidMount() {
        // No initial action needed, restoration happens on iframe load
    }

    componentWillUnmount() {
        this.saveScrollPosition();
        this.cleanupScrollListener();
    }

    getSnapshotBeforeUpdate(prevProps: PreviewProps) {
        if (
            prevProps.sessionId !== this.props.sessionId ||
            prevProps.version !== this.props.version
        ) {
            this.saveScrollPosition();
        }
        // If becoming inactive (tab switch), save scroll
        if (prevProps.active && !this.props.active) {
            this.saveScrollPosition(true);
        }
        // If we are about to switch version within the same session
        if (
            prevProps.sessionId === this.props.sessionId &&
            prevProps.version !== this.props.version &&
            prevProps.active
        ) {
            // Logic handled by saveScrollPosition above, but we keep this for legacy alignment if needed,
            // though saveScrollPosition writes to static store now.
        }
        return null;
    }

    componentDidUpdate(prevProps: PreviewProps, _prevState: PreviewState, _snapshot: any) {
        // If became active (tab switch), restore scroll
        if (!prevProps.active && this.props.active) {
            this.restoreScroll();
        }
    }

    saveScrollPosition = (force: boolean = false) => {
        const { sessionId, active } = this.props;
        if (!sessionId) return;

        // Dont save if we are hidden or inactive, as scroll values might be 0
        if (!active && !force) return;

        const iframe = this.iframeRef.current;
        if (iframe && iframe.contentWindow) {
            // Double check if we are truly visible to avoid saving 0s
            // (width logic is handled by 'active' prop usually, but safeguards help)
            if (iframe.offsetWidth === 0 && iframe.offsetHeight === 0 && !force) return;

            try {
                const x = iframe.contentWindow.scrollX;
                const y = iframe.contentWindow.scrollY;
                if (x !== undefined && y !== undefined) {
                    Preview.scrollStore[sessionId] = { x, y };
                }
            } catch (e) {
                // Ignored (cross-origin or closed)
            }
        }
    };

    public saveScroll = () => this.saveScrollPosition(true);

    public restoreScroll = () => {
        const { sessionId } = this.props;
        const iframe = this.iframeRef.current;
        if (sessionId && iframe && iframe.contentWindow) {
            const saved = Preview.scrollStore[sessionId];
            if (saved) {
                try {
                    iframe.contentWindow.scrollTo(saved.x, saved.y);
                } catch (e) { }
            }
        }
    }

    cleanupScrollListener = () => {
        const iframe = this.iframeRef.current;
        if (iframe && iframe.contentWindow && this.thottledScrollHandler) {
            try {
                iframe.contentWindow.removeEventListener('scroll', this.thottledScrollHandler);
            } catch (e) {
                // Ignored
            }
        }
        this.thottledScrollHandler = null;
    }

    throttle = (func: () => void, limit: number) => {
        let inThrottle: boolean;
        return () => {
            if (!inThrottle) {
                func();
                inThrottle = true;
                setTimeout(() => (inThrottle = false), limit);
            }
        };
    };

    handleScroll = () => {
        this.saveScrollPosition();
    }

    handleIframeLoad = () => {
        const { sessionId } = this.props;
        const iframe = this.iframeRef.current;

        if (sessionId && iframe && iframe.contentWindow) {
            try {
                // 1. Restore scroll if exists
                const saved = Preview.scrollStore[sessionId];
                if (saved) {
                    iframe.contentWindow.scrollTo(saved.x, saved.y);
                }

                // 2. Attach scroll listener
                // First cleanup old if any (though iframe reload usually wipes listeners on window)
                this.thottledScrollHandler = this.throttle(this.handleScroll, 200);
                iframe.contentWindow.addEventListener('scroll', this.thottledScrollHandler);
            } catch (e) {
                // Ignored
            }
        }

        if (this.props.onLoad) {
            this.props.onLoad();
        }
    };

    handleDeviceChange = (value: string) => {
        this.setState({ deviceIndex: Number(value) });
    };

    toggleMobile = (checked: boolean) => {
        this.setState({ isMobile: checked });
    };

    handleNewWindow = () => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;
        const url = `/api/sessions/${sessionId}/${version}/files/index.html`;
        window.open(url, '_blank');
    };

    handleDownload = async () => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;

        try {
            const response = await fetch(
                `/api/sessions/${encodeURIComponent(sessionId)}/${version}/archive`,
            );
            if (!response.ok) throw new Error('Failed to download');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `session-${sessionId.slice(0, 8)}-v${version}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed', error);
        }
    };

    // Public method for parent
    public getIframe = (): HTMLIFrameElement | null => {
        return this.iframeRef.current;
    };

    render() {
        const { sessionId, version, active, reloadTrigger } = this.props;
        const { isMobile, deviceIndex } = this.state;
        const device = DEVICES[deviceIndex];

        const previewUrl =
            sessionId && typeof version === 'number'
                ? `/api/sessions/${sessionId}/${version}/files/index.html`
                : 'about:blank';

        // Key logic: Combine identifying props to force remount of iframe when any changes
        const iframeKey = `${sessionId}-${version}-${reloadTrigger}`;

        return (
            <div className={styles.previewContainer} style={{ display: active ? 'flex' : 'none' }}>
                <Toolbar
                    left={
                        <>
                            <UiCheckbox
                                checked={isMobile}
                                onChange={this.toggleMobile}
                                label="Mobile"
                            />
                            {isMobile && (
                                <UiDropdown
                                    className={styles.deviceSelect}
                                    value={String(deviceIndex)}
                                    onChange={this.handleDeviceChange}
                                    options={DEVICES.map((d, i) => ({
                                        value: String(i),
                                        label: `${d.name} (${d.width}×${d.height})`
                                    }))}
                                />
                            )}
                        </>
                    }
                    right={
                        <>
                            <UiButton
                                variant="secondary"
                                size="icon"
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
                            </UiButton>
                            <UiButton
                                variant="secondary"
                                size="icon"
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
                            </UiButton>
                        </>
                    }
                />

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
                        style={{
                            ...(isMobile
                                ? {
                                    width: `${device.width}px`,
                                    height: `${device.height}px`,
                                }
                                : {}),
                            pointerEvents: this.props.isResizing ? 'none' : 'auto'
                        }}
                    />
                </div>
            </div>
        );
    }
}
