// Real main/preload/renderer integration, with disposable browser data and local fixtures.
const { app, BrowserWindow, dialog, clipboard, webContents } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const appRoot = process.env.SHIIRA_SMOKE_APP_ROOT ? path.resolve(process.env.SHIIRA_SMOKE_APP_ROOT) : path.resolve(__dirname, '..');
const loadApp = file => require(path.join(appRoot, file));
if (process.env.SHIIRA_SMOKE_APP_ROOT) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) });
  app.getAppPath = () => appRoot;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-orbe-'));
const artifacts = path.resolve(__dirname, '../tmp/orbe-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
loadApp('src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
let copiedText, copiedItems;
clipboard.writeText = async text => { copiedText = text; };
clipboard.write = async items => { copiedItems = items; };
const source = path.join(root, 'source.html');
const original = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><H3>Research</H3><DL><A HREF="https://example.com/?x=1&amp;y=2">Saved page</A></DL><A HREF="https://second.example/">Second</A></DL>';
fs.writeFileSync(source, original);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
dialog.showSaveDialog = async (_win, options) => ({ canceled: false, filePath: path.join(root, options.defaultPath.endsWith('.html') ? 'export.html' : 'capture.png') });
const server = http.createServer((req, res) => {
  if (req.url === '/media.mp4') {
    const media = fs.readFileSync(path.join(__dirname, 'fixtures/youtube/fixture-0.mp4'));
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': media.length });
    res.end(media);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><head><title>Local ${req.url}</title></head><body style="background:#e8e8f0;color:#111;min-height:1200px"><h1>Local ${req.url}</h1><input aria-label="Draft" id="draft"><p id="content">Page content</p><div id="ad">Hide this element</div></body></html>`);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let finished = false, phase = 'startup';
const deadline = setTimeout(() => finish(new Error('Orbe integration smoke timed out')), 75000);
function finish(error, details = {}) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  server.close();
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error, error: error?.stack, phase, temporaryProfile: root, ...details }, null, 2));
  app.exit(error ? 1 : 0);
}
loadApp('src/main/main');
async function until(fn, message) {
  for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error(message);
}
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const win = await until(async () => {
      const candidate = BrowserWindow.getAllWindows().find(w => w.webContents.getLastWebPreferences().webviewTag);
      return candidate && await candidate.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false) ? candidate : null;
    }, 'Browser did not initialize');
    const run = script => win.webContents.executeJavaScript(script, true);
    await run(`window.ShiiraBrowser.finishWelcomeSetup(); window.ShiiraBrowser.closeAllPopups(); localStorage.setItem('shiira-auto-pip', 'false');`);
    // Select only the fixture; the worker's browser detection is covered by unit fixtures.
    const imported = await run(`(async () => {
      const b = window.ShiiraBrowser;
      b.browserImportDialog.classList.remove('hidden');
      document.getElementById('browser-import-source').innerHTML = '<option value="file">Bookmarks HTML file…</option>';
      b.updateBrowserImportProfiles();
      await b.previewBrowserImport();
      const preview = document.getElementById('browser-import-summary').textContent;
      document.getElementById('browser-import-name').value = 'Migrated';
      await b.applyBrowserImport();
      return { preview, status: document.getElementById('browser-import-summary').textContent,
        saved: await window.shiiraAPI.spaces.load(), sleeping: b.tabs.filter(t => t.section === 'pinned').every(t => !t.webview) };
    })()`);
    assert.ok(imported.preview.includes('2 bookmarks'));
    assert.ok(imported.status.includes('Imported 2'));
    assert.equal(imported.sleeping, true);
    assert.equal(imported.saved.items.length, 2);
    assert.equal(imported.saved.folders[0].title, 'Research');
    assert.equal(imported.saved.spaces.find(s => s.id === imported.saved.focusedSpaceId).title, 'Migrated');
    assert.equal(fs.readFileSync(source, 'utf8'), original);
    const markup = await run('document.documentElement.outerHTML');
    const htmlFile = path.join(artifacts, 'import.html');
    const baseFile = pathToFileURL(path.resolve(__dirname, '../src/renderer') + path.sep).href;
    fs.writeFileSync(htmlFile, markup.replace('<head>', `<head><base href="${baseFile}">`).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    const preview = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true } });
    await preview.loadFile(htmlFile);
    await delay(200);
    fs.writeFileSync(path.join(artifacts, 'import.png'), (await preview.webContents.capturePage()).toPNG());
    preview.destroy();
    phase = 'bookmarks bar'; console.log('[Orbe smoke]', phase);
    const bar = await run(`(async () => { const b = window.ShiiraBrowser; await b.previewBrowserImport(); document.getElementById('browser-import-target').value = 'bar'; await b.applyBrowserImport(); return await window.shiiraAPI.bookmarks.get(); })()`);
    assert.equal(bar.barEnabled, true);
    const barFile = JSON.parse(fs.readFileSync(path.join(root, 'bookmarks.json'), 'utf8'));
    assert.ok(Object.keys(barFile.bookmarks.folders).length >= 2);
    phase = 'Space export'; console.log('[Orbe smoke]', phase);
    const exportResult = await run('(async () => { const b = window.ShiiraBrowser; b.hideBrowserImport(); await b.exportSpaceBookmarks(); return true; })()');
    assert.equal(exportResult, true);
    assert.equal(require('../src/main/import-bookmarks').parse(fs.readFileSync(path.join(root, 'export.html'), 'utf8')).bookmarks, 2);
    phase = 'local pages'; console.log('[Orbe smoke]', phase);
    const ids = await run(`(() => { const b = window.ShiiraBrowser; return ['a','b','c','d'].map(name => b.createTab(${JSON.stringify(base)} + '/' + name)); })()`);
    await until(() => run(`window.ShiiraBrowser.tabs.filter(t => ${JSON.stringify(ids)}.includes(t.id)).every(t => t.webview && t.title.startsWith('Local'))`), 'Local pages did not load');
    const split = await run(`(() => {
      const b = window.ShiiraBrowser, ids = ${JSON.stringify(ids)};
      b.switchTab(ids[0]); ids.slice(1).forEach(id => b.openSplitView(id));
      const count = b.splitPair.length;
      const grid = b.tabs.filter(t => ids.includes(t.id)).map(t => { const r = t.webview.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
      b.setSplitLayout('rows'); const rowHeight = b.tabs.find(t => t.id === ids[0]).webview.getBoundingClientRect().height;
      b.closeTab(ids[3], true);
      const afterClose = b.splitPair?.length;
      const afterCloseVisible = b.browserContent.querySelectorAll('webview.split-pane').length;
      b.exitSplitView();
      return { count, grid, rowHeight, afterClose, afterCloseVisible, afterExitVisible: b.browserContent.querySelectorAll('webview.active').length };
    })()`);
    assert.equal(split.count, 4);
    assert.equal(split.afterClose, 3);
    assert.equal(split.afterCloseVisible, 3);
    assert.equal(split.afterExitVisible, 1);
    assert.ok(split.grid.every(r => r.width > 100 && r.height > 100));
    assert.ok(split.rowHeight > 60 && split.rowHeight < split.grid[0].height);
    phase = 'MRU'; console.log('[Orbe smoke]', phase);
    const mru = await run(`(() => {
      const b = window.ShiiraBrowser, ids = ${JSON.stringify(ids)};
      b.switchTab(ids[0]); b.switchTab(ids[2]); b.switchTab(ids[1]);
      b.stepTabSwitcher(1); const chosen = b.tabSwitcher.ids[b.tabSwitcher.index];
      b.commitTabSwitcher(); return { chosen, active: b.activeTabId, developerMode: b.isDeveloperMode() };
    })()`);
    assert.equal(mru.chosen, ids[2]);
    assert.equal(mru.active, ids[2]);
    assert.equal(mru.developerMode, true);
    const pageId = await run('window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId).webview.getWebContentsId()');
    const page = webContents.fromId(pageId);
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] });
    await until(() => run('Boolean(window.ShiiraBrowser.tabSwitcher)'), 'Native Ctrl+Tab did not open MRU');
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Control' });
    await until(() => run('!window.ShiiraBrowser.tabSwitcher'), 'Releasing Ctrl did not commit MRU');
    await run(`window.ShiiraBrowser.switchTab(${JSON.stringify(ids[2])})`);
    phase = 'Boosts'; console.log('[Orbe smoke]', phase);
    const boost = await run(`(async () => { const b = window.ShiiraBrowser; await b.showBoosts(); document.getElementById('boost-css').value = '#content { color: rgb(255, 0, 0) !important; }'; b.boostDraft.zaps = ['#ad']; const r = await b.saveBoost(); b.hideBoosts(); return r; })()`);
    assert.equal(boost.success, true);
    const appearance = await page.executeJavaScript("({ color: getComputedStyle(document.getElementById('content')).color, display: getComputedStyle(document.getElementById('ad')).display })");
    assert.equal(appearance.color, 'rgb(255, 0, 0)');
    assert.equal(appearance.display, 'none');
    await page.executeJavaScript("const wrapper = document.createElement('div'); wrapper.id='player-ancestor'; wrapper.innerHTML='<div id=\"shiira-youtube-player\">Player</div>'; document.body.appendChild(wrapper);");
    const protectedBoost = await run(`(async () => { const b = window.ShiiraBrowser; await b.showBoosts(); b.boostDraft.zaps = ['#ad', '#player-ancestor']; const result = await b.saveBoost(); b.hideBoosts(); return result; })()`);
    assert.equal(protectedBoost.success, true);
    assert.notEqual(await page.executeJavaScript("getComputedStyle(document.getElementById('player-ancestor')).display"), 'none', 'Zap cannot hide an ancestor of the browser-owned player');
    await page.loadURL(base + '/changed');
    await until(async () => await page.executeJavaScript("getComputedStyle(document.getElementById('ad')).display === 'none'").catch(() => false), 'Boost did not survive navigation');
    await run(`window.ShiiraBrowser.copyTabUrl(window.ShiiraBrowser.activeTabId, { markdown: true })`);
    assert.ok(copiedText.startsWith('[Local '));
    phase = 'capture'; console.log('[Orbe smoke]', phase);
    // A hidden native window has no capture surface. Let it composite without
    // drawing an interactive window over the user's desktop.
    win.removeAllListeners('show');
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.showInactive();
    await delay(200);
    const capture = await run(`window.ShiiraBrowser.capturePage('full')`);
    assert.equal(capture?.success, true, capture?.error);
    assert.ok(fs.statSync(path.join(root, 'capture.png')).size > 100);
    // No clipboard access to the host: assert the real Electron 45 image item.
    const copiedCapture = await run(`window.ShiiraBrowser.capturePage('full', undefined, window.ShiiraBrowser.activeTabId, 'copy')`);
    assert.equal(copiedCapture?.success, true, copiedCapture?.error);
    assert.equal(copiedItems[0].types.includes('image/png'), true);
    assert.ok((await copiedItems[0].getType('image/png')).size > 100);
    const areaCapture = await run(`window.ShiiraBrowser.capturePage('area', {x: 0, y: 0, width: 120, height: 80}, window.ShiiraBrowser.activeTabId, 'copy')`);
    assert.equal(areaCapture?.success, true, areaCapture?.error);
    await page.executeJavaScript("document.getElementById('draft').focus()");
    await page.insertText('Unsaved work');
    await until(() => run('window.ShiiraBrowser.tabs.find(t => t.id === window.ShiiraBrowser.activeTabId).hasUserInput'), 'Preload did not protect an edited form');
    await run(`(() => { const b = window.ShiiraBrowser; const t = b.tabs.find(t => t.id === b.activeTabId); t.lastActiveAt = 1; b.switchTab(${JSON.stringify(ids[0])}); })()`);
    await run('window.ShiiraBrowser.runTabMaintenance()');
    assert.equal(await run(`Boolean(window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(ids[2])}).webview)`), true);
    phase = 'sidebar media'; console.log('[Orbe smoke]', phase);
    await page.executeJavaScript(`(async () => { const v = document.createElement('video'); v.src = '/media.mp4'; v.loop = true; v.muted = true; document.body.appendChild(v); await v.play(); })()`, true);
    await until(() => run(`window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(ids[2])}).mediaState?.paused === false`), 'Media events did not reach the sidebar');
    await run(`window.ShiiraBrowser.switchTab(${JSON.stringify(ids[0])})`);
    assert.equal(await run("document.querySelectorAll('.sidebar-mini-player').length"), 1);
    await run(`window.ShiiraBrowser.controlBackgroundMedia(window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(ids[2])}), 'toggle')`);
    assert.equal(await page.executeJavaScript("document.querySelector('video').paused"), true);
    assert.equal(await run('window.ShiiraBrowser.tabs.some(t => t.audioCheckInterval)'), false);
    await run(`window.ShiiraBrowser.sleepTab(window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(ids[2])}), {force: true})`);
    assert.equal(await run("document.querySelectorAll('.sidebar-mini-player').length"), 0);
    finish(null, { imported: { preview: imported.preview, status: imported.status, sleeping: imported.sleeping }, bar: true, export: true, split, mru, nativeMRU: true, boosts: appearance, fullCapture: true, imageClipboard: true, formProtection: true, sidebarMedia: true });
  } catch (error) { finish(error); }
});
