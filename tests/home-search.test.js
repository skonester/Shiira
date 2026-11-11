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

function browserState(mixin) {
  return { ...mixin, tabs: [{ id: 'home', isHome: true, url: 'shiira://home' }], activeTabId: 'home',
    currentSearchEngine: 'brave', searchScope: { value: 'web' }, homeSearch: { value: '' }, urlInput: { value: '' },
    renderHomeSearch() {}, updateTabTitle() {}, saveSession: async () => true };
}
const result = query => ({ success: true, result: { provider: 'brave', query, answer: '', results: [], more: false } });

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
