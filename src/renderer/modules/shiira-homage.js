// Shiira Homage Module
// Adds palette drawers, Tab Expose, page-turn transitions, and Startpage search.

const SEARCH_ENGINES = {
  brave: {
    label: 'Brave',
    logo: 'shiira-asset://site-logos/brave-search.svg',
    url: query => `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`
  },
  startpage: {
    label: 'Startpage',
    logo: 'shiira-asset://site-logos/Startpage.com_logo.svg',
    url: query => `https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`
  },
  scira: {
    label: 'Scira',
    logo: 'shiira-asset://site-logos/scira.svg',
    url: query => `https://scira.ai/?q=${encodeURIComponent(query)}`
  }
};

export const ShiiraHomageMixin = {
  initShiiraHomage() {
    this.currentSearchEngine = localStorage.getItem('shiira-search-engine') || 'brave';
    if (!SEARCH_ENGINES[this.currentSearchEngine]) {
      this.currentSearchEngine = 'brave';
    }
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
    this.initAISearch();
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

    const engine = SEARCH_ENGINES[this.currentSearchEngine] || SEARCH_ENGINES.startpage;
    if (this.homeSearch) {
      this.homeSearch.placeholder = `Search ${engine.label}...`;
    }
    const logoEl = document.querySelector('.search-box-logo');
    if (logoEl && engine.logo) {
      logoEl.src = engine.logo;
      logoEl.alt = engine.label;
    }
  },

  buildSearchUrl(query) {
    const trimmed = (query || '').trim();
    const engine = SEARCH_ENGINES[this.currentSearchEngine] || SEARCH_ENGINES.startpage;
    return engine.url(trimmed);
  },

  // AI Search for Scira
  initAISearch() {
    this.aiSearchResults = document.getElementById('ai-search-results');
    this.aiSearchContent = document.getElementById('ai-search-content');
    this.aiSearchClose = document.getElementById('ai-search-close');
    
    this.aiSearchClose?.addEventListener('click', () => this.hideAISearch());
  },

  async performAISearch(query) {
    if (!this.aiSearchResults || !this.aiSearchContent) return;
    
    this.aiSearchResults.classList.remove('hidden');
    this.aiSearchContent.innerHTML = '<div class="ai-loading">Getting instant results...</div>';
    
    try {
      // Try Wikipedia API first for factual answers
      const wikiResponse = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(3000) }
      );
      
      if (wikiResponse.ok) {
        const wikiData = await wikiResponse.json();
        if (wikiData.extract) {
          this.renderWikiResults(wikiData, query);
          return;
        }
      }
      
      // Fallback to DuckDuckGo Instant Answer API
      const ddgResponse = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { signal: AbortSignal.timeout(3000) }
      );
      
      if (ddgResponse.ok) {
        const ddgData = await ddgResponse.json();
        this.renderAISearchResults(ddgData, query);
      } else {
        throw new Error('Both APIs failed');
      }
    } catch (error) {
      this.aiSearchContent.innerHTML = `
        <div class="ai-error">
          <p>Instant results unavailable.</p>
          <p><a href="${SEARCH_ENGINES.scira.url(query)}" target="_blank">Search with Scira AI</a> for full AI-powered answers.</p>
        </div>
      `;
    }
  },

  renderWikiResults(data, query) {
    const html = `
      <div class="ai-results-content">
        <div class="ai-answer">
          <h3>${data.title}</h3>
          <p>${data.extract}</p>
          ${data.content_urls?.desktop?.page ? `<p><a href="${data.content_urls.desktop.page}" target="_blank">Read more on Wikipedia</a></p>` : ''}
        </div>
        <div class="ai-fallback">
          <p><a href="${SEARCH_ENGINES.scira.url(query)}" target="_blank">Search with Scira AI</a> for more comprehensive answers.</p>
        </div>
      </div>
    `;
    this.aiSearchContent.innerHTML = html;
  },

  renderAISearchResults(data, query) {
    let html = '<div class="ai-results-content">';
    
    // Abstract (main answer)
    if (data.Abstract) {
      html += `<div class="ai-answer"><h3>${data.Heading || 'Quick Answer'}</h3><p>${data.Abstract}</p></div>`;
    }
    
    // Related topics
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      html += '<div class="ai-related"><h4>Related Topics:</h4><ul>';
      data.RelatedTopics.slice(0, 5).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          html += `<li><a href="${topic.FirstURL}" target="_blank">${topic.Text}</a></li>`;
        }
      });
      html += '</ul></div>';
    }
    
    // If no results, show direct link to Scira
    if (!data.Abstract && !data.RelatedTopics?.length) {
      html += `<div class="ai-fallback">
        <p>No instant results available.</p>
        <p><a href="${SEARCH_ENGINES.scira.url(query)}" target="_blank">Click here to search with Scira AI</a> for comprehensive AI-powered answers.</p>
      </div>`;
    }
    
    html += '</div>';
    this.aiSearchContent.innerHTML = html;
  },

  hideAISearch() {
    this.aiSearchResults?.classList.add('hidden');
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
