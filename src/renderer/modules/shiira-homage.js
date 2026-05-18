// Shiira Homage Module
// Adds palette drawers, Tab Expose, page-turn transitions, and multi-search engines.

const SEARCH_ENGINES = {
  google: {
    label: 'Google',
    url: query => `https://www.google.com/search?q=${encodeURIComponent(query)}`
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    url: query => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
  },
  brave: {
    label: 'Brave',
    url: query => `https://search.brave.com/search?q=${encodeURIComponent(query)}`
  },
  wikipedia: {
    label: 'Wikipedia',
    url: query => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`
  }
};

export const ShiiraHomageMixin = {
  initShiiraHomage() {
    this.currentSearchEngine = localStorage.getItem('shiira-search-engine') || 'google';
    this.btnShiiraDrawer = document.getElementById('btn-shiira-drawer');
    this.shiiraDrawer = document.getElementById('shiira-drawer');
    this.btnCloseShiiraDrawer = document.getElementById('btn-close-shiira-drawer');
    this.btnTabExpose = document.getElementById('btn-tab-expose');
    this.tabExposeOverlay = document.getElementById('tab-expose-overlay');
    this.tabExposeGrid = document.getElementById('tab-expose-grid');
    this.btnCloseTabExpose = document.getElementById('btn-close-tab-expose');
    this.clearOnExitToggle = document.getElementById('shiira-clear-on-exit');
    this.cacheStatus = document.getElementById('shiira-cache-status');

    this.btnShiiraDrawer?.addEventListener('click', () => this.toggleShiiraDrawer());
    this.btnCloseShiiraDrawer?.addEventListener('click', () => this.hideShiiraDrawer());
    this.btnTabExpose?.addEventListener('click', () => this.showTabExpose());
    this.btnCloseTabExpose?.addEventListener('click', () => this.hideTabExpose());
    this.tabExposeOverlay?.addEventListener('click', (event) => {
      if (event.target === this.tabExposeOverlay) this.hideTabExpose();
    });

    document.querySelectorAll('.shiira-palette-tab').forEach(button => {
      button.addEventListener('click', () => this.selectShiiraPalette(button.dataset.palette));
    });

    document.querySelectorAll('.shiira-drawer-action').forEach(button => {
      button.addEventListener('click', () => this.handleShiiraDrawerAction(button.dataset.action));
    });

    if (this.clearOnExitToggle) {
      this.clearOnExitToggle.checked = localStorage.getItem('shiira-clear-on-exit') === 'true';
      this.clearOnExitToggle.addEventListener('change', () => {
        localStorage.setItem('shiira-clear-on-exit', String(this.clearOnExitToggle.checked));
      });
    }

    window.addEventListener('beforeunload', () => {
      if (localStorage.getItem('shiira-clear-on-exit') === 'true') {
        window.shiiraAPI?.privacy?.clearBrowsingData?.('cookies-and-cache');
      }
    });

    document.querySelectorAll('.search-engine-chip').forEach(button => {
      button.addEventListener('click', () => this.selectSearchEngine(button.dataset.engine));
    });
    this.updateSearchEngineUI();
  },

  selectSearchEngine(engine) {
    if (!SEARCH_ENGINES[engine]) return;
    this.currentSearchEngine = engine;
    localStorage.setItem('shiira-search-engine', engine);
    this.updateSearchEngineUI();
  },

  updateSearchEngineUI() {
    document.querySelectorAll('.search-engine-chip').forEach(button => {
      button.classList.toggle('active', button.dataset.engine === this.currentSearchEngine);
    });

    const engine = SEARCH_ENGINES[this.currentSearchEngine] || SEARCH_ENGINES.google;
    if (this.homeSearch) {
      this.homeSearch.placeholder = `Search ${engine.label}...`;
    }
  },

  buildSearchUrl(query) {
    const trimmed = (query || '').trim();
    const engine = SEARCH_ENGINES[this.currentSearchEngine] || SEARCH_ENGINES.google;
    return engine.url(trimmed);
  },

  toggleShiiraDrawer() {
    if (this.shiiraDrawer?.classList.contains('hidden')) {
      this.showShiiraDrawer();
    } else {
      this.hideShiiraDrawer();
    }
  },

  showShiiraDrawer() {
    this.shiiraDrawer?.classList.remove('hidden');
  },

  hideShiiraDrawer() {
    this.shiiraDrawer?.classList.add('hidden');
  },

  selectShiiraPalette(palette) {
    document.querySelectorAll('.shiira-palette-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.palette === palette);
    });
    document.querySelectorAll('.shiira-palette-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.palettePanel === palette);
    });
  },

  handleShiiraDrawerAction(action) {
    switch (action) {
      case 'open-bookmarks':
        if (!this.bookmarksBarEnabled) this.toggleBookmarksBar();
        break;
      case 'open-history':
        this.showHistoryPanel();
        break;
      case 'clear-cache':
        this.clearShiiraBrowsingData('cache');
        break;
      case 'clear-cookies':
        this.clearShiiraBrowsingData('cookies');
        break;
      case 'clear-storage':
        this.clearShiiraBrowsingData('storage');
        break;
    }
  },

  async clearShiiraBrowsingData(kind) {
    if (!window.shiiraAPI?.privacy?.clearBrowsingData) return;
    this.setCacheStatus('Clearing...', '');
    const result = await window.shiiraAPI.privacy.clearBrowsingData(kind);
    if (result?.success) {
      const labels = {
        cache: 'Cache cleared.',
        cookies: 'Cookies cleared.',
        storage: 'Site storage cleared.',
        'cookies-and-cache': 'Cookies and cache cleared.'
      };
      this.setCacheStatus(labels[kind] || 'Browsing data cleared.', 'success');
    } else {
      this.setCacheStatus(result?.error || 'Could not clear browsing data.', 'error');
    }
  },

  setCacheStatus(message, state) {
    if (!this.cacheStatus) return;
    this.cacheStatus.textContent = message;
    this.cacheStatus.className = `shiira-cache-status${state ? ` ${state}` : ''}`;
  },

  showTabExpose() {
    if (!this.tabExposeOverlay || !this.tabExposeGrid) return;

    this.tabExposeGrid.innerHTML = '';
    this.tabs.forEach(tab => {
      const card = document.createElement('button');
      card.className = `tab-expose-card${tab.id === this.activeTabId ? ' active' : ''}`;
      const icon = tab.favicon || (tab.isHome ? 'shiira-asset://ui-icons/home.svg' : 'shiira-asset://ui-icons/globe.svg');
      const title = tab.title || 'New Tab';
      const url = tab.pendingUrl || tab.url || tab.webview?.getURL?.() || 'shiira://home';

      card.innerHTML = `
        <div class="tab-expose-card-title">
          <img src="${icon}" alt="">
          <span>${this.escapeExposeText(title)}</span>
        </div>
        <div class="tab-expose-card-url">${this.escapeExposeText(url)}</div>
        <div class="tab-expose-card-preview"></div>
      `;
      card.addEventListener('click', () => {
        this.switchTab(tab.id);
        this.hideTabExpose();
      });
      this.tabExposeGrid.appendChild(card);
    });

    this.tabExposeOverlay.classList.remove('hidden');
  },

  hideTabExpose() {
    this.tabExposeOverlay?.classList.add('hidden');
  },

  runPageTurn() {
    document.body.classList.remove('page-turning');
    window.requestAnimationFrame(() => {
      document.body.classList.add('page-turning');
      window.setTimeout(() => document.body.classList.remove('page-turning'), 380);
    });
  },

  escapeExposeText(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
};

export default ShiiraHomageMixin;
