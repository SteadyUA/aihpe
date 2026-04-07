import React from 'react';
import classNames from 'classnames';
import { UiCheckbox } from '../UiCheckbox';
import { UiDropdown } from '../UiDropdown';
import { UiButton } from '../UiButton';
import { Toolbar } from './Toolbar';
import { apiAuth } from '../../utils/api';
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
    scale: number;
    reloadCount: number;
    hasMultiStep: boolean;
    currentStep: number;
    maxStep: number;
}

export class Preview extends React.Component<PreviewProps, PreviewState> {
    // Static store to persist scroll positions across unmounts/remounts per session
    private static scrollStore: Record<string, { x: number; y: number }> = {};
    private thottledScrollHandler: (() => void) | null = null;
    private iframeRef: React.RefObject<HTMLIFrameElement | null>;
    private containerRef: React.RefObject<HTMLDivElement | null>;
    private cleanupCustomScrollbar?: () => void;

    constructor(props: PreviewProps) {
        super(props);
        const storedIsMobile = localStorage.getItem('preview_is_mobile');
        const storedDeviceIndex = localStorage.getItem('preview_device_index');

        this.state = {
            isMobile: storedIsMobile === 'true', // Default false if null
            deviceIndex: storedDeviceIndex ? parseInt(storedDeviceIndex, 10) : 0,
            scale: 1,
            reloadCount: 0,
            hasMultiStep: false,
            currentStep: 0,
            maxStep: 0,
        };
        this.iframeRef = React.createRef();
        this.containerRef = React.createRef();
    }

    componentDidMount() {
        // No initial action needed, restoration happens on iframe load
        this.observeContainer();
        window.addEventListener('resize', this.calculateScale);
    }

    componentWillUnmount() {
        this.saveScrollPosition();
        this.cleanupScrollListener();
        this.stopPolling();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        window.removeEventListener('resize', this.calculateScale);
    }

    private resizeObserver: ResizeObserver | null = null;

    observeContainer = () => {
        if (this.containerRef.current) {
            this.resizeObserver = new ResizeObserver(() => {
                this.calculateScale();
            });
            this.resizeObserver.observe(this.containerRef.current);
        }
    };

    calculateScale = () => {
        const { isMobile, deviceIndex } = this.state;
        if (!isMobile) {
            if (this.state.scale !== 1) {
                this.setState({ scale: 1 });
            }
            return;
        }

        const container = this.containerRef.current;
        if (!container) return;

        const device = DEVICES[deviceIndex];
        // Available space in container (accounting for some padding if needed, 
        // though container padding is handled by CSS, we care about content box usually)
        // The container is the .frameWrapper which has flex layout.

        // We need to measure the available space. 
        // frameWrapper has padding: 2rem 0 for mobile in CSS.
        // clientHeight includes padding.
        // We want to fit device.height + borders into available height.

        // CSS defines: .frameWrapper.mobile iframe { border: 8px solid #1e293b; ... }
        // So total height needed is device.height + 16px (borders)
        // Total width needed is device.width + 16px (borders)

        const BORDER_SIZE = 16; // 8px * 2
        const VERTICAL_PADDING = 0; // 2rem top + 2rem bottom roughly, or just safe margin
        const HORIZONTAL_PADDING = 0;

        const availableWidth = container.clientWidth - HORIZONTAL_PADDING;
        const availableHeight = container.clientHeight - VERTICAL_PADDING;

        const requiredWidth = device.width + BORDER_SIZE;
        const requiredHeight = device.height + BORDER_SIZE;

        const scaleX = availableWidth / requiredWidth;
        const scaleY = availableHeight / requiredHeight;

        // Use the smaller scale to fit both dimensions, capped at 1 (don't zoom in)
        const newScale = Math.min(Math.min(scaleX, scaleY), 1);

        // Limit precision to avoid constant updates for tiny fraction diffs
        if (Math.abs(newScale - this.state.scale) > 0.001) {
            this.setState({ scale: newScale });
        }
    };

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

    componentDidUpdate(prevProps: PreviewProps, prevState: PreviewState, _snapshot: any) {
        // If became active (tab switch), restore scroll
        if (!prevProps.active && this.props.active) {
            this.restoreScroll();
            // Also recalc scale as container might have changed size
            setTimeout(this.calculateScale, 0);
        }

        if (prevState.isMobile !== this.state.isMobile || prevState.deviceIndex !== this.state.deviceIndex) {
            this.calculateScale();
        }

        if (prevState.isMobile !== this.state.isMobile) {
            this.manageCustomScrollbar();
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

    manageCustomScrollbar = () => {
        const iframe = this.iframeRef.current;
        if (!iframe || !iframe.contentDocument || !iframe.contentWindow) return;

        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;

        const STYLE_ID = 'mobile-custom-scroll-style';
        const BAR_ID = 'mobile-custom-scrollbar';

        // Cleanup previous
        if (this.cleanupCustomScrollbar) {
            this.cleanupCustomScrollbar();
            this.cleanupCustomScrollbar = undefined;
        }

        const existingStyle = doc.getElementById(STYLE_ID);
        if (existingStyle) existingStyle.remove();

        const existingBar = doc.getElementById(BAR_ID);
        if (existingBar) existingBar.remove();

        if (!this.state.isMobile) return;

        // 1. Hide native scrollbar
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            html { 
                scrollbar-width: none !important; 
                -ms-overflow-style: none !important; 
            }
            body {
                scrollbar-width: none !important; 
                -ms-overflow-style: none !important; 
            }
            ::-webkit-scrollbar { 
                display: none !important; 
                width: 0 !important; 
                height: 0 !important; 
            }
        `;
        doc.head.appendChild(style);

        // 2. Inject Custom DOM Scrollbar
        const bar = doc.createElement('div');
        bar.id = BAR_ID;
        Object.assign(bar.style, {
            position: 'fixed',
            right: '2px',
            top: '4px',
            bottom: '2px',
            width: '5px',
            zIndex: '2147483647', // Max z-index
            pointerEvents: 'none',
            display: 'none',
        });

        const thumb = doc.createElement('div');
        Object.assign(thumb.style, {
            position: 'absolute',
            width: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '10px',
            outline: '1px solid rgba(255, 255, 255, 0.3)',
        });

        bar.appendChild(thumb);
        doc.body.appendChild(bar);

        // 3. Logic to update position
        let fadeTimeout: any;
        const fadeOut = () => {
            thumb.style.opacity = '0';
        };

        const update = () => {
            try {
                const h = win.innerHeight;
                const sh = doc.documentElement.scrollHeight || doc.body.scrollHeight;
                const st = win.scrollY || doc.documentElement.scrollTop || doc.body.scrollTop;

                if (sh <= h) {
                    bar.style.display = 'none';
                    return;
                }

                bar.style.display = 'block';
                thumb.style.opacity = '1';

                // Calculate height and position using available height (h - 8px margin)
                const availableHeight = h - 8;
                const thumbHeight = Math.max((h / sh) * availableHeight, 30);
                const maxTop = availableHeight - thumbHeight;
                // scrollRatio 0..1
                const maxScroll = sh - h;
                const scrollRatio = maxScroll > 0 ? st / maxScroll : 0;

                const top = scrollRatio * maxTop;

                thumb.style.height = `${thumbHeight}px`;
                thumb.style.transform = `translateY(${top}px)`;

                // Auto-fade logic (mimic mobile)
                clearTimeout(fadeTimeout);
                fadeTimeout = setTimeout(fadeOut, 800);
            } catch (e) { /* ignore cleanup errors */ }
        };

        win.addEventListener('scroll', update);
        win.addEventListener('resize', update);
        const observer = new MutationObserver(update);
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true });

        // Initial update
        update();

        this.cleanupCustomScrollbar = () => {
            try {
                win.removeEventListener('scroll', update);
                win.removeEventListener('resize', update);
                observer.disconnect();
                clearTimeout(fadeTimeout);
            } catch (e) { }
        };
    };

    private pollingInterval: any = null;

    stopPolling = () => {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    };

    startPolling = () => {
        this.stopPolling();
        this.pollingInterval = setInterval(this.checkMultiStep, 500);
    };

    checkMultiStep = () => {
        const iframe = this.iframeRef.current;
        if (!iframe || !iframe.contentWindow) return;

        try {
            const win = iframe.contentWindow as any;
            const regform = win.regform;

            if (regform && regform.multiStep) {
                const { currentStepIndex, maxStep } = regform.multiStep;
                if (
                    !this.state.hasMultiStep ||
                    this.state.currentStep !== currentStepIndex ||
                    this.state.maxStep !== maxStep
                ) {
                    this.setState({
                        hasMultiStep: true,
                        currentStep: currentStepIndex,
                        maxStep: maxStep,
                    });
                }
            } else if (this.state.hasMultiStep) {
                this.setState({ hasMultiStep: false });
            }
        } catch (e) {
            // Ignore cross-origin or other errors
            console.error('[Preview] Error checking multiStep:', e);
        }
    };

    handlePrev = () => {
        const iframe = this.iframeRef.current;
        if (iframe && iframe.contentWindow) {
            try {
                const win = iframe.contentWindow as any;
                if (win.regform?.multiStep?.prev) {
                    win.regform.multiStep.prev();
                }
            } catch (e) { }
        }
    };

    handleNext = () => {
        const iframe = this.iframeRef.current;
        if (iframe && iframe.contentWindow) {
            try {
                const win = iframe.contentWindow as any;
                if (win.regform?.multiStep?.next) {
                    win.regform.multiStep.next();
                }
            } catch (e) { }
        }
    };

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

        this.manageCustomScrollbar();
        this.startPolling();

        if (this.props.onLoad) {
            this.props.onLoad();
        }
    };

    handleDeviceChange = (value: string) => {
        const index = Number(value);
        this.setState({ deviceIndex: index });
        localStorage.setItem('preview_device_index', String(index));
    };

    toggleMobile = (checked: boolean) => {
        this.setState({ isMobile: checked });
        localStorage.setItem('preview_is_mobile', String(checked));
    };

    handleNewWindow = () => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;
        const url = `${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/files/index.html`;
        window.open(url, '_blank');
    };

    handleDownload = async () => {
        const { sessionId, version } = this.props;
        if (!sessionId) return;

        try {
            const response = await apiAuth.fetch(
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

    handleReload = () => {
        this.setState(prev => ({ reloadCount: prev.reloadCount + 1 }));
    };

    // Public method for parent
    public getIframe = (): HTMLIFrameElement | null => {
        return this.iframeRef.current;
    };

    render() {
        const { sessionId, version, active, reloadTrigger } = this.props;
        const { isMobile, deviceIndex, scale, reloadCount, hasMultiStep, currentStep, maxStep } = this.state;
        const device = DEVICES[deviceIndex];

        const previewUrl =
            sessionId && typeof version === 'number'
                ? `${import.meta.env.BASE_URL}api/sessions/${sessionId}/${version}/files/index.html`
                : 'about:blank';

        // Key logic: Combine identifying props to force remount of iframe when any changes
        const iframeKey = `${sessionId}-${version}-${reloadTrigger}-${reloadCount}`;

        // When scaled, the wrapping div needs to take up exactly the scaled size
        // so the parent flex container knows the true size.
        // The inner div (with iframe) stays full size but is scaled down visually.
        const wrapperStyle = isMobile
            ? {
                width: `${device.width * scale}px`,
                height: `${device.height * scale}px`,
                // We don't put overflow:hidden here necessarily unless we want to crop shadows,
                // but usually better not to to keep shadows nice.
            }
            : { width: '100%', height: '100%' };

        const innerStyle = isMobile
            ? {
                width: `${device.width}px`,
                height: `${device.height}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left', // Scale from top-left so it fits into the wrapper
            }
            : { width: '100%', height: '100%' };

        return (
            <div className={styles.previewContainer} style={{ display: active ? 'flex' : 'none' }}>
                <Toolbar
                    left={
                        <>
                            <UiButton
                                variant="secondary"
                                size="icon"
                                onClick={this.handleReload}
                                title="Reload Preview"
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
                                    <path d="M23 4v6h-6"></path>
                                    <path d="M1 20v-6h6"></path>
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                                </svg>
                            </UiButton>
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
                            {hasMultiStep && (
                                <div className={styles.stepper}>
                                    <UiButton
                                        variant="secondary"
                                        size="icon"
                                        onClick={this.handlePrev}
                                        disabled={currentStep === 0}
                                        title="Previous Step"
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
                                            <polyline points="15 18 9 12 15 6"></polyline>
                                        </svg>
                                    </UiButton>
                                    <span className={styles.stepInfo}>
                                        {currentStep + 1} / {maxStep}
                                    </span>
                                    <UiButton
                                        variant="secondary"
                                        size="icon"
                                        onClick={this.handleNext}
                                        disabled={currentStep === maxStep - 1}
                                        title="Next Step"
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
                                            <polyline points="9 18 15 12 9 6"></polyline>
                                        </svg>
                                    </UiButton>
                                </div>
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
                    ref={this.containerRef}
                    className={classNames(styles.frameWrapper, {
                        [styles.mobile]: isMobile,
                    })}
                >
                    {/* Size-Constraining Wrapper: Sized to the scaled result */}
                    <div style={wrapperStyle}>
                        {/* Transformed Content: Full size but scaled down */}
                        <div style={innerStyle}>
                            <iframe
                                key={iframeKey}
                                ref={this.iframeRef}
                                src={previewUrl}
                                title="Preview"
                                sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
                                onLoad={this.handleIframeLoad}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    pointerEvents: this.props.isResizing ? 'none' : 'auto'
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
