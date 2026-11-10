// Command bar (Ctrl+T in the sidebar layout): open a site, search, jump to any tab or space, or run an action.
// Modelled on Arc's command bar and Solamar's (https://github.com/Bambeek/solamar, GPL-3.0-or-later).

import { escapeHtml } from './utils.js';
import { hostOf, letterIcon, sortByPosition } from './spaces-model.js';

const MAX_RESULTS = 12;

function looksLikeAddress(text) {
  return /^(https?|shiira|file):\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text) || /^localhost(:\d+)?(\/\S*)?$/i.test(text);
}

function matches(query, ...fields) {
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return query.split(/\s+/).every(word => haystack.includes(word));
}

export const CommandBarMixin = {
  initCommandBar() {
    this.commandBar = document.getElementById('command-bar');
    this.commandInput = document.getElementById('command-bar-input');
    this.commandResults = document.getElementById('command-bar-results');
    if (!this.commandBar) return;
    this.commandItems = [];
    this.commandIndex = 0;
    this.commandSuggestions = [];

    this.commandInput.addEventListener('input', () => {
      this.commandIndex = 0;
      this.renderCommandResults();
      this.fetchCommandSuggestions();
    });
    this.commandInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault();
        this.moveCommandSelection(1);
      } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
        event.preventDefault();
        this.moveCommandSelection(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.runCommandItem(this.commandItems[this.commandIndex], { background: event.altKey });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.hideCommandBar();
      }
    });
    this.commandBar.addEventListener('mousedown', (event) => {
      if (event.target === this.commandBar) this.hideCommandBar();
    });
  },

  openCommandBar(text = '') {
    if (!this.commandBar) {
      this.createTab();
      return;
    }
    this.hideSidebarMenu?.();
    this.commandBar.classList.remove('hidden');
    this.commandInput.value = text;
    this.commandIndex = 0;
    this.commandSuggestions = [];
    this.renderCommandResults();
    this.commandInput.focus();
    this.commandInput.select();
  },

  hideCommandBar() {
    if (!this.commandBar || this.commandBar.classList.contains('hidden')) return;
    this.commandBar.classList.add('hidden');
    clearTimeout(this.commandSuggestTimer);
  },

  isCommandBarOpen() {
    return Boolean(this.commandBar && !this.commandBar.classList.contains('hidden'));
  },

  moveCommandSelection(step) {
    if (!this.commandItems.length) return;
    this.commandIndex = (this.commandIndex + step + this.commandItems.length) % this.commandItems.length;
    this.highlightCommandResult();
  },

  fetchCommandSuggestions() {
    clearTimeout(this.commandSuggestTimer);
    const query = this.commandInput.value.trim();
    if (!query || looksLikeAddress(query) || query.length < 2) {
      this.commandSuggestions = [];
      return;
    }
    this.commandSuggestTimer = setTimeout(async () => {
      try {
        const suggestions = await window.shiiraAPI.getUrlSuggestions(query);
        if (this.commandInput.value.trim() !== query) return;
        this.commandSuggestions = (Array.isArray(suggestions) ? suggestions : [])
          .filter(s => typeof s === 'string' && s.toLowerCase() !== query.toLowerCase())
          .slice(0, 3);
        this.renderCommandResults();
      } catch {
        this.commandSuggestions = [];
      }
    }, 160);
  },

  getCommandActions() {
    const active = this.tabs.find(t => t.id === this.activeTabId);
    const space = this.getFocusedSpace?.();
    const actions = [
      { label: 'New Space…', keywords: 'create add space', hint: '', run: () => this.openSpaceEditor('new') },
      space && { label: `Edit Space “${space.title}”…`, keywords: 'rename colour color icon emoji space theme', run: () => this.openSpaceEditor('edit', space.id) },
      this.layout === 'sidebar' && { label: this.sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar', keywords: 'toggle sidebar collapse', hint: 'Ctrl+S', run: () => this.toggleSidebar() },
      { label: this.layout === 'sidebar' ? 'Use Top Tabs Layout' : 'Use Vertical Sidebar Layout', keywords: 'layout tabs sidebar vertical horizontal arc classic', run: () => this.setLayout(this.layout === 'sidebar' ? 'tabs' : 'sidebar') },
      active && !active.isHome && { label: this.splitPair ? 'Exit Split View' : 'Split View with Next Tab', keywords: 'split view side by side', hint: 'Ctrl+Shift+\\', run: () => this.toggleSplitView() },
      active && active.section === 'today' && this.canPin?.(active) && { label: 'Pin Tab', keywords: 'pin keep', hint: 'Ctrl+D', run: () => this.togglePin(active.id) },
      active && active.section === 'pinned' && { label: 'Unpin Tab', keywords: 'unpin', hint: 'Ctrl+D', run: () => this.togglePin(active.id) },
      active && active.section !== 'favorites' && this.canPin?.(active) && { label: 'Add Tab to Favorites', keywords: 'favorite favourite star', run: () => this.toggleFavorite(active.id) },
      active && !active.isHome && { label: 'Copy Link', keywords: 'copy url address', hint: 'Ctrl+Shift+C', run: () => this.copyTabUrl(active.id) },
      { label: 'New Folder…', keywords: 'folder group pinned', run: () => this.createSidebarFolder() },
      { label: 'Clear Today Tabs', keywords: 'clear close archive today', run: () => this.clearTodayTabs() },
      { label: 'Archived Tabs', keywords: 'archive old closed', hint: 'Ctrl+Shift+A', run: () => this.showArchivePanel() },
      this.closedTabs?.length && { label: 'Reopen Closed Tab', keywords: 'reopen undo closed', hint: 'Ctrl+Shift+T', run: () => this.reopenClosedTab() },
      { label: 'New Private Tab', keywords: 'private incognito', hint: 'Ctrl+Shift+N', run: () => this.createTab(null, { privateMode: true, title: 'Private Tab' }) },
      { label: 'History', keywords: 'history visited', hint: 'Ctrl+H', run: () => this.showHistoryPanel() },
      { label: 'Tab Expose', keywords: 'expose overview all tabs grid', hint: 'Ctrl+Shift+E', run: () => this.showTabExpose() },
      { label: 'Toggle Bookmarks Bar', keywords: 'bookmarks bar', hint: 'Ctrl+Shift+B', run: () => this.toggleBookmarksBar() },
      { label: 'Passwords', keywords: 'password anvil logins', run: () => this.showPasswordAnvil?.() },
      { label: 'Import from Arc…', keywords: 'arc import migrate move spaces', run: () => this.importFromArc() },
      { label: 'Themes', keywords: 'theme colour color look appearance', run: () => this.showThemesModal?.() },
      { label: 'Settings', keywords: 'settings preferences options', hint: 'Ctrl+,', run: () => this.showSettings() }
    ];
    return actions.filter(Boolean).map(action => ({ ...action, type: 'action' }));
  },

  buildCommandItems() {
    const raw = this.commandInput.value.trim();
    const query = raw.toLowerCase();
    const items = [];

    if (!query) {
      items.push({ type: 'new', label: 'Open a New Tab', subtitle: 'Shiira home page', run: () => this.createTab() });
      const recent = [...this.tabs]
        .filter(t => !t.isHome && t.id !== this.activeTabId && !t.element?.classList.contains('closing'))
        .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
        .slice(0, 5);
      recent.forEach(tab => items.push(this.tabCommandItem(tab)));
      return items.concat(this.getCommandActions().slice(0, 4));
    }

    // First choice: go to the address, or search for the words.
    if (looksLikeAddress(raw)) {
      const url = this.processUrl(raw);
      items.push({ type: 'open', label: raw, subtitle: 'Open this address', url, run: (opts) => this.openFromCommandBar(url, opts) });
    } else {
      const url = this.processUrl(raw);
      const engine = this.currentSearchEngine ? this.currentSearchEngine.charAt(0).toUpperCase() + this.currentSearchEngine.slice(1) : 'the web';
      items.push({ type: 'search', label: raw, subtitle: `Search ${engine}`, url, run: (opts) => this.openFromCommandBar(url, opts) });
    }

    // Tabs in every space.
    this.tabs
      .filter(t => !t.isHome && !t.element?.classList.contains('closing') && matches(query, t.customTitle, t.title, this.currentTabUrl?.(t)))
      .slice(0, 5)
      .forEach(tab => items.push(this.tabCommandItem(tab)));

    // Spaces.
    sortByPosition(this.spaces || [])
      .filter(space => space.id !== this.focusedSpaceId && matches(query, space.title, 'space'))
      .forEach(space => items.push({ type: 'space', label: `${space.icon || ''} ${space.title}`.trim(), subtitle: 'Go to space', run: () => this.focusSpace(space.id) }));

    // Actions.
    this.getCommandActions()
      .filter(action => matches(query, action.label, action.keywords))
      .slice(0, 4)
      .forEach(action => items.push(action));

    // History.
    const openUrls = new Set(this.tabs.map(t => this.currentTabUrl?.(t)));
    (this.getHistorySuggestions?.(raw) || [])
      .filter(h => !openUrls.has(h.url))
      .slice(0, 4)
      .forEach(h => items.push({ type: 'history', label: h.text, subtitle: h.url, url: h.url, favicon: h.favicon, run: (opts) => this.openFromCommandBar(h.url, opts) }));

    // Online suggestions (only if suggestions are on in Settings > Search).
    this.commandSuggestions.forEach(text => {
      const url = this.processUrl(text);
      items.push({ type: 'suggestion', label: text, subtitle: 'Search suggestion', url, run: (opts) => this.openFromCommandBar(url, opts) });
    });

    return items.slice(0, MAX_RESULTS);
  },

  tabCommandItem(tab) {
    const space = tab.spaceId && this.spaces?.find(s => s.id === tab.spaceId);
    const where = tab.section === 'favorites' ? 'Favorite' : tab.section === 'pinned' ? 'Pinned' : 'Tab';
    const spaceLabel = space && space.id !== this.focusedSpaceId ? ` · ${space.icon || ''} ${space.title}` : '';
    const url = this.currentTabUrl?.(tab) || tab.url || '';
    return {
      type: 'tab',
      label: tab.customTitle || tab.title || hostOf(url) || 'Tab',
      subtitle: `Switch to ${where.toLowerCase()} · ${hostOf(url) || url}${spaceLabel}`,
      url,
      favicon: tab.favicon,
      run: () => this.switchTab(tab.id)
    };
  },

  openFromCommandBar(url, { background = false } = {}) {
    this.createTab(url, { background });
  },

  renderCommandResults() {
    this.commandItems = this.buildCommandItems();
    this.commandIndex = Math.min(this.commandIndex, Math.max(0, this.commandItems.length - 1));
    const icons = {
      action: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m13 2-9 12h8l-1 8 9-12h-8z"/></svg>',
      search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      suggestion: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      open: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
      new: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      space: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>'
    };
    this.commandResults.replaceChildren(...this.commandItems.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'command-result';
      row.setAttribute('role', 'option');
      row.id = `command-result-${index}`;
      let icon = icons[item.type] || icons.open;
      if (item.favicon) icon = `<img src="${escapeHtml(item.favicon)}" width="16" height="16" alt="">`;
      else if (item.type === 'tab' || item.type === 'history') {
        const { letter, hue } = letterIcon(item.url, item.label);
        icon = `<span class="letter-icon" style="background:hsl(${hue} 45% 46%)">${escapeHtml(letter)}</span>`;
      }
      row.innerHTML = `
        <span class="command-result-icon">${icon}</span>
        <span class="command-result-text">
          <span class="command-result-label">${escapeHtml(item.label)}</span>
          ${item.subtitle ? `<span class="command-result-subtitle">${escapeHtml(item.subtitle)}</span>` : ''}
        </span>
        ${item.hint ? `<kbd class="command-result-hint">${escapeHtml(item.hint)}</kbd>` : ''}`;
      // A favicon that fails to load becomes the site's letter.
      row.querySelector('img')?.addEventListener('error', (event) => {
        const { letter, hue } = letterIcon(item.url, item.label);
        const fallback = document.createElement('span');
        fallback.className = 'letter-icon';
        fallback.style.background = `hsl(${hue} 45% 46%)`;
        fallback.textContent = letter;
        event.currentTarget.replaceWith(fallback);
      });
      row.addEventListener('mousemove', () => {
        if (this.commandIndex === index) return;
        this.commandIndex = index;
        this.highlightCommandResult();
      });
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', (event) => this.runCommandItem(item, { background: event.altKey }));
      return row;
    }));
    this.highlightCommandResult();
  },

  highlightCommandResult() {
    [...this.commandResults.children].forEach((row, index) => {
      const selected = index === this.commandIndex;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
      if (selected) row.scrollIntoView({ block: 'nearest' });
    });
    this.commandInput.setAttribute('aria-activedescendant', `command-result-${this.commandIndex}`);
  },

  runCommandItem(item, options = {}) {
    if (!item) return;
    this.hideCommandBar();
    item.run(options);
  },

  // Ctrl+T: the command bar in the sidebar layout, a plain new tab in the top tabs layout.
  handleNewTabShortcut() {
    if (this.layout === 'sidebar' && this.commandBar) {
      if (this.isCommandBarOpen()) this.hideCommandBar();
      else this.openCommandBar();
    } else {
      this.createTab();
    }
  }
};
