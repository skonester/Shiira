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
let textClipboard = '';
// Match Electron 44+: a write is complete only when its promise resolves.
clipboard.writeText = async text => {
  await new Promise(resolve => setTimeout(resolve, 40));
  textClipboard = text;
};
clipboard.readText = async () => textClipboard;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => finish(new Error('Runtime smoke test timed out')), 45000);
function finish(error, details = {}) {
  clearTimeout(deadline);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({
    success: !error, error: error?.stack, temporaryProfile: root,
    electron: process.versions.electron, chromium: process.versions.chrome, packaged: app.isPackaged, ...details
  }, null, 2));
  app.exit(error ? 1 : 0);
  process.exit(error ? 1 : 0);
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
      win = BrowserWindow.getAllWindows().find(window => window.webContents.getLastWebPreferences().webviewTag);
      if (win && await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false)) break;
      await delay(100);
    }
    assert.ok(win, 'The main window opened');
    win.webContents.on('console-message', details => {
      if (details.level === 'error') console.error('[Renderer]', details.message);
    });
    assert.equal(await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)'), true);

    // Address-bar text editing must use the browser-chrome clipboard bridge,
    // because Chromium clipboard permissions are intentionally denied.
    const clipboardRoundTrip = await win.webContents.executeJavaScript(`(async () => {
      await window.shiiraAPI.clipboard.writeText('address-bar-fixture');
      return await window.shiiraAPI.clipboard.readText();
    })()`);
    assert.equal(clipboardRoundTrip, 'address-bar-fixture');

    const originalWriteText = clipboard.writeText;
    try {
      clipboard.writeText = async () => { throw new Error('Fixture text clipboard failure'); };
      const failure = await win.webContents.executeJavaScript(`window.shiiraAPI.clipboard.writeText('failure')
        .then(() => 'unexpected success', error => error.message)`);
      assert.match(failure, /Fixture text clipboard failure/);
    } finally {
      clipboard.writeText = originalWriteText;
    }

    // Click the actual menu item, then hit-test the input. Calling the action
    // directly misses an invisible overlay that can leave the app unclickable.
    await win.webContents.executeJavaScript(`(() => {
      const browser = window.ShiiraBrowser;
      browser.finishWelcomeSetup();
      browser.closeAllPopups();
      const input = browser.urlInput;
      input.value = 'mouse-copy-fixture';
      input.focus();
      input.select();
      input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 100 }));
    })()`);
    await delay(250);
    const point = await win.webContents.executeJavaScript(`(() => {
      const item = document.querySelector('#text-context-menu [data-action="copy"]');
      document.querySelector('#text-context-menu').getAnimations({ subtree: true }).forEach(animation => animation.finish());
      const rect = item.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
      return { x, y, clickable: item.contains(document.elementFromPoint(x, y)),
        hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 200) };
    })()`);
    assert.equal(point.clickable, true, `Copy menu item is covered: ${JSON.stringify(point)}`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await delay(300);
    assert.equal(textClipboard, 'mouse-copy-fixture');
    const menuClosed = await win.webContents.executeJavaScript(`(() => {
      const browser = window.ShiiraBrowser;
      const rect = browser.urlInput.getBoundingClientRect();
      return { hidden: browser.textContextMenu.classList.contains('hidden'),
        overlayHidden: browser.contextMenuOverlay.classList.contains('hidden'),
        inputClickable: browser.urlInput === document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) };
    })()`);
    assert.deepEqual(menuClosed, { hidden: true, overlayHidden: true, inputClickable: true });

    // A busy clipboard must not block IPC or let an old completion close a
    // menu opened for another field while the write was pending.
    let releaseWrite;
    clipboard.writeText = text => new Promise(resolve => {
      releaseWrite = () => { textClipboard = text; resolve(); };
    });
    try {
      const released = await win.webContents.executeJavaScript(`(() => {
        const b = window.ShiiraBrowser, input = b.urlInput;
        input.focus(); input.select();
        b.showTextContextMenu({ clientX: 400, clientY: 100 }, input);
        window.pendingClipboardCopy = b.handleTextContextAction('copy');
        return b.contextMenuOverlay.classList.contains('hidden');
      })()`);
      assert.equal(released, true, 'The overlay releases before the OS write completes');
      for (let n = 0; n < 100 && !releaseWrite; n++) await delay(10);
      assert.equal(typeof releaseWrite, 'function');
      await win.webContents.executeJavaScript(`(() => {
        const b = window.ShiiraBrowser;
        const input = document.createElement('textarea'); input.id = 'pending-clipboard-target'; document.body.appendChild(input);
        b.showTextContextMenu({ clientX: 400, clientY: 100 }, input);
      })()`);
      releaseWrite();
      await win.webContents.executeJavaScript('window.pendingClipboardCopy');
      assert.equal(await win.webContents.executeJavaScript(`window.ShiiraBrowser.textContextTarget?.id`), 'pending-clipboard-target');
      await win.webContents.executeJavaScript(`window.ShiiraBrowser.hideAllContextMenus(); document.getElementById('pending-clipboard-target').remove()`);
    } finally {
      releaseWrite?.();
      clipboard.writeText = originalWriteText;
    }

    // Exercise bubbling from both existing fields and fields added after init.
    // Reopening during the closing animation must retain the new action target.
    const textMenus = await win.webContents.executeJavaScript(`(async () => {
      const browser = window.ShiiraBrowser;
      const dynamic = document.createElement('textarea');
      dynamic.id = 'runtime-dynamic-input';
      document.body.appendChild(dynamic);
      const results = [];
      for (const id of ['url-input', 'home-search', 'search-brave-key', 'search-scira-key', 'settings-homepage', 'command-bar-input', dynamic.id]) {
        const input = document.getElementById(id);
        input.value = 'fixture-' + id;
        input.setSelectionRange(0, input.value.length);
        const open = () => input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
        open();
        browser.hideTextContextMenu();
        open();
        await new Promise(resolve => setTimeout(resolve, 200));
        const visible = !browser.textContextMenu.classList.contains('hidden');
        const targeted = browser.textContextTarget === input;
        await browser.handleTextContextAction('copy');
        const copied = await window.shiiraAPI.clipboard.readText();
        open();
        await browser.handleTextContextAction('paste');
        results.push({ id, visible, targeted, copied, pasted: input.value });
      }
      dynamic.remove();
      return results;
    })()`);
    for (const result of textMenus) {
      assert.equal(result.visible, true, `${result.id} menu stays open`);
      assert.equal(result.targeted, true, `${result.id} retains its action target`);
      assert.equal(result.copied, `fixture-${result.id}`);
      assert.equal(result.pasted, `fixture-${result.id}`);
    }

    const panelCopy = await win.webContents.executeJavaScript(`(async () => {
      const browser = window.ShiiraBrowser;
      browser._passwords = [{ id: 1001, url: 'https://runtime.example/', username: 'fixture-user', password: 'panel-fixture' }];
      browser.renderPasswords(browser._passwords);
      const button = browser.passwordList.querySelector('.password-action-btn.copy');
      button.click();
      for (let attempt = 0; attempt < 50 && !button.classList.contains('copied'); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return { copied: await window.shiiraAPI.clipboard.readText(), feedback: button.classList.contains('copied') };
    })()`);
    assert.deepEqual(panelCopy, { copied: 'panel-fixture', feedback: true });

    await win.webContents.executeJavaScript('window.shiiraAPI.createPasswordAnvilWindow()');
    const anvil = BrowserWindow.getAllWindows().find(window => window !== win && window.getTitle() === 'Password Anvil');
    assert.ok(anvil, 'Password Anvil opened');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await anvil.webContents.executeJavaScript('Boolean(textContextMenu)').catch(() => false)) break;
      await delay(100);
    }
    const anvilClipboard = await anvil.webContents.executeJavaScript(`(async () => {
      const input = document.getElementById('search');
      const open = () => input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
      input.value = 'anvil-fixture';
      input.focus();
      input.select();
      open();
      await handleTextContextAction('copy');
      const copied = await window.shiiraAPI.clipboard.readText();
      open();
      await handleTextContextAction('cut');
      const cut = input.value;
      open();
      await handleTextContextAction('paste');
      const pasted = input.value;
      passwords = [{ id: 1002, url: 'https://runtime.example/', username: 'fixture-user', password: 'button-fixture' }];
      renderPasswords(passwords);
      const button = document.querySelector('#passwords-list .password-actions .icon-btn');
      button.click();
      for (let attempt = 0; attempt < 50 && button.textContent !== 'Copied!'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return { copied, cut, pasted, password: await window.shiiraAPI.clipboard.readText(), feedback: button.textContent };
    })()`);
    assert.deepEqual(anvilClipboard, { copied: 'anvil-fixture', cut: '', pasted: 'anvil-fixture',
      password: 'button-fixture', feedback: 'Copied!' });
    anvil.destroy();

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
    finish(null, { passwordStorage: true, textContextMenus: true, asynchronousClipboard: true,
      mouseContextMenu: true, pendingClipboard: true, passwordAnvilClipboard: true,
      imageClipboard: true, clipboardErrors: true, mv3Extension: true });
  } catch (error) {
    finish(error);
  }
});
