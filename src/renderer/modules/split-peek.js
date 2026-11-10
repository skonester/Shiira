// Split view (two tabs side by side) and Peek (Shift+click a link to preview it over the page).
// Both are Arc features, also in Solamar (https://github.com/Bambeek/solamar, GPL-3.0-or-later).

const PEEK_KEY = 'shiira-peek-links';
const WEBVIEW_PREFERENCES = 'contextIsolation=yes,devTools=no,plugins=yes,backgroundThrottling=no';

export const SplitPeekMixin = {
  initSplitView() {
    this.splitPair = null;
    this.splitRatio = 0.5;
    this.splitDivider = document.getElementById('split-divider');
    const divider = this.splitDivider;
    if (!divider) return;
    divider.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      document.body.classList.add('sb-resizing');
    });
    divider.addEventListener('pointermove', (event) => {
      if (!divider.hasPointerCapture(event.pointerId)) return;
      const rect = this.browserContent.getBoundingClientRect();
      this.splitRatio = Math.max(0.2, Math.min(0.8, (event.clientX - rect.left) / rect.width));
      this.browserContent.style.setProperty('--split-ratio', String(this.splitRatio));
    });
    const finish = (event) => {
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      document.body.classList.remove('sb-resizing');
    };
    divider.addEventListener('pointerup', finish);
    divider.addEventListener('pointercancel', finish);
    divider.addEventListener('dblclick', () => {
      this.splitRatio = 0.5;
      this.browserContent.style.setProperty('--split-ratio', '0.5');
    });
  },

  // Shows the active tab next to `otherTabId`.
  openSplitView(otherTabId) {
    const active = this.tabs.find(t => t.id === this.activeTabId);
    const other = this.tabs.find(t => t.id === otherTabId);
    if (!active || active.isHome || !active.webview) {
      this.setStatus?.('Open a page first, then split it with another tab.', 2500);
      return;
    }
    if (!other || other.isHome || other.id === active.id) return;
    this.ensureWebview(other);
    if (other.pendingUrl && other.webview) {
      other.webview.src = other.pendingUrl;
      other.pendingUrl = null;
    }
    other.lastActiveAt = Date.now();
    this.splitPair = [active.id, other.id];
    this.applySplitLayout();
    this.updateSidebarActive?.();
  },

  toggleSplitView() {
    if (this.splitPair) {
      this.exitSplitView();
      return;
    }
    const order = this.getCycleOrder();
    const index = order.findIndex(t => t.id === this.activeTabId);
    const candidates = [...order.slice(index + 1), ...order.slice(0, Math.max(index, 0))];
    const next = candidates.find(t => !t.isHome && t.id !== this.activeTabId);
    if (next) this.openSplitView(next.id);
    else this.setStatus?.('Open another tab to split the window with.', 2500);
  },

  exitSplitView() {
    if (!this.splitPair) return;
    this.splitPair = null;
    this.applySplitLayout();
    this.updateSidebarActive?.();
  },

  applySplitLayout() {
    const content = this.browserContent;
    if (!content) return;
    content.querySelectorAll('webview.split-a, webview.split-b, webview.split-focused').forEach((webview) => {
      webview.classList.remove('split-a', 'split-b', 'split-focused');
    });

    const pair = this.splitPair?.map(id => this.tabs.find(t => t.id === id));
    const valid = pair && pair.every(tab => tab?.webview) && this.splitPair.includes(this.activeTabId);
    if (!valid) {
      // Opening a tab outside the pair ends split view.
      this.splitPair = null;
      content.classList.remove('split');
      return;
    }

    content.classList.add('split');
    content.style.setProperty('--split-ratio', String(this.splitRatio));
    const [left, right] = pair;
    left.webview.classList.add('split-a', 'active');
    right.webview.classList.add('split-b', 'active');
    const focused = pair.find(tab => tab.id === this.activeTabId);
    focused?.webview.classList.add('split-focused');
    this.welcomePage?.classList.add('hidden');
  },

  onTabClosing(tab) {
    if (this.splitPair?.includes(tab.id)) this.exitSplitView();
  },

  // ---------- Peek ----------

  isPeekEnabled() {
    return localStorage.getItem(PEEK_KEY) !== 'false';
  },

  initPeek() {
    this.peekOverlay = document.getElementById('peek-overlay');
    this.peekHost = document.getElementById('peek-webview-host');
    this.peekTitle = document.getElementById('peek-title');
    if (!this.peekOverlay) return;
    document.getElementById('peek-close')?.addEventListener('click', () => this.closePeek());
    document.getElementById('peek-open-tab')?.addEventListener('click', () => this.peekToTab());
    document.getElementById('peek-open-split')?.addEventListener('click', () => this.peekToSplit());
    this.peekOverlay.addEventListener('mousedown', (event) => {
      if (event.target === this.peekOverlay) this.closePeek();
    });
  },

  openPeek(url) {
    if (!this.peekOverlay || !/^https?:/i.test(url || '')) {
      this.openLinkInTabOnce(url);
      return;
    }
    this.closePeek();
    this.hideSidebarMenu?.();
    this.peekUrl = url;
    const webview = document.createElement('webview');
    webview.className = 'peek-webview';
    webview.setAttribute('partition', 'persist:main');
    webview.setAttribute('webpreferences', WEBVIEW_PREFERENCES);
    webview.style.filter = `brightness(${(this.currentBrightness || 100) / 100})`;
    const setTitle = (text) => { if (this.peekTitle) this.peekTitle.textContent = text; };
    setTitle(url);
    webview.addEventListener('page-title-updated', (event) => setTitle(event.title || this.peekUrl));
    webview.addEventListener('did-navigate', (event) => {
      this.peekUrl = event.url;
      this.injectCosmeticCSS?.(webview, event.url);
      this.injectForcedDarkMode?.(webview, event.url);
    });
    webview.addEventListener('dom-ready', () => {
      try {
        const current = webview.getURL();
        this.injectPasswordAutofill?.(webview, current);
      } catch (error) {
        // Not attached yet.
      }
    });
    webview.addEventListener('new-window', (event) => {
      event.preventDefault?.();
      if (event.url && event.url !== 'about:blank') this.openLinkInTabOnce(event.url);
    });
    webview.src = url;
    this.peekHost.replaceChildren(webview);
    this.peekWebview = webview;
    this.peekOverlay.classList.remove('hidden');
  },

  peekCurrentUrl() {
    try {
      return this.peekWebview?.getURL() || this.peekUrl;
    } catch (error) {
      return this.peekUrl;
    }
  },

  peekToTab() {
    const url = this.peekCurrentUrl();
    this.closePeek();
    if (url) this.createTab(url);
  },

  peekToSplit() {
    const url = this.peekCurrentUrl();
    this.closePeek();
    if (!url) return;
    const active = this.tabs.find(t => t.id === this.activeTabId);
    const id = this.createTab(url, { background: true });
    if (active && !active.isHome) this.openSplitView(id);
    else this.switchTab(id);
  },

  closePeek() {
    if (!this.peekOverlay || this.peekOverlay.classList.contains('hidden')) return;
    this.peekOverlay.classList.add('hidden');
    this.peekHost.replaceChildren();
    this.peekWebview = null;
  }
};
