const { app, BrowserWindow, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-orbe-next-'));
const artifacts = path.resolve(__dirname, '../tmp/orbe-next-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root); app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
loadApp('src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>Local fixture</title><body><h1>Local fixture</h1><input id="edit"></body>');
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let phase = 'startup', done = false;
const deadline = setTimeout(() => finish(new Error('Orbe continuation smoke timed out')), 75000);
function finish(error, details = {}) {
  if (done) return;
  done = true; clearTimeout(deadline); server.close();
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error, error: error?.stack, phase, temporaryProfile: root, packaged: app.isPackaged, ...details }, null, 2));
  app.exit(error ? 1 : 0);
}
async function until(fn, message) {
  for (let i = 0; i < 120; i++) { const value = await fn(); if (value) return value; await delay(75); }
  throw new Error(message);
}
const isLittle = win => !win.isDestroyed() && win.shiiraWindowKind === 'little';
async function snapshot(win, name, width, height) {
  const markup = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
  const html = path.join(artifacts, name + '.html');
  const base = pathToFileURL(path.resolve(__dirname, '../src/renderer') + path.sep).href;
  fs.writeFileSync(html, markup.replace('<head>', `<head><base href="${base}">`).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  const preview = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
  await preview.loadFile(html); await delay(500);
  fs.writeFileSync(path.join(artifacts, name + '.png'), (await preview.webContents.capturePage()).toPNG());
  preview.destroy();
}
loadApp('src/main/bootstrap');
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const main = await until(async () => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getLastWebPreferences().webviewTag && !isLittle(w));
      return win && await win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.spacesLoaded)').catch(() => false) ? win : null;
    }, 'Main renderer did not initialize');
    const run = script => main.webContents.executeJavaScript(script, true);
    const setup = await run(`(async () => { const b = window.ShiiraBrowser; b.finishWelcomeSetup(); b.closeAllPopups(); const personal = b.focusedSpaceId; const work = b.createSpace({title:'Work'}); const tab = b.createTab(${JSON.stringify(base + '/main')}); await b.saveSession(); return {personal, work:work.id, tab}; })()`);
    await until(() => run(`window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(setup.tab)})?.title === 'Local fixture'`), 'Local page did not load');
    phase = 'shortcut recording';
    await run(`(async () => { const b = window.ShiiraBrowser; b.showSettings('shortcuts'); await b.loadShortcutSettings(); await b.startShortcutRecording('new-tab'); })()`);
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control', 'alt'] });
    await until(() => run("window.ShiiraBrowser.pendingShortcut?.key === 'Ctrl+Alt+U'"), 'The physical shortcut was not recorded');
    const applied = await run("window.ShiiraBrowser.changeShortcut('new-tab', window.ShiiraBrowser.pendingShortcut.key)");
    assert.equal(applied.success, true);
    const savedKeys = JSON.parse(fs.readFileSync(path.join(root, 'shortcuts.json'), 'utf8'));
    assert.equal(savedKeys['new-tab'], 'Ctrl+Alt+U');
    await snapshot(main, 'shortcuts', 1280, 850);
    await run('window.ShiiraBrowser.hideSettings()');
    const pageId = await run(`window.ShiiraBrowser.tabs.find(t => t.id === ${JSON.stringify(setup.tab)}).webview.getWebContentsId()`);
    const page = webContents.fromId(pageId);
    page.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
    await delay(150);
    assert.equal(await run('window.ShiiraBrowser.isCommandBarOpen()'), false, 'The replaced default shortcut stopped working');
    page.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control', 'alt'] });
    await until(() => run('window.ShiiraBrowser.isCommandBarOpen()'), 'The new shortcut did not work from a webpage');
    await run('window.ShiiraBrowser.hideCommandBar(); window.ShiiraBrowser.showSettings("shortcuts")');
    const conflict = await run("window.ShiiraBrowser.changeShortcut('new-tab', 'Ctrl+L')");
    assert.equal(conflict.conflict, 'focus-url');
    assert.equal(await run("document.getElementById('shortcut-reassign').classList.contains('hidden')"), false);
    const reassigned = await run("window.ShiiraBrowser.changeShortcut('new-tab', 'Ctrl+L', {force:true})");
    assert.equal(reassigned.success, true);
    assert.deepEqual(reassigned.commands.find(c => c.id === 'focus-url').accels, []);
    assert.ok(await run("document.getElementById('sb-new-tab').title.includes('Ctrl+L')"));
    await run("window.ShiiraBrowser.changeShortcut(null, null, {reset:true})");
    await run("(async () => { const b = window.ShiiraBrowser; await b.startShortcutRecording('new-tab'); b.selectSettingsSection('links'); })()");
    await until(() => run("!window.ShiiraBrowser.recordingCommand && document.getElementById('shortcut-cancel').classList.contains('hidden')"), 'Leaving the editor did not cancel recording');
    await run('window.ShiiraBrowser.hideSettings()');
    phase = 'Little window';
    const created = await run(`window.ShiiraBrowser.openLittleWindow(${JSON.stringify(base + '/little')})`);
    assert.equal(created.success, true);
    const little = BrowserWindow.fromId(created.windowId);
    const littleRun = script => little.webContents.executeJavaScript(script, true);
    await until(() => littleRun("window.ShiiraBrowser?.tabs.some(t => t.title === 'Local fixture')").catch(() => false), 'Little window did not load');
    const littleState = await littleRun(`(async () => { const b = window.ShiiraBrowser; return { little:b.isLittle, count:b.tabs.length, readonly:b.spacesReadOnly, fullWindowCount:await window.shiiraAPI.session.getWindowCount(), clear:await window.shiiraAPI.session.clear(), save:await window.shiiraAPI.spaces.save({spaces:[]}), welcomeHidden:b.setupOverlay.classList.contains('hidden'), partition:b.tabs[0].webview.getAttribute('partition'), fits:document.getElementById('url-input').getBoundingClientRect().width > 80 }; })()`);
    assert.equal(littleState.little, true); assert.equal(littleState.count, 1);
    assert.equal(littleState.readonly, true); assert.equal(littleState.fullWindowCount, 1);
    assert.equal(littleState.clear, false); assert.equal(littleState.save.success, false);
    assert.equal(littleState.welcomeHidden, true); assert.equal(littleState.partition, 'persist:main'); assert.equal(littleState.fits, true);
    await snapshot(little, 'little', 860, 640);
    const session = await run('window.shiiraAPI.session.load()');
    assert.ok(session.tabs.some(t => t.url === base + '/main'));
    assert.ok(!session.tabs.some(t => t.url === base + '/little'));
    const refused = await littleRun("window.ShiiraBrowser.promoteLittleWindow('missing-space')");
    assert.ok(refused.error); assert.equal(little.isDestroyed(), false);
    await littleRun('window.ShiiraBrowser.showLittleSpaces()');
    assert.equal(await littleRun("document.querySelectorAll('[data-little-space]').length"), 2);
    const promoted = await littleRun(`window.ShiiraBrowser.promoteLittleWindow(${JSON.stringify(setup.work)})`);
    assert.equal(promoted.success, true);
    await until(() => little.isDestroyed(), 'Little window did not close after acceptance');
    assert.equal(await run(`window.ShiiraBrowser.tabs.find(t => t.url === ${JSON.stringify(base + '/little')})?.spaceId`), setup.work);
    phase = 'OS link routing';
    await run(`(async () => { const b = window.ShiiraBrowser; b.showSettings('links'); await b.loadRoutingSettings(); b.routingDraft = {defaultDestination:'main', rules:[{match:${JSON.stringify('127.0.0.1:' + server.address().port + '/work')},to:${JSON.stringify('space:' + setup.work)}},{match:${JSON.stringify('127.0.0.1:' + server.address().port)},to:'little'}]}; b.renderRoutingSettings(); await b.saveRoutingSettings(); })()`);
    await snapshot(main, 'routing', 1280, 850);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'external-links.json'), 'utf8'));
    assert.equal(onDisk.rules[0].to, 'space:' + setup.work);
    assert.equal(onDisk.rules[1].to, 'little');
    app.emit('second-instance', {}, ['Shiira.exe', base + '/work/one']);
    app.emit('open-url', { preventDefault() {} }, base + '/work/two');
    await until(() => run(`window.ShiiraBrowser.tabs.filter(t => t.url.startsWith(${JSON.stringify(base + '/work/')})).length === 2`), 'Repeated OS links were lost');
    assert.equal(await run(`window.ShiiraBrowser.tabs.filter(t => t.url.startsWith(${JSON.stringify(base + '/work/')})).every(t => t.spaceId === ${JSON.stringify(setup.work)})`), true);
    const secondaryEnv = { ...process.env, SHIIRA_EXTERNAL_LAUNCH_PROFILE: root };
    delete secondaryEnv.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'fixtures/external-launch.cjs'), base + '/work/secondary-process'], { env: secondaryEnv, stdio: 'ignore', windowsHide: true });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Secondary launch did not exit')); }, 10000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Secondary launch exited ${code}`)); });
    });
    await until(() => run(`window.ShiiraBrowser.tabs.some(t => t.url === ${JSON.stringify(base + '/work/secondary-process')} && t.spaceId === ${JSON.stringify(setup.work)})`), 'The real secondary process did not deliver its URL');
    assert.equal((await run(`window.shiiraAPI.externalLinks.preview(${JSON.stringify(base + '/outside')})`)).to, 'little');
    app.emit('open-url', { preventDefault() {} }, base + '/outside');
    const routedLittle = await until(() => BrowserWindow.getAllWindows().find(isLittle), 'The Little routing rule was ignored');
    await until(() => routedLittle.webContents.executeJavaScript("window.ShiiraBrowser?.tabs.some(t => t.title === 'Local fixture')").catch(() => false), 'Routed Little did not initialize');
    app.emit('open-url', { preventDefault() {} }, base + '/outside');
    await delay(150);
    assert.equal(BrowserWindow.getAllWindows().filter(isLittle).length, 1, 'A repeated link focused the existing Little window');
    const routedPageId = await routedLittle.webContents.executeJavaScript('window.ShiiraBrowser.tabs[0].webview.getWebContentsId()');
    await webContents.fromId(routedPageId).loadURL('about:blank');
    app.emit('open-url', { preventDefault() {} }, base + '/outside');
    await until(() => BrowserWindow.getAllWindows().filter(isLittle).length === 2, 'A navigated Little window incorrectly retained its old URL for deduplication');
    BrowserWindow.getAllWindows().filter(w => isLittle(w) && w !== routedLittle).forEach(w => w.close());
    routedLittle.close();
    const preview = await run(`window.shiiraAPI.externalLinks.preview(${JSON.stringify(base + '/workforce')})`);
    assert.equal(preview.to, 'little', 'Path-prefix lookalikes fall through to the site rule');
    const count = await run('window.shiiraAPI.session.getWindowCount()');
    assert.equal(count, 1);
    phase = 'recently deleted routing Space';
    await run(`(async () => { const b = window.ShiiraBrowser; const confirm = b.showConfirmation; b.showConfirmation = async () => true; try { await b.deleteSpace(${JSON.stringify(setup.work)}); clearTimeout(b.saveSpacesTimer); } finally { b.showConfirmation = confirm; } })()`);
    // Keep the persisted snapshot stale, exactly as in the normal save debounce.
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'spaces.json'), 'utf8')).spaces.some(s => s.id === setup.work));
    app.emit('open-url', { preventDefault() {} }, base + '/work/deleted-space');
    await until(() => run(`window.ShiiraBrowser.tabs.some(t => t.url === ${JSON.stringify(base + '/work/deleted-space')} && t.spaceId === ${JSON.stringify(setup.personal)})`), 'An OS link to a just-deleted Space was lost');
    phase = 'promotion into a restarting main window';
    const handoff = await run(`window.ShiiraBrowser.openLittleWindow(${JSON.stringify(base + '/handoff')})`);
    const handoffLittle = BrowserWindow.fromId(handoff.windowId);
    await until(() => handoffLittle.webContents.executeJavaScript("window.ShiiraBrowser?.tabs.some(t => t.title === 'Local fixture')").catch(() => false), 'Handoff page did not load');
    main.close();
    await until(() => main.isDestroyed(), 'Original main window did not finish saving');
    const handedOff = await handoffLittle.webContents.executeJavaScript(`window.ShiiraBrowser.promoteLittleWindow(${JSON.stringify(setup.personal)})`, true);
    assert.equal(handedOff.success, true);
    const newMain = BrowserWindow.getAllWindows().find(w => w.webContents.getLastWebPreferences().webviewTag && !isLittle(w));
    assert.ok(newMain && newMain !== main);
    assert.equal(await newMain.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.some(t => t.url === ${JSON.stringify(base + '/handoff')} && t.spaceId === ${JSON.stringify(setup.personal)})`), true);
    await until(() => handoffLittle.isDestroyed(), 'Handoff Little window did not close');
    finish(null, { shortcuts: { record:true, nativePageDispatch:true, conflict:true, reset:true, hints:true, saved:true }, little: littleState,
      promotion:true, coldMainPromotion:true, invalidSpacePreservedLittle:true, routing:{ repeatedOSLinks:true, realSecondaryLaunch:true, space:true, little:true, deduplication:true, persisted:true } });
  } catch (error) { finish(error); }
});
