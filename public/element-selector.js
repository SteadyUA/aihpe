
const PICKER_STYLE_ID = 'html-preview-picker-style';
const PICKER_HOVER_CLASS = 'html-preview-picker-hover';
const PICKER_SELECTED_CLASS = 'html-preview-picker-selected';
const PICKER_MODE_CLASS = 'html-preview-picker-mode';
const INTERNAL_PICKER_CLASS_SET = new Set([PICKER_HOVER_CLASS, PICKER_SELECTED_CLASS, PICKER_MODE_CLASS]);

export class ElementSelector {
  constructor(config) {
    this.iframe = config.iframe;
    this.storageKey = config.storageKey;
    this.onSelectionChange = config.onSelectionChange; // Callback when selection changes
    
    // UI Elements
    this.ui = {
      pickerButton: config.ui.pickerButton,
      infoContainer: config.ui.infoContainer,
      selectorDisplay: config.ui.selectorDisplay,
      descriptionDisplay: config.ui.descriptionDisplay,
      chooseButton: config.ui.chooseButton,
      clearButton: config.ui.clearButton,
    };

    this.enabled = false;
    this.currentSelection = null;
    this.pickerCleanup = null;
    this.lastHoverElement = null;
    this.selectedFrameElement = null;

    this.init();
  }

  init() {
    this.loadStoredSelection();
    this.setupEventListeners();
    this.render();
  }

  setupEventListeners() {
    if (this.ui.pickerButton) {
      this.ui.pickerButton.addEventListener('click', () => {
        this.toggle();
      });
    }

    if (this.ui.clearButton) {
      this.ui.clearButton.addEventListener('click', () => {
        this.clearSelection();
      });
    }
    
    // Handle iframe load events to re-attach picker/re-apply selection
    if (this.iframe) {
       this.iframe.addEventListener('load', () => {
           this.handleFrameLoad();
       });
    }
  }

  handleFrameLoad() {
      this.detachPicker();
      this.clearHover();
      
      const doc = this.iframe.contentDocument;
      if (!doc) return;

      this.ensurePickerStyles(doc);
      this.applySelectionToDocument(this.currentSelection, doc);
      
      if (this.enabled) {
          this.attachPickerToDocument(doc);
      }
  }

  loadStoredSelection() {
    try {
      if (!this.storageKey) return;
      const stored = window.localStorage.getItem(this.storageKey);
      if (stored) {
        this.currentSelection = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to parse stored selection', error);
    }
  }

  saveSelection() {
    if (!this.storageKey) return;
    if (!this.currentSelection) {
      window.localStorage.removeItem(this.storageKey);
    } else {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.currentSelection));
      } catch (error) {
        console.warn('Failed to persist element selection', error);
      }
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) {
        if (enabled) this.attachPickerToFrame();
        this.render();
        return;
    }

    this.enabled = enabled;
    
    if (this.ui.pickerButton) {
        this.ui.pickerButton.setAttribute('aria-pressed', String(enabled));
        this.ui.pickerButton.textContent = enabled ? 'Выбор активен' : 'Выбрать элемент';
    }

    this.render();

    if (enabled) {
        this.attachPickerToFrame();
    } else {
        this.detachPicker();
    }
  }

  attachPickerToFrame() {
      if (!this.enabled || !this.iframe) return;

      const doc = this.iframe.contentDocument;
      if (!doc || doc.readyState === 'loading') {
          // If loading, the 'load' listener in init() or setupEventListeners will handle it
          // actually, for safety, we can add a one-off here if needed, but the main 'load' listener is better
          // But wait, setupEventListeners adds a permanent listener.
          return;
      }
      this.attachPickerToDocument(doc);
  }

  attachPickerToDocument(doc) {
    this.detachPicker();
    this.ensurePickerStyles(doc);

    if (doc.body) {
      doc.body.classList.add(PICKER_MODE_CLASS);
    }

    const normalizeTarget = (value) => {
      if (!value) return null;
      let node = value;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
      }
      while (node && node.nodeType === Node.ELEMENT_NODE && ['HTML', 'HEAD', 'SCRIPT', 'STYLE'].includes(node.tagName)) {
        node = node.parentElement;
      }
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }
      return node;
    };

    const onMouseOver = (event) => {
      const element = normalizeTarget(event.target);
      if (!element || element.tagName === 'HTML') return;
      if (element !== this.selectedFrameElement) {
        this.setHoverElement(element);
      }
    };

    const onMouseOut = (event) => {
      const related = normalizeTarget(event.relatedTarget);
      if (!related || related !== this.lastHoverElement) {
        this.clearHover();
      }
    };

    const onWindowClick = (event) => {
      if (!this.enabled) {
        return;
      }
      const element = normalizeTarget(event.target);
      if (!element) return;

      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      event.stopPropagation();
      this.selectElement(element);
    };

    doc.addEventListener('mouseover', onMouseOver, true);
    doc.addEventListener('mouseout', onMouseOut, true);
    doc.defaultView?.addEventListener('click', onWindowClick, true);

    this.pickerCleanup = () => {
      doc.removeEventListener('mouseover', onMouseOver, true);
      doc.removeEventListener('mouseout', onMouseOut, true);
      doc.defaultView?.removeEventListener('click', onWindowClick, true);
      if (doc.body) {
        doc.body.classList.remove(PICKER_MODE_CLASS);
      }
      this.clearHover();
    };
  }

  detachPicker() {
    if (this.pickerCleanup) {
      this.pickerCleanup();
      this.pickerCleanup = null;
    }
  }

  setHoverElement(element) {
    if (this.lastHoverElement === element) return;
    this.clearHover();
    this.lastHoverElement = element;
    element.classList.add(PICKER_HOVER_CLASS);
  }

  clearHover() {
    if (this.lastHoverElement && this.lastHoverElement.classList) {
      this.lastHoverElement.classList.remove(PICKER_HOVER_CLASS);
    }
    this.lastHoverElement = null;
  }

  selectElement(element) {
    const descriptor = this.createElementDescriptor(element);
    this.setSelectedElement(element, element?.ownerDocument ?? this.iframe?.contentDocument);
    this.updateSelection(descriptor);
    this.clearHover();
    this.setEnabled(false);
  }

  updateSelection(selection) {
      this.currentSelection = selection;
      this.saveSelection();
      this.render();
      
      const doc = this.iframe?.contentDocument;
      if (doc) {
          this.applySelectionToDocument(selection, doc);
      }

      if (this.onSelectionChange) {
          this.onSelectionChange(selection);
      }
  }
  
  clearSelection() {
      this.updateSelection(null);
  }

  render() {
      if (!this.ui.infoContainer) return;

      const hasSelection = Boolean(this.currentSelection?.selector);
      this.ui.infoContainer.hidden = !hasSelection;

      if (this.ui.pickerButton) {
          this.ui.pickerButton.hidden = hasSelection;
      }

      if (this.ui.selectorDisplay) {
          this.ui.selectorDisplay.textContent = this.currentSelection?.selector ?? '';
      }
  }

  applySelectionToDocument(selection, doc) {
    if (!doc) {
        this.setSelectedElement(null);
        return;
    }
    
    this.ensurePickerStyles(doc);

    if (!selection?.selector) {
        this.setSelectedElement(null, doc);
        return;
    }

    try {
        const element = doc.querySelector(selection.selector);
        this.setSelectedElement(element ?? null, doc);
    } catch (error) {
        console.warn('Failed to apply selector', selection.selector, error);
        this.setSelectedElement(null, doc);
    }
  }

  setSelectedElement(element, doc) {
      if (this.selectedFrameElement && this.selectedFrameElement.classList) {
          this.removeClass(this.selectedFrameElement, PICKER_SELECTED_CLASS);
      }

      if (!element || !doc || element.ownerDocument !== doc) {
          this.selectedFrameElement = null;
          return;
      }

      this.selectedFrameElement = element;
      this.forceClass(this.selectedFrameElement, PICKER_SELECTED_CLASS);
  }

  createElementDescriptor(element) {
    const doc = element.ownerDocument;
    const selector = this.buildCssSelector(element);
    const tag = element.tagName.toLowerCase();
    const idPart = element.id ? `#${this.cssEscape(element.id, doc)}` : '';
    const displayClasses = this.getElementClasses(element);
    const classPart = displayClasses.length ? `.${displayClasses.map((cls) => this.cssEscape(cls, doc)).join('.')}` : '';
    const textContent = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    let backgroundImage = null;

    try {
      const styles = doc.defaultView?.getComputedStyle(element);
      if (styles && styles.backgroundImage && styles.backgroundImage !== 'none') {
        backgroundImage = styles.backgroundImage;
      }
    } catch (error) {
      console.warn('Failed to read computed styles', error);
    }

    return {
      selector,
      summary: `${tag}${idPart}${classPart}`,
      text: this.truncateText(textContent, 120),
      backgroundImage,
    };
  }

  describeSelection(selection) {
    const parts = [];
    if (selection.summary) {
      parts.push(selection.summary);
    }
    if (selection.text) {
      parts.push(`Текст: "${selection.text}"`);
    }
    if (selection.backgroundImage) {
      const match = selection.backgroundImage.match(/url\(("|'|)(.*?)\1\)/i);
      const imageValue = match ? match[2] : selection.backgroundImage;
      parts.push(`Фон: ${this.truncateText(imageValue, 80)}`);
    }
    return parts.join(' · ') || 'Элемент выбран.';
  }

  // Helpers
  
  ensurePickerStyles(doc) {
    if (!doc || doc.getElementById(PICKER_STYLE_ID)) return;

    const style = doc.createElement('style');
    style.id = PICKER_STYLE_ID;
    style.textContent = `
      .${PICKER_HOVER_CLASS} {
        outline: 2px dashed #2563eb !important;
        outline-offset: 2px !important;
      }
      .${PICKER_SELECTED_CLASS} {
        outline: 3px solid #10b981 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2) inset !important;
      }
      body.${PICKER_MODE_CLASS},
      body.${PICKER_MODE_CLASS} * {
        cursor: crosshair !important;
      }
    `;
    doc.head?.appendChild(style);
  }

  getElementClasses(element) {
    return Array.from(element.classList ?? []).filter((cls) => !INTERNAL_PICKER_CLASS_SET.has(cls));
  }

  buildCssSelector(element) {
    const doc = element.ownerDocument;
    if (element.id) {
      return `${element.tagName.toLowerCase()}#${this.cssEscape(element.id, doc)}`;
    }

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName !== 'HTML') {
      let part = current.tagName.toLowerCase();
      const classNames = this.getElementClasses(current);
      if (classNames.length) {
        part += `.${classNames.map((cls) => this.cssEscape(cls, doc)).join('.')}`;
      }

      const siblingIndex = this.getNthOfType(current);
      if (siblingIndex > 1) {
        part += `:nth-of-type(${siblingIndex})`;
      }

      parts.unshift(part);

      if (current.id) {
        parts[0] = `${current.tagName.toLowerCase()}#${this.cssEscape(current.id, doc)}`;
        break;
      }

      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  getNthOfType(element) {
    let index = 1;
    let sibling = element;
    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.tagName === element.tagName) {
        index += 1;
      }
    }
    return index;
  }

  cssEscape(value, doc) {
    const escapeFn = doc?.defaultView?.CSS?.escape || window.CSS?.escape;
    if (escapeFn) {
      return escapeFn(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
  
  truncateText(value, maxLength) {
    if (!value) return '';
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
  }
  
  forceClass(element, className) {
    if (!element?.classList) return;
    if (!element.classList.contains(className)) {
        element.classList.add(className);
    }
  }

  removeClass(element, className) {
    if (!element?.classList) return;
    if (element.classList.contains(className)) {
        element.classList.remove(className);
    }
  }
}
