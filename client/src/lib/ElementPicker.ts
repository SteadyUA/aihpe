export class ElementPicker {
    private iframe: HTMLIFrameElement | null = null;
    private onSelect: ((selector: string) => void) | null = null;
    private selectedElement: HTMLElement | null = null;

    // Event handlers stored as properties for removal
    private handleMouseOver: ((e: Event) => void) | null = null;
    private handleMouseOut: ((e: Event) => void) | null = null;
    private handleClick: ((e: Event) => void) | null = null;

    stop() {
        this.removeListeners();
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

        this.handleMouseOver = (e: Event) => {
            e.stopPropagation();
            const target = e.target as HTMLElement;
            if (target === doc.documentElement) return;
            if (target === this.selectedElement) return;
            target.classList.add('element-picker-hover');
        };

        this.handleMouseOut = (e: Event) => {
            e.stopPropagation();
            const target = e.target as HTMLElement;
            target.classList.remove('element-picker-hover');
        };

        this.handleClick = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.target as HTMLElement;

            this.highlightElement(target);

            const selector = this.generateSelector(target);
            this.onSelect?.(selector);

            this.removeListeners();
        };

        doc.body.addEventListener('mouseover', this.handleMouseOver);
        doc.body.addEventListener('mouseout', this.handleMouseOut);
        doc.body.addEventListener('click', this.handleClick);
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
            this.highlightElement(el);
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
                    background-color: rgba(37, 99, 235, 0.1) !important;
                    cursor: crosshair !important;
                }
                .element-picker-selected {
                    outline: 2px solid #10b981 !important;
                    background-color: rgba(16, 185, 129, 0.1) !important;
                }
            `;
            doc.head.appendChild(style);
        }
    }

    private highlightElement(target: HTMLElement) {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element-picker-selected');
        }

        target.classList.remove('element-picker-hover');
        target.classList.add('element-picker-selected');
        this.selectedElement = target;
    }

    private removeListeners() {
        if (!this.iframe?.contentDocument?.body) return;
        const body = this.iframe.contentDocument.body;

        if (this.handleMouseOver)
            body.removeEventListener('mouseover', this.handleMouseOver);
        if (this.handleMouseOut)
            body.removeEventListener('mouseout', this.handleMouseOut);
        if (this.handleClick)
            body.removeEventListener('click', this.handleClick);

        if (this.iframe.contentDocument) {
            this.iframe.contentDocument
                .querySelectorAll('.element-picker-hover')
                .forEach((el) => el.classList.remove('element-picker-hover'));
        }
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
