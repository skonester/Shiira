// Two real Electron launches share an isolated profile and temporary OS keychain
// entries. HTTP responses are fixtures; no real provider keys or API credits are used.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const keytar = require('keytar');
const root = process.env.SHIIRA_SETTINGS_SMOKE_PROFILE;
const phase = process.env.SHIIRA_SETTINGS_SMOKE_PHASE;
assert.ok(root && ['write', 'read', 'cleanup'].includes(phase), 'Run through test:settings:electron');
const service = `Shiira settings smoke ${path.basename(root)}`;
const providers = ['brave', 'scira'];
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });

async function cleanup() {
  await Promise.all(providers.map(provider => keytar.deletePassword(service, provider)));
}
if (phase === 'cleanup') {
  app.whenReady().then(cleanup).then(() => app.exit(0), () => app.exit(1));
} else {
  require('../src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
  const search = require('../src/main/search-service');
  const OriginalSearchService = search.SearchService;
  const requests = [];
  search.SearchService = class extends OriginalSearchService {
    constructor() {
      super({ env: {}, keychain: {
        getPassword: (_service, provider) => keytar.getPassword(service, provider),
        setPassword: (_service, provider, key) => keytar.setPassword(service, provider, key),
        deletePassword: (_service, provider) => keytar.deletePassword(service, provider)
      }, fetchImpl: async (url, options) => {
        const provider = new URL(url).hostname === 'api.scira.ai' ? 'scira' : 'brave';
        assert.equal(options.headers[provider === 'brave' ? 'X-Subscription-Token' : 'x-api-key'], `fixture-${provider}-key`);
        requests.push(provider);
        return new Response(JSON.stringify(provider === 'brave' ? { web: { results: [] } } : { text: 'Fixture answer', sources: [] }), { headers: { 'content-type': 'application/json' } });
      } });
    }
  };
  require('../src/main/main');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let finished = false;
  const deadline = setTimeout(() => void finish(new Error('Settings smoke timed out')), 30000);
  async function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    if (phase === 'read' || error) await cleanup().catch(() => {});
    fs.writeFileSync(path.join(root, `settings-${phase}.json`), JSON.stringify({ success: !error, phase, error: error?.stack, nativeKeychain: true, requests }, null, 2));
    BrowserWindow.getAllWindows().forEach(win => win.destroy());
    app.exit(error ? 1 : 0);
  }
  async function waitFor(win, expression) {
    for (let n = 0; n < 100; n++) {
      if (await win.webContents.executeJavaScript(expression).catch(() => false)) return;
      await delay(50);
    }
    throw new Error(`Settings action did not finish: ${expression}`);
  }
  async function click(win, id) {
    const point = await win.webContents.executeJavaScript(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
      if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Settings control is covered');
      return { x, y };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await delay(50);
  }
  app.whenReady().then(async () => {
    try {
      let win;
      for (let n = 0; n < 100; n++) {
        win = BrowserWindow.getAllWindows()[0];
        if (win && await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded && window.ShiiraBrowser.activeTabId)').catch(() => false)) break;
        await delay(100);
      }
      assert.ok(win);
      session.fromPartition('persist:main').webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
      if (phase === 'write') {
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.setSciraSearchMode('reddit')`);
        await win.webContents.executeJavaScript(`(() => {
          const b = window.ShiiraBrowser; b.finishWelcomeSetup(); b.showSettings('general');
          document.getElementById('settings-homepage').value = 'google.com';
        })()`);
        await click(win, 'settings-save-homepage');
        assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('shiira-homepage-url')`), 'https://google.com/');
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.selectSettingsSection('startup')`);
        await click(win, 'settings-restore-session');
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.selectSettingsSection('downloads')`);
        await click(win, 'settings-ask-download');
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.selectSettingsSection('updates')`);
        await click(win, 'settings-auto-updates');
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.selectSettingsSection('search')`);
        for (const provider of providers) {
          await win.webContents.executeJavaScript(`(() => {
            const input = document.getElementById('search-${provider}-key');
            input.value = 'fixture-${provider}-key'; input.focus();
          })()`);
          if (provider === 'brave') await click(win, 'search-brave-save');
          else {
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
          }
          await waitFor(win, `document.getElementById('search-${provider}-status').textContent.includes('in the system keychain') && !document.getElementById('search-${provider}-key').disabled`);
          assert.equal(await keytar.getPassword(service, provider), `fixture-${provider}-key`);
        }
        const destinations = await win.webContents.executeJavaScript(`(async () => {
          const b = window.ShiiraBrowser; b.hideSettings();
          const id = b.createTab(), normal = b.tabs.find(t => t.id === id);
          const fresh = normal.webview.src;
          b.navigate('https://example.com/'); b.goHome();
          const home = normal.webview.src;
          const privateId = b.createTab(null, { privateMode: true });
          const privateHome = b.tabs.find(t => t.id === privateId).isHome;
          await b.saveSession();
          return { fresh, home, privateHome, restore: localStorage.getItem('shiira-restore-session') };
        })()`);
        assert.deepEqual(destinations, { fresh: 'https://google.com/', home: 'https://google.com/', privateHome: true, restore: 'false' });
        session.defaultSession.flushStorageData();
      } else {
        const state = await win.webContents.executeJavaScript(`(async () => {
          const b = window.ShiiraBrowser, tab = b.tabs.find(t => t.id === b.activeTabId);
          return { url: tab.url, src: tab.webview?.src, scope: b.searchScope.value, settings: await window.shiiraAPI.browserSettings.get(), credentials: await window.shiiraAPI.search.status() };
        })()`);
        assert.equal(state.url, 'https://google.com/');
        assert.equal(state.src, state.url);
        assert.equal(state.scope, 'reddit');
        assert.equal(state.settings.askWhereToSave, false);
        assert.equal(state.settings.autoCheckUpdates, false);
        for (const provider of providers) {
          assert.deepEqual(state.credentials[provider], { configured: true, source: 'keychain' });
          const status = await win.webContents.executeJavaScript(`(async () => {
            const b = window.ShiiraBrowser; b.createHomeTab();
            await b.performHomeSearch('saved key fixture', '${provider}');
            return b.tabs.find(t => t.id === b.activeTabId).searchState?.status;
          })()`);
          assert.equal(status, 'done');
        }
        assert.deepEqual(requests, providers);
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.showSettings('search')`);
        for (const provider of providers) {
          await click(win, `search-${provider}-remove`);
          await waitFor(win, `document.getElementById('search-${provider}-status').textContent === 'No API key configured.'`);
          assert.equal(await keytar.getPassword(service, provider), null);
        }
        await win.webContents.executeJavaScript(`window.ShiiraBrowser.selectSettingsSection('general')`);
        await click(win, 'settings-reset-homepage');
        const reset = await win.webContents.executeJavaScript(`(() => {
          const b = window.ShiiraBrowser; b.hideSettings();
          const id = b.createTab('https://example.com/'); b.goHome();
          const tab = b.tabs.find(t => t.id === id);
          return { url: tab.url, home: tab.isHome, webview: Boolean(tab.webview),
            guests: Array.from(document.querySelectorAll('webview')).filter(view => view.id === id).length };
        })()`);
        assert.deepEqual(reset, { url: 'shiira://home', home: true, webview: false, guests: 0 });
        assert.equal(await win.webContents.executeJavaScript(`(() => {
          const b = window.ShiiraBrowser; b.hideSettings(); const id = b.createTab();
          return b.tabs.find(t => t.id === id).isHome;
        })()`), true);
      }
      await finish();
    } catch (error) { await finish(error); }
  });
}
