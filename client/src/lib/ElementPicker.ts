export class ElementPicker {
    private iframe: HTMLIFrameElement | null = null;
    private onSelect: ((selector: string) => void) | null = null;
    private selectedElement: HTMLElement | null = null;

    private overlay: HTMLElement | null = null;
    private overlayHandlers: {
        mousemove: (e: MouseEvent) => void;
        click: (e: MouseEvent) => void;
    } | null = null;

    stop() {
        this.removeOverlay();
        this.clearSelection();
        this.iframe = null;
        this.onSelect = null;
    }

    start(iframe: HTMLIFrameElement, onSelect: (selector: string) => void) {
        this.stop();

        this.iframe = iframe;
        this.onSelect = onSelect;

        const doc = this.iframe.contentDocument;
        if (!doc) return;

        this.injectStyles(doc);
        this.createOverlay(doc);
    }

    private createOverlay(doc: Document) {
        this.overlay = doc.createElement('div');
        this.overlay.style.position = 'fixed';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.zIndex = '2147483647'; // Max z-index
        this.overlay.style.backgroundColor = 'transparent';
        this.overlay.style.cursor = 'default';

        // Handlers attached to the overlay
        this.overlayHandlers = {
            mousemove: (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                // Hide overlay momentarily to find element underneath
                this.overlay!.style.pointerEvents = 'none';
                const el = doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
                this.overlay!.style.pointerEvents = 'auto'; // Restore immediately

                if (el && el !== doc.documentElement && el !== doc.body) {
                    this.highlightElement(el);
                }
            },
            click: (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                this.overlay!.style.pointerEvents = 'none';
                const el = doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
                this.overlay!.style.pointerEvents = 'auto';

                if (el) {
                    this.selectElement(el);
                    const selector = this.generateSelector(el);
                    this.onSelect?.(selector);
                    this.removeOverlay(); // Stop picking but keep selection
                }
            }
        };

        this.overlay.addEventListener('mousemove', this.overlayHandlers.mousemove);
        this.overlay.addEventListener('click', this.overlayHandlers.click);

        doc.body.appendChild(this.overlay);
    }

    private removeOverlay() {
        if (this.overlay && this.overlay.parentNode) {
            if (this.overlayHandlers) {
                this.overlay.removeEventListener('mousemove', this.overlayHandlers.mousemove);
                this.overlay.removeEventListener('click', this.overlayHandlers.click);
                this.overlayHandlers = null;
            }
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;

        // Cleanup hover effects
        if (this.iframe?.contentDocument) {
            this.iframe.contentDocument
                .querySelectorAll('.element-picker-hover')
                .forEach((el) => el.classList.remove('element-picker-hover'));
        }
    }

    // Programmatically select an element by selector
    selectBySelector(iframe: HTMLIFrameElement, selector: string) {
        // If we are not already attached to this iframe, attach context (without starting listeners)
        this.iframe = iframe;
        const doc = this.iframe.contentDocument;
        if (!doc) return;

        this.injectStyles(doc); // Ensure styles exist

        const el = doc.querySelector(selector) as HTMLElement;
        if (el) {
            this.selectElement(el);
            // Optionally scroll to it
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    private injectStyles(doc: Document) {
        const styleId = 'element-picker-style';
        if (!doc.getElementById(styleId)) {
            const style = doc.createElement('style');
            style.id = styleId;
            style.textContent = `
                .element-picker-hover {
                    outline: 2px dashed #2563eb !important;
                    outline-offset: 2px !important;
                    cursor: crosshair !important;
                }
                .element-picker-selected {
                    outline: 3px solid #10b981 !important;
                    outline-offset: 2px !important;
                    box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2) inset !important;
                }
            `;
            doc.head.appendChild(style);
        }
    }

    private highlightElement(target: HTMLElement) {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element-picker-selected');
        }

        // Clean up previous hover
        if (this.iframe?.contentDocument) {
            this.iframe.contentDocument
                .querySelectorAll('.element-picker-hover')
                .forEach((el) => el.classList.remove('element-picker-hover'));
        }

        target.classList.add('element-picker-hover');
    }

    private selectElement(target: HTMLElement) {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element-picker-selected');
        }

        // Remove hover class just in case
        target.classList.remove('element-picker-hover');

        target.classList.add('element-picker-selected');
        this.selectedElement = target;
    }

    clearSelection() {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element-picker-selected');
            this.selectedElement = null;
        }
    }

    private generateSelector(el: HTMLElement): string {
        if (el.id) return `#${el.id}`;

        const path: string[] = [];
        let current: HTMLElement | null = el;

        while (
            current &&
            current.tagName !== 'BODY' &&
            current.tagName !== 'HTML'
        ) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                selector = `#${current.id}`;
                path.unshift(selector);
                break;
            } else if (current.parentElement) {
                const siblings = Array.from(
                    current.parentElement.children,
                ).filter((c) => c.tagName === current!.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    selector += `:nth-child(${index})`;
                }
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }
}
