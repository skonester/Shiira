// Run with npm run test:runtime:electron. Keep browser data and credentials in a
// disposable profile, and intercept clipboard writes so the OS clipboard is untouched.
const { app, BrowserWindow, clipboard, nativeImage, net, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const appRoot = process.env.SHIIRA_SMOKE_APP_ROOT ? path.resolve(process.env.SHIIRA_SMOKE_APP_ROOT) : path.resolve(__dirname, '..');
const loadApp = file => require(path.join(appRoot, file));
if (process.env.SHIIRA_SMOKE_APP_ROOT) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) });
  app.getAppPath = () => appRoot;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-runtime-'));
const artifacts = path.resolve(__dirname, '../tmp/runtime-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => {
  win.setSkipTaskbar(true);
  win.on('show', () => win.hide());
});
let clipboardItems;
clipboard.write = async items => { clipboardItems = items; };

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => finish(new Error('Runtime smoke test timed out')), 45000);
function finish(error, details = {}) {
  clearTimeout(deadline);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({
    success: !error, error: error?.stack, temporaryProfile: root,
    electron: process.versions.electron, chromium: process.versions.chrome, packaged: app.isPackaged, ...details
  }, null, 2));
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  app.exit(error ? 1 : 0);
}

try {
  loadApp('src/main/password-service').prototype.initializeEncryption = async function () {
    this.encryptionKey = randomBytes(32);
  };
  loadApp('src/main/main');
} catch (error) {
  finish(error);
}

app.whenReady().then(async () => {
  try {
    assert.equal(process.versions.electron, require('../package.json').build.electronVersion);
    assert.equal(loadApp('package.json').version, require('../package.json').version);
    let win;
    for (let attempt = 0; attempt < 150; attempt++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false)) break;
      await delay(100);
    }
    assert.ok(win, 'The main window opened');
    assert.equal(await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)'), true);

    // Exercise the app's real password service and its SQLite schema using only
    // fixture data. This catches native addon failures swallowed during startup.
    const PasswordService = loadApp('src/main/password-service');
    const passwords = new PasswordService();
    await passwords.initialize();
    const id = passwords.addPassword('https://runtime.example/', 'fixture-user', 'fixture-password');
    const stored = passwords.db.prepare('SELECT * FROM passwords WHERE id = ?').get(id);
    assert.notEqual(stored.password, 'fixture-password');
    assert.equal(passwords.decrypt(stored.password), 'fixture-password');
    passwords.updatePassword(id, stored.url, stored.username, 'updated-fixture');
    assert.equal(passwords.decrypt(passwords.db.prepare('SELECT password FROM passwords WHERE id = ?').get(id).password), 'updated-fixture');
    passwords.deletePassword(id);
    assert.equal(passwords.db.prepare('SELECT COUNT(*) AS count FROM passwords').get().count, 0);
    passwords.db.close();

    // Drive Copy image through the real sandboxed UI bridge. The ClipboardItem
    // and PNG Blob are real; only the final OS write is intercepted.
    const imageUrl = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toDataURL();
    const copied = await win.webContents.executeJavaScript(`window.shiiraAPI.copyImage(${JSON.stringify(imageUrl)})`);
    assert.equal(copied.success, true, copied.error);
    assert.equal(clipboardItems.length, 1);
    assert.ok(clipboardItems[0].types.includes('image/png'));
    const png = await clipboardItems[0].getType('image/png');
    assert.ok(png.size > 0);
    const originalFetch = net.fetch;
    try {
      net.fetch = async () => new Response(await png.arrayBuffer(), { headers: { 'content-type': 'image/png' } });
      const remoteCopy = await win.webContents.executeJavaScript('window.shiiraAPI.copyImage("https://runtime.example/image.png")');
      assert.equal(remoteCopy.success, true, remoteCopy.error);
      assert.ok((await clipboardItems[0].getType('image/png')).size > 0);
    } finally {
      net.fetch = originalFetch;
    }
    clipboard.write = async () => { throw new Error('Fixture clipboard failure'); };
    const failedCopy = await win.webContents.executeJavaScript(`window.shiiraAPI.copyImage(${JSON.stringify(imageUrl)})`);
    assert.equal(failedCopy.success, false);
    assert.equal(failedCopy.error, 'Fixture clipboard failure');

    // Load a local MV3 extension in the same session as normal browser tabs.
    const extensionPath = path.join(root, 'runtime-extension');
    fs.mkdirSync(extensionPath);
    fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Shiira runtime fixture', version: '1.0.0', permissions: ['storage']
    }));
    fs.writeFileSync(path.join(extensionPath, 'page.html'), '<!doctype html><title>Runtime fixture</title>');
    const browserSession = session.fromPartition('persist:main');
    const extension = await browserSession.extensions.loadExtension(extensionPath);
    const extensionWindow = new BrowserWindow({ show: false, webPreferences: { session: browserSession, sandbox: true, contextIsolation: true } });
    await extensionWindow.loadURL(`chrome-extension://${extension.id}/page.html`);
    const extensionResult = await extensionWindow.webContents.executeJavaScript(`(async () => {
      await chrome.storage.local.set({ fixture: 'saved' });
      return { name: chrome.runtime.getManifest().name, stored: (await chrome.storage.local.get('fixture')).fixture };
    })()`);
    assert.deepEqual(extensionResult, { name: 'Shiira runtime fixture', stored: 'saved' });
    extensionWindow.destroy();
    browserSession.extensions.removeExtension(extension.id);
    finish(null, { passwordStorage: true, imageClipboard: true, clipboardErrors: true, mv3Extension: true });
  } catch (error) {
    finish(error);
  }
});
