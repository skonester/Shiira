// Exercise Scira's actual website request, not just the destination URL.
// Live mode loads public website assets but cancels search POSTs before they
// reach Scira. No real keys, authenticated API calls or paid searches are used.
const { app, BrowserWindow, session, webContents } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const appRoot = process.env.SHIIRA_SEARCH_SMOKE_APP_ROOT || path.resolve(__dirname, '..');
const live = process.env.SHIIRA_SCIRA_WEBSITE_LIVE === '1';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-scira-website-'));
const artifacts = path.resolve(__dirname, '../tmp/scira-website-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
if (path.extname(appRoot) === '.asar') {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) });
  app.getAppPath = () => appRoot;
  fs.writeFileSync(path.join(root, 'browser-settings.json'), JSON.stringify({ autoCheckUpdates: false }));
}
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
require(path.join(appRoot, 'src/main/password-service')).prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
const search = require(path.join(appRoot, 'src/main/search-service'));
const OriginalSearchService = search.SearchService;
const keys = new Map();
search.SearchService = class extends OriginalSearchService {
  constructor(options) {
    super({ ...options, env: {}, keychain: { getPassword: async (_service, provider) => keys.get(provider) } });
  }
};
const requests = [];
let apiRequests = 0;
let finished = false;
let deadline;
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({
    success: !error, error: error?.stack, temporaryProfile: root, liveWebsiteAssets: live,
    searchRequestsCanceled: true, realApiKeysUsed: false, apiFixtureRequests: apiRequests, requests
  }, null, 2));
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  app.exit(error ? 1 : 0);
}
process.on('unhandledRejection', finish);
require(path.join(appRoot, 'src/main/main'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, description) {
  for (let n = 0; n < 150; n++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
function installWebsite(ses) {
  const record = (body, webContentsId) => requests.push({ webContentsId, group: body.group, enabledGroups: body.enabledGroups,
    multiAgent: body.multiAgent, query: body.messages?.at(-1)?.parts?.find(p => p.type === 'text')?.text });
  if (!live) ses.protocol.handle('https', async request => {
    if (new URL(request.url).pathname === '/api/search') {
      const body = await request.json();
      const query = body.messages.at(-1).parts[0].text;
      const guest = webContents.getAllWebContents().find(wc => wc.session === ses && new URL(wc.getURL()).searchParams.get('q') === query);
      record(body, guest?.id);
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    }
    // The site's initial script reads sources independently of the URL group.
    // Keeping this at the start of the document catches late dom-ready fixes.
    return new Response(`<!doctype html><script>
      const url = new URL(location.href);
      const query = url.searchParams.get('q');
      if (query) fetch('/api/search', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        group:url.searchParams.get('group') || 'web',
        enabledGroups:JSON.parse(localStorage.getItem('scira-delegate-enabled-groups') || '["web"]'),
        multiAgent:JSON.parse(localStorage.getItem('scira-multi-agent-enabled') || 'false'),
        messages:[{role:'user',parts:[{type:'text',text:query}]}]
      })}).catch(()=>{});
    </script><title>Scira website contract fixture</title>`, { headers: { 'content-type': 'text/html' } });
  });
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const url = new URL(details.url);
    const isScira = url.origin === 'https://scira.ai';
    if (isScira && details.method === 'POST' && /^\/api\/(search|chat)(?:[/?]|$)/.test(url.pathname)) {
      const body = JSON.parse(Buffer.concat((details.uploadData || []).filter(d => d.bytes).map(d => d.bytes)).toString());
      record(body, details.webContentsId);
      callback({ cancel: true });
    } else callback({ cancel: !isScira });
  });
}
function guestFor(win, tabId) {
  return win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(tabId)})?.webview?.getWebContentsId()`)
    .then(id => id && webContents.fromId(id));
}
async function submitted(win, expected, start) {
  await waitFor(() => requests.length > start, `${expected.group} website submission`);
  await delay(250);
  assert.equal(requests.length, start + 1, 'One homepage submit must send one website search');
  const request = requests.at(-1);
  assert.equal(request.group, expected.group);
  assert.deepEqual(request.enabledGroups, [expected.group], 'Scira must enable the selected source, not its saved/default Web source');
  assert.equal(request.query, expected.query);
  if (!live) assert.equal(request.multiAgent, false);
  const guest = webContents.fromId(request.webContentsId);
  const state = await guest.executeJavaScript(`({group:localStorage.getItem('scira-selected-group'), sources:localStorage.getItem('scira-delegate-enabled-groups'), bridge:typeof window.shiiraAPI})`);
  assert.equal(state.group, JSON.stringify(expected.group));
  assert.equal(state.sources, JSON.stringify([expected.group]));
  assert.equal(state.bridge, 'undefined');
  return guest;
}
deadline = setTimeout(() => finish(new Error('Scira website smoke timed out')), 55000);
app.whenReady().then(async () => {
  try {
    let win;
    await waitFor(async () => {
      win = BrowserWindow.getAllWindows()[0];
      return win && win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false);
    }, 'Shiira startup');
    installWebsite(session.fromPartition('persist:main'));
    await session.fromPartition('search-api').protocol.handle('https', () => {
      apiRequests++;
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    });
    const seedId = await win.webContents.executeJavaScript(`(() => { const b=window.ShiiraBrowser; b.finishWelcomeSetup(); return b.createTab('https://scira.ai/'); })()`);
    let seed;
    await waitFor(async () => {
      try { seed = await guestFor(win, seedId); return seed && await seed.executeJavaScript('location.origin === "https://scira.ai" && document.readyState === "complete"'); } catch { return false; }
    }, 'Scira seed page');
    await seed.executeJavaScript(`localStorage.setItem('scira-selected-group','"web"'); localStorage.setItem('scira-delegate-enabled-groups','["web","github"]'); localStorage.setItem('scira-multi-agent-enabled','true');`);
    // Operate the real homepage dropdown and keyboard submit with stale site preferences.
    await win.webContents.executeJavaScript(`(() => { const b=window.ShiiraBrowser; b.createHomeTab(); b.selectSearchEngine('scira'); b.homeSearch.value=''; b.setSciraSearchMode('web'); b.searchScope.focus(); })()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await waitFor(() => win.webContents.executeJavaScript(`window.ShiiraBrowser.sciraSearchMode === 'reddit'`), 'native Reddit selector');
    await win.webContents.executeJavaScript(`(() => { const b=window.ShiiraBrowser; b.homeSearch.value='avgn'; b.homeSearch.focus(); })()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await submitted(win, { group: 'reddit', query: 'avgn' }, 0);
    assert.equal(apiRequests, 0, 'No API key must mean no API platform request');
    await win.webContents.executeJavaScript(`(async () => { const b=window.ShiiraBrowser; b.createHomeTab(); await b.performHomeSearch('browser tabs', 'scira', {mode:'web'}); })()`);
    await submitted(win, { group: 'web', query: 'browser tabs' }, 1);
    const privateId = await win.webContents.executeJavaScript(`window.ShiiraBrowser.createHomeTab({privateMode:true})`);
    installWebsite(session.fromPartition('private:' + privateId));
    await win.webContents.executeJavaScript(`window.ShiiraBrowser.performHomeSearch('browser ideas', 'scira', {mode:'x'})`);
    const privateGuest = await submitted(win, { group: 'x', query: 'browser ideas' }, 2);
    assert.equal(privateGuest.session, session.fromPartition('private:' + privateId));
    assert.equal(apiRequests, 0);
    // An API failure must use the same website source initialization.
    keys.set('scira', 'fixture-scira-key');
    await win.webContents.executeJavaScript(`(async () => { const b=window.ShiiraBrowser; b.createHomeTab(); await b.performHomeSearch('reddit browser discussions', 'scira', {mode:'reddit'}); })()`);
    await submitted(win, { group: 'reddit', query: 'reddit browser discussions' }, 3);
    assert.equal(apiRequests, 1);
    finish();
  } catch (error) { finish(error); }
});
