import { ElementSelector } from './element-selector.js';

const activeSessionKey = 'html-preview-active-session-id';
const sessionsListKey = 'html-preview-sessions-list';
const sessionsGroupsKey = 'html-preview-session-groups';

// Legacy key support
const legacySessionKey = 'html-preview-chat-session-id';
const legacyId = window.localStorage.getItem(legacySessionKey);

// Track session status locally to support switching between active/generating sessions
const sessionStates = {};

let activeSessions = [];
let sessionGroups = {};
try {
  activeSessions = JSON.parse(window.localStorage.getItem(sessionsListKey) || '[]');
} catch (e) {
  activeSessions = [];
}
try {
  sessionGroups = JSON.parse(window.localStorage.getItem(sessionsGroupsKey) || '{}');
} catch (e) {
  sessionGroups = {};
}

let sessionId = window.localStorage.getItem(activeSessionKey) || legacyId;

if (legacyId) {
    // Migrate legacy
    window.localStorage.removeItem(legacySessionKey);
}

if (!sessionId && activeSessions.length > 0) {
  sessionId = activeSessions[0];
} else if (!sessionId) {
  sessionId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  activeSessions = [sessionId];
} else if (!activeSessions.includes(sessionId)) {
  activeSessions.push(sessionId);
}

saveSessionState();

function saveSessionState() {
  window.localStorage.setItem(activeSessionKey, sessionId);
  window.localStorage.setItem(sessionsListKey, JSON.stringify(activeSessions));
  window.localStorage.setItem(sessionsGroupsKey, JSON.stringify(sessionGroups));
}

const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const textareaEl = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const sessionLabel = document.getElementById('session-label');
const sessionTabsEl = document.getElementById('session-tabs');
const cloneSessionBtn = document.getElementById('clone-session-button');
const previewWrapper = document.getElementById('preview-wrapper');
const previewFrame = document.getElementById('preview-frame');
const htmlCode = document.getElementById('html-code');
const cssCode = document.getElementById('css-code');
const jsCode = document.getElementById('js-code');
const mobileToggle = document.getElementById('mobile-toggle');
const deviceSelect = document.getElementById('device-select');
const pickerButton = document.getElementById('picker-button');
const openNewWindowBtn = document.getElementById('open-new-window-button');
const downloadSessionBtn = document.getElementById('download-session-button');
const selectionInfo = document.getElementById('selection-display-area');

let currentSessionFiles = null;
let currentPreviewFiles = null;
let sessionCurrentVersion = 0;
let previewedVersion = 0;
const versionCache = new Map();
let activeVersionMessage = null;
let versionDividerEl = null;
const selectionSelectorEl = document.getElementById('selection-tag-code');
const selectionClearButton = document.getElementById('selection-tag-close');

let currentRenderedSessionId = null;
const sessionScrolls = {};

const mobilePrefKey = 'html-preview-chat-mobile-enabled';
const devicePrefKey = 'html-preview-chat-device-pref';
let selectionPrefKey = `html-preview-chat-selection-${sessionId}`;

const DEVICES = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 12/13/14', width: 390, height: 844 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { name: 'Pixel 7', width: 412, height: 915 },
  { name: 'Samsung S20 Ultra', width: 412, height: 915 },
  { name: 'iPad Mini', width: 768, height: 1024 },
  { name: 'iPad Air', width: 820, height: 1180 }
];

let statusClearTimer = null;
let sseSource = null;
const pendingAssistantMessages = [];

// Initialize Element Selector
const elementSelector = new ElementSelector({
  iframe: previewFrame,
  storageKey: selectionPrefKey,
  ui: {
    pickerButton,
    infoContainer: selectionInfo,
    selectorDisplay: selectionSelectorEl,
    clearButton: selectionClearButton,
  }
});

// Initialize Device Selector
if (deviceSelect) {
  DEVICES.forEach((dev, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    opt.textContent = `${dev.name} (${dev.width}×${dev.height})`;
    deviceSelect.appendChild(opt);
  });
  
  const savedDeviceIndex = window.localStorage.getItem(devicePrefKey);
  if (savedDeviceIndex) {
    deviceSelect.value = savedDeviceIndex;
    // Validate in case DEVICES changed
    if (deviceSelect.selectedIndex === -1) {
      deviceSelect.selectedIndex = 0;
    }
  }

  deviceSelect.addEventListener('change', () => {
    window.localStorage.setItem(devicePrefKey, deviceSelect.value);
    if (mobileToggle?.checked) {
      updatePreviewMinHeight();
    }
  });
}

const persistedMobile = window.localStorage.getItem(mobilePrefKey);
if (persistedMobile === 'true' && mobileToggle) {
  mobileToggle.checked = true;
}
applyPreviewMode(Boolean(mobileToggle?.checked));

if (mobileToggle) {
  mobileToggle.addEventListener('change', () => {
    const enabled = Boolean(mobileToggle?.checked);
    window.localStorage.setItem(mobilePrefKey, String(enabled));
    applyPreviewMode(enabled);
  });
}

window.addEventListener('resize', () => {
  updatePreviewMinHeight();
});

renderSessionTabs();

if (cloneSessionBtn) {
  cloneSessionBtn.addEventListener('click', () => {
    cloneCurrentSession();
  });
}

if (openNewWindowBtn) {
  openNewWindowBtn.addEventListener('click', () => {
    const sourceFiles = currentPreviewFiles || currentSessionFiles;
    if (!sourceFiles) return;
    
    const docContent = buildPreviewDocument(sourceFiles);
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.open();
      newWindow.document.write(docContent);
      newWindow.document.close();
    }
  });
}

if (downloadSessionBtn) {
  downloadSessionBtn.addEventListener('click', async () => {
    try {
      downloadSessionBtn.disabled = true;
      downloadSessionBtn.setAttribute('aria-busy', 'true');
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/archive`);
      if (!response.ok) {
        throw new Error(`Failed to download archive: ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      const safeId = (sessionId || 'session').replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 24) || 'session';
      anchor.download = `session-${safeId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Failed to download session files', error);
    } finally {
      downloadSessionBtn.disabled = false;
      downloadSessionBtn.removeAttribute('aria-busy');
    }
  });
}

typeText(sessionLabel, sessionId);
startChatStatusStream();



window.addEventListener('beforeunload', () => {
  if (sseSource) {
    sseSource.close();
  }
});


formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = textareaEl.value.trim();
  if (!message) {
    return;
  }

  setBusy(true, 'Отправка запроса...');
  const currentSelection = elementSelector.currentSelection;
  addMessage('user', message, { selection: currentSelection });
  createAssistantPlaceholder('Готовлю ответ...');
  textareaEl.value = '';

  try {
    const payload = { 
        sessionId, 
        message, 
        attachments: [] 
    };
    
    if (currentSelection?.selector) {
        payload.selection = { selector: currentSelection.selector };
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    finalizePendingAssistantMessage(data.message ?? 'Готово.');
    // Refresh selection info if needed (though elementSelector handles its own state)
    await loadSession();
    const isSseUnavailable =
      typeof EventSource === 'undefined' || !sseSource || sseSource.readyState !== EventSource.OPEN;
    if (isSseUnavailable || sendButton.disabled) {
      setBusy(false, 'Готово');
      scheduleStatusClear(2500);
    }
  } catch (error) {
    console.error(error);
    failPendingAssistantMessage('Произошла ошибка. Проверьте консоль.');
    setBusy(false, 'Ошибка');
  }
});

void loadSession();

async function loadSession() {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
      throw new Error(`Failed to load session: ${response.status}`);
    }
    const session = await response.json();
    
    if (typeof session.group === 'number') {
        sessionGroups[session.id] = session.group;
        saveSessionState();
        renderSessionTabs(); // Update tabs with group info
    }

    renderSession(session);
    restoreSessionState();
  } catch (error) {
    console.error(error);
  }
}

async function fetchVersionFiles(version) {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/versions/${version}/files`);
    if (!response.ok) {
      throw new Error(`Failed to load version ${version}: ${response.status}`);
    }
    const payload = await response.json();
    return cloneFiles(payload);
  } catch (error) {
    console.error('Failed to fetch version files', error);
    return null;
  }
}

async function previewVersion(version, messageEl) {
  if (typeof version !== 'number') {
    return;
  }

  if (previewedVersion === version && currentPreviewFiles) {
    highlightVersionMessage(version, messageEl);
    return;
  }

  let files;
  if (version === sessionCurrentVersion && currentSessionFiles) {
    files = currentSessionFiles;
  } else if (versionCache.has(version)) {
    files = versionCache.get(version);
  } else {
    files = await fetchVersionFiles(version);
    if (!files) {
      return;
    }
    versionCache.set(version, files);
  }

  currentPreviewFiles = files;
  previewedVersion = version;
  updatePreview(files);
  renderCode(files);
  highlightVersionMessage(version, messageEl);
}

function highlightVersionMessage(version, messageEl) {
  if (messagesEl) {
    messagesEl.querySelectorAll('.message-version-active').forEach((node) => node.classList.remove('message-version-active'));
    messagesEl.querySelectorAll('.message.message-dimmed').forEach((node) => node.classList.remove('message-dimmed'));
  }

  if (versionDividerEl && versionDividerEl.parentNode) {
    versionDividerEl.remove();
  }
  versionDividerEl = null;

  if (typeof version !== 'number') {
    activeVersionMessage = null;
    return;
  }

  let target = messageEl || null;
  if (!target && messagesEl) {
    const candidates = messagesEl.querySelectorAll(`[data-version="${version}"]`);
    if (candidates.length > 0) {
      target = candidates[candidates.length - 1];
    }
  }

  activeVersionMessage = target || null;
  if (target) {
    target.classList.add('message-version-active');
    let cursor = target.nextElementSibling;
    while (cursor) {
      if (cursor.classList && cursor.classList.contains('message')) {
        cursor.classList.add('message-dimmed');
      }
      cursor = cursor.nextElementSibling;
    }

    if (target.nextElementSibling) {
      versionDividerEl = document.createElement('div');
      versionDividerEl.className = 'message-version-divider';
      target.insertAdjacentElement('afterend', versionDividerEl);
    }
  }
}

function updateCloneButtonsVisibility() {
  if (!messagesEl) {
    return;
  }
  const items = messagesEl.querySelectorAll('.message');
  if (!items.length) {
    return;
  }
  const lastMessage = items[items.length - 1];
  items.forEach((message) => {
    if (message === lastMessage) {
      message.classList.add('message-latest');
    } else {
      message.classList.remove('message-latest');
    }
  });
}

function applyPreviewMode(isMobile) {
  if (!previewWrapper) return;

  previewWrapper.classList.toggle('mobile', isMobile);
  if (deviceSelect) {
    deviceSelect.disabled = !isMobile;
  }
  updatePreviewMinHeight();
}

function updatePreviewMinHeight() {
  if (!previewFrame) {
    return;
  }

  const isMobile = Boolean(mobileToggle?.checked);
  if (isMobile) {
    const deviceIndex = parseInt(deviceSelect?.value || '0', 10);
    const device = DEVICES[deviceIndex] || DEVICES[0];
    
    if (previewWrapper) {
      previewWrapper.style.minHeight = `${device.height}px`;
    }
    previewFrame.style.width = `${device.width}px`;
    previewFrame.style.height = `${device.height}px`;
    previewFrame.style.minHeight = `${device.height}px`;
    return;
  }

  // Desktop mode: reset styles to allow flexbox to handle sizing
  previewFrame.style.width = '';
  previewFrame.style.height = '';
  previewFrame.style.minHeight = '';
  if (previewWrapper) {
    previewWrapper.style.minHeight = '';
  }
}

function renderSession(session) {
  if (!session) return;

  sessionCurrentVersion = typeof session.currentVersion === 'number' ? session.currentVersion : 0;
  versionCache.clear();
  if (session.files) {
    const normalizedFiles = cloneFiles(session.files);
    currentSessionFiles = normalizedFiles;
    currentPreviewFiles = normalizedFiles;
    previewedVersion = sessionCurrentVersion;
    versionCache.set(sessionCurrentVersion, cloneFiles(normalizedFiles));
    updatePreview(normalizedFiles);
    renderCode(normalizedFiles);
  }

  if (session.history) {
    renderMessages(session.history);
    highlightVersionMessage(previewedVersion);
  }
}

function renderMessages(history) {
  messagesEl.innerHTML = '';
  pendingAssistantMessages.length = 0;
  (history ?? []).forEach((entry) => {
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'system' ? 'system' : 'user';
    addMessage(role, entry.content ?? '', {
      silent: true,
      selection: entry.selection,
      version: entry.version,
      deferCloneUpdate: true,
    });
  });
  updateCloneButtonsVisibility();
  messagesEl.scrollTo({ top: messagesEl.scrollHeight });
}

function addMessage(role, text, options = {}) {
  if (!messagesEl) {
    return null;
  }
  const { silent = false, selection, version, deferCloneUpdate = false } = options;
  const el = document.createElement('div');
  el.className = `message ${role}`;
  
  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  
  if (selection?.selector) {
      const chip = document.createElement('div');
      chip.className = 'message-selection-chip';
      chip.textContent = selection.selector;
      chip.title = 'Нажмите, чтобы выделить элемент в предпросмотре';
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', (event) => {
          event.stopPropagation();
          if (typeof elementSelector !== 'undefined') {
              elementSelector.updateSelection({ selector: selection.selector });
              
              // Scroll to element if possible
              try {
                  const frame = document.getElementById('preview-frame');
                  const doc = frame?.contentDocument;
                  const el = doc?.querySelector(selection.selector);
                  if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
              } catch (e) {
                  console.warn('Failed to scroll to element', e);
              }
          }
      });
      contentEl.appendChild(chip);
  }
  
  const textNode = document.createElement('div');
  textNode.textContent = text;
  contentEl.appendChild(textNode);
  el.appendChild(contentEl);

  if (typeof version === 'number' && role === 'assistant') {
      el.dataset.version = String(version);
      el.classList.add('message-has-version');
      el.addEventListener('click', () => {
          void previewVersion(version, el);
      });

      const actionsEl = document.createElement('div');
      actionsEl.className = 'message-actions';

      const cloneButton = document.createElement('button');
      cloneButton.type = 'button';
      cloneButton.className = 'message-version-clone';
      cloneButton.title = 'Клонировать';
      cloneButton.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
      cloneButton.addEventListener('click', (event) => {
          event.stopPropagation();
          void cloneSessionAtVersion(version);
      });
      
      actionsEl.appendChild(cloneButton);
      el.appendChild(actionsEl);
  }
  
  messagesEl.appendChild(el);
  if (silent) {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight });
  } else {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  if (!deferCloneUpdate) {
    updateCloneButtonsVisibility();
  }

  return el;
}


function createAssistantPlaceholder(initialMessage = 'Готовлю ответ...') {
  if (!messagesEl) {
    return null;
  }
  const entry = {
    element: document.createElement('div'),
    spinner: document.createElement('span'),
    text: document.createElement('span'),
  };
  entry.element.className = 'message assistant message-pending';
  entry.spinner.className = 'message-spinner';
  entry.spinner.setAttribute('aria-hidden', 'true');
  entry.text.className = 'message-status';
  entry.text.textContent = initialMessage;
  entry.element.append(entry.spinner, entry.text);
  messagesEl.appendChild(entry.element);
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  pendingAssistantMessages.push(entry);
  return entry;
}

function ensureAssistantPlaceholder(initialMessage) {
  const current = pendingAssistantMessages[0];
  if (current) {
    if (typeof initialMessage === 'string' && initialMessage.length > 0) {
      current.text.textContent = initialMessage;
    }
    return current;
  }
  return createAssistantPlaceholder(initialMessage ?? 'Готовлю ответ...');
}

function finalizePendingAssistantMessage(message) {
  const current = pendingAssistantMessages.shift();
  if (!current) {
    return;
  }
  if (current.spinner.parentNode) {
    current.spinner.remove();
  }
  current.element.classList.remove('message-pending');
  current.element.classList.remove('message-error');
  current.text.classList.remove('message-status');
  current.text.textContent = message ?? '';
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}

function failPendingAssistantMessage(message) {
  const current = pendingAssistantMessages.shift();
  if (!current) {
    return;
  }
  if (current.spinner.parentNode) {
    current.spinner.remove();
  }
  current.element.classList.remove('message-pending');
  current.element.classList.add('message-error');
  current.text.classList.remove('message-status');
  current.text.textContent = message ?? 'Ошибка при выполнении запроса.';
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
}

function setBusy(isBusy, text) {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  sendButton.disabled = isBusy;
}

function scheduleStatusClear(delayMs = 2500) {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
  }
  statusClearTimer = setTimeout(() => {
    statusClearTimer = null;
  }, delayMs);
}

function startChatStatusStream() {
  if (typeof EventSource === 'undefined') {
    console.warn('EventSource не поддерживается в этом браузере.');
    return;
  }

  if (sseSource) {
    sseSource.close();
  }

  sseSource = new EventSource('/api/sse');

  sseSource.addEventListener('chat-status', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (!payload) {
        return;
      }
      
      updateSessionState(payload);

      if (payload.sessionId !== sessionId) {
        return;
      }
      handleChatStatusUpdate(payload);
    } catch (error) {
      console.warn('Failed to parse chat status event', error);
    }
  });

  sseSource.addEventListener('session-created', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload && payload.newSessionId) {
        handleSessionCreated(payload);
      }
    } catch (error) {
      console.warn('Failed to parse session created event', error);
    }
  });

  sseSource.addEventListener('error', (event) => {
    console.warn('Chat status stream error', event);
  });
}

function handleChatStatusUpdate(payload) {
  const { status, message, details } = payload || {};
  switch (status) {
    case 'started': {
      const label = message || 'Запрос к GPT выполняется...';
      ensureAssistantPlaceholder(label);
      setBusy(true, label);
      break;
    }
    case 'completed': {
      const summary = typeof details === 'string' && details.trim().length > 0 ? details : message || 'Готово';
      finalizePendingAssistantMessage(summary);
      setBusy(false, message || 'Готово');
      scheduleStatusClear(2500);
      // Reload session to get latest history/files
      loadSession(); 
      break;
    }
    case 'error': {
      const errorText = message || 'Ошибка при выполнении запроса.';
      const detailText = typeof details === 'string' && details.trim().length > 0 ? details : null;
      failPendingAssistantMessage(detailText || errorText);
      setBusy(false, errorText);
      if (details) {
        console.error('GPT request failed', details);
      }
      break;
    }
    case 'skipped': {
      const skipText = message || 'Запрос пропущен.';
      ensureAssistantPlaceholder(skipText);
      finalizePendingAssistantMessage(skipText);
      setBusy(false, skipText);
      scheduleStatusClear(2000);
      break;
    }
    default:
      console.warn('Получен неизвестный статус события SSE', payload);
  }
}

function updateSessionState(payload) {
  const { sessionId, status, message } = payload;
  if (!sessionStates[sessionId]) {
    sessionStates[sessionId] = { status: 'idle' };
  }
  
  if (status === 'started') {
    sessionStates[sessionId].status = 'busy';
    sessionStates[sessionId].message = message;
  } else if (['completed', 'error', 'skipped'].includes(status)) {
    sessionStates[sessionId].status = 'idle';
    sessionStates[sessionId].message = '';
  }
  
  renderSessionTabs();
}

function restoreSessionState() {
  const state = sessionStates[sessionId];
  if (state && state.status === 'busy') {
    ensureAssistantPlaceholder(state.message || 'Запрос к GPT выполняется...');
    setBusy(true, state.message);
  } else {
    // If we switched to an idle session, ensure UI is not stuck in busy state
    // Check if we are incorrectly busy (e.g. from previous session)
    if (sendButton.disabled) {
       setBusy(false, 'Ready');
       scheduleStatusClear(0);
    }
  }
}


function handleSessionCreated(payload) {
  const { newSessionId, sourceSessionId, group } = payload;
  if (!newSessionId) return;

  if (!activeSessions.includes(newSessionId)) {
    activeSessions.push(newSessionId);
    
    // Prefer explicit group from payload, otherwise inherit from source if available
    if (typeof group === 'number') {
        sessionGroups[newSessionId] = group;
    } else if (sourceSessionId && typeof sessionGroups[sourceSessionId] === 'number') {
        sessionGroups[newSessionId] = sessionGroups[sourceSessionId];
    }
    
    saveSessionState();
    renderSessionTabs();
    
    // Optional: visual notification
    const notification = document.createElement('div');
    notification.className = 'message system';
    notification.textContent = `✨ Новый вариант создан: ${newSessionId.slice(0,8)}`;
    messagesEl.appendChild(notification);
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }
}

function renderCode(files) {
  htmlCode.textContent = files.html ?? '';
  cssCode.textContent = files.css ?? '';
  jsCode.textContent = files.js ?? '';
}

function updatePreview(files) {
  // 1. Capture current scroll position for the *currently rendered* session
  if (currentRenderedSessionId && previewFrame && previewFrame.contentWindow) {
    try {
      sessionScrolls[currentRenderedSessionId] = {
        x: previewFrame.contentWindow.scrollX,
        y: previewFrame.contentWindow.scrollY,
      };
    } catch (e) {
      // Ignore cross-origin issues
    }
  }

  // 2. Determine target scroll for the *new* session (which might be the same one)
  // If we just switched sessions, sessionId is already updated, so we pick from cache.
  // If we are updating the same session, we just saved its latest scroll above.
  const targetScroll = sessionScrolls[sessionId] || { x: 0, y: 0 };

  const doc = buildPreviewDocument(files);
  if (!previewFrame) return;

  previewFrame.srcdoc = doc;
  
  // 3. Restore scroll position after load
  const restoreScroll = () => {
    try {
      if (previewFrame.contentWindow) {
        previewFrame.contentWindow.scrollTo(targetScroll.x, targetScroll.y);
      }
    } catch (e) {
      // Ignore
    }
    previewFrame.removeEventListener('load', restoreScroll);
  };
  previewFrame.addEventListener('load', restoreScroll);

  // 4. Update tracking
  currentRenderedSessionId = sessionId;
}

function buildPreviewDocument(files) {
  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(files.html ?? '', 'text/html');
    if (!parsed || !parsed.documentElement) {
      throw new Error('Failed to parse HTML');
    }

    parsed.querySelectorAll('link[rel="stylesheet"]').forEach((node) => node.remove());
    parsed.querySelectorAll('script[src]').forEach((node) => node.remove());

    const head = parsed.head ?? parsed.getElementsByTagName('head')[0] ?? parsed.createElement('head');
    if (!parsed.head) {
      parsed.documentElement.insertBefore(head, parsed.body ?? null);
    }

    const body = parsed.body ?? parsed.getElementsByTagName('body')[0] ?? parsed.createElement('body');
    if (!parsed.body) {
      parsed.documentElement.appendChild(body);
    }

    const style = parsed.createElement('style');
    style.textContent = files.css ?? '';
    head.appendChild(style);

    const script = parsed.createElement('script');
    script.type = 'module';
    script.textContent = files.js ?? '';
    body.appendChild(script);

    return '<!DOCTYPE html>' + parsed.documentElement.outerHTML;
  } catch (error) {
    console.warn('Falling back to inline preview rendering', error);
    const html = files.html ?? '<!DOCTYPE html><html><head></head><body></body></html>';
    const styled = html.includes('</head>')
      ? html.replace('</head>', `<style>${files.css ?? ''}</style></head>`)
      : `<style>${files.css ?? ''}</style>${html}`;
    const scriptTag = `<script type="module">${files.js ?? ''}</script>`;
    if (styled.includes('</body>')) {
      return styled.replace('</body>', `${scriptTag}</body>`);
    }
    return styled + scriptTag;
  }
}

function cloneFiles(files = {}) {
  return {
    html: files.html ?? '',
    css: files.css ?? '',
    js: files.js ?? '',
  };
}

function renderSessionTabs() {
  if (!sessionTabsEl) return;
  sessionTabsEl.innerHTML = '';

  activeSessions.forEach((id) => {
    const tab = document.createElement('div');
    const group = sessionGroups[id] ?? 0;
    tab.className = `session-tab session-group-${group} ${id === sessionId ? 'active' : ''}`;
    
    // Status Icon
    const statusIcon = document.createElement('span');
    const isBusy = sessionStates[id]?.status === 'busy';
    
    if (isBusy) {
        statusIcon.className = 'session-tab-status busy';
        statusIcon.setAttribute('aria-label', 'Ожидание ответа');
    } else {
        statusIcon.className = 'session-tab-status';
        // Chat bubble icon
        statusIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    }
    
    const label = document.createElement('span');
    label.textContent = id.slice(0, 8);
    label.title = id;
    label.onclick = () => {
      if (id !== sessionId) {
        switchSession(id);
      }
    };

    const closeBtn = document.createElement('span');
    closeBtn.className = 'session-tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close session';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeSession(id);
    };

    tab.append(statusIcon, label, closeBtn);
    sessionTabsEl.appendChild(tab);
  });

  // Add "New Chat" button
  const newBtn = document.createElement('button');
  newBtn.className = 'session-tab-new';
  newBtn.type = 'button';
  newBtn.title = 'Новый чат';
  newBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
  newBtn.onclick = () => createNewSession();
  
  sessionTabsEl.appendChild(newBtn);
}

async function createNewSession() {
  setBusy(true, 'Creating new session...');
  try {
    const response = await fetch('/api/sessions', { method: 'POST' });
    if (!response.ok) throw new Error('Failed to create session');
    const session = await response.json();
    
    activeSessions.push(session.id);
    
    if (typeof session.group === 'number') {
        sessionGroups[session.id] = session.group;
        saveSessionState();
    }
    
    switchSession(session.id, session);
  } catch (error) {
    console.error(error);
    setBusy(false, 'Error creating session');
  }
}

async function cloneCurrentSession() {
  setBusy(true, 'Cloning session...');
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/clone`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to clone session');
    const session = await response.json();
    
    activeSessions.push(session.id);
    
    if (typeof session.group === 'number') {
        sessionGroups[session.id] = session.group;
        saveSessionState();
    }
    
    switchSession(session.id, session);
  } catch (error) {
    console.error(error);
    setBusy(false, 'Error cloning session');
  }
}

async function cloneSessionAtVersion(version) {
  if (!Number.isFinite(version) || version < 0) {
    return;
  }
  setBusy(true, 'Клонирование версии...');
  try {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/versions/${version}/clone`,
      { method: 'POST' },
    );
    if (!response.ok) {
      throw new Error('Failed to clone version');
    }
    const session = await response.json();

    if (!activeSessions.includes(session.id)) {
      activeSessions.push(session.id);
    }

    if (typeof session.group === 'number') {
      sessionGroups[session.id] = session.group;
    }

    saveSessionState();
    switchSession(session.id, session);
    setBusy(false, 'Готово');
    scheduleStatusClear(2000);
  } catch (error) {
    console.error(error);
    setBusy(false, 'Ошибка клонирования');
    scheduleStatusClear(2000);
  }
}

function switchSession(newId, preloadedSession = null) {
  sessionId = newId;
  saveSessionState();
  selectionPrefKey = `html-preview-chat-selection-${sessionId}`;
  
  // Clear current state
  pendingAssistantMessages.length = 0;
  
  // Update Element Selector state
  elementSelector.storageKey = selectionPrefKey;
  elementSelector.currentSelection = null; // Reset first
  elementSelector.loadStoredSelection();   // Load new
  elementSelector.render();
  
  renderSessionTabs();
  
  if (preloadedSession) {
    renderSession(preloadedSession);
    restoreSessionState();
  } else {
    loadSession();
  }
  
  typeText(sessionLabel, sessionId);
}

const previewPanel = document.querySelector('.preview-panel');
const assetTabs = document.querySelectorAll('.asset-tab');
const assetPanels = document.querySelectorAll('.asset-panel');
const assetCloseBtn = document.querySelector('.asset-close');

function openCodeView(type) {
  if (previewPanel) {
    previewPanel.classList.add('code-view');
  }
  
  // Update tabs
  assetTabs.forEach(tab => {
    const isActive = tab.dataset.type === type;
    tab.setAttribute('aria-selected', String(isActive));
    if (isActive) tab.classList.add('active');
    else tab.classList.remove('active');
  });

  // Update panels
  assetPanels.forEach(panel => {
    const isPanel = panel.id === `panel-${type}`;
    panel.hidden = !isPanel;
  });
}

function closeCodeView() {
  if (previewPanel) {
    previewPanel.classList.remove('code-view');
  }
  
  assetTabs.forEach(tab => {
    tab.setAttribute('aria-selected', 'false');
    tab.classList.remove('active');
  });
  
  assetPanels.forEach(panel => {
    panel.hidden = true;
  });
}

if (assetTabs) {
  assetTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const type = tab.dataset.type;
      if (type) openCodeView(type);
    });
  });
}

if (assetCloseBtn) {
  assetCloseBtn.addEventListener('click', closeCodeView);
}

function closeSession(id) {
  const index = activeSessions.indexOf(id);
  if (index === -1) return;
  
  activeSessions.splice(index, 1);
  // Optional: cleanup group cache? 
  // delete sessionGroups[id]; 
  // Maybe not, in case we re-open? But we don't have a "reopen" UI.
  // Let's keep it to avoid state drift if we re-add logic later.
  
  if (activeSessions.length === 0) {
    // Ensure at least one session exists
    createNewSession();
    return;
  }
  
  if (id === sessionId) {
    // Switch to the nearest neighbor (previous or next)
    const newId = activeSessions[Math.max(0, index - 1)];
    switchSession(newId);
  } else {
    saveSessionState();
    renderSessionTabs();
  }
}

function typeText(target, text) {
  if (!target) return;
  target.textContent = text;
}
