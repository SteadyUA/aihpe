export class ElementPicker {
    private iframe: HTMLIFrameElement | null = null;
    private onSelect: ((selector: string) => void) | null = null;
    private selectedElement: HTMLElement | null = null;

    private overlayContainer: HTMLElement | null = null;
    private hoverBox: HTMLElement | null = null;
    private selectionBox: HTMLElement | null = null;

    private overlayHandlers: {
        mousemove: (e: MouseEvent) => void;
        click: (e: MouseEvent) => void;
        mouseleave: (e: MouseEvent) => void;
        scroll: () => void;
        resize: () => void;
    } | null = null;

    setOnSelect(callback: (selector: string) => void) {
        this.onSelect = callback;
    }

    stop() {
        this.removeOverlay();
        this.clearSelection();
        this.iframe = null;
        // Do not clear onSelect, it might be permanent for the session
    }

    start(iframe: HTMLIFrameElement) {
        // If we were already running, stop first
        if (this.iframe) {
            this.stop();
        }

        this.iframe = iframe;
        const doc = this.iframe.contentDocument;
        if (!doc) return;

        this.createOverlay(doc);
    }

    private createOverlay(doc: Document) {
        // Container for all our visuals
        this.overlayContainer = doc.createElement('div');
        Object.assign(this.overlayContainer.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            zIndex: '2147483647', // Max z-index
            pointerEvents: 'auto', // Capture events
            backgroundColor: 'transparent',
            cursor: 'default',
        });

        // Inject Styles for Tooltip parts
        const style = doc.createElement('style');
        style.textContent = `
            .element-picker-parent-link::after {
                content: " >";
                margin-left: 5px;
                text-decoration: none;
                display: inline-block;
            }
        `;
        this.overlayContainer.appendChild(style);

        // Hover Highlight Box
        this.hoverBox = document.createElement('div');
        Object.assign(this.hoverBox.style, {
            position: 'fixed',
            pointerEvents: 'none',
            outline: '1px solid #4a90e2',
            backgroundColor: 'rgba(74, 144, 226, 0.4)',
            display: 'none',
            zIndex: '2147483645',
            boxSizing: 'border-box',
        });

        // Tooltip for Hover Box
        const tooltip = document.createElement('div');
        tooltip.className = 'element-picker-tooltip';
        Object.assign(tooltip.style, {
            position: 'absolute',
            bottom: '100%',
            left: '0',
            backgroundColor: '#333',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            marginBottom: '4px',
            pointerEvents: 'none',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        });
        this.hoverBox.appendChild(tooltip);

        // Selection Box (Persistent)
        this.selectionBox = document.createElement('div');
        Object.assign(this.selectionBox.style, {
            position: 'fixed',
            pointerEvents: 'none',
            outline: '2px solid #10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            display: 'none',
            zIndex: '2147483646',
            boxSizing: 'border-box',
        });

        // Tooltip for Selection Box
        const selectionTooltip = document.createElement('div');
        selectionTooltip.className = 'element-picker-tooltip';
        Object.assign(selectionTooltip.style, {
            position: 'absolute',
            bottom: '100%',
            left: '0',
            backgroundColor: '#10b981',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            marginBottom: '4px',
            pointerEvents: 'auto', // Allow clicking children (parent link)
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        });
        this.selectionBox.appendChild(selectionTooltip);

        this.overlayContainer.appendChild(this.selectionBox);
        this.overlayContainer.appendChild(this.hoverBox);

        // Handlers
        this.overlayHandlers = {
            mousemove: (e: MouseEvent) => {
                // If hovering over our own tooltip, ignore
                if ((e.target as HTMLElement).closest('.element-picker-tooltip')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                // Hide container momentarily to find element underneath
                if (this.overlayContainer) {
                    this.overlayContainer.style.pointerEvents = 'none';
                    const el = doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
                    this.overlayContainer.style.pointerEvents = 'auto';

                    if (el && el !== doc.documentElement && el !== doc.body && el !== this.overlayContainer) {
                        this.highlightElement(el);
                    } else {
                        this.hideHighlight();
                    }
                }
            },
            click: (e: MouseEvent) => {
                // If clicking our own tooltip, do nothing (let bubble to tooltip handlers)
                if ((e.target as HTMLElement).closest('.element-picker-tooltip')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                if (this.overlayContainer) {
                    this.overlayContainer.style.pointerEvents = 'none';
                    const el = doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
                    this.overlayContainer.style.pointerEvents = 'auto';

                    if (el) {
                        this.selectElement(el);
                        const selector = this.generateSelector(el);
                        this.onSelect?.(selector);
                    }
                }
            },
            mouseleave: () => {
                this.hideHighlight();
            },
            scroll: () => {
                if (this.selectedElement && this.selectionBox) {
                    this.updateBox(this.selectionBox, this.selectedElement);
                }
            },
            resize: () => {
                if (this.selectedElement && this.selectionBox) {
                    this.updateBox(this.selectionBox, this.selectedElement);
                }
            }
        };

        this.overlayContainer.addEventListener('mousemove', this.overlayHandlers.mousemove);
        this.overlayContainer.addEventListener('click', this.overlayHandlers.click);
        this.overlayContainer.addEventListener('mouseleave', this.overlayHandlers.mouseleave);

        doc.addEventListener('scroll', this.overlayHandlers.scroll, { passive: true, capture: true });
        doc.defaultView?.addEventListener('resize', this.overlayHandlers.resize);

        doc.body.appendChild(this.overlayContainer);
    }

    private removeOverlay() {
        if (this.overlayContainer && this.overlayContainer.parentNode) {
            const doc = this.overlayContainer.ownerDocument;
            if (this.overlayHandlers && doc) {
                doc.removeEventListener('scroll', this.overlayHandlers.scroll, { capture: true });
                doc.defaultView?.removeEventListener('resize', this.overlayHandlers.resize);
            }

            if (this.overlayHandlers) {
                this.overlayContainer.removeEventListener('mousemove', this.overlayHandlers.mousemove);
                this.overlayContainer.removeEventListener('click', this.overlayHandlers.click);
                this.overlayContainer.removeEventListener('mouseleave', this.overlayHandlers.mouseleave);
                this.overlayHandlers = null;
            }
            this.overlayContainer.parentNode.removeChild(this.overlayContainer);
        }
        this.overlayContainer = null;
        this.hoverBox = null;
        this.selectionBox = null;
    }

    // Programmatically select an element by selector
    selectBySelector(iframe: HTMLIFrameElement, selector: string, scrollTo: boolean = false) {
        this.iframe = iframe;
        const doc = this.iframe.contentDocument;
        if (!doc) return;

        if (!this.overlayContainer) {
            this.createPassiveOverlay(doc);
        }

        const el = doc.querySelector(selector) as HTMLElement;
        if (el) {
            this.selectElement(el);
            if (scrollTo) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // Creates an overlay that allows interaction with the page but holds our visual boxes
    private createPassiveOverlay(doc: Document) {
        this.overlayContainer = doc.createElement('div');
        Object.assign(this.overlayContainer.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            zIndex: '2147483647',
            pointerEvents: 'none', // Crucial: allow clicks to pass through
            backgroundColor: 'transparent',
        });

        // Inject Styles for Tooltip parts
        const style = doc.createElement('style');
        style.textContent = `
            .element-picker-parent-link::after {
                content: " >";
                margin-left: 5px;
                text-decoration: none;
                display: inline-block;
            }
        `;
        this.overlayContainer.appendChild(style);

        this.selectionBox = document.createElement('div');
        Object.assign(this.selectionBox.style, {
            position: 'fixed',
            pointerEvents: 'none', // Box itself passes clicks
            outline: '2px solid #10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            display: 'none',
            zIndex: '2147483646',
            boxSizing: 'border-box',
        });

        // Tooltip for Selection Box
        const selectionTooltip = document.createElement('div');
        selectionTooltip.className = 'element-picker-tooltip';
        Object.assign(selectionTooltip.style, {
            position: 'absolute',
            bottom: '100%',
            left: '0',
            backgroundColor: '#10b981',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            marginBottom: '4px',
            pointerEvents: 'auto', // Allow clicking children (parent link)
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        });
        this.selectionBox.appendChild(selectionTooltip);

        this.overlayContainer.appendChild(this.selectionBox);

        // Need to update position on scroll even in passive mode
        this.overlayHandlers = {
            mousemove: () => { },
            click: () => { },
            mouseleave: () => { },
            scroll: () => {
                if (this.selectedElement && this.selectionBox) {
                    this.updateBox(this.selectionBox, this.selectedElement);
                }
            },
            resize: () => {
                if (this.selectedElement && this.selectionBox) {
                    this.updateBox(this.selectionBox, this.selectedElement);
                }
            }
        };
        doc.addEventListener('scroll', this.overlayHandlers.scroll, { passive: true, capture: true });
        doc.defaultView?.addEventListener('resize', this.overlayHandlers.resize);

        doc.body.appendChild(this.overlayContainer);
    }

    private highlightElement(target: HTMLElement) {
        if (!this.hoverBox || !this.overlayContainer) return;
        this.updateBox(this.hoverBox, target);
        // Hover tooltip doesn't need parent interaction usually, only selection
        this.updateTooltip(this.hoverBox, target, false);
    }

    private hideHighlight() {
        if (this.hoverBox) {
            this.hoverBox.style.display = 'none';
        }
    }

    private selectElement(target: HTMLElement) {
        this.selectedElement = target;
        if (this.selectionBox) {
            this.updateBox(this.selectionBox, target);
            this.updateTooltip(this.selectionBox, target, true); // Show parent info on selection
        }
    }

    private updateTooltip(box: HTMLElement, target: HTMLElement, showParent: boolean) {
        const tooltip = box.firstElementChild as HTMLElement;
        if (tooltip) {
            tooltip.innerHTML = ''; // Clear prev content

            // 1. Parent Element (if requested and exists)
            if (showParent && target.parentElement && target.parentElement.tagName !== 'BODY' && target.parentElement.tagName !== 'HTML') {
                const parent = target.parentElement;
                const parentTag = parent.tagName.toLowerCase();
                // Create clickable span
                const parentSpan = document.createElement('span');
                parentSpan.className = 'element-picker-parent-link'; // Hook for pseudo-element
                parentSpan.style.textDecoration = 'underline';
                parentSpan.style.cursor = 'pointer';
                parentSpan.style.marginRight = '5px';
                parentSpan.style.color = '#e0e7ff'; // light indigo/white
                parentSpan.title = 'Select parent';

                const parentId = parent.id ? `#${parent.id}` : '';

                const parentClassName = parent.className && typeof parent.className === 'string'
                    ? `.${parent.className.split(' ').join('.')}`
                    : '';
                const maxParentClassLen = 20;
                const truncatedParentClass = parentClassName.length > maxParentClassLen
                    ? parentClassName.substring(0, maxParentClassLen) + '...'
                    : parentClassName;

                parentSpan.textContent = `${parentTag}${parentId}${truncatedParentClass}`; // Separator is now in CSS ::after

                parentSpan.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const selector = this.generateSelector(parent);
                    this.selectElement(parent);
                    this.onSelect?.(selector);
                };

                tooltip.appendChild(parentSpan);
            }

            // 2. Current Element Info
            const tagName = target.tagName.toLowerCase();
            const idId = target.id ? `#${target.id}` : '';
            const className = target.className && typeof target.className === 'string'
                ? `.${target.className.split(' ').join('.')}`
                : '';

            const maxClassLen = 30;
            const truncatedClass = className.length > maxClassLen
                ? className.substring(0, maxClassLen) + '...'
                : className;

            const dims = `${Math.round(target.getBoundingClientRect().width)} x ${Math.round(target.getBoundingClientRect().height)}`;

            const infoSpan = document.createElement('span');
            infoSpan.textContent = `${tagName}${idId}${truncatedClass} | ${dims}`;
            tooltip.appendChild(infoSpan);

            // Adjust position if top is clipped
            const rect = target.getBoundingClientRect();
            if (rect.top < 30) {
                tooltip.style.bottom = 'auto';
                tooltip.style.top = '100%';
                tooltip.style.marginTop = '4px';
                tooltip.style.marginBottom = '0';
            } else {
                tooltip.style.bottom = '100%';
                tooltip.style.top = 'auto';
                tooltip.style.marginTop = '0';
                tooltip.style.marginBottom = '4px';
            }
        }
    }

    private updateBox(box: HTMLElement, target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        Object.assign(box.style, {
            display: 'block',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
        });
    }

    clearSelection() {
        this.selectedElement = null;
        if (this.selectionBox) {
            this.selectionBox.style.display = 'none';
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
                    selector += `:nth-of-type(${index})`;
                }
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }
}
