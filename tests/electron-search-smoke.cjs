// Real Electron main/preload/renderer with fixture provider responses and an
// in-memory keychain. Does not spend API credits or access real search keys.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const appRoot = process.env.SHIIRA_SEARCH_SMOKE_APP_ROOT || path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-search-'));
if (path.extname(appRoot) === '.asar') {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) });
  app.getAppPath = () => appRoot;
  fs.writeFileSync(path.join(root, 'browser-settings.json'), JSON.stringify({ autoCheckUpdates: false }));
}
const artifacts = path.resolve(__dirname, '../tmp/search-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
require(path.join(appRoot, 'src/main/password-service')).prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
const keys = new Map();
const calls = [];
let sciraServerError = false;
let sciraAuthError = false;
let braveAuthError = false;
const search = require(path.join(appRoot, 'src/main/search-service'));
const OriginalSearchService = search.SearchService;
search.SearchService = class extends OriginalSearchService {
  constructor(options) {
    assert.equal(typeof options?.fetchImpl, 'function', 'The app must inject its Electron network transport');
    super({ ...options, env: {}, keychain: {
      getPassword: async (_service, provider) => keys.get(provider),
      setPassword: async (_service, provider, key) => keys.set(provider, key),
      deletePassword: async (_service, provider) => keys.delete(provider)
    } });
  }
};
async function providerResponse(url, options) {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      const parsed = new URL(url);
      let data;
      if (parsed.hostname === 'api.search.brave.com') {
        assert.equal(options.headers['X-Subscription-Token'], 'fixture-brave-key');
        if (braveAuthError) return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
        const second = parsed.searchParams.get('offset') === '1';
        data = { query: { more_results_available: !second }, web: { results: [
          { url: 'https://example.com/browser', title: 'A quieter browser workspace', description: 'Spaces, pinned tabs, and useful search results in one place.' },
          { url: `https://example.org/${second ? 'more' : 'guide'}`, title: second ? 'More browser ideas' : 'A guide to browser privacy', description: 'A concise guide to the tools that help you browse.' },
          { url: 'javascript:alert(1)', title: 'Unsafe source' }
        ] } };
      } else if (parsed.hostname === 'api.scira.ai') {
        assert.equal(options.headers['x-api-key'], 'fixture-scira-key');
        if (sciraAuthError) return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
        const mode = { '/api/search': 'web', '/api/reddit': 'reddit', '/api/xsearch': 'x', '/api/people': 'people' }[parsed.pathname];
        if (sciraServerError === true || sciraServerError === mode) return new Response(null, { status: 500, headers: { 'x-vercel-id': 'cle1::fra1::fixture-failure' } });
        data = mode === 'people' ? { profile: { name: 'Fixture person', bio: 'Researcher', website: 'https://example.com/' } } : { text: '## A calmer way to browse\n\nKeep related projects in separate spaces. Pin the pages you return to, and use temporary tabs for the rest.\n\nThese sources explain browser workflows and privacy controls.',
          sources: ['https://example.com/browser', 'https://example.org/privacy'],
          results: [{ url: 'https://example.com/browser', title: 'Browser workflows people recommend', excerpt: 'A discussion of spaces, pinned tabs and everyday browsing.' }] };
      } else if (parsed.hostname === 'api.duckduckgo.com') {
        data = { Heading: 'Web browser', AbstractText: 'A web browser retrieves and presents information on the web.', AbstractURL: 'https://en.wikipedia.org/wiki/Web_browser' };
      } else throw new Error('Unexpected provider request');
      return new Response(JSON.stringify(data), { headers: { 'content-type': parsed.hostname === 'api.duckduckgo.com' ? 'application/x-javascript' : 'application/json' } });
}
process.on('unhandledRejection', error => finish(error));
require(path.join(appRoot, 'src/main/main'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression) {
  for (let n = 0; n < 100; n++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(50);
  }
  const state = await win.webContents.executeJavaScript(`({ focus: document.activeElement?.id, scope: window.ShiiraBrowser.searchScope?.value, savedScope: window.ShiiraBrowser.sciraSearchMode, status: window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status })`);
  throw new Error(`Search state did not settle: ${expression}; ${JSON.stringify(state)}`);
}
async function press(win, keyCode, completed) {
  keyCode = keyCode.replace(/^Arrow/, '');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await waitFor(win, completed);
}
async function clickOnce(win, expression, completed = `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const button = ${expression};
    if (!button) throw new Error('Search button was not found');
    button.scrollIntoView({ block: 'center' });
    const rect = button.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  for (let n = 0; n < 40; n++) {
    const done = await win.webContents.executeJavaScript(completed);
    if (done) return;
    await delay(50);
  }
  throw new Error('One click did not complete the action');
}
const deadline = setTimeout(() => finish(new Error('Search smoke timed out')), 45000);
function finish(error, details = {}) {
  clearTimeout(deadline);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error, error: error?.stack, temporaryProfile: root, electron: process.versions.electron, fixtureResponses: true, ...details }, null, 2));
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  app.exit(error ? 1 : 0);
}
async function capture(win, name, width = 1280, height = 800) {
  const markup = await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('input').forEach(input => { if (input.type !== 'password') input.setAttribute('value', input.value); });
    document.querySelectorAll('option').forEach(option => option.toggleAttribute('selected', option.selected));
    return document.documentElement.outerHTML;
  })()`);
  const base = pathToFileURL(path.join(appRoot, 'src/renderer') + path.sep).href;
  const file = path.join(artifacts, `${name}.html`);
  fs.writeFileSync(file, markup.replace('<head>', `<head><base href="${base}">`).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  const preview = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true } });
  await preview.loadFile(file);
  await delay(200);
  fs.writeFileSync(path.join(artifacts, `${name}.png`), (await preview.webContents.capturePage()).toPNG());
  preview.destroy();
}
app.whenReady().then(async () => {
  try {
    // Intercept only the API partition. Requests still pass through the app's
    // real Electron session.fetch transport, without contacting live providers.
    session.fromPartition('search-api').protocol.handle('https', async request => {
      assert.equal(request.headers.get('cookie'), null);
      const headers = Object.fromEntries(request.headers);
      headers['X-Subscription-Token'] = request.headers.get('X-Subscription-Token');
      return providerResponse(request.url, { headers, body: request.method === 'POST' ? await request.text() : undefined });
    });
    let win;
    for (let n = 0; n < 120; n++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false)) break;
      await delay(200);
    }
    assert.ok(win);
    session.fromPartition('persist:main').webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
    const missing = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; b.finishWelcomeSetup(); b.createHomeTab();
      const id = b.activeTabId, tabCount = b.tabs.length;
      await b.performHomeSearch('browser workflows', 'brave');
      const tab = b.tabs.find(t => t.id === id);
      return { sameTab: b.activeTabId === id && b.tabs.length === tabCount, url: tab.url, src: tab.webview.src, isHome: tab.isHome,
        webviews: document.querySelectorAll('webview').length,
        removed: !document.querySelector('[data-engine="startpage"]'), status: await window.shiiraAPI.search.status() };
    })()`);
    assert.equal(missing.sameTab, true);
    assert.equal(missing.url, 'https://search.brave.com/search?q=browser+workflows&source=web');
    assert.equal(missing.src, missing.url);
    assert.equal(missing.isHome, false);
    assert.equal(missing.webviews, 1);
    assert.equal(missing.removed, true);
    assert.equal(missing.status.brave.configured, false);
    assert.equal(calls.length, 0);
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.showSettings('search');
      document.getElementById('search-brave-key').value = 'fixture-brave-key';
    })()`);
    await clickOnce(win, `document.getElementById('search-brave-save')`, `document.getElementById('search-brave-status').textContent.includes('in the system keychain')`);
    const brave = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; b.hideSettings(); b.createHomeTab();
      await b.performHomeSearch('browser workflows', 'brave');
      const tab = b.tabs.find(t => t.id === b.activeTabId);
      return { status: tab.searchState.status, results: tab.searchState.result.results.length, more: tab.searchState.result.more,
        keyCleared: document.getElementById('search-brave-key').value === '', url: tab.url, isHome: tab.isHome, hasWebview: Boolean(tab.webview) };
    })()`);
    assert.equal(brave.status, 'done');
    assert.equal(brave.results, 2);
    assert.equal(brave.more, true);
    assert.equal(brave.keyCleared, true);
    assert.equal(brave.isHome, true);
    assert.equal(brave.hasWebview, false);
    assert.ok(brave.url.startsWith('shiira://search?'));
    await capture(win, 'brave-results');
    const more = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; await b.performHomeSearch('browser workflows', 'brave', { page: 1 });
      return b.tabs.find(t => t.id === b.activeTabId).searchState.result.results.length;
    })()`);
    assert.equal(more, 3);
    braveAuthError = true;
    const braveErrorCalls = calls.length;
    const braveFallback = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser, id = b.activeTabId, count = b.tabs.length;
      await b.performHomeSearch('browser workflows', 'brave');
      const tab = b.tabs.find(t => t.id === id);
      return { sameTab: b.activeTabId === id && b.tabs.length === count, url: tab.url, src: tab.webview.src,
        notice: !document.getElementById('search-fallback-notice').classList.contains('hidden'),
        message: document.getElementById('search-fallback-message').textContent };
    })()`);
    assert.equal(braveFallback.sameTab, true);
    assert.equal(braveFallback.url, 'https://search.brave.com/search?q=browser+workflows&source=web');
    assert.equal(braveFallback.src, braveFallback.url);
    assert.equal(braveFallback.notice, true);
    assert.match(braveFallback.message, /rejected the API credentials/);
    assert.equal(calls.length, braveErrorCalls + 1);
    await capture(win, 'brave-api-fallback');
    braveAuthError = false;
    await win.webContents.executeJavaScript(`(() => {
      window.ShiiraBrowser.showSettings('search');
    })()`);
    const credentialError = await win.webContents.executeJavaScript(`(async () => {
      await window.ShiiraBrowser.loadSearchCredentials();
      return document.getElementById('search-brave-status').textContent;
    })()`);
    assert.match(credentialError, /rejected the API credentials/);
    const beforeSetup = calls.length;
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.hideSettings(); b.createHomeTab();
      b.selectSearchEngine('scira'); b.searchScope.value = 'web'; b.homeSearch.value = ''; b.searchScope.focus();
    })()`);
    await press(win, 'ArrowDown', `window.ShiiraBrowser.sciraSearchMode === 'reddit'`);
    await win.webContents.executeJavaScript(`(() => { const b = window.ShiiraBrowser; b.homeSearch.value = 'How can I make my browser workspace calmer?'; b.homeSearch.focus(); })()`);
    await press(win, 'Enter', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.webview?.src.startsWith('https://scira.ai/') === true`);
    const noKey = await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser;
      const tab = b.tabs.find(t => t.id === b.activeTabId);
      return { url: tab.webview.src, hasWebview: Boolean(tab.webview), isHome: tab.isHome,
        blockedByKeyForm: Boolean(document.getElementById('home-scira-key')), settingsVisible: !b.settingsModal.classList.contains('hidden') };
    })()`);
    assert.equal(noKey.hasWebview, true);
    assert.equal(noKey.isHome, false);
    assert.equal(noKey.blockedByKeyForm, false);
    assert.equal(noKey.settingsVisible, false);
    assert.equal(new URL(noKey.url).hostname, 'scira.ai');
    assert.equal(new URL(noKey.url).searchParams.get('q'), 'How can I make my browser workspace calmer?');
    assert.equal(new URL(noKey.url).searchParams.get('group'), 'reddit');
    assert.equal(calls.length, beforeSetup);
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.showSettings('search');
      document.getElementById('search-scira-key').value = 'fixture-scira-key';
    })()`);
    await clickOnce(win, `document.getElementById('search-scira-save')`, `document.getElementById('search-scira-status').textContent.includes('in the system keychain')`);
    await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; b.hideSettings(); b.createHomeTab();
      await b.performHomeSearch('How can I make my browser workspace calmer?', 'scira', { mode: 'reddit' });
    })()`);
    assert.equal(calls.length, beforeSetup + 1);
    const scira = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser;
      return { status: b.tabs.find(t => t.id === b.activeTabId).searchState.status,
        title: b.searchBadge.textContent, cards: document.querySelectorAll('.home-search-result').length,
        safe: !document.querySelector('#ai-search-content a[href^="javascript:"]'), keys: await window.shiiraAPI.search.status() };
    })()`);
    assert.equal(scira.status, 'done');
    assert.equal(scira.cards, 2);
    assert.equal(scira.safe, true);
    assert.equal(scira.keys.scira.configured, true);
    assert.equal(JSON.stringify(scira).includes('fixture-scira-key'), false);
    await capture(win, 'scira-results');
    // Select Reddit on an empty homepage using the native dropdown, then submit
    // with Enter and with the arrow button. Assert the actual endpoint and body.
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.createHomeTab(); b.selectSearchEngine('scira');
      b.searchScope.value = 'web'; b.homeSearch.value = ''; b.searchScope.focus();
    })()`);
    const scopeCalls = calls.length;
    await press(win, 'ArrowDown', `window.ShiiraBrowser.sciraSearchMode === 'reddit'`);
    assert.equal(calls.length, scopeCalls);
    await win.webContents.executeJavaScript(`(() => { const b = window.ShiiraBrowser; b.homeSearch.value = 'coolgithubprojects'; b.homeSearch.focus(); })()`);
    await press(win, 'Enter', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.query === 'coolgithubprojects' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/reddit');
    assert.deepEqual(calls.at(-1).body, { query: 'coolgithubprojects' });
    await win.webContents.executeJavaScript(`window.ShiiraBrowser.homeSearch.value = 'cool github projects & rust'`);
    await clickOnce(win, `document.getElementById('home-search-submit')`, `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.query === 'cool github projects & rust' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/reddit');
    assert.deepEqual(calls.at(-1).body, { query: 'cool github projects & rust' });
    await win.webContents.executeJavaScript(`window.ShiiraBrowser.searchScope.focus()`);
    await press(win, 'ArrowDown', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.mode === 'x' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/xsearch');
    await press(win, 'ArrowDown', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.mode === 'people' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/people');
    // A new tab remembers the last choice; older tabs keep their own scope.
    const scopeTabs = await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser, source = b.activeTabId;
      b.createHomeTab(); const fresh = b.activeTabId, freshMode = b.searchScope.value;
      b.setSciraSearchMode('reddit'); b.switchTab(source);
      const oldMode = b.searchScope.value; b.switchTab(fresh);
      return { freshMode, oldMode, restoredBlankMode: b.searchScope.value };
    })()`);
    assert.deepEqual(scopeTabs, { freshMode: 'people', oldMode: 'people', restoredBlankMode: 'reddit' });
    await win.webContents.executeJavaScript(`(() => { const b = window.ShiiraBrowser; b.urlInput.value = 'reddit projects from the address bar'; b.urlInput.focus(); })()`);
    await press(win, 'Enter', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.query === 'reddit projects from the address bar' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/reddit');
    // A Web 500 must not prevent a later, valid Reddit request.
    sciraServerError = 'web';
    await win.webContents.executeJavaScript(`window.ShiiraBrowser.searchScope.focus()`);
    await press(win, 'Home', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchFallback?.mode === 'web'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/search');
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.createHomeTab(); b.selectSearchEngine('scira');
      b.homeSearch.value = ''; b.searchScope.focus();
    })()`);
    await press(win, 'ArrowDown', `window.ShiiraBrowser.sciraSearchMode === 'reddit'`);
    await win.webContents.executeJavaScript(`(() => { const b = window.ShiiraBrowser; b.homeSearch.value = 'Reddit still works after a Web failure'; b.homeSearch.focus(); })()`);
    await press(win, 'Enter', `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/reddit');
    sciraServerError = false;
    sciraAuthError = true;
    const rejected = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; await b.performHomeSearch('rejected key fixture', 'scira');
      const tab = b.tabs.find(t => t.id === b.activeTabId);
      return { code: tab.searchFallback.code, url: tab.webview.src };
    })()`);
    assert.equal(rejected.code, 'authentication');
    assert.equal(new URL(rejected.url).hostname, 'scira.ai');
    assert.equal(new URL(rejected.url).searchParams.get('group'), 'reddit');
    sciraAuthError = false;
    sciraServerError = true;
    const fallbackCalls = calls.length;
    const upstream = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; b.createHomeTab(); const id = b.activeTabId, count = b.tabs.length;
      await b.performHomeSearch('web browser & tabs', 'scira', { retry: true });
      const tab = b.tabs.find(t => t.id === id);
      return { sameTab: b.activeTabId === id && b.tabs.length === count, url: tab.url, hasWebview: Boolean(tab.webview),
        fallback: tab.searchFallback, message: document.getElementById('search-fallback-message').textContent };
    })()`);
    assert.equal(upstream.sameTab, true);
    assert.equal(new URL(upstream.url).searchParams.get('q'), 'web browser & tabs');
    assert.equal(new URL(upstream.url).searchParams.get('group'), 'reddit');
    assert.equal(upstream.hasWebview, true);
    assert.equal(upstream.fallback.mode, 'reddit');
    assert.equal(upstream.fallback.query, 'web browser & tabs');
    assert.match(upstream.message, /Opened Scira Reddit search/);
    assert.equal(new URL(upstream.url).hostname, 'scira.ai');
    assert.equal(upstream.message.includes('HTTP'), false);
    assert.equal(calls.length, fallbackCalls + 1);
    win.setSize(560, 760);
    await delay(100);
    const noticeFits = await win.webContents.executeJavaScript(`(() => {
      const rect = document.getElementById('search-fallback-notice').getBoundingClientRect();
      const content = window.ShiiraBrowser.browserContent.getBoundingClientRect();
      return rect.width > 0 && rect.left >= content.left && rect.right <= content.right;
    })()`);
    assert.equal(noticeFits, true);
    await capture(win, 'scira-reddit-fallback-narrow', 560, 760);
    const guardedCalls = calls.length;
    const guarded = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser;
      await b.performHomeSearch('another query during the failure pause', 'scira');
      return b.tabs.find(t => t.id === b.activeTabId).searchFallback.retryBlocked;
    })()`);
    assert.equal(guarded, true);
    assert.equal(calls.length, guardedCalls);
    sciraServerError = false;
    await clickOnce(win, `document.getElementById('search-fallback-retry')`);
    assert.equal(calls.length, guardedCalls + 1);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/reddit');
    assert.deepEqual(calls.at(-1).body, { query: 'another query during the failure pause' });
    win.setSize(1280, 800);
    await delay(100);
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.createHomeTab(); b.homeSearch.value = 'web browser';
    })()`);
    const duckCalls = calls.length;
    await clickOnce(win, `document.querySelector('.search-engine-chip[data-engine="duckduckgo"]')`, `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.provider === 'duckduckgo' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    const fallback = await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser, state = b.tabs.find(t => t.id === b.activeTabId).searchState;
      return { provider: state.provider, status: state.status, selected: document.querySelector('.search-engine-chip.active').dataset.engine, answer: state.result.answer };
    })()`);
    assert.equal(fallback.provider, 'duckduckgo');
    assert.equal(fallback.status, 'done');
    assert.equal(fallback.selected, 'duckduckgo');
    assert.ok(fallback.answer);
    assert.equal(calls.length, duckCalls + 1);
    await capture(win, 'duckduckgo-first-click');
    sciraServerError = false;
    const chipCalls = calls.length;
    await clickOnce(win, `document.querySelector('.search-engine-chip[data-engine="scira"]')`, `window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.provider === 'scira' && window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId)?.searchState?.status === 'done'`);
    assert.equal(await win.webContents.executeJavaScript('window.ShiiraBrowser.currentSearchEngine'), 'scira');
    assert.equal(calls.length, chipCalls + 1);
    assert.equal(new URL(calls.at(-1).url).pathname, '/api/reddit');
    win.setSize(560, 760);
    await delay(100);
    const fits = await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser, panel = b.searchPanel.getBoundingClientRect(), content = b.browserContent.getBoundingClientRect();
      return panel.width > 0 && panel.left >= content.left && panel.right <= content.right;
    })()`);
    assert.equal(fits, true);
    await capture(win, 'scira-narrow', 560, 760);
    const requestCount = calls.length;
    const restored = await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser, current = b.tabs.find(t => t.id === b.activeTabId);
      const id = b.createTab(current.url, { deferLoad: true }); b.switchTab(id);
      return b.tabs.find(t => t.id === id).searchState.status;
    })()`);
    assert.equal(restored, 'restored');
    assert.equal(calls.length, requestCount);
    const privateSaved = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; b.createTab(null, { privateMode: true });
      await b.performHomeSearch('private query fixture', 'duckduckgo'); await b.saveSession();
      const state = await window.shiiraAPI.session.load();
      return { savedPrivate: state.tabs.some(t => t.url.includes('private+query+fixture')), status: b.tabs.find(t => t.id === b.activeTabId).searchState.status };
    })()`);
    assert.equal(privateSaved.savedPrivate, false);
    assert.equal(privateSaved.status, 'done');
    const privateId = await win.webContents.executeJavaScript('window.ShiiraBrowser.activeTabId');
    session.fromPartition('private:' + privateId).webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
    sciraServerError = true;
    const privateFallback = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser, id = b.activeTabId;
      const pending = b.performHomeSearch('private fallback fixture', 'scira');
      const other = b.createHomeTab();
      await pending;
      const source = b.tabs.find(t => t.id === id);
      await b.saveSession();
      const saved = await window.shiiraAPI.session.load();
      return { hasWebview: Boolean(source.webview), partition: source.webview.getAttribute('partition'), query: source.searchFallback.query, url: source.url, stillPrivate: source.privateMode,
        saved: saved.tabs.some(t => t.url.includes('private+fallback+fixture')),
        sameActiveTab: b.activeTabId === other, activeUrl: b.urlInput.value, welcomeVisible: !b.welcomePage.classList.contains('hidden'),
        backgroundInactive: !source.element.classList.contains('active') };
    })()`);
    assert.equal(privateFallback.hasWebview, true);
    assert.ok(privateFallback.partition.startsWith('private:'));
    assert.equal(privateFallback.query, 'private fallback fixture');
    assert.equal(new URL(privateFallback.url).searchParams.get('q'), 'private fallback fixture');
    assert.equal(new URL(privateFallback.url).searchParams.get('group'), 'reddit');
    assert.equal(privateFallback.stillPrivate, true);
    assert.equal(privateFallback.saved, false);
    assert.equal(privateFallback.sameActiveTab, true);
    assert.equal(privateFallback.activeUrl, '');
    assert.equal(privateFallback.welcomeVisible, true);
    assert.equal(privateFallback.backgroundInactive, true);
    finish(null, { missingKeyWebsiteFallback: true, brave, brave401WebsiteFallback: true, scira,
      sciraWithoutKeyOpensScira: noKey, sciraRejectedKeyOpensScira: rejected, sciraServerErrorOpensScira: upstream, noKeyWebSearch: true, failedRequestsPaused: true,
      nativeHomepageScopeSelection: true, enterAndArrowRetainReddit: true, addressBarRetainsReddit: true, scopeTabs, webFailureDoesNotBlockReddit: true,
      duckDuckGoWorksOnFirstClick: true, providerChipWorksOnFirstClick: true,
      chromiumTransport: true, narrowLayoutFits: fits, restoredSearchDoesNotRequest: true, privateSearchNotSaved: true, privateFallback, calls: calls.length });
  } catch (error) { finish(error); }
});
