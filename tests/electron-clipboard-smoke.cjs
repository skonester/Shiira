// Real OS clipboard, keyboard shortcuts and right-click menus. Uses a disposable
// profile and materializes/restores every original clipboard item before exiting.
const { app, BrowserWindow, clipboard, ClipboardItem, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-clipboard-'));
const artifacts = path.resolve(__dirname, '../tmp/clipboard-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => win.setSkipTaskbar(true));
require('../src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
const server = http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><title>Clipboard fixture</title><textarea id="input" style="width:500px;height:100px">website-fixture</textarea><p id="text">Selected website text</p>');
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let originalItems;
let finished = false;
let mainTicks = 0;
let monitoring = false;
let lastMainTick = performance.now();
let maxMainGapMs = 0;
const steps = [];
const heartbeat = setInterval(() => {
  const now = performance.now();
  if (monitoring) maxMainGapMs = Math.max(maxMainGapMs, now - lastMainTick);
  lastMainTick = now;
  mainTicks++;
}, 20);
const deadline = setTimeout(() => void finish(new Error('Clipboard smoke timed out')), 45000);
async function finish(error, details = {}) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  clearInterval(heartbeat);
  let clipboardRestored = false;
  try {
    if (originalItems) {
      if (originalItems.length) await clipboard.write(originalItems);
      else clipboard.clear();
      clipboardRestored = true;
    }
  } catch (restoreError) { error = restoreError; }
  server.close();
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error, error: error?.stack,
    temporaryProfile: root, electron: process.versions.electron, clipboardRestored, steps, ...details }, null, 2));
  app.exit(error ? 1 : 0);
}
async function waitFor(check, label) {
  for (let n = 0; n < 100; n++) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`Clipboard action did not finish: ${label}`);
}
async function click(contents, selector, button = 'left') {
  const point = await contents.executeJavaScript(`(() => {
    document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).forEach(animation => animation.finish());
    const element = document.querySelector(${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    if (${JSON.stringify(button)} === 'right' && element.selectionEnd > element.selectionStart) {
      const context = document.createElement('canvas').getContext('2d');
      const style = getComputedStyle(element);
      context.font = style.font;
      const before = context.measureText(element.value.slice(0, element.selectionStart)).width;
      const selected = context.measureText(element.value.slice(element.selectionStart, element.selectionEnd)).width;
      x = rect.left + Math.min(rect.width - 5, parseFloat(style.paddingLeft) + before + selected / 2 - element.scrollLeft);
    }
    x = Math.round(x);
    const y = Math.round(rect.top + rect.height / 2);
    return { x, y, clickable: element.contains(document.elementFromPoint(x, y)) };
  })()`);
  assert.equal(point.clickable, true, `${selector} is clickable`);
  contents.sendInputEvent({ type: 'mouseDown', button, clickCount: 1, x: point.x, y: point.y });
  contents.sendInputEvent({ type: 'mouseUp', button, clickCount: 1, x: point.x, y: point.y });
  await delay(50);
}
function key(contents, keyCode, modifiers = []) {
  contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
require('../src/main/main');
app.whenReady().then(async () => {
  try {
    // getType can be lazy; snapshot all payloads before changing the clipboard.
    originalItems = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item => new ClipboardItem(
      Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))
    )));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let win;
    await waitFor(async () => {
      win = BrowserWindow.getAllWindows().find(window => window.webContents.getLastWebPreferences().webviewTag);
      return win && win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded && window.ShiiraBrowser.activeTabId)').catch(() => false);
    }, 'browser startup');
    win.show();
    win.focus();
    monitoring = true;
    lastMainTick = performance.now();
    await win.webContents.executeJavaScript(`(() => {
      const b = window.ShiiraBrowser;
      b.finishWelcomeSetup(); b.closeAllPopups(); b.createHomeTab();
      window.clipboardRendererTicks = 0;
      window.clipboardRendererMaxGapMs = 0;
      let lastTick = performance.now();
      window.clipboardHeartbeat = setInterval(() => {
        const now = performance.now();
        window.clipboardRendererMaxGapMs = Math.max(window.clipboardRendererMaxGapMs, now - lastTick);
        lastTick = now;
        window.clipboardRendererTicks++;
      }, 20);
      b.urlInput.value = 'prefix selected suffix'; b.urlInput.focus(); b.urlInput.setSelectionRange(7, 15);
    })()`);
    await click(win.webContents, '#url-input', 'right');
    steps.push(await win.webContents.executeJavaScript(`({ stage: 'right-click', selected: [window.ShiiraBrowser.urlInput.selectionStart, window.ShiiraBrowser.urlInput.selectionEnd], target: window.ShiiraBrowser.textContextTarget?.id })`));
    await click(win.webContents, '#text-context-menu [data-action="copy"]');
    steps.push(await win.webContents.executeJavaScript(`({ stage: 'copy-click', selected: [window.ShiiraBrowser.urlInput.selectionStart, window.ShiiraBrowser.urlInput.selectionEnd], menuHidden: window.ShiiraBrowser.contextMenuOverlay.classList.contains('hidden') })`));
    steps.push({ stage: 'copied', expected: await clipboard.readText() === 'selected', entireField: await clipboard.readText() === 'prefix selected suffix' });
    await waitFor(async () => await clipboard.readText() === 'selected', 'chrome right-click copy preserves selection');
    await waitFor(() => win.webContents.executeJavaScript('window.ShiiraBrowser.contextMenuOverlay.classList.contains("hidden")'), 'copy releases overlay');
    await clipboard.writeText('pasted');
    await click(win.webContents, '#url-input', 'right');
    await click(win.webContents, '#text-context-menu [data-action="paste"]');
    assert.equal(await win.webContents.executeJavaScript('window.ShiiraBrowser.urlInput.value'), 'prefix pasted suffix');

    // Outside click and Escape must both release the click-blocking overlay.
    await click(win.webContents, '#url-input', 'right');
    await click(win.webContents, '#context-menu-overlay');
    await waitFor(() => win.webContents.executeJavaScript('window.ShiiraBrowser.contextMenuOverlay.classList.contains("hidden")'), 'outside-click dismissal');
    await click(win.webContents, '#url-input', 'right');
    key(win.webContents, 'Escape');
    await waitFor(() => win.webContents.executeJavaScript('window.ShiiraBrowser.contextMenuOverlay.classList.contains("hidden")'), 'Escape dismissal');

    const control = process.platform === 'darwin' ? 'meta' : 'control';
    await win.webContents.executeJavaScript(`(() => { const input = window.ShiiraBrowser.urlInput; input.value = 'keyboard-fixture'; input.focus(); input.select(); })()`);
    key(win.webContents, 'c', [control]);
    await waitFor(async () => await clipboard.readText() === 'keyboard-fixture', 'chrome keyboard copy');
    key(win.webContents, 'x', [control]);
    await waitFor(() => win.webContents.executeJavaScript('window.ShiiraBrowser.urlInput.value === ""'), 'chrome keyboard cut');
    key(win.webContents, 'v', [control]);
    await waitFor(() => win.webContents.executeJavaScript('window.ShiiraBrowser.urlInput.value === "keyboard-fixture"'), 'chrome keyboard paste');

    for (const privateMode of [false, true]) {
      const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.createTab('http://127.0.0.1:${server.address().port}/', { privateMode: ${privateMode} })`);
      let guest;
      await waitFor(async () => {
        const guestId = await win.webContents.executeJavaScript(`(() => { const view = window.ShiiraBrowser.tabs.find(tab => tab.id === ${JSON.stringify(id)})?.webview; try { return view?.getWebContentsId(); } catch { return null; } })()`);
        guest = guestId && webContents.fromId(guestId);
        return guest && guest.executeJavaScript('Boolean(document.querySelector("#input"))').catch(() => false);
      }, 'website fixture');
      await click(guest, '#input');
      await guest.executeJavaScript('document.querySelector("#input").select()');
      key(guest, 'c', [control]);
      await waitFor(async () => await clipboard.readText() === 'website-fixture', 'website keyboard copy');
      key(guest, 'x', [control]);
      await waitFor(() => guest.executeJavaScript('document.querySelector("#input").value === ""'), 'website keyboard cut');
      key(guest, 'v', [control]);
      await waitFor(() => guest.executeJavaScript('document.querySelector("#input").value === "website-fixture"'), 'website keyboard paste');
      await clipboard.writeText('different-fixture');
      await guest.executeJavaScript('document.querySelector("#input").select()');
      await click(guest, '#input', 'right');
      await waitFor(() => win.webContents.executeJavaScript('!window.ShiiraBrowser.webviewContextMenu.classList.contains("hidden")'), 'website context menu opens');
      await click(win.webContents, '#webview-context-menu [data-action="copy"]');
      await waitFor(async () => await clipboard.readText() === 'website-fixture', 'website right-click copy');
      await click(guest, '#input', 'right');
      await click(win.webContents, '#webview-context-menu [data-action="cut"]');
      steps.push(await guest.executeJavaScript(`({ stage: 'website-menu-cut', privateMode: ${privateMode}, value: document.querySelector('#input').value, focus: document.activeElement?.id, selected: [document.querySelector('#input').selectionStart, document.querySelector('#input').selectionEnd] })`));
      steps.push(await win.webContents.executeJavaScript(`({ stage: 'website-menu-state', target: window.ShiiraBrowser.contextMenuWebview?.id, cut: typeof document.querySelector('webview').cut, overlayHidden: window.ShiiraBrowser.contextMenuOverlay.classList.contains('hidden') })`));
      await waitFor(() => guest.executeJavaScript('document.querySelector("#input").value === ""'), 'website right-click cut');
      await click(guest, '#input', 'right');
      await click(win.webContents, '#webview-context-menu [data-action="paste"]');
      await waitFor(() => guest.executeJavaScript('document.querySelector("#input").value === "website-fixture"'), 'website right-click paste');
    }
    assert.ok(mainTicks > 5, 'The main event loop remains responsive');
    assert.ok(await win.webContents.executeJavaScript('window.clipboardRendererTicks > 5'), 'The renderer event loop remains responsive');
    const maxRendererGapMs = await win.webContents.executeJavaScript('window.clipboardRendererMaxGapMs');
    assert.ok(maxMainGapMs < 2000, 'The main event loop did not stall during editing');
    assert.ok(maxRendererGapMs < 2000, 'The renderer event loop did not stall during editing');
    await finish(null, { chromeRightClick: true, chromeKeyboard: true, websiteKeyboard: true,
      websiteRightClick: true, privateTabs: true, overlayDismissal: true, eventLoopsResponsive: true,
      maxMainGapMs: Math.round(maxMainGapMs), maxRendererGapMs: Math.round(maxRendererGapMs) });
  } catch (error) { await finish(error); }
});
