const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.join(__dirname, `../src/renderer/modules/${name}.js`)).href);

test('search URLs stay inside Shiira, migrate removed engines, and retain provider/mode/query', async () => {
  const { searchUrl, parseSearchUrl, normalizeSearchEngine } = await load('search-model');
  const url = searchUrl('browser & tabs/日本', 'scira', 'reddit');
  assert.deepEqual(parseSearchUrl(url), { provider: 'scira', query: 'browser & tabs/日本', mode: 'reddit' });
  assert.equal(normalizeSearchEngine('startpage'), 'brave');
  assert.equal(normalizeSearchEngine('__proto__'), 'brave');
  assert.equal(parseSearchUrl('https://scira.ai/?q=anything'), null);
});

test('provider shortcuts and address search fallback use APIs inside Shiira', async () => {
  const { matchSiteSearch, siteSearchUrl } = await load('site-search');
  const { parseSearchUrl } = await load('search-model');
  const { NavigationMixin } = await load('navigation');
  for (const [name, provider] of [['brave', 'brave'], ['scira', 'scira'], ['duckduckgo', 'duckduckgo']]) {
    assert.equal(parseSearchUrl(siteSearchUrl(matchSiteSearch(name), 'browser tabs')).provider, provider);
  }
  assert.equal(parseSearchUrl(NavigationMixin.processUrl.call({}, 'browser tabs')).provider, 'brave');
});

test('website fallback URLs keep the query on the selected provider and encode URL syntax', async () => {
  const { websiteSearchUrl } = await load('search-model');
  const query = 'browser & tabs/#? 日本';
  for (const [provider, origin] of [['brave', 'https://search.brave.com'], ['scira', 'https://scira.ai']]) {
    const url = new URL(websiteSearchUrl(`  ${query}  `, provider));
    assert.equal(url.origin, origin);
    assert.equal(url.searchParams.get('q'), query);
    assert.equal(url.hash, '');
    assert.equal(url.username, '');
    assert.equal(url.searchParams.size, 2);
  }
  for (const provider of ['duckduckgo', 'startpage', '__proto__']) assert.equal(websiteSearchUrl(query, provider), null);
  assert.equal(websiteSearchUrl(' ', 'scira'), null);
});

function browserState(mixin) {
  return { ...mixin, tabs: [{ id: 'home', isHome: true, url: 'shiira://home' }], activeTabId: 'home',
    currentSearchEngine: 'brave', searchScope: { value: 'web' }, homeSearch: { value: '' }, urlInput: { value: '' },
    navigations: [], createWebviewForHomeTab(tab, url) { this.navigations.push({ tab, url }); tab.searchState = null; tab.isHome = false; tab.url = url; },
    renderHomeSearch() {}, renderSearchFallbackNotice() {}, updateTabTitle() {}, selectSearchEngine(provider) { this.currentSearchEngine = provider; }, saveSession: async () => true };
}
const result = query => ({ success: true, result: { provider: 'brave', query, answer: '', results: [], more: false } });

test('Brave API failures use its website once in the original private tab', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const previous = global.window;
  try {
    for (const provider of ['brave']) {
      for (const code of ['missing_key', 'authentication', 'rate_limit', 'provider_error', 'timeout', 'network', 'invalid_response', 'unavailable', 'busy']) {
        let calls = 0;
        global.window = { shiiraAPI: { search: { query: async () => { calls++; return { success: false, code }; }, cancel: async () => {} } } };
        const browser = browserState(HomeSearchMixin);
        const source = browser.tabs[0];
        source.privateMode = true;
        await browser.performHomeSearch('web browser & tabs', provider);
        assert.equal(calls, 1);
        assert.equal(browser.tabs.length, 1);
        assert.equal(browser.navigations.length, 1);
        assert.equal(browser.navigations[0].tab, source);
        assert.equal(new URL(source.url).searchParams.get('q'), 'web browser & tabs');
        assert.equal(new URL(source.url).hostname, provider === 'brave' ? 'search.brave.com' : 'scira.ai');
        assert.equal(source.privateMode, true);
        assert.equal(source.searchState, null);
      }
    }
  } finally { global.window = previous; }
});

test('Scira without a key, rejected keys and unreadable credentials open Scira itself with the selected scope', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const previous = global.window;
  try {
    for (const code of ['missing_key', 'credential_unavailable', 'authentication']) {
      global.window = { shiiraAPI: { search: { query: async () => ({ success: false, code, error: 'Fixture failure', status: 500 }), cancel: async () => {} } } };
      const browser = browserState(HomeSearchMixin);
      browser.tabs[0].privateMode = true;
      await browser.performHomeSearch('my original query', 'scira', { mode: 'reddit' });
      const tab = browser.tabs[0];
      assert.equal(browser.navigations.length, 1);
      assert.equal(tab.isHome, false);
      assert.equal(tab.privateMode, true);
      const url = new URL(tab.url);
      assert.equal(url.hostname, 'scira.ai');
      assert.equal(url.searchParams.get('q'), 'my original query');
      assert.equal(url.searchParams.get('group'), 'reddit');
    }
  } finally { global.window = previous; }
});

test('Scira service failures stay on Scira instead of substituting another provider', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const { websiteSearchUrl } = await load('search-model');
  const previous = global.window;
  try {
    for (const mode of ['web', 'reddit', 'x', 'people']) {
      for (const code of ['rate_limit', 'provider_error', 'timeout', 'network', 'invalid_response', 'unavailable', 'busy']) {
        global.window = { shiiraAPI: { search: { query: async () => ({ success: false, code, error: 'Fixture failure' }), cancel: async () => {} } } };
        const browser = browserState(HomeSearchMixin);
        const tab = browser.tabs[0]; tab.privateMode = true;
        await browser.performHomeSearch('my original query', 'scira', { mode });
        assert.equal(browser.navigations.length, 1);
        assert.equal(tab.url, websiteSearchUrl('my original query', 'scira', mode));
        assert.equal(new URL(tab.url).hostname, 'scira.ai');
        assert.equal(tab.privateMode, true);
        assert.equal(tab.searchFallback.query, 'my original query');
        assert.equal(tab.searchFallback.mode, mode);
        assert.equal(browser.currentSearchEngine, 'scira');
      }
    }
  } finally { global.window = previous; }
});

test('scope is retained in address-bar searches, Scira shortcuts, website URLs and fallback queries', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const { ShiiraHomageMixin } = await load('shiira-homage');
  const { NavigationMixin } = await load('navigation');
  const { matchSiteSearch, siteSearchUrl } = await load('site-search');
  const { parseSearchUrl, websiteSearchUrl } = await load('search-model');
  const browser = { ...HomeSearchMixin, ...ShiiraHomageMixin, ...NavigationMixin, currentSearchEngine: 'scira', searchScope: { value: 'reddit' } };
  assert.equal(parseSearchUrl(browser.processUrl('cool github projects')).mode, 'reddit');
  assert.equal(parseSearchUrl(siteSearchUrl(matchSiteSearch('scira'), 'cool github projects', browser.getSearchMode())).mode, 'reddit');
  for (const mode of ['web', 'reddit', 'x', 'people']) {
    assert.equal(new URL(websiteSearchUrl('original query', 'scira', mode)).searchParams.get('group'), mode);
  }
});

test('switching to another provider does not reset the saved Scira scope to Web', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const previous = global.window;
  const requests = [];
  global.window = { shiiraAPI: { search: { query: async input => { requests.push(input); return result(input.query); }, cancel: async () => {} } } };
  try {
    const browser = browserState(HomeSearchMixin);
    browser.searchScope.value = 'reddit';
    await browser.performHomeSearch('test query', 'duckduckgo');
    assert.equal(browser.searchScope.value, 'reddit');
    await browser.performHomeSearch('test query', 'scira');
    assert.equal(requests[1].mode, 'reddit');
  } finally { global.window = previous; }
});

test('cancellation, invalid input, successful searches and DuckDuckGo errors never open a provider website', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const previous = global.window;
  try {
    for (const [provider, response] of [['brave', { success: false, code: 'canceled' }], ['scira', { success: false, code: 'invalid_request' }],
      ['duckduckgo', { success: false, code: 'network' }], ['scira', result('web browser')]]) {
      global.window = { shiiraAPI: { search: { query: async () => response, cancel: async () => {} } } };
      const browser = browserState(HomeSearchMixin);
      await browser.performHomeSearch('web browser', provider);
      assert.equal(browser.navigations.length, 0);
      assert.equal(browser.tabs[0].isHome, true);
    }
  } finally { global.window = previous; }
});

test('Scira bridge failures use regular search and a background fallback stays with its source', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const previous = global.window;
  try {
    global.window = { shiiraAPI: { search: { query: async () => { throw new Error('Bridge unavailable'); } } } };
    const bridge = browserState(HomeSearchMixin);
    await bridge.performHomeSearch('web browser', 'scira');
    assert.equal(bridge.tabs[0].searchFallback.code, 'unavailable');
    assert.equal(bridge.navigations.length, 1);

    let finish;
    global.window = { shiiraAPI: { search: { query: () => new Promise(resolve => { finish = resolve; }) } } };
    const browser = browserState(HomeSearchMixin);
    const source = browser.tabs[0];
    const pending = browser.performHomeSearch('background query', 'brave');
    const active = { id: 'other', isHome: true, url: 'shiira://home' };
    browser.tabs.push(active);
    browser.activeTabId = active.id;
    finish({ success: false, code: 'provider_error' });
    await pending;
    assert.equal(browser.activeTabId, active.id);
    assert.equal(active.url, 'shiira://home');
    assert.equal(browser.navigations[0].tab, source);
  } finally { global.window = previous; }
});

test('a late failure after cancel, a newer search or tab closure cannot open the fallback site', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const previous = global.window;
  try {
    for (const action of ['cancel', 'replace', 'close']) {
      const pending = [];
      global.window = { shiiraAPI: { search: { query: () => new Promise(resolve => pending.push(resolve)), cancel: async () => {} } } };
      const browser = browserState(HomeSearchMixin);
      const first = browser.performHomeSearch('old query', 'scira');
      if (action === 'cancel') browser.cancelHomeSearch(browser.tabs[0]);
      if (action === 'replace') {
        const replacement = browser.performHomeSearch('new query', 'duckduckgo');
        pending[1](result('new query'));
        await replacement;
      }
      if (action === 'close') browser.tabs = [];
      pending[0]({ success: false, code: 'provider_error' });
      await first;
      assert.equal(browser.navigations.length, 0);
    }
  } finally { global.window = previous; }
});

test('background fallback creates a private webview without changing the active page chrome', async () => {
  const { NavigationMixin } = await load('navigation');
  const updates = [];
  const webview = { style: {}, classList: { add: value => updates.push(value) } };
  const browser = { ...NavigationMixin, activeTabId: 'other', currentBrightness: 100, urlInput: { value: 'keep this URL' },
    welcomePage: { classList: { add: value => updates.push(value) } }, updateSecurityIndicator: () => updates.push('security'),
    createTabWebview(id, privateMode) { assert.equal(id, 'source'); assert.equal(privateMode, true); return webview; } };
  const tab = { id: 'source', isHome: true, privateMode: true, element: { dataset: {}, querySelector: () => null } };
  browser.createWebviewForHomeTab(tab, 'https://scira.ai/?q=background');
  assert.deepEqual(updates, []);
  assert.equal(browser.urlInput.value, 'keep this URL');
  assert.equal(tab.isHome, false);
  assert.equal(webview.src, tab.url);
  assert.deepEqual(tab.navigationHistory, ['https://scira.ai/?q=background']);
});

test('one provider-chip click immediately runs the entered query and switches the selected provider', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const calls = [];
  const previous = global.window;
  global.window = { shiiraAPI: { search: { query: async request => { calls.push(request); return result(request.query); }, cancel: async () => {} } } };
  try {
    const browser = browserState(HomeSearchMixin);
    browser.currentSearchEngine = 'scira';
    browser.homeSearch.value = 'web browser';
    await browser.selectHomeSearchProvider('duckduckgo');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, 'duckduckgo');
    assert.equal(calls[0].query, 'web browser');
    assert.equal(browser.currentSearchEngine, 'duckduckgo');
    assert.equal(browser.tabs[0].searchState.status, 'done');
  } finally { global.window = previous; }
});

test('fallback searches update the engine and repeated clicks do not duplicate an in-flight query', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const calls = [];
  let finish;
  const previous = global.window;
  global.window = { shiiraAPI: { search: { query: request => { calls.push(request); return new Promise(resolve => { finish = resolve; }); }, cancel: async () => {} } } };
  try {
    const browser = browserState(HomeSearchMixin);
    browser.currentSearchEngine = 'scira';
    const first = browser.performHomeSearch('web browser', 'duckduckgo');
    await browser.performHomeSearch('web browser', 'duckduckgo');
    assert.equal(calls.length, 1);
    assert.equal(browser.currentSearchEngine, 'duckduckgo');
    finish(result('web browser'));
    await first;
  } finally { global.window = previous; }
});

test('a late search response cannot replace a newer search or another tab’s results', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const pending = [];
  const previous = global.window;
  global.window = { shiiraAPI: { search: { query: request => new Promise(resolve => pending.push({ request, resolve })), cancel: async () => {} } } };
  try {
    const browser = browserState(HomeSearchMixin);
    const first = browser.performHomeSearch('old query');
    const second = browser.performHomeSearch('new query');
    pending[1].resolve(result('new query'));
    await second;
    pending[0].resolve(result('old query'));
    await first;
    assert.equal(browser.tabs[0].searchState.result.query, 'new query');
    assert.equal(browser.tabs[0].url.startsWith('shiira://search?'), true);
  } finally { global.window = previous; }
});

test('cancel invalidates a request immediately even if an upstream completion races it', async () => {
  const { HomeSearchMixin } = await load('home-search');
  let resolve;
  const previous = global.window;
  global.window = { shiiraAPI: { search: { query: () => new Promise(done => { resolve = done; }), cancel: async () => {} } } };
  try {
    const browser = browserState(HomeSearchMixin);
    const request = browser.performHomeSearch('cancel me');
    browser.cancelHomeSearch(browser.tabs[0]);
    assert.equal(browser.tabs[0].searchState.status, 'canceled');
    resolve(result('cancel me'));
    await request;
    assert.equal(browser.tabs[0].searchState.status, 'canceled');
  } finally { global.window = previous; }
});

test('restored searches do not spend API requests just by switching to their tab', async () => {
  const { HomeSearchMixin } = await load('home-search');
  const browser = browserState(HomeSearchMixin);
  browser.searchPanel = {};
  browser.tabs[0].searchState = { query: 'saved query', provider: 'scira', status: 'restored' };
  browser.performHomeSearch = () => { throw new Error('Should require explicit rerun'); };
  browser.restoreHomeSearch(browser.tabs[0]);
  assert.equal(browser.homeSearch.value, 'saved query');
});

test('private tabs never request online address suggestions', async () => {
  const { UrlSuggestionsMixin } = await load('url-suggestions');
  let called = false;
  const previous = global.window;
  global.window = { shiiraAPI: { getUrlSuggestions: async () => { called = true; return []; } } };
  try {
    const browser = { ...UrlSuggestionsMixin, tabs: [{ id: 'private', privateMode: true }], activeTabId: 'private', currentSearchEngine: 'brave',
      getHistorySuggestions: () => [], buildSearchUrl: q => q, renderSuggestions() {} };
    await browser.fetchSuggestions('private words');
    assert.equal(called, false);
  } finally { global.window = previous; }
});
