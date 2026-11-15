// Split view and Peek (Shift+click, or links to other hosts from pinned tabs/favorites).
// Both are Arc features, also in Solamar (https://github.com/Bambeek/solamar, GPL-3.0-or-later).

const PEEK_KEY = 'shiira-peek-links';
import { splitRects } from './split-layout.js';
const WEBVIEW_PREFERENCES = 'contextIsolation=yes,devTools=no,plugins=yes,backgroundThrottling=no';

export const SplitPeekMixin = {
  initSplitView() {
    this.splitPair = null;
    this.splitRatio = 0.5;
    this.splitLayout = 'columns';
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
      const value = this.splitLayout === 'rows' ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width;
      this.splitRatio = Math.max(0.2, Math.min(0.8, value));
      this.browserContent.style.setProperty('--split-ratio', String(this.splitRatio));
      this.applySplitLayout();
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
      this.applySplitLayout();
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
    const ids = this.splitPair?.includes(active.id) ? [...this.splitPair] : [active.id];
    if (ids.includes(other.id)) return;
    if (ids.length >= 4) { this.setStatus?.('Split View supports up to four pages.', 2500); return; }
    this.ensureWebview(other);
    if (other.pendingUrl && other.webview) {
      other.webview.src = other.pendingUrl;
      other.pendingUrl = null;
    }
    other.lastActiveAt = Date.now();
    this.splitPair = [...ids, other.id];
    if (this.splitPair.length > 2) this.splitLayout = 'grid';
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

  addNextSplitPane() {
    const next = this.getCycleOrder().find(t => !t.isHome && t.id !== this.activeTabId && !this.splitPair?.includes(t.id));
    if (next) this.openSplitView(next.id);
    else this.setStatus?.('Open another page to add a split pane.', 2000);
  },

  setSplitLayout(layout) {
    if (!['columns', 'rows', 'grid'].includes(layout)) return;
    this.splitLayout = layout;
    this.applySplitLayout();
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
    content.querySelectorAll('webview.split-a, webview.split-b, webview.split-pane, webview.split-focused').forEach((webview) => {
      webview.classList.remove('split-a', 'split-b', 'split-pane', 'split-focused');
      if (webview.id !== this.activeTabId) webview.classList.remove('active');
      for (const property of ['left', 'top', 'width', 'height']) webview.style.removeProperty(property);
    });

    const pair = this.splitPair?.map(id => this.tabs.find(t => t.id === id));
    const valid = pair && pair.every(tab => tab?.webview) && this.splitPair.includes(this.activeTabId);
    if (!valid) {
      // Opening a tab outside the pair ends split view.
      this.splitPair = null;
      content.classList.remove('split');
      content.classList.remove('split-rows', 'split-many');
      return;
    }

    content.classList.add('split');
    content.classList.toggle('split-rows', this.splitLayout === 'rows');
    content.classList.toggle('split-many', pair.length > 2);
    content.style.setProperty('--split-ratio', String(this.splitRatio));
    const rects = splitRects(pair.length, this.splitLayout, this.splitRatio);
    pair.forEach((tab, i) => {
      const r = rects[i];
      tab.webview.classList.add('split-pane', 'active');
      Object.assign(tab.webview.style, { left: `calc(${r.x * 100}% + ${r.x ? 3 : 0}px)`, top: `calc(${r.y * 100}% + ${r.y ? 3 : 0}px)`,
        width: `calc(${r.width * 100}% - ${r.width < 1 ? 3 : 0}px)`, height: `calc(${r.height * 100}% - ${r.height < 1 ? 3 : 0}px)` });
    });
    const focused = pair.find(tab => tab.id === this.activeTabId);
    focused?.webview.classList.add('split-focused');
    this.welcomePage?.classList.add('hidden');
  },

  onTabClosing(tab) {
    if (!this.splitPair?.includes(tab.id)) return;
    const remaining = this.splitPair.filter(id => id !== tab.id);
    if (remaining.length < 2) this.exitSplitView();
    else {
      this.splitPair = remaining;
      if (this.activeTabId !== tab.id) this.applySplitLayout();
    }
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

  openPeek(url, sourceTabId = this.activeTabId) {
    if (!this.peekOverlay || !/^https?:/i.test(url || '')) {
      this.openLinkInTabOnce(url, sourceTabId);
      return;
    }
    this.closePeek();
    this.hideSidebarMenu?.();
    this.peekUrl = url;
    const source = this.tabs.find(tab => tab.id === sourceTabId);
    this.peekSource = { spaceId: source?.spaceId || this.focusedSpaceId, privateMode: source?.privateMode === true };
    const webview = document.createElement('webview');
    webview.className = 'peek-webview';
    webview.setAttribute('partition', source?.webview?.getAttribute('partition') || (source?.privateMode ? this.privatePartition(source.id) : this.partitionForProfile(this.profileForTab(source))));
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
      if (event.url && event.url !== 'about:blank') this.openLinkInTabOnce(event.url, sourceTabId);
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
    const options = this.peekSource;
    this.closePeek();
    if (url) this.createTab(url, options);
  },

  peekToSplit() {
    const url = this.peekCurrentUrl();
    const options = this.peekSource;
    this.closePeek();
    if (!url) return;
    const active = this.tabs.find(t => t.id === this.activeTabId);
    const id = this.createTab(url, { ...options, background: true });
    if (active && !active.isHome) this.openSplitView(id);
    else this.switchTab(id);
  },

  closePeek() {
    if (!this.peekOverlay || this.peekOverlay.classList.contains('hidden')) return;
    this.peekOverlay.classList.add('hidden');
    this.peekHost.replaceChildren();
    this.peekWebview = null;
    this.peekSource = null;
  }
};
