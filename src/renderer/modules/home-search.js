import { SEARCH_ENGINES, normalizeSearchEngine, searchUrl, safeResultUrl } from './search-model.js';

export const HomeSearchMixin = {
  initHomeSearch() {
    this.searchPanel = document.getElementById('ai-search-results');
    this.searchContent = document.getElementById('ai-search-content');
    this.searchBadge = document.getElementById('home-search-provider');
    this.searchScope = document.getElementById('home-search-scope');
    document.getElementById('ai-search-close')?.addEventListener('click', () => this.hideHomeSearch());
    document.getElementById('home-search-submit')?.addEventListener('click', () => {
      if (this.homeSearch.value.trim()) void this.performHomeSearch(this.homeSearch.value.trim());
    });
    this.initSearchCredentials();
  },

  createSearchTab(query, options = {}) {
    const provider = normalizeSearchEngine(options.provider || this.currentSearchEngine);
    const id = this.createHomeTab({ ...options, background: true });
    const tab = this.tabs.find(tab => tab.id === id);
    tab.searchState = { query, provider, mode: options.mode || 'web', status: options.deferLoad ? 'restored' : 'idle', page: 0 };
    tab.url = searchUrl(query, provider, tab.searchState.mode);
    this.updateTabTitle(id, `${SEARCH_ENGINES[provider].label}: ${query}`);
    if (!options.background && !options.deferLoad) this.switchTab(id);
    return id;
  },

  async performHomeSearch(query, provider = this.currentSearchEngine, { page = 0, mode = this.searchScope?.value || 'web' } = {}) {
    let tab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!tab?.isHome) return this.createSearchTab(query, { provider, mode, privateMode: tab?.privateMode === true });
    provider = normalizeSearchEngine(provider);
    if (provider !== 'scira') mode = 'web';
    const old = tab.searchState;
    if (old?.requestId) void window.shiiraAPI.search.cancel(old.requestId);
    this.homeSearchSequence = (this.homeSearchSequence || 0) + 1;
    const requestId = `search-${tab.id}-${this.homeSearchSequence}`;
    const state = { query: query.trim(), provider, mode, page, requestId, status: 'loading', result: page > 0 ? old?.result : null };
    tab.searchState = state;
    tab.url = searchUrl(state.query, provider, mode);
    this.updateTabTitle(tab.id, `${SEARCH_ENGINES[provider].label}: ${state.query}`);
    this.homeSearch.value = state.query;
    this.urlInput.value = tab.url;
    this.renderHomeSearch(tab);
    let response;
    try { response = await window.shiiraAPI.search.query({ id: requestId, query: state.query, provider, mode, page }); }
    catch { response = { success: false, code: 'unavailable', error: 'Search is unavailable. Try again.' }; }
    // A newer search or a closed tab must never be overwritten by an old reply.
    if (tab.searchState !== state || !this.tabs.includes(tab)) return;
    if (response.success) {
      let result = response.result;
      if (page > 0 && state.result) {
        const seen = new Set();
        result = { ...result, results: [...state.result.results, ...result.results].filter(item => !seen.has(item.url) && seen.add(item.url)) };
      }
      state.status = 'done';
      state.result = result;
    } else {
      state.status = response.code === 'canceled' ? 'canceled' : 'error';
      state.error = response.error;
      state.code = response.code;
    }
    state.requestId = null;
    if (this.activeTabId === tab.id) this.renderHomeSearch(tab);
    void this.saveSession?.();
  },

  restoreHomeSearch(tab) {
    if (!this.searchPanel) return;
    this.homeSearch.value = tab?.searchState?.query || '';
    if (tab?.searchState) this.urlInput.value = tab.url;
    this.renderHomeSearch(tab);
    if (tab?.searchState?.status === 'idle') void this.performHomeSearch(tab.searchState.query, tab.searchState.provider, { mode: tab.searchState.mode });
  },

  renderHomeSearch(tab) {
    if (!this.searchPanel || !this.searchContent) return;
    const state = tab?.searchState;
    this.searchPanel.classList.toggle('hidden', !state);
    this.welcomePage.classList.toggle('has-search-results', Boolean(state));
    this.searchScope?.parentElement.classList.toggle('hidden', this.currentSearchEngine !== 'scira');
    if (!state) { this.searchContent.replaceChildren(); return; }
    this.searchBadge.textContent = `${SEARCH_ENGINES[state.provider].label}${state.provider === 'scira' && state.mode !== 'web' ? ` · ${state.mode}` : ''}`;
    this.searchPanel.setAttribute('aria-busy', String(state.status === 'loading'));
    this.searchContent.replaceChildren();
    const paragraph = (content, className = '') => {
      const p = document.createElement('p'); p.textContent = content; p.className = className; this.searchContent.append(p); return p;
    };
    const action = (label, run) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'home-search-action'; button.textContent = label;
      button.addEventListener('click', run); this.searchContent.append(button);
    };
    if (state.status === 'loading') {
      paragraph(`Searching ${SEARCH_ENGINES[state.provider].label}…`, 'ai-loading');
      action('Cancel search', () => this.cancelHomeSearch(tab));
      return;
    }
    if (state.status === 'restored') paragraph('Your search was restored. Run it again to fetch fresh results.');
    else if (state.status === 'error' || state.status === 'canceled') paragraph(state.error || 'Search canceled.', 'home-search-message');
    const result = state.result;
    if (result) {
      if (result.correctedQuery) paragraph(`Showing results for ${result.correctedQuery}`, 'home-search-note');
      if (result.answer) {
        const answer = document.createElement('div'); answer.className = 'home-search-answer';
        for (const block of result.answer.split(/\n{2,}/)) {
          const heading = /^#{1,4}\s+([^\n]+)$/.exec(block);
          const node = document.createElement(heading ? 'h3' : 'p');
          node.textContent = heading ? heading[1] : block;
          answer.append(node);
        }
        this.searchContent.append(answer);
      }
      for (const [index, item] of result.results.entries()) {
        const url = safeResultUrl(item.url);
        if (!url) continue;
        const card = document.createElement('article'); card.className = 'home-search-result';
        const link = document.createElement('a'); link.href = url; link.textContent = item.title;
        link.addEventListener('click', event => { event.preventDefault(); this.createTab(url, { background: event.ctrlKey || event.metaKey || event.altKey, privateMode: tab.privateMode === true }); });
        const host = document.createElement('small'); host.textContent = `${index + 1} · ${new URL(url).hostname}`;
        card.append(host, link);
        if (item.description) { const description = document.createElement('p'); description.textContent = item.description; card.append(description); }
        this.searchContent.append(card);
      }
      if (!result.answer && !result.results.length) paragraph(state.provider === 'duckduckgo' ? 'No quick answer was found. DuckDuckGo Quick provides instant answers and related topics, rather than full web results. Try Brave Search or Scira AI for a broader search.' : 'No results were returned. Try a different query.');
      if (result.more && state.status === 'done') action('More results', () => void this.performHomeSearch(state.query, state.provider, { page: state.page + 1, mode: state.mode }));
    }
    if (state.status !== 'done') {
      if (state.code === 'missing_key' || state.code === 'authentication') action('Open Search settings', () => this.showSettings('search'));
      else action('Search again', () => void this.performHomeSearch(state.query, state.provider, { page: state.page, mode: state.mode }));
      if (state.provider !== 'duckduckgo') action('Try DuckDuckGo Quick', () => void this.performHomeSearch(state.query, 'duckduckgo', { mode: 'web' }));
    }
  },

  cancelHomeSearch(tab) {
    if (tab?.searchState?.requestId) {
      void window.shiiraAPI.search.cancel(tab.searchState.requestId);
      tab.searchState = { ...tab.searchState, status: 'canceled', requestId: null, error: 'Search canceled.' };
      if (this.activeTabId === tab.id) this.renderHomeSearch(tab);
    }
  },

  hideHomeSearch() {
    const tab = this.tabs.find(tab => tab.id === this.activeTabId);
    this.cancelHomeSearch(tab);
    if (tab?.isHome) { tab.searchState = null; tab.url = 'shiira://home'; this.updateTabTitle(tab.id, tab.privateMode ? 'Private Tab' : 'Home'); }
    this.homeSearch.value = '';
    this.renderHomeSearch(tab);
  },

  initSearchCredentials() {
    for (const provider of ['brave', 'scira']) {
      document.getElementById(`search-${provider}-save`)?.addEventListener('click', () => void this.saveSearchCredential(provider));
      document.getElementById(`search-${provider}-remove`)?.addEventListener('click', () => void this.saveSearchCredential(provider, true));
    }
  },

  async loadSearchCredentials() {
    try {
      const status = await window.shiiraAPI.search.status();
      for (const provider of ['brave', 'scira']) {
        const el = document.getElementById(`search-${provider}-status`);
        if (el) el.textContent = status[provider]?.configured ? `API key configured${status[provider].source === 'environment' ? ' through environment' : ' in the system keychain'}.` : 'No API key configured.';
      }
    } catch { /* Settings remain usable when the keychain is temporarily unavailable. */ }
  },

  async saveSearchCredential(provider, remove = false) {
    const input = document.getElementById(`search-${provider}-key`);
    const status = document.getElementById(`search-${provider}-status`);
    if (!remove && !input.value.trim()) { status.textContent = 'Enter an API key to save.'; return; }
    const key = remove ? '' : input.value;
    input.value = '';
    try {
      const response = await window.shiiraAPI.search.setKey(provider, key);
      if (!response.success) { status.textContent = response.error; return; }
      await this.loadSearchCredentials();
    } catch { status.textContent = 'The API key could not be saved.'; }
  }
};
