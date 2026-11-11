// Real Electron main/preload/renderer with fixture provider responses and an
// in-memory keychain. Does not spend API credits or access real search keys.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-search-'));
const artifacts = path.resolve(__dirname, '../tmp/search-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
require('../src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
const keys = new Map();
const calls = [];
const search = require('../src/main/search-service');
const OriginalSearchService = search.SearchService;
search.SearchService = class extends OriginalSearchService {
  constructor() {
    super({ env: {}, keychain: {
      getPassword: async (_service, provider) => keys.get(provider),
      setPassword: async (_service, provider, key) => keys.set(provider, key),
      deletePassword: async (_service, provider) => keys.delete(provider)
    }, fetchImpl: async (url, options) => {
      calls.push({ url });
      const parsed = new URL(url);
      let data;
      if (parsed.hostname === 'api.search.brave.com') {
        assert.equal(options.headers['X-Subscription-Token'], 'fixture-brave-key');
        const second = parsed.searchParams.get('offset') === '1';
        data = { query: { more_results_available: !second }, web: { results: [
          { url: 'https://example.com/browser', title: 'A quieter browser workspace', description: 'Spaces, pinned tabs, and useful search results in one place.' },
          { url: `https://example.org/${second ? 'more' : 'guide'}`, title: second ? 'More browser ideas' : 'A guide to browser privacy', description: 'A concise guide to the tools that help you browse.' },
          { url: 'javascript:alert(1)', title: 'Unsafe source' }
        ] } };
      } else if (parsed.hostname === 'api.scira.ai') {
        assert.equal(options.headers['x-api-key'], 'fixture-scira-key');
        data = { text: '## A calmer way to browse\n\nKeep related projects in separate spaces. Pin the pages you return to, and use temporary tabs for the rest.\n\nThese sources explain browser workflows and privacy controls.',
          sources: ['https://example.com/browser', 'https://example.org/privacy'],
          results: [{ url: 'https://example.com/browser', title: 'Browser workflows people recommend', excerpt: 'A discussion of spaces, pinned tabs and everyday browsing.' }] };
      } else if (parsed.hostname === 'api.duckduckgo.com') {
        data = { Heading: 'Web browser', AbstractText: 'A web browser retrieves and presents information on the web.', AbstractURL: 'https://en.wikipedia.org/wiki/Web_browser' };
      } else throw new Error('Unexpected provider request');
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    } });
  }
};
require('../src/main/main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const base = pathToFileURL(path.resolve(__dirname, '../src/renderer') + path.sep).href;
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
      await b.performHomeSearch('browser workflows', 'brave');
      return { code: b.tabs.find(t => t.id === b.activeTabId).searchState.code, webviews: document.querySelectorAll('webview').length,
        removed: !document.querySelector('[data-engine="startpage"]'), status: await window.shiiraAPI.search.status() };
    })()`);
    assert.equal(missing.code, 'missing_key');
    assert.equal(missing.webviews, 0);
    assert.equal(missing.removed, true);
    assert.equal(missing.status.brave.configured, false);
    assert.equal(calls.length, 0);
    const brave = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser;
      document.getElementById('search-brave-key').value = 'fixture-brave-key';
      await b.saveSearchCredential('brave');
      await b.performHomeSearch('browser workflows', 'brave');
      const tab = b.tabs.find(t => t.id === b.activeTabId);
      return { status: tab.searchState.status, results: tab.searchState.result.results.length, more: tab.searchState.result.more,
        keyCleared: document.getElementById('search-brave-key').value === '', url: tab.url, webviews: document.querySelectorAll('webview').length };
    })()`);
    assert.equal(brave.status, 'done');
    assert.equal(brave.results, 2);
    assert.equal(brave.more, true);
    assert.equal(brave.keyCleared, true);
    assert.equal(brave.webviews, 0);
    assert.ok(brave.url.startsWith('shiira://search?'));
    await capture(win, 'brave-results');
    const more = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser; await b.performHomeSearch('browser workflows', 'brave', { page: 1 });
      return b.tabs.find(t => t.id === b.activeTabId).searchState.result.results.length;
    })()`);
    assert.equal(more, 3);
    const scira = await win.webContents.executeJavaScript(`(async () => {
      const b = window.ShiiraBrowser;
      document.getElementById('search-scira-key').value = 'fixture-scira-key'; await b.saveSearchCredential('scira');
      b.selectSearchEngine('scira'); b.searchScope.value = 'reddit';
      await b.performHomeSearch('How can I make my browser workspace calmer?', 'scira', { mode: 'reddit' });
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
    const privatePartition = await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser; b.navigate('https://example.com/private');
      return b.tabs.find(t => t.id === b.activeTabId).webview.getAttribute('partition');
    })()`);
    assert.ok(privatePartition.startsWith('private:'));
    finish(null, { missingKey: missing.code, brave, scira, narrowLayoutFits: fits, restoredSearchDoesNotRequest: true, privateSearchNotSaved: true, privateNavigationPartition: true, calls: calls.length });
  } catch (error) { finish(error); }
});
