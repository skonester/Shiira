const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.join(__dirname, `../src/renderer/modules/${name}.js`)).href);

function installGlobals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
}

function preferences(t, initial = {}) {
  const values = new Map(Object.entries(initial));
  installGlobals(t, { localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  } });
  return values;
}

test('home page accepts a bare domain and rejects credentials and unsafe protocols', async t => {
  const { normalizeHomepage, getHomepage } = await load('homepage');
  const values = preferences(t);
  assert.equal(getHomepage(), 'shiira://home');
  assert.equal(normalizeHomepage(' google.com '), 'https://google.com/');
  assert.equal(normalizeHomepage('http://localhost:8080/start'), 'http://localhost:8080/start');
  for (const input of ['', 'https://', 'https://user:secret@example.com', 'file:///tmp', 'javascript://example.com']) {
    assert.equal(normalizeHomepage(input), null);
  }
  values.set('shiira-homepage-url', 'google.com');
  assert.equal(getHomepage(), 'https://google.com/');
  values.set('shiira-homepage-url', 'file:///tmp');
  assert.equal(getHomepage(), 'shiira://home');
});

test('new tabs use the saved home page while explicit pages, private tabs and API search keep their destinations', async t => {
  const { TabManagerMixin } = await load('tab-manager');
  const { HomeSearchMixin } = await load('home-search');
  preferences(t, { 'shiira-homepage-url': 'https://google.com/' });
  const browser = { ...TabManagerMixin, ...HomeSearchMixin, tabs: [], tabCounter: 0,
    tabsContainer: { appendChild() {} }, getCachedFavicon() { return null; },
    buildTabElement() { return { classList: { add() {} } }; },
    createTabWebview() { return {}; }, placeNewTab() {}, switchTab(id) { this.activeTabId = id; }, updateTabTitle() {}
  };
  const find = id => browser.tabs.find(tab => tab.id === id);
  const normal = find(browser.createTab());
  assert.equal(normal.url, 'https://google.com/');
  assert.equal(normal.webview.src, normal.url);
  assert.equal(find(browser.createTab('https://example.com/')).url, 'https://example.com/');
  assert.equal(find(browser.createTab(null, { privateMode: true })).isHome, true);
  assert.equal(find(browser.createTab('shiira://home')).isHome, true);
  const search = find(browser.createSearchTab('browser', { provider: 'brave', deferLoad: true }));
  assert.equal(search.isHome, true);
  assert.ok(search.url.startsWith('shiira://search?'));
  assert.equal(search.webview, null);
});

test('startup respects restore-session before choosing the configured home page', async t => {
  const { SidebarMixin } = await load('sidebar');
  const values = preferences(t);
  const remembered = { id: 'saved', itemId: 'saved-item' };
  const activated = [];
  const browser = { focusedSpaceId: 'space', savedActiveItems: { space: 'saved-item' },
    getVisibleTabOrder: () => [remembered], switchTab: id => activated.push(id), createTab: () => activated.push('homepage') };
  SidebarMixin.activateInitialTab.call(browser);
  values.set('shiira-restore-session', 'false');
  SidebarMixin.activateInitialTab.call(browser);
  assert.deepEqual(activated, ['saved', 'homepage']);
});

test('failed credential saves preserve the entered key and can be retried; pending clicks do not duplicate writes', async t => {
  const { HomeSearchMixin } = await load('home-search');
  let resolve;
  let writes = 0;
  const elements = Object.fromEntries(['key', 'status', 'save', 'remove'].map(name => [`search-brave-${name}`, { value: '', disabled: false }]));
  elements['search-brave-key'].value = 'fixture-key';
  installGlobals(t, { document: { getElementById: id => elements[id] }, window: { shiiraAPI: { search: {
    setKey: () => { writes++; return new Promise(done => { resolve = done; }); }
  } } } });
  const browser = { ...HomeSearchMixin };
  const first = browser.saveSearchCredential('brave');
  await browser.saveSearchCredential('brave');
  assert.equal(writes, 1);
  resolve({ success: false, error: 'Keychain unavailable' });
  await first;
  assert.equal(elements['search-brave-key'].value, 'fixture-key');
  assert.equal(elements['search-brave-key'].disabled, false);
  assert.equal(elements['search-brave-status'].textContent, 'Keychain unavailable');
  const retry = browser.saveSearchCredential('brave');
  resolve({ success: true, status: { brave: { configured: true, source: 'keychain' } } });
  await retry;
  assert.equal(elements['search-brave-key'].value, '');
  assert.match(elements['search-brave-status'].textContent, /configured in the system keychain/);
});

test('an older status request cannot overwrite the result of saving a key', async t => {
  const { HomeSearchMixin } = await load('home-search');
  let resolveStatus;
  const elements = Object.fromEntries(['key', 'status', 'save', 'remove'].map(name => [`search-brave-${name}`, { value: 'fixture-key', disabled: false }]));
  installGlobals(t, { document: { getElementById: id => elements[id] }, window: { shiiraAPI: { search: {
    status: () => new Promise(done => { resolveStatus = done; }),
    setKey: async () => ({ success: true, status: { brave: { configured: true, source: 'keychain' } } })
  } } } });
  const browser = { ...HomeSearchMixin };
  const loading = browser.loadSearchCredentials();
  await browser.saveSearchCredential('brave');
  resolveStatus({ brave: { configured: false } });
  await loading;
  assert.match(elements['search-brave-status'].textContent, /configured in the system keychain/);
});
