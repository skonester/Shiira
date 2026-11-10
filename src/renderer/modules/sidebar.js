// Arc-style sidebar: spaces, favorites, pinned tabs with folders, today tabs, archive and tab sleep.
// Inspired by Solamar (https://github.com/Bambeek/solamar, GPL-3.0-or-later); written for Shiira's <webview> tabs.
//
// Layouts: 'sidebar' (vertical sidebar on the left, the default) or 'tabs' (Shiira's classic top tab strip).
// Tab rows are the same elements in both layouts; this module only moves them to the right container.

import { escapeHtml } from './utils.js';
import {
  uid, defaultSpace, DEFAULT_SPACE_ID, SPACE_COLORS, SPACE_ICONS,
  siblings, insertAt, isInsideFolder, folderTree, visibleOrder,
  shouldArchive, shouldSleep, hostOf, letterIcon, shade, planFromArc, sortByPosition
} from './spaces-model.js';

const KEYS = {
  layout: 'shiira-layout',
  width: 'shiira-sidebar-width',
  collapsed: 'shiira-sidebar-collapsed',
  archiveHours: 'shiira-archive-hours',
  sleepMinutes: 'shiira-sleep-minutes'
};
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const MAX_ARCHIVE = 500;
const DRAG_TYPE = 'application/x-shiira-item';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function readNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  const value = Number(raw);
  return raw === null || !Number.isFinite(value) ? fallback : value;
}

function timeAgo(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const FOLDER_ICON = '<svg class="sb-folder-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const CHEVRON = '<svg class="sb-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>';

export const SidebarMixin = {
  initSidebar() {
    this.spaces = [defaultSpace()];
    this.focusedSpaceId = DEFAULT_SPACE_ID;
    this.sidebarFolders = [];
    this.folderElements = new Map();
    this.activeBySpace = {};
    this.archive = [];
    this.spacesLoaded = false;
    this.spacesReadOnly = false;
    this.layout = localStorage.getItem(KEYS.layout) === 'tabs' ? 'tabs' : 'sidebar';
    this.sidebarWidth = clamp(readNumber(KEYS.width, DEFAULT_WIDTH), MIN_WIDTH, MAX_WIDTH);
    this.sidebarCollapsed = localStorage.getItem(KEYS.collapsed) === 'true';

    this.sidebar = document.getElementById('sidebar');
    this.sbFavorites = document.getElementById('sb-favorites');
    this.sbPinned = document.getElementById('sb-pinned');
    this.sbPinnedEmpty = document.getElementById('sb-pinned-empty');
    this.sbToday = document.getElementById('sb-today');
    this.sbParking = document.getElementById('sb-parking');
    this.sbSpaceDots = document.getElementById('sb-space-dots');
    this.sbClearToday = document.getElementById('sb-clear-today');
    this.sidebarMenu = document.getElementById('sb-menu');
    this.windowControls = document.querySelector('.window-controls');
    this.tabbar = document.getElementById('tabbar');
    this.navbar = document.getElementById('navbar');
    this.tabbarSpace = document.getElementById('tabbar-space');
    if (!this.sidebar) return;

    const on = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);
    on('sb-new-tab', 'click', () => this.openCommandBar?.() ?? this.createTab());
    on('sb-collapse', 'click', () => this.toggleSidebar());
    on('sb-clear-today', 'click', () => this.clearTodayTabs());
    on('sb-space-title', 'click', () => this.openSpaceEditor('edit', this.focusedSpaceId));
    on('sb-space-more', 'click', (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      this.showSpaceMenu(rect.left, rect.bottom + 4, this.focusedSpaceId);
    });
    on('sb-add-space', 'click', () => this.openSpaceEditor('new'));
    on('sb-archive', 'click', () => this.showArchivePanel());
    this.tabbarSpace?.addEventListener('click', (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      this.showSpaceSwitcherMenu(rect.left, rect.bottom + 4);
    });

    this.sidebar.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.tab, .sb-folder-row, .sb-space-dot, button')) return;
      event.preventDefault();
      this.showSidebarAreaMenu(event.clientX, event.clientY);
    });

    this.setupSidebarResize();
    this.setupSidebarReveal();
    this.setupSidebarDragAndDrop();
    this.initSpaceEditor();
    this.initArchivePanel();

    document.addEventListener('mousedown', (event) => {
      if (this.sidebarMenu && !this.sidebarMenu.classList.contains('hidden') && !this.sidebarMenu.contains(event.target)) {
        this.hideSidebarMenu();
      }
    }, true);

    this.applyLayout();
    this.maintenanceTimer = setInterval(() => this.runTabMaintenance(), 60 * 1000);
  },

  // Shows a message in the status bar, then goes back to "Ready".
  setStatus(text, duration = 2000) {
    this.updateStatus?.(text);
    clearTimeout(this.statusResetTimer);
    this.statusResetTimer = setTimeout(() => {
      if (this.statusText?.textContent === text) this.updateStatus?.('Ready');
    }, duration);
  },

  // ---------- Layout ----------

  applyLayout() {
    if (!this.sidebar) return;
    const sidebarMode = this.layout === 'sidebar';
    document.body.classList.toggle('layout-sidebar', sidebarMode);
    document.body.classList.toggle('layout-tabs', !sidebarMode);
    document.body.classList.toggle('sidebar-collapsed', sidebarMode && this.sidebarCollapsed);
    document.documentElement.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`);

    // Without a tab bar, the window controls and the drag area live in the navigation bar.
    if (this.windowControls) {
      const home = sidebarMode ? this.navbar : this.tabbar;
      if (home && this.windowControls.parentElement !== home) home.appendChild(this.windowControls);
    }
    this.placeTabElements();
    this.renderSpaceChrome();
  },

  setLayout(layout) {
    this.layout = layout === 'tabs' ? 'tabs' : 'sidebar';
    localStorage.setItem(KEYS.layout, this.layout);
    this.applyLayout();
    const select = document.getElementById('settings-layout');
    if (select) select.value = this.layout;
  },

  toggleSidebar() {
    if (this.layout !== 'sidebar') {
      this.setStatus?.('The sidebar is off in the top tabs layout (Settings > Look and Feel).', 3000);
      return;
    }
    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem(KEYS.collapsed, String(this.sidebarCollapsed));
    document.body.classList.remove('sidebar-revealed');
    this.applyLayout();
  },

  setupSidebarResize() {
    const resizer = document.getElementById('sb-resizer');
    if (!resizer) return;
    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizer.setPointerCapture(event.pointerId);
      document.body.classList.add('sb-resizing');
    });
    resizer.addEventListener('pointermove', (event) => {
      if (!resizer.hasPointerCapture(event.pointerId)) return;
      const left = this.sidebar.getBoundingClientRect().left;
      this.sidebarWidth = clamp(Math.round(event.clientX - left), MIN_WIDTH, MAX_WIDTH);
      document.documentElement.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`);
    });
    const finish = (event) => {
      if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
      document.body.classList.remove('sb-resizing');
      localStorage.setItem(KEYS.width, String(this.sidebarWidth));
    };
    resizer.addEventListener('pointerup', finish);
    resizer.addEventListener('pointercancel', finish);
    resizer.addEventListener('dblclick', () => {
      this.sidebarWidth = DEFAULT_WIDTH;
      localStorage.setItem(KEYS.width, String(DEFAULT_WIDTH));
      document.documentElement.style.setProperty('--sidebar-width', `${DEFAULT_WIDTH}px`);
    });
    resizer.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this.sidebarWidth = clamp(this.sidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16), MIN_WIDTH, MAX_WIDTH);
      localStorage.setItem(KEYS.width, String(this.sidebarWidth));
      document.documentElement.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`);
    });
  },

  // A hidden sidebar slides in when the pointer touches the left edge of the window.
  setupSidebarReveal() {
    const hotzone = document.getElementById('sidebar-hotzone');
    let hideTimer = null;
    const show = () => {
      if (!document.body.classList.contains('sidebar-collapsed')) return;
      clearTimeout(hideTimer);
      document.body.classList.add('sidebar-revealed');
    };
    const hide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (this.sidebarMenu && !this.sidebarMenu.classList.contains('hidden')) return;
        document.body.classList.remove('sidebar-revealed');
      }, 280);
    };
    hotzone?.addEventListener('mouseenter', show);
    this.sidebar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    this.sidebar.addEventListener('mouseleave', hide);
  },

  // Puts every tab row in the container it belongs to for the current space and layout.
  placeTabElements() {
    if (!this.sidebar || !this.tabsContainer) return;
    const spaceId = this.focusedSpaceId;
    const sidebarMode = this.layout === 'sidebar';
    const live = this.tabs.filter(t => t.element);
    const favorites = siblings(live, [], { section: 'favorites', spaceId }).map(e => e.ref);
    const today = siblings(live, [], { section: 'today', spaceId }).map(e => e.ref);
    const shown = new Set();

    for (const tab of live) {
      tab.element.classList.toggle('tab-favorite', tab.section === 'favorites');
      tab.element.classList.toggle('tab-pinned', tab.section === 'pinned');
      tab.element.draggable = sidebarMode && !tab.element.classList.contains('closing');
    }

    if (sidebarMode) {
      this.sbFavorites.replaceChildren(...favorites.map(t => t.element));
      favorites.forEach(t => shown.add(t.id));
      this.renderPinnedTree(null, this.sbPinned, shown);
      this.sbToday.replaceChildren(...today.map(t => t.element));
      today.forEach(t => shown.add(t.id));
      this.tabsContainer.replaceChildren();
    } else {
      const strip = visibleOrder(live, this.sidebarFolders, spaceId);
      this.tabsContainer.replaceChildren(...strip.map(t => t.element));
      strip.forEach(t => shown.add(t.id));
      this.sbFavorites.replaceChildren();
      this.sbPinned.replaceChildren();
      this.sbToday.replaceChildren();
    }

    // Tabs of other spaces wait out of sight, keeping their state.
    this.sbParking.replaceChildren(...live.filter(t => !shown.has(t.id)).map(t => t.element));

    const pinnedCount = live.filter(t => t.section === 'pinned' && t.spaceId === spaceId).length
      + this.sidebarFolders.filter(f => f.spaceId === spaceId).length;
    this.sbFavorites.classList.toggle('empty', favorites.length === 0);
    this.sbPinnedEmpty?.classList.toggle('hidden', pinnedCount > 0);
    this.sbClearToday?.classList.toggle('hidden', !today.some(t => !t.isHome));
    this.updateSidebarActive();
  },

  renderPinnedTree(parentId, container, shown) {
    const nodes = [];
    for (const entry of siblings(this.tabs, this.sidebarFolders, { section: 'pinned', spaceId: this.focusedSpaceId, parentId })) {
      if (entry.kind === 'tab') {
        nodes.push(entry.ref.element);
        shown.add(entry.id);
      } else {
        const element = this.getFolderElement(entry.ref);
        this.renderPinnedTree(entry.id, element.querySelector('.sb-folder-children'), shown);
        nodes.push(element);
      }
    }
    container.replaceChildren(...nodes);
  },

  getFolderElement(folder) {
    let element = this.folderElements.get(folder.id);
    if (!element) {
      element = document.createElement('div');
      element.className = 'sb-folder';
      element.dataset.folderId = folder.id;
      element.innerHTML = `
        <div class="sb-folder-row" draggable="true" data-folder-id="${escapeHtml(folder.id)}" role="button" tabindex="0">
          ${CHEVRON}${FOLDER_ICON}<span class="sb-folder-title"></span>
        </div>
        <div class="sb-folder-children"></div>`;
      const row = element.querySelector('.sb-folder-row');
      row.addEventListener('click', () => this.toggleSidebarFolder(folder.id));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.toggleSidebarFolder(folder.id);
        }
      });
      row.addEventListener('dblclick', () => this.renameSidebarFolder(folder.id));
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.showFolderMenu(event.clientX, event.clientY, folder.id);
      });
      this.folderElements.set(folder.id, element);
    }
    element.classList.toggle('collapsed', Boolean(folder.collapsed));
    element.querySelector('.sb-folder-row').setAttribute('aria-expanded', String(!folder.collapsed));
    element.querySelector('.sb-folder-title').textContent = folder.title;
    return element;
  },

  updateSidebarActive() {
    const split = this.splitPair || [];
    for (const tab of this.tabs) {
      tab.element?.classList.toggle('in-split', split.includes(tab.id));
    }
    const active = this.tabs.find(t => t.id === this.activeTabId);
    if (active && this.layout === 'sidebar' && this.sidebar?.contains(active.element)) {
      active.element.scrollIntoView({ block: 'nearest' });
    }
  },

  // Space header, space switcher dots and the window tint.
  renderSpaceChrome() {
    if (!this.sidebar) return;
    const space = this.getFocusedSpace();
    const icon = document.getElementById('sb-space-icon');
    const title = document.getElementById('sb-space-name');
    if (icon) icon.textContent = space.icon || '•';
    if (title) title.textContent = space.title;
    if (this.tabbarSpace) {
      this.tabbarSpace.textContent = space.icon || '•';
      this.tabbarSpace.title = `${space.title} (click to switch space)`;
    }
    const root = document.documentElement;
    root.style.setProperty('--space-color', space.color);
    root.style.setProperty('--space-color-2', shade(space.color, 0.35));

    const ordered = sortByPosition(this.spaces);
    this.sbSpaceDots.replaceChildren(...ordered.map((entry, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'sb-space-dot' + (entry.id === space.id ? ' active' : '');
      dot.dataset.spaceId = entry.id;
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-selected', String(entry.id === space.id));
      dot.title = index < 9 ? `${entry.title} (Alt+${index + 1})` : entry.title;
      dot.style.setProperty('--dot-color', entry.color);
      dot.textContent = entry.icon || entry.title.slice(0, 1).toUpperCase();
      dot.addEventListener('click', () => this.focusSpace(entry.id));
      dot.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.showSpaceMenu(event.clientX, event.clientY, entry.id);
      });
      return dot;
    }));
  },

  // ---------- Spaces ----------

  getFocusedSpace() {
    return this.spaces.find(s => s.id === this.focusedSpaceId) || this.spaces[0];
  },

  getVisibleTabOrder() {
    return visibleOrder(this.tabs, this.sidebarFolders, this.focusedSpaceId)
      .filter(t => !t.element?.classList.contains('closing'));
  },

  focusSpace(spaceId, { activate = true } = {}) {
    const space = this.spaces.find(s => s.id === spaceId);
    if (!space) return;
    const previous = this.spaces.find(s => s.id === this.focusedSpaceId);
    const changed = spaceId !== this.focusedSpaceId;
    this.focusedSpaceId = spaceId;

    if (changed) {
      // A split pair from the old space ends when its tabs are no longer visible.
      if (this.splitPair?.some(id => {
        const tab = this.tabs.find(t => t.id === id);
        return tab && tab.spaceId && tab.spaceId !== spaceId;
      })) this.exitSplitView?.();
      this.placeTabElements();
      this.renderSpaceChrome();
      const direction = previous && (previous.position ?? 0) > (space.position ?? 0) ? 'sb-enter-left' : 'sb-enter-right';
      for (const element of [this.sbPinned, this.sbToday, document.getElementById('sb-space-head')]) {
        if (!element) continue;
        element.classList.remove('sb-enter-left', 'sb-enter-right');
        void element.offsetWidth;
        element.classList.add(direction);
      }
    }

    if (activate && changed) {
      const visible = this.getVisibleTabOrder();
      const remembered = visible.find(t => t.id === this.activeBySpace[spaceId]);
      const fallback = visible.find(t => t.section === 'today') || visible.find(t => t.section === 'pinned');
      if (remembered) this.switchTab(remembered.id);
      else if (fallback) this.switchTab(fallback.id);
      else this.createHomeTab();
    }
    this.saveSpacesSoon();
  },

  focusSpaceByIndex(index) {
    const ordered = sortByPosition(this.spaces);
    if (ordered[index]) this.focusSpace(ordered[index].id);
  },

  focusAdjacentSpace(step) {
    const ordered = sortByPosition(this.spaces);
    if (ordered.length < 2) return;
    const index = ordered.findIndex(s => s.id === this.focusedSpaceId);
    this.focusSpace(ordered[(index + step + ordered.length) % ordered.length].id);
  },

  createSpace({ title, icon, color }) {
    const space = {
      id: uid('s-'),
      title: (title || 'New Space').slice(0, 60),
      icon: icon || SPACE_ICONS[this.spaces.length % SPACE_ICONS.length],
      color: color || SPACE_COLORS[this.spaces.length % SPACE_COLORS.length],
      position: Math.max(-1, ...this.spaces.map(s => s.position ?? 0)) + 1
    };
    this.spaces.push(space);
    this.focusSpace(space.id);
    return space;
  },

  updateSpace(spaceId, patch) {
    const space = this.spaces.find(s => s.id === spaceId);
    if (!space) return;
    Object.assign(space, patch);
    this.renderSpaceChrome();
    this.saveSpacesSoon();
  },

  moveSpace(spaceId, step) {
    const ordered = sortByPosition(this.spaces);
    const index = ordered.findIndex(s => s.id === spaceId);
    const target = index + step;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    ordered.forEach((space, i) => { space.position = i; });
    this.renderSpaceChrome();
    this.saveSpacesSoon();
  },

  async deleteSpace(spaceId) {
    const space = this.spaces.find(s => s.id === spaceId);
    if (!space) return;
    if (this.spaces.length === 1) {
      this.showNotification?.('Cannot delete space', 'Shiira needs at least one space.');
      return;
    }
    const tabs = this.tabs.filter(t => t.spaceId === spaceId && !t.isHome);
    const ok = await this.showConfirmation(
      `Delete “${space.title}”?`,
      tabs.length ? `Its ${tabs.length} pinned and today tab${tabs.length === 1 ? '' : 's'} will close. This cannot be undone.` : 'This cannot be undone.',
      { confirmText: 'Delete Space', danger: true }
    );
    if (!ok) return;
    const next = sortByPosition(this.spaces).find(s => s.id !== spaceId);
    if (this.focusedSpaceId === spaceId) this.focusSpace(next.id);
    this.tabs.filter(t => t.spaceId === spaceId).forEach(t => this.closeTab(t.id, true));
    this.sidebarFolders = this.sidebarFolders.filter(f => f.spaceId !== spaceId);
    this.spaces = this.spaces.filter(s => s.id !== spaceId);
    delete this.activeBySpace[spaceId];
    this.archive.forEach(entry => { if (entry.spaceId === spaceId) entry.spaceId = null; });
    this.placeTabElements();
    this.renderSpaceChrome();
    this.saveSpacesSoon();
  },

  // ---------- Pinning, favorites, moving ----------

  currentTabUrl(tab) {
    if (!tab || tab.isHome) return '';
    try {
      const live = tab.webview?.getURL?.();
      if (live && live !== 'about:blank') return live;
    } catch (e) {
      // The webview has not attached yet.
    }
    return tab.pendingUrl || tab.url || '';
  },

  canPin(tab) {
    return Boolean(tab && !tab.isHome && !tab.privateMode && /^(https?|file):/i.test(this.currentTabUrl(tab)));
  },

  // Moves a tab to a section/folder/space, at an index among its new siblings.
  setTabPlacement(tab, { section, spaceId, parentId = null, index = Infinity }) {
    const previous = tab.section;
    tab.section = section;
    tab.spaceId = section === 'favorites' ? null : (spaceId || this.focusedSpaceId);
    tab.parentId = section === 'pinned' ? parentId : null;
    if (section === 'today') {
      tab.pinnedUrl = null;
    } else if (previous === 'today' || !tab.pinnedUrl) {
      tab.pinnedUrl = this.currentTabUrl(tab) || null;
    }
    const list = siblings(this.tabs, this.sidebarFolders, { section, spaceId: tab.spaceId, parentId: tab.parentId });
    insertAt(list, { kind: 'tab', id: tab.id, ref: tab }, index);
  },

  togglePin(tabId = this.activeTabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.section === 'today') {
      if (!this.canPin(tab)) {
        this.setStatus?.(tab.privateMode ? 'Private tabs cannot be pinned.' : 'Open a page first, then pin it.', 2500);
        return;
      }
      this.setTabPlacement(tab, { section: 'pinned', spaceId: tab.spaceId || this.focusedSpaceId });
      this.setStatus?.('Tab pinned', 1500);
    } else {
      this.setTabPlacement(tab, { section: 'today', spaceId: tab.spaceId || this.focusedSpaceId, index: 0 });
      this.setStatus?.(tab.section === 'favorites' ? 'Removed from favorites' : 'Tab unpinned', 1500);
    }
    this.afterStructureChange();
  },

  toggleFavorite(tabId = this.activeTabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.section === 'favorites') {
      this.setTabPlacement(tab, { section: 'today', spaceId: this.focusedSpaceId, index: 0 });
    } else {
      if (!this.canPin(tab)) {
        this.setStatus?.('This tab cannot be a favorite.', 2500);
        return;
      }
      this.setTabPlacement(tab, { section: 'favorites' });
    }
    this.afterStructureChange();
  },

  moveTabToSpace(tabId, spaceId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !this.spaces.some(s => s.id === spaceId)) return;
    const section = tab.section === 'favorites' ? 'today' : tab.section;
    this.setTabPlacement(tab, { section, spaceId, index: section === 'today' ? 0 : Infinity });
    this.afterStructureChange();
  },

  // After a move: if the tab on screen left this space, show another one.
  afterStructureChange() {
    const active = this.tabs.find(t => t.id === this.activeTabId);
    if (active && active.section !== 'favorites' && active.spaceId !== this.focusedSpaceId) {
      const next = this.getVisibleTabOrder().find(t => t.id !== active.id);
      if (next) this.switchTab(next.id);
      else this.createHomeTab();
    }
    this.placeTabElements();
    this.saveSpacesSoon();
  },

  resetPinnedTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab?.pinnedUrl) return;
    if (tab.webview) tab.webview.src = tab.pinnedUrl;
    else {
      tab.pendingUrl = tab.pinnedUrl;
      this.switchTab(tab.id);
    }
  },

  setPinnedUrlToCurrent(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    const url = this.currentTabUrl(tab);
    if (!tab || !url) return;
    tab.pinnedUrl = url;
    this.saveSpacesSoon();
    this.setStatus?.('Pinned page updated', 1500);
  },

  async renameTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.isHome) return;
    const name = await this.showPrompt('Rename Tab', 'A name for this tab. Use “Reset Name” to show the page title again.', tab.customTitle || tab.title || '', { confirmText: 'Rename' });
    if (!name) return;
    tab.customTitle = name.slice(0, 120);
    this.updateTabTitle(tab.id, tab.title || name);
    this.saveSpacesSoon();
  },

  resetTabName(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.customTitle = '';
    this.updateTabTitle(tab.id, tab.title || 'New Tab');
    this.saveSpacesSoon();
  },

  deleteSidebarTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    this.closeTab(tabId);
  },

  copyTabUrl(tabId = this.activeTabId) {
    const url = this.currentTabUrl(this.tabs.find(t => t.id === tabId));
    if (!url) return;
    navigator.clipboard.writeText(url)
      .then(() => this.setStatus?.('Link copied', 1500))
      .catch(() => this.setStatus?.('Could not copy the link', 2000));
  },

  // ---------- Folders ----------

  async createSidebarFolder({ parentId = null, withTabId = null } = {}) {
    const title = await this.showPrompt('New Folder', 'Folders keep pinned tabs together.', 'New Folder', { confirmText: 'Create' });
    if (!title) return;
    const folder = {
      id: uid('f-'),
      spaceId: this.focusedSpaceId,
      parentId,
      title: title.slice(0, 120),
      collapsed: false,
      position: Infinity
    };
    this.sidebarFolders.push(folder);
    insertAt(siblings(this.tabs, this.sidebarFolders, { section: 'pinned', spaceId: folder.spaceId, parentId }), { kind: 'folder', id: folder.id, ref: folder }, Infinity);
    const tab = this.tabs.find(t => t.id === withTabId);
    if (tab && (tab.section !== 'today' || this.canPin(tab))) {
      this.setTabPlacement(tab, { section: 'pinned', spaceId: folder.spaceId, parentId: folder.id });
    }
    this.afterStructureChange();
  },

  toggleSidebarFolder(folderId) {
    const folder = this.sidebarFolders.find(f => f.id === folderId);
    if (!folder) return;
    folder.collapsed = !folder.collapsed;
    this.getFolderElement(folder);
    this.saveSpacesSoon();
  },

  async renameSidebarFolder(folderId) {
    const folder = this.sidebarFolders.find(f => f.id === folderId);
    if (!folder) return;
    const title = await this.showPrompt('Rename Folder', '', folder.title, { confirmText: 'Rename' });
    if (!title) return;
    folder.title = title.slice(0, 120);
    this.getFolderElement(folder);
    this.saveSpacesSoon();
  },

  // The folder goes away; whatever was inside takes its place.
  deleteSidebarFolder(folderId) {
    const folder = this.sidebarFolders.find(f => f.id === folderId);
    if (!folder) return;
    const inside = siblings(this.tabs, this.sidebarFolders, { section: 'pinned', spaceId: folder.spaceId, parentId: folder.id });
    inside.forEach((entry, i) => {
      entry.ref.parentId = folder.parentId || null;
      entry.ref.position = (folder.position ?? 0) + (i + 1) / (inside.length + 1);
    });
    this.sidebarFolders = this.sidebarFolders.filter(f => f.id !== folderId);
    this.folderElements.get(folderId)?.remove();
    this.folderElements.delete(folderId);
    this.placeTabElements();
    this.saveSpacesSoon();
  },

  // ---------- Drag and drop ----------

  setupSidebarDragAndDrop() {
    const sidebar = this.sidebar;
    sidebar.addEventListener('dragstart', (event) => {
      const tabElement = event.target.closest?.('.tab');
      const folderRow = event.target.closest?.('.sb-folder-row');
      if (tabElement && sidebar.contains(tabElement)) this.sbDrag = { kind: 'tab', id: tabElement.dataset.tabId };
      else if (folderRow) this.sbDrag = { kind: 'folder', id: folderRow.dataset.folderId };
      else return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(this.sbDrag));
      const tab = this.sbDrag.kind === 'tab' && this.tabs.find(t => t.id === this.sbDrag.id);
      const url = tab && this.currentTabUrl(tab);
      if (url) event.dataTransfer.setData('text/uri-list', url);
      document.body.classList.add('sb-dragging');
    });
    sidebar.addEventListener('dragover', (event) => {
      if (!this.sbDrag) return;
      const target = this.resolveDropTarget(event);
      this.clearDropHints();
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      target.hintElement?.classList.add(`drop-${target.hint}`);
    });
    sidebar.addEventListener('dragleave', (event) => {
      if (!sidebar.contains(event.relatedTarget)) this.clearDropHints();
    });
    sidebar.addEventListener('drop', (event) => {
      if (!this.sbDrag) return;
      event.preventDefault();
      const target = this.resolveDropTarget(event);
      this.clearDropHints();
      if (target) this.moveSidebarItem(this.sbDrag, target);
      this.sbDrag = null;
    });
    sidebar.addEventListener('dragend', () => {
      this.clearDropHints();
      this.sbDrag = null;
      document.body.classList.remove('sb-dragging');
    });
  },

  clearDropHints() {
    this.sidebar.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach((element) => {
      element.classList.remove('drop-before', 'drop-after', 'drop-inside');
    });
  },

  resolveDropTarget(event) {
    const drag = this.sbDrag;
    if (!drag) return null;
    const draggedTab = drag.kind === 'tab' ? this.tabs.find(t => t.id === drag.id) : null;
    const draggedFolder = drag.kind === 'folder' ? this.sidebarFolders.find(f => f.id === drag.id) : null;
    if (!draggedTab && !draggedFolder) return null;
    // Home and private tabs stay in today; they can still be reordered or sent to another space.
    const todayOnly = draggedTab && (draggedTab.isHome || draggedTab.privateMode || !this.canPin(draggedTab));
    const allowed = (section) => (draggedFolder ? section === 'pinned' : !todayOnly || section === 'today');

    const dot = event.target.closest('.sb-space-dot[data-space-id]');
    if (dot) {
      const section = draggedFolder ? 'pinned' : (draggedTab.section === 'favorites' ? 'today' : draggedTab.section);
      return { section, spaceId: dot.dataset.spaceId, parentId: null, index: section === 'today' ? 0 : Infinity, hintElement: dot, hint: 'inside' };
    }

    const tabElement = event.target.closest('.tab');
    const folderRow = event.target.closest('.sb-folder-row');
    const row = tabElement || folderRow;
    if (row && this.sidebar.contains(row)) {
      let context;
      let key;
      if (tabElement) {
        const tab = this.tabs.find(t => t.id === tabElement.dataset.tabId);
        if (!tab) return null;
        context = { section: tab.section, spaceId: tab.spaceId || this.focusedSpaceId, parentId: tab.parentId || null };
        key = { kind: 'tab', id: tab.id };
      } else {
        const folder = this.sidebarFolders.find(f => f.id === folderRow.dataset.folderId);
        if (!folder) return null;
        context = { section: 'pinned', spaceId: folder.spaceId, parentId: folder.parentId || null };
        key = { kind: 'folder', id: folder.id };
      }
      if (key.kind === drag.kind && key.id === drag.id) return null;
      const rect = row.getBoundingClientRect();
      const ratio = context.section === 'favorites'
        ? (event.clientX - rect.left) / rect.width
        : (event.clientY - rect.top) / rect.height;

      if (folderRow && ratio > 0.28 && ratio < 0.72) {
        const target = { section: 'pinned', spaceId: context.spaceId, parentId: key.id, index: 0, hintElement: row, hint: 'inside' };
        if (!allowed('pinned') || (draggedFolder && isInsideFolder(this.sidebarFolders, key.id, draggedFolder.id))) return null;
        return target;
      }
      if (!allowed(context.section)) return null;
      if (draggedFolder && context.parentId && isInsideFolder(this.sidebarFolders, context.parentId, draggedFolder.id)) return null;
      const list = siblings(this.tabs, this.sidebarFolders, context).filter(e => !(e.kind === drag.kind && e.id === drag.id));
      const position = list.findIndex(e => e.kind === key.kind && e.id === key.id);
      const before = ratio < 0.5;
      return { ...context, index: before ? position : position + 1, hintElement: row, hint: before ? 'before' : 'after' };
    }

    const zone = event.target.closest('[data-drop-section]');
    if (zone && allowed(zone.dataset.dropSection)) {
      const section = zone.dataset.dropSection;
      return { section, spaceId: this.focusedSpaceId, parentId: null, index: section === 'today' ? Infinity : Infinity, hintElement: zone, hint: 'inside' };
    }
    return null;
  },

  moveSidebarItem(drag, target) {
    if (drag.kind === 'tab') {
      const tab = this.tabs.find(t => t.id === drag.id);
      if (!tab) return;
      this.setTabPlacement(tab, target);
    } else {
      const folder = this.sidebarFolders.find(f => f.id === drag.id);
      if (!folder || target.section !== 'pinned') return;
      if (target.parentId && isInsideFolder(this.sidebarFolders, target.parentId, folder.id)) return;
      if (target.spaceId !== folder.spaceId) {
        const tree = new Set(folderTree(this.sidebarFolders, folder.id));
        this.sidebarFolders.forEach(f => { if (tree.has(f.id)) f.spaceId = target.spaceId; });
        this.tabs.forEach(t => { if (t.section === 'pinned' && tree.has(t.parentId)) t.spaceId = target.spaceId; });
      }
      folder.parentId = target.parentId || null;
      const list = siblings(this.tabs, this.sidebarFolders, { section: 'pinned', spaceId: target.spaceId, parentId: folder.parentId });
      insertAt(list, { kind: 'folder', id: folder.id, ref: folder }, target.index);
    }
    this.afterStructureChange();
  },

  // ---------- Menus ----------

  showSidebarMenu(x, y, entries) {
    const menu = this.sidebarMenu;
    if (!menu) return;
    this.tabContextMenu?.classList.add('hidden');
    menu.replaceChildren();
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.separator) {
        if (menu.lastElementChild && !menu.lastElementChild.classList.contains('context-menu-separator')) {
          const separator = document.createElement('div');
          separator.className = 'context-menu-separator';
          menu.appendChild(separator);
        }
        continue;
      }
      const item = document.createElement('div');
      item.className = 'context-menu-item' + (entry.danger ? ' sb-menu-danger' : '') + (entry.disabled ? ' disabled' : '');
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `<span class="sb-menu-label">${escapeHtml(entry.label)}</span>${entry.hint ? `<span class="sb-menu-hint">${escapeHtml(entry.hint)}</span>` : ''}`;
      if (!entry.disabled) {
        item.addEventListener('click', () => {
          this.hideSidebarMenu();
          entry.action();
        });
      }
      menu.appendChild(item);
    }
    if (menu.lastElementChild?.classList.contains('context-menu-separator')) menu.lastElementChild.remove();
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.remove('hidden');
    // Keep the menu inside the window.
    requestAnimationFrame(() => {
      const width = menu.offsetWidth || 220;
      const height = Math.min(menu.scrollHeight, window.innerHeight * 0.8);
      menu.style.left = `${clamp(x, 4, window.innerWidth - width - 4)}px`;
      menu.style.top = `${clamp(y, 4, window.innerHeight - height - 4)}px`;
    });
  },

  hideSidebarMenu() {
    this.sidebarMenu?.classList.add('hidden');
  },

  showTabMenu(x, y, tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const url = this.currentTabUrl(tab);
    const isWeb = /^https?:/i.test(url);
    const pinnable = this.canPin(tab);
    const inSplit = this.splitPair?.includes(tabId);
    const otherSpaces = sortByPosition(this.spaces).filter(s => s.id !== tab.spaceId);
    const keep = tab.section === 'pinned' || tab.section === 'favorites';

    this.showSidebarMenu(x, y, [
      { label: 'New Tab', hint: 'Ctrl+T', action: () => this.createTab(null, { position: tab.section === 'today' ? tab.position + 0.5 : undefined }) },
      { separator: true },
      tab.webview && { label: 'Reload', action: () => this.reloadTab(tabId) },
      isWeb && { label: 'Duplicate', action: () => this.duplicateTab(tabId) },
      tab.webview && { label: tab.isMuted ? 'Unmute Tab' : 'Mute Tab', action: () => this.toggleTabMute(tabId) },
      isWeb && { label: 'Copy Link', hint: tabId === this.activeTabId ? 'Ctrl+Shift+C' : '', action: () => this.copyTabUrl(tabId) },
      { separator: true },
      tab.section === 'today' && pinnable && { label: 'Pin Tab', hint: 'Ctrl+D', action: () => this.togglePin(tabId) },
      tab.section === 'pinned' && { label: 'Unpin Tab', hint: 'Ctrl+D', action: () => this.togglePin(tabId) },
      tab.section !== 'favorites' && pinnable && { label: 'Add to Favorites', action: () => this.toggleFavorite(tabId) },
      tab.section === 'favorites' && { label: 'Remove from Favorites', action: () => this.toggleFavorite(tabId) },
      tab.section === 'pinned' && { label: 'Add to New Folder…', action: () => this.createSidebarFolder({ withTabId: tabId }) },
      keep && tab.pinnedUrl && url && url !== tab.pinnedUrl && { label: 'Go Back to Pinned Page', action: () => this.resetPinnedTab(tabId) },
      keep && url && url !== tab.pinnedUrl && { label: 'Make This the Pinned Page', action: () => this.setPinnedUrlToCurrent(tabId) },
      !tab.isHome && { label: 'Rename Tab…', action: () => this.renameTab(tabId) },
      tab.customTitle && { label: 'Reset Name', action: () => this.resetTabName(tabId) },
      { separator: true },
      !inSplit && !tab.isHome && tabId !== this.activeTabId && { label: 'Open in Split View', action: () => this.openSplitView?.(tabId) },
      inSplit && { label: 'Exit Split View', action: () => this.exitSplitView?.() },
      ...(tab.section !== 'favorites' ? otherSpaces.map(space => ({ label: `Move to ${space.icon || ''} ${space.title}`.replace(/\s+/g, ' '), action: () => this.moveTabToSpace(tabId, space.id) })) : []),
      isWeb && !tab.privateMode && { label: 'Move Tab to New Window', action: () => this.moveTabToNewWindow(tabId) },
      { separator: true },
      keep
        ? { label: 'Unload Tab', hint: 'Ctrl+W', action: () => this.unloadTab(tabId) }
        : { label: 'Close Tab', hint: 'Ctrl+W', action: () => this.closeTab(tabId) },
      tab.section === 'today' && { label: 'Close Other Today Tabs', action: () => this.closeOtherTabs(tabId) },
      keep && { label: tab.section === 'favorites' ? 'Delete Favorite' : 'Delete Pinned Tab', danger: true, action: () => this.deleteSidebarTab(tabId) }
    ]);
  },

  showFolderMenu(x, y, folderId) {
    const folder = this.sidebarFolders.find(f => f.id === folderId);
    if (!folder) return;
    this.showSidebarMenu(x, y, [
      { label: folder.collapsed ? 'Expand' : 'Collapse', action: () => this.toggleSidebarFolder(folderId) },
      { label: 'Rename Folder…', action: () => this.renameSidebarFolder(folderId) },
      { label: 'New Folder Inside…', action: () => this.createSidebarFolder({ parentId: folderId }) },
      { separator: true },
      { label: 'Delete Folder', danger: true, action: () => this.deleteSidebarFolder(folderId) }
    ]);
  },

  showSpaceMenu(x, y, spaceId) {
    const space = this.spaces.find(s => s.id === spaceId);
    if (!space) return;
    const ordered = sortByPosition(this.spaces);
    const index = ordered.findIndex(s => s.id === spaceId);
    this.showSidebarMenu(x, y, [
      spaceId !== this.focusedSpaceId && { label: `Go to ${space.title}`, action: () => this.focusSpace(spaceId) },
      { label: 'Edit Space…', action: () => this.openSpaceEditor('edit', spaceId) },
      { label: 'New Space…', action: () => this.openSpaceEditor('new') },
      { label: 'New Folder…', action: () => this.createSidebarFolder() },
      { separator: true },
      index > 0 && { label: 'Move Space Left', action: () => this.moveSpace(spaceId, -1) },
      index < ordered.length - 1 && { label: 'Move Space Right', action: () => this.moveSpace(spaceId, 1) },
      { separator: true },
      { label: 'Delete Space…', danger: true, disabled: this.spaces.length === 1, action: () => this.deleteSpace(spaceId) }
    ]);
  },

  showSpaceSwitcherMenu(x, y) {
    this.showSidebarMenu(x, y, [
      ...sortByPosition(this.spaces).map((space, i) => ({
        label: `${space.id === this.focusedSpaceId ? '● ' : ''}${space.icon || ''} ${space.title}`.trim(),
        hint: i < 9 ? `Alt+${i + 1}` : '',
        action: () => this.focusSpace(space.id)
      })),
      { separator: true },
      { label: 'New Space…', action: () => this.openSpaceEditor('new') },
      { label: 'Use Vertical Sidebar', action: () => this.setLayout('sidebar') }
    ]);
  },

  showSidebarAreaMenu(x, y) {
    this.showSidebarMenu(x, y, [
      { label: 'New Tab', hint: 'Ctrl+T', action: () => this.openCommandBar?.() ?? this.createTab() },
      { label: 'New Folder…', action: () => this.createSidebarFolder() },
      { label: 'New Space…', action: () => this.openSpaceEditor('new') },
      { separator: true },
      { label: 'Archived Tabs', hint: 'Ctrl+Shift+A', action: () => this.showArchivePanel() },
      { label: 'Import from Arc…', action: () => this.importFromArc() },
      { separator: true },
      { label: 'Hide Sidebar', hint: 'Ctrl+S', action: () => this.toggleSidebar() },
      { label: 'Use Top Tabs Layout', action: () => this.setLayout('tabs') }
    ]);
  },

  // ---------- Sleep and archive ----------

  getArchiveHours() {
    return readNumber(KEYS.archiveHours, 12);
  },

  getSleepMinutes() {
    return readNumber(KEYS.sleepMinutes, 30);
  },

  // Frees a tab's page process; it reloads when opened. Pinned tabs go back to their pinned page.
  sleepTab(tab, { force = false, resetToPinned = false } = {}) {
    if (!tab?.webview || tab.isHome || tab.privateMode) return false;
    if (!force && (tab.id === this.activeTabId || this.splitPair?.includes(tab.id))) return false;
    let url = this.currentTabUrl(tab);
    if (resetToPinned && tab.pinnedUrl) url = tab.pinnedUrl;
    if (!force && (!url || url === 'about:blank')) return false;
    if (this.splitPair?.includes(tab.id)) this.exitSplitView?.();
    if (tab.audioCheckInterval) {
      clearInterval(tab.audioCheckInterval);
      tab.audioCheckInterval = null;
    }
    tab.webview.remove();
    tab.webview = null;
    tab.isPlayingAudio = false;
    tab.adsBlocked = 0;
    this.updateTabAudioIcon(tab.id);
    tab.pendingUrl = url || null;
    if (url) tab.url = url;
    tab.element.classList.remove('loading');
    tab.element.classList.add('tab-suspended');
    return true;
  },

  unloadTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.isHome) return;
    if (tabId === this.activeTabId) {
      const next = this.pickNextTab(tab);
      if (next) this.switchTab(next.id);
      else this.createHomeTab();
    }
    this.sleepTab(tab, { force: true, resetToPinned: true });
    this.saveSpacesSoon();
  },

  runTabMaintenance() {
    const now = Date.now();
    const activeIds = [this.activeTabId, ...(this.splitPair || [])].filter(Boolean);
    const hours = this.getArchiveHours();
    const minutes = this.getSleepMinutes();
    let archived = 0;
    for (const tab of [...this.tabs]) {
      if (tab.element?.classList.contains('closing')) continue;
      if (shouldArchive(tab, { now, hours, activeIds })) {
        this.archiveTab(tab.id);
        archived++;
      } else if (shouldSleep(tab, { now, minutes, activeIds })) {
        this.sleepTab(tab);
      }
    }
    if (archived) this.setStatus?.(`${archived} idle tab${archived === 1 ? '' : 's'} moved to the archive`, 3000);
  },

  archiveTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const url = this.currentTabUrl(tab);
    if (url && !tab.privateMode && /^(https?|file):/i.test(url)) {
      this.archive = this.archive.filter(entry => entry.url !== url);
      this.archive.unshift({ url, title: tab.customTitle || tab.title || url, favicon: tab.favicon || null, spaceId: tab.spaceId, archivedAt: Date.now() });
      this.archive.length = Math.min(this.archive.length, MAX_ARCHIVE);
    }
    this.closeTab(tabId, true);
    this.saveSpacesSoon();
  },

  // Arc's "Clear": today tabs of this space go to the archive.
  clearTodayTabs() {
    const today = this.tabs.filter(t => t.section === 'today' && t.spaceId === this.focusedSpaceId && !t.isHome);
    today.forEach(t => this.archiveTab(t.id));
    if (today.length) this.setStatus?.(`${today.length} tab${today.length === 1 ? '' : 's'} archived`, 2000);
  },

  initArchivePanel() {
    this.archivePanel = document.getElementById('archive-panel');
    this.archiveList = document.getElementById('archive-list');
    this.archiveSearch = document.getElementById('archive-search');
    if (!this.archivePanel) return;
    document.getElementById('archive-close')?.addEventListener('click', () => this.hideArchivePanel());
    document.getElementById('archive-clear')?.addEventListener('click', async () => {
      if (!this.archive.length) return;
      const ok = await this.showConfirmation('Clear the archive?', `${this.archive.length} archived tab${this.archive.length === 1 ? '' : 's'} will be forgotten.`, { confirmText: 'Clear Archive', danger: true });
      if (!ok) return;
      this.archive = [];
      this.renderArchive();
      this.saveSpacesSoon();
    });
    this.archivePanel.addEventListener('click', (event) => {
      if (event.target === this.archivePanel) this.hideArchivePanel();
    });
    this.archiveSearch?.addEventListener('input', () => this.renderArchive());
  },

  showArchivePanel() {
    if (!this.archivePanel) return;
    this.closeAllPopups?.();
    this.archiveSearch.value = '';
    this.renderArchive();
    this.archivePanel.classList.remove('hidden');
    this.archiveSearch.focus();
  },

  hideArchivePanel() {
    this.archivePanel?.classList.add('hidden');
  },

  renderArchive() {
    if (!this.archiveList) return;
    const query = (this.archiveSearch?.value || '').trim().toLowerCase();
    const entries = this.archive
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !query || `${entry.title} ${entry.url}`.toLowerCase().includes(query));
    const hours = this.getArchiveHours();
    document.getElementById('archive-note').textContent = hours > 0
      ? `Today tabs you have not opened for ${hours} hour${hours === 1 ? '' : 's'} come here. Change this in Settings > Tab Management.`
      : 'Automatic archiving is off. Tabs cleared from Today still come here.';
    if (!entries.length) {
      this.archiveList.innerHTML = `<p class="archive-empty">${query ? 'No archived tabs match.' : 'Nothing archived yet.'}</p>`;
      return;
    }
    this.archiveList.replaceChildren(...entries.slice(0, 200).map(({ entry, index }) => {
      const row = document.createElement('div');
      row.className = 'archive-row';
      const space = this.spaces.find(s => s.id === entry.spaceId);
      const { letter, hue } = letterIcon(entry.url, entry.title);
      row.innerHTML = `
        <button type="button" class="archive-open" title="${escapeHtml(entry.url)}">
          ${entry.favicon ? `<img class="archive-favicon" src="${escapeHtml(entry.favicon)}" alt="">` : `<span class="archive-favicon letter-icon" style="background:hsl(${hue} 45% 46%)">${escapeHtml(letter)}</span>`}
          <span class="archive-text">
            <span class="archive-title">${escapeHtml(entry.title || entry.url)}</span>
            <span class="archive-meta">${escapeHtml(hostOf(entry.url))} · ${escapeHtml(timeAgo(entry.archivedAt))}${space ? ` · ${escapeHtml(space.icon || '')} ${escapeHtml(space.title)}` : ''}</span>
          </span>
        </button>
        <button type="button" class="archive-remove" title="Forget" aria-label="Forget this tab">×</button>`;
      row.querySelector('.archive-favicon')?.addEventListener('error', (event) => event.currentTarget.remove());
      row.querySelector('.archive-open').addEventListener('click', () => this.restoreArchived(index));
      row.querySelector('.archive-remove').addEventListener('click', () => {
        this.archive.splice(index, 1);
        this.renderArchive();
        this.saveSpacesSoon();
      });
      return row;
    }));
  },

  restoreArchived(index) {
    const entry = this.archive[index];
    if (!entry) return;
    this.archive.splice(index, 1);
    const spaceId = this.spaces.some(s => s.id === entry.spaceId) ? entry.spaceId : this.focusedSpaceId;
    this.hideArchivePanel();
    this.createTab(entry.url, { spaceId, title: entry.title, favicon: entry.favicon });
    this.saveSpacesSoon();
  },

  // ---------- Space editor ----------

  initSpaceEditor() {
    this.spaceEditor = document.getElementById('space-editor');
    if (!this.spaceEditor) return;
    const icons = document.getElementById('space-icons');
    icons.replaceChildren(...SPACE_ICONS.map(icon => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'space-icon-choice';
      button.textContent = icon;
      button.dataset.icon = icon;
      button.addEventListener('click', () => this.setSpaceEditorValue({ icon }));
      return button;
    }));
    const colors = document.getElementById('space-colors');
    colors.replaceChildren(...SPACE_COLORS.map(color => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'space-color-choice';
      button.style.background = color;
      button.dataset.color = color;
      button.title = color;
      button.setAttribute('aria-label', `Colour ${color}`);
      button.addEventListener('click', () => this.setSpaceEditorValue({ color }));
      return button;
    }));
    document.getElementById('space-icon-custom')?.addEventListener('input', (event) => {
      const value = [...event.target.value.trim()].slice(0, 2).join('');
      if (value) this.setSpaceEditorValue({ icon: value }, { keepCustom: true });
    });
    document.getElementById('space-color-custom')?.addEventListener('input', (event) => this.setSpaceEditorValue({ color: event.target.value }));
    document.getElementById('space-editor-cancel')?.addEventListener('click', () => this.hideSpaceEditor());
    document.getElementById('space-editor-save')?.addEventListener('click', () => this.saveSpaceEditor());
    document.getElementById('space-editor-delete')?.addEventListener('click', () => {
      const id = this.spaceEditorState?.spaceId;
      this.hideSpaceEditor();
      if (id) this.deleteSpace(id);
    });
    document.getElementById('space-name')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.saveSpaceEditor();
    });
    this.spaceEditor.addEventListener('click', (event) => {
      if (event.target === this.spaceEditor) this.hideSpaceEditor();
    });
  },

  openSpaceEditor(mode, spaceId = null) {
    if (!this.spaceEditor) return;
    this.closeAllPopups?.();
    const space = mode === 'edit' ? this.spaces.find(s => s.id === spaceId) : null;
    const index = this.spaces.length;
    this.spaceEditorState = {
      mode: space ? 'edit' : 'new',
      spaceId: space?.id || null,
      title: space?.title || '',
      icon: space?.icon || SPACE_ICONS[index % SPACE_ICONS.length],
      color: space?.color || SPACE_COLORS[index % SPACE_COLORS.length]
    };
    document.getElementById('space-editor-title').textContent = space ? 'Edit Space' : 'New Space';
    document.getElementById('space-editor-save').textContent = space ? 'Save' : 'Create Space';
    document.getElementById('space-editor-delete').classList.toggle('hidden', !space || this.spaces.length === 1);
    document.getElementById('space-name').value = this.spaceEditorState.title;
    document.getElementById('space-icon-custom').value = '';
    this.setSpaceEditorValue({});
    this.spaceEditor.classList.remove('hidden');
    document.getElementById('space-name').focus();
  },

  setSpaceEditorValue(patch, { keepCustom = false } = {}) {
    Object.assign(this.spaceEditorState, patch);
    const { icon, color } = this.spaceEditorState;
    document.querySelectorAll('.space-icon-choice').forEach(b => b.classList.toggle('active', b.dataset.icon === icon));
    document.querySelectorAll('.space-color-choice').forEach(b => b.classList.toggle('active', b.dataset.color === color));
    const custom = document.getElementById('space-color-custom');
    if (custom && /^#[0-9a-f]{6}$/i.test(color)) custom.value = color;
    if (!keepCustom && patch.icon) document.getElementById('space-icon-custom').value = '';
    const preview = document.getElementById('space-preview');
    if (preview) {
      preview.textContent = icon;
      preview.style.background = `linear-gradient(135deg, ${color}, ${shade(color, 0.35)})`;
    }
  },

  saveSpaceEditor() {
    const state = this.spaceEditorState;
    if (!state) return;
    const title = document.getElementById('space-name').value.trim() || (state.mode === 'new' ? 'New Space' : 'Space');
    const color = /^#[0-9a-f]{6}$/i.test(state.color) ? state.color.toLowerCase() : SPACE_COLORS[0];
    this.hideSpaceEditor();
    if (state.mode === 'edit') this.updateSpace(state.spaceId, { title: title.slice(0, 60), icon: state.icon, color });
    else this.createSpace({ title, icon: state.icon, color });
  },

  hideSpaceEditor() {
    this.spaceEditor?.classList.add('hidden');
  },

  // ---------- Persistence ----------

  serializeSpaces() {
    const keepers = this.tabs.filter(t => (t.section === 'pinned' || t.section === 'favorites') && !t.privateMode && !t.isHome && !t.element?.classList.contains('closing'));
    const activeBySpace = {};
    for (const [spaceId, tabId] of Object.entries(this.activeBySpace)) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab && !tab.privateMode && !tab.isHome) activeBySpace[spaceId] = tab.itemId;
    }
    return {
      version: 1,
      focusedSpaceId: this.focusedSpaceId,
      spaces: this.spaces.map(({ id, title, icon, color, position }) => ({ id, title, icon, color, position })),
      folders: this.sidebarFolders.map(({ id, spaceId, parentId, title, collapsed, position }) => ({ id, spaceId, parentId: parentId || null, title, collapsed: Boolean(collapsed), position })),
      items: keepers.map(t => ({
        id: t.itemId,
        spaceId: t.spaceId,
        section: t.section,
        parentId: t.parentId || null,
        url: this.currentTabUrl(t) || t.pinnedUrl,
        pinnedUrl: t.pinnedUrl,
        title: t.title,
        customTitle: t.customTitle || '',
        favicon: t.favicon || null,
        position: t.position
      })),
      archive: this.archive,
      activeBySpace
    };
  },

  saveSpacesSoon() {
    if (!this.spacesLoaded || this.spacesReadOnly) return;
    clearTimeout(this.saveSpacesTimer);
    this.saveSpacesTimer = setTimeout(() => void this.saveSpacesNow(), 500);
  },

  async saveSpacesNow() {
    if (!this.spacesLoaded || this.spacesReadOnly) return;
    clearTimeout(this.saveSpacesTimer);
    try {
      const result = await window.shiiraAPI.spaces.save(this.serializeSpaces());
      if (!result?.success) console.warn('[Spaces] Save failed:', result?.error);
    } catch (error) {
      console.error('[Spaces] Save failed:', error);
    }
  },

  // Loads spaces, folders, pinned tabs and favorites. Pinned tabs and favorites start asleep.
  async loadSpaces() {
    let doc = null;
    try {
      // Only the first window owns the saved sidebar, so two windows never overwrite each other.
      const windows = await window.shiiraAPI.session.getWindowCount();
      if (windows > 1) this.spacesReadOnly = true;
      else doc = await window.shiiraAPI.spaces.load();
    } catch (error) {
      console.error('[Spaces] Load failed:', error);
    }

    if (doc?.spaces?.length) {
      this.spaces = doc.spaces;
      this.sidebarFolders = doc.folders || [];
      this.archive = doc.archive || [];
      const known = new Set(this.spaces.map(s => s.id));
      const focused = known.has(doc.focusedSpaceId) ? doc.focusedSpaceId : this.spaces[0].id;
      // Tabs opened before the sidebar loaded (a link from another app) join the saved space.
      this.tabs.forEach(t => { if (t.spaceId && !known.has(t.spaceId)) t.spaceId = focused; });
      this.focusedSpaceId = focused;
      for (const item of sortByPosition(doc.items || [])) {
        this.createTab(item.url, {
          deferLoad: true,
          title: item.title || hostOf(item.url) || item.url,
          favicon: item.favicon,
          section: item.section,
          spaceId: item.spaceId,
          parentId: item.parentId,
          position: item.position,
          itemId: item.id,
          customTitle: item.customTitle,
          pinnedUrl: item.pinnedUrl
        });
      }
      this.savedActiveItems = doc.activeBySpace || {};
    }
    this.spacesLoaded = true;
    this.applyLayout();
  },

  // After startup restore: show the tab that was on screen, or a fresh home tab.
  activateInitialTab({ legacyActiveItemId = null } = {}) {
    const visible = this.getVisibleTabOrder();
    const wanted = this.savedActiveItems?.[this.focusedSpaceId] || legacyActiveItemId;
    const remembered = wanted && visible.find(t => t.itemId === wanted);
    if (remembered && localStorage.getItem('shiira-restore-session') !== 'false') {
      this.switchTab(remembered.id);
    } else {
      const home = visible.find(t => t.isHome);
      if (home) this.switchTab(home.id);
      else this.createHomeTab();
    }
  },

  // ---------- Arc import ----------

  async importFromArc() {
    this.closeAllPopups?.();
    let found = await window.shiiraAPI.arc.locate();
    if (!found?.found) {
      const pick = await this.showConfirmation(
        'Arc was not found',
        'Shiira could not find Arc’s sidebar file on this computer. You can choose StorableSidebar.json yourself (on Windows it is in %LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_…\\LocalCache\\Local\\Arc).',
        { confirmText: 'Choose File…' }
      );
      if (!pick) return;
      found = await window.shiiraAPI.arc.chooseFile();
      if (found?.canceled) return;
    }
    if (found?.error || !found?.summary) {
      this.showError?.(found?.error || 'This file could not be read.', 'Arc import failed');
      return;
    }
    const s = found.summary;
    const ok = await this.showConfirmation(
      'Import from Arc',
      `Found ${s.spaces} space${s.spaces === 1 ? '' : 's'}, ${s.pinned} pinned tab${s.pinned === 1 ? '' : 's'}, ${s.folders} folder${s.folders === 1 ? '' : 's'} and ${s.favorites} favorite${s.favorites === 1 ? '' : 's'}.\nArc's files are only read, never changed.`,
      { confirmText: 'Import' }
    );
    if (!ok) return;
    let includeToday = false;
    if (s.today > 0) {
      includeToday = await this.showConfirmation(
        'Bring over Today tabs too?',
        `Arc also has ${s.today} unpinned tab${s.today === 1 ? '' : 's'}. They will open asleep in Today.`,
        { confirmText: 'Include Them', cancelText: 'Pinned Only' }
      );
    }
    const read = await window.shiiraAPI.arc.read(found.path);
    if (!read?.success) {
      this.showError?.(read?.error || 'The Arc sidebar could not be read.', 'Arc import failed');
      return;
    }
    const result = this.applyArcImport(read.plan, { includeToday });
    this.showSuccess?.(`Imported ${result.spaces} space${result.spaces === 1 ? '' : 's'} and ${result.tabs} tab${result.tabs === 1 ? '' : 's'}.`, 'Arc import complete');
  },

  applyArcImport(plan, { includeToday = false } = {}) {
    const existingFavoriteUrls = this.tabs.filter(t => t.section === 'favorites').map(t => this.currentTabUrl(t));
    const { spaces, folders, tabs } = planFromArc(plan, { existingSpaces: this.spaces, existingFavoriteUrls, includeToday });
    this.spaces.push(...spaces);
    this.sidebarFolders.push(...folders);
    for (const tab of tabs) {
      this.createTab(tab.url, {
        deferLoad: true,
        title: tab.title || hostOf(tab.url),
        section: tab.section,
        spaceId: tab.spaceId,
        parentId: tab.parentId,
        position: tab.position,
        itemId: tab.itemId
      });
    }
    if (spaces[0]) this.focusSpace(spaces[0].id);
    this.placeTabElements();
    this.renderSpaceChrome();
    this.saveSpacesSoon();
    return { spaces: spaces.length, tabs: tabs.length };
  }
};
