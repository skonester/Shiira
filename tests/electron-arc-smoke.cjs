// Run with: npm run test:arc:electron
// Drives the real main/preload/renderer using a disposable profile. No installed
// Arc data or OS keychain entries are changed. Native source dialogs select a fixture.
const { app, BrowserWindow, dialog, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-arc-'));
const artifacts = path.resolve(__dirname, '../tmp/arc-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => {
  win.setSkipTaskbar(true);
  win.on('show', () => win.hide());
});
// Keep credential initialization confined to this temporary test profile.
require('../src/main/password-service').prototype.initializeEncryption = async function () {
  this.encryptionKey = randomBytes(32);
};
const source = path.join(root, 'Arc');
fs.mkdirSync(source);
fs.copyFileSync(path.join(__dirname, 'fixtures/arc-sidebar.json'), path.join(source, 'StorableSidebar.json'));
const profile = path.join(source, 'User Data', 'Default');
fs.mkdirSync(profile, { recursive: true });
const { DatabaseSync } = require('node:sqlite');
const historyDb = new DatabaseSync(path.join(profile, 'History'));
historyDb.exec('CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER, hidden INTEGER)');
historyDb.prepare('INSERT INTO urls VALUES (?, ?, ?, 0)').run('https://history.example/', 'Imported history', (Date.UTC(2026, 10, 1) + 11644473600000) * 1000);
historyDb.close();
const historyBefore = fs.readFileSync(path.join(profile, 'History'));
fs.writeFileSync(path.join(source, 'StorableWindows.json'), JSON.stringify({ lastFocusedSpaceID: 'S2', sidebarViewPreferences: { sidebarWidth: 300 } }));
fs.writeFileSync(path.join(source, 'StorableArchiveItems.json'), JSON.stringify({ items: [{ archivedAt: 783000000, source: { space: { _0: 'S1' } }, sidebarItem: { data: { tab: { savedURL: 'https://archive.example/', savedTitle: 'Archived guide' } } } }] }));
dialog.showMessageBox = async (_owner, options) => ({ response: options.buttons.indexOf('Choose Arc Folder…') });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });

require('../src/main/main');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => finish(new Error('Electron smoke test timed out')), 45000);
function finish(error, details = {}) {
  clearTimeout(deadline);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error, error: error?.stack, temporaryProfile: root, versions: process.versions, ...details }, null, 2));
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  app.exit(error ? 1 : 0);
}

app.whenReady().then(async () => {
  try {
    let win;
    for (let attempt = 0; attempt < 120; attempt++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false)) break;
      await delay(200);
    }
    assert.ok(win, 'The main window opened');
    const initial = await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)');
    assert.equal(initial, true, 'The real renderer initialized');
    session.fromPartition('persist:main').webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const denied = await win.webContents.executeJavaScript(`window.shiiraAPI.arc.read(${JSON.stringify(path.join(source, 'StorableSidebar.json'))})`);
    assert.equal(denied.success, false, 'Unselected paths remain inaccessible');
    const imported = await win.webContents.executeJavaScript(`(async () => {
      const browser = window.ShiiraBrowser;
      browser.finishWelcomeSetup();
      document.querySelectorAll('.modal-overlay, .shiira-modal-overlay').forEach(el => el.classList.add('hidden'));
      browser.showConfirmation = async () => true;
      browser.showSuccess = message => { window.arcSmokeSuccess = message; };
      browser.showError = message => { window.arcSmokeError = message; };
      await browser.importFromArc();
      return { error: window.arcSmokeError, success: window.arcSmokeSuccess,
        spaces: browser.spaces.map(space => space.title), archive: browser.archive.length,
        history: browser.browsingHistory.filter(visit => visit.url === 'https://history.example/').length,
        focused: browser.getFocusedSpace().title,
        pinned: browser.tabs.filter(tab => tab.section === 'pinned').map(tab => ({ title: tab.customTitle, url: tab.pinnedUrl })),
        saved: await window.shiiraAPI.spaces.load() };
    })()`);
    assert.equal(imported.error, undefined);
    assert.ok(imported.success);
    assert.deepEqual(imported.spaces, ['Personal', 'Work', 'Fun']);
    assert.equal(imported.focused, 'Fun');
    assert.equal(imported.archive, 1);
    assert.equal(imported.history, 1);
    assert.deepEqual(fs.readFileSync(path.join(profile, 'History')), historyBefore);
    assert.equal(imported.saved.items.length, 5);
    assert.equal(imported.pinned[0].title, 'My doc');
    assert.equal(imported.saved.items.find(item => item.customTitle === 'My doc').pinnedUrl, 'https://docs.example.com/a');
    const search = await win.webContents.executeJavaScript(`(() => {
      const browser = window.ShiiraBrowser;
      browser.openCommandBar('youtube');
      browser.commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      browser.commandInput.value = 'browser tips';
      browser.commandInput.dispatchEvent(new Event('input', { bubbles: true }));
      const chip = browser.commandSiteButton.getBoundingClientRect();
      const input = browser.commandInput.getBoundingClientRect();
      const row = browser.commandInput.parentElement.getBoundingClientRect();
      return { site: browser.commandSiteSearch?.name, chipVisible: !browser.commandSiteButton.classList.contains('hidden'), url: browser.commandItems[0]?.url,
        fits: chip.width > 0 && input.width > 50 && chip.right <= input.left && input.right <= row.right };
    })()`);
    assert.equal(search.site, 'YouTube');
    assert.equal(search.chipVisible, true);
    assert.equal(search.fits, true, 'The site chip and search input fit within the command bar');
    assert.equal(search.url, 'https://www.youtube.com/results?search_query=browser%20tips');
    // A hidden native window may not have a capturable surface. Render a static
    // copy of its actual DOM offscreen for layout inspection without showing it.
    const markup = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    const { pathToFileURL } = require('node:url');
    const base = pathToFileURL(path.resolve(__dirname, '../src/renderer') + path.sep).href;
    const htmlFile = path.join(artifacts, 'site-search.html');
    fs.writeFileSync(htmlFile, markup.replace('<head>', `<head><base href="${base}">`).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    const preview = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true } });
    await preview.loadFile(htmlFile);
    await delay(500);
    fs.writeFileSync(path.join(artifacts, 'site-search.png'), (await preview.webContents.capturePage()).toPNG());
    preview.destroy();
    finish(null, { imported: { spaces: imported.spaces, focused: imported.focused, savedItems: imported.saved.items.length, archive: imported.archive, history: imported.history }, search });
  } catch (error) { finish(error); }
});
