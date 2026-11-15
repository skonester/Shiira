// Little-window, promotion and Air Traffic Control workflows adapted from Orbe.
// The compact window reuses Shiira's sandboxed webviews and custom media player.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LinkRoutingSettings, webUrl, urlsFromArgs, sizeOf } = require('./link-routing-settings');

class ExternalLinksService {
  constructor(deps) {
    Object.assign(this, deps);
    this.littles = new Map();
    this.ready = new Set();
    this.watched = new WeakSet();
    this.deliveries = new Map();
    this.earlyUrls = urlsFromArgs(process.argv);
    this.started = false;
    this.app.on('open-url', (event, url) => { event.preventDefault(); this.receive(url); });
    this.app.on('second-instance', (_event, args) => {
      const urls = urlsFromArgs(args);
      if (urls.length) urls.forEach(url => this.receive(url));
      else if (this.started) this.focus(this.ensureMain());
    });
    this.ipcMain.on('startup-ready', event => {
      if (!this.isTrusted(event)) return;
      this.watchDestination(event.sender);
      this.ready.add(event.sender.id);
      const win = this.BrowserWindow.fromWebContents(event.sender);
      const little = this.littles.get(win?.id);
      if (little) event.sender.send('little-open', little.url);
      for (const delivery of this.deliveries.values()) if (delivery.win.webContents === event.sender && !delivery.sent) this.send(delivery);
    });
    this.ipcMain.on('external-link-opened', (event, requestId, result) => {
      const delivery = this.deliveries.get(requestId);
      if (!delivery || !this.isTrusted(event) || delivery.win.webContents !== event.sender) return;
      this.finish(delivery, result?.success === true ? { success: true } : { error: String(result?.error || 'Could not open this page in Shiira.').slice(0, 300) });
    });
    const handle = (name, fn) => this.ipcMain.handle(name, async (event, ...args) => {
      if (!this.isTrusted(event)) return { error: 'Unavailable.' };
      if (!this.settings) return { error: 'Link routing is not ready.' };
      try { return await fn(event, ...args); } catch (error) { return { error: error.message }; }
    });
    handle('external-links-get', () => this.get());
    handle('external-links-save', (_event, input) => {
      const result = this.settings.set(input, this.getSpaces());
      return { ...result, ...this.get() };
    });
    handle('external-links-preview', (_event, url) => webUrl(url) ? this.settings.destination(url, this.getSpaces()) : { error: 'Enter an HTTP or HTTPS URL.' });
    handle('external-links-open-little', (_event, url) => ({ success: true, windowId: this.openLittle(url).id }));
    handle('external-links-open-main', (_event, url, spaceId) => this.openMain(url, spaceId));
    handle('external-links-promote', (event, spaceId) => this.promote(event.sender, spaceId));
  }
  start() {
    this.settings = new LinkRoutingSettings(path.join(this.app.getPath('userData'), 'external-links.json'));
    this.settings.load();
    this.started = true;
    for (const url of this.earlyUrls.splice(0)) this.receive(url);
  }
  get() { return { ...this.settings.values, spaces: this.getSpaces().map(({ id, title, icon }) => ({ id, title, icon })) }; }
  isLittle(win) { return !!win && this.littles.has(win.id); }
  isLittleSender(event) { return this.isLittle(this.BrowserWindow.fromWebContents(event.sender)); }
  focus(win) { if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  receive(url) {
    const safe = webUrl(url);
    if (!safe) return false;
    if (!this.started) { if (this.earlyUrls.length < 20) this.earlyUrls.push(safe); return true; }
    const { to } = this.settings.destination(safe, this.getSpaces());
    if (to === 'little') this.openLittle(safe);
    else void this.openMain(safe, to.startsWith('space:') ? to.slice(6) : null, null, true).then(result => {
      if (result.error) this.log?.warn('[External links]', result.error);
    });
    return true;
  }
  openLittle(input = '') {
    const url = input ? webUrl(input) : '';
    if (input && !url) throw new Error('Little Shiira opens HTTP and HTTPS pages only.');
    const existing = url && [...this.littles.values()].find(l => !l.win.isDestroyed() && l.url === url);
    if (existing) { this.focus(existing.win); return existing.win; }
    const size = sizeOf(this.settings.values.littleSize);
    const win = new this.BrowserWindow({ ...size, minWidth: 420, minHeight: 320, title: 'Little Shiira', frame: false, show: false,
      backgroundColor: '#020308', autoHideMenuBar: true, icon: this.getIcon(),
      webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), additionalArguments: ['--shiira-window-kind=little'],
        webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, backgroundThrottling: false } });
    const little = { win, url, page: null };
    win.shiiraWindowKind = 'little';
    const windowId = win.id, uiId = win.webContents.id;
    this.littles.set(win.id, little);
    this.installWebviewPreload(win);
    this.extensionsService.watchWindow(win);
    win.webContents.on('before-input-event', (event, input) => this.handleInput(event, input, win));
    win.webContents.on('did-attach-webview', (_event, page) => {
      little.page = page;
      const navigated = () => { little.url = webUrl(page.getURL()) || ''; };
      page.on('did-navigate', navigated);
      page.on('did-navigate-in-page', navigated);
    });
    win.once('ready-to-show', () => win.show());
    let sizeTimer;
    win.on('resize', () => {
      clearTimeout(sizeTimer);
      sizeTimer = setTimeout(() => {
        if (!win.isDestroyed() && !win.isMaximized()) {
          const [width, height] = win.getSize();
          this.settings.save({ ...this.settings.values, littleSize: sizeOf({ width, height }) });
        }
      }, 400);
    });
    win.on('closed', () => {
      clearTimeout(sizeTimer);
      this.littles.delete(windowId);
      this.ready.delete(uiId);
    });
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
    return win;
  }
  watchDestination(sender) {
    if (this.watched.has(sender)) return;
    this.watched.add(sender);
    const id = sender.id;
    sender.once('destroyed', () => this.ready.delete(id));
    sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (inPlace || !mainFrame) return;
      this.ready.delete(id);
      for (const delivery of this.deliveries.values()) {
        if (delivery.win.webContents === sender && delivery.sent) this.finish(delivery, { error: 'The destination window reloaded. Try opening the page again.' });
      }
    });
  }
  openMain(url, spaceId = null, command = null, fallbackToCurrent = false) {
    if (url && !webUrl(url)) return Promise.resolve({ error: 'Only HTTP and HTTPS links can be opened here.' });
    if (spaceId && !this.getSpaces().some(s => s.id === spaceId)) {
      if (fallbackToCurrent) spaceId = null;
      else return Promise.resolve({ error: 'That Space no longer exists.' });
    }
    return this.openInWindow(this.ensureMain(), url, spaceId, command, fallbackToCurrent);
  }
  openInWindow(win, url, spaceId = null, command = null, fallbackToCurrent = false) {
    const safe = url ? webUrl(url) : null;
    if (url && !safe) return Promise.resolve({ error: 'Only HTTP and HTTPS links can be opened here.' });
    if (spaceId && !this.getSpaces().some(s => s.id === spaceId)) return Promise.resolve({ error: 'That Space no longer exists.' });
    if (!win || win.isDestroyed()) return Promise.resolve({ error: 'Could not open a Shiira window.' });
    this.watchDestination(win.webContents);
    this.focus(win);
    return new Promise(resolve => {
      const requestId = randomUUID();
      const delivery = { requestId, win, url: safe, spaceId, command, fallbackToCurrent, resolve, sent: false };
      delivery.timer = setTimeout(() => this.finish(delivery, { error: 'Shiira is still starting. Try opening this page again.' }), 15000);
      this.deliveries.set(requestId, delivery);
      const closed = () => this.finish(delivery, { error: 'The destination window was closed.' });
      delivery.closed = closed;
      win.once('closed', closed);
      if (this.ready.has(win.webContents.id)) this.send(delivery);
    });
  }
  send(delivery) {
    if (delivery.win.isDestroyed()) { this.finish(delivery, { error: 'The destination window was closed.' }); return; }
    delivery.sent = true;
    delivery.win.webContents.send('external-link-open', { requestId: delivery.requestId, url: delivery.url, spaceId: delivery.spaceId, command: delivery.command, fallbackToCurrent: delivery.fallbackToCurrent });
  }
  finish(delivery, result) {
    if (!this.deliveries.delete(delivery.requestId)) return;
    clearTimeout(delivery.timer);
    delivery.win.removeListener('closed', delivery.closed);
    delivery.resolve(result);
  }
  async promote(sender, spaceId = null) {
    const win = this.BrowserWindow.fromWebContents(sender);
    const little = this.littles.get(win?.id);
    if (!little || little.promoting || !little.page || little.page.isDestroyed()) return { error: 'Open a webpage in Little Shiira first.' };
    const url = webUrl(little.page.getURL());
    if (!url) return { error: 'Only a loaded webpage can be opened in Shiira.' };
    little.promoting = true;
    let promoted = false;
    try {
      const result = await this.openMain(url, spaceId);
      if (result.success && !win.isDestroyed()) {
        promoted = true;
        // Return the IPC result before destroying its sender's frame.
        setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 100);
      }
      return result;
    } finally { if (!promoted) little.promoting = false; }
  }
  handleShortcut(win, command) {
    if (command === 'little-window') {
      if (this.isLittle(win)) this.openLittle();
      else win.webContents.send('keyboard-shortcut', 'little-window');
      return true;
    }
    if (!this.isLittle(win)) return false;
    if (['new-tab', 'focus-url'].includes(command)) win.webContents.send('little-focus-address');
    else if (command === 'close-tab') win.close();
    else if (['promote-little', 'pin-tab'].includes(command)) void this.promote(win.webContents).then(result => { if (result.error && !win.isDestroyed()) win.webContents.send('little-error', result.error); });
    else if (['show-settings', 'show-history', 'archive', 'tab-expose', 'import-bookmarks', 'private-tab'].includes(command)) void this.openMain(null, null, command);
    else if (['next-space', 'prev-space', 'next-recent-tab', 'previous-recent-tab', 'next-tab', 'prev-tab', 'split-view', 'toggle-sidebar', 'toggle-bookmarks-bar'].includes(command) || /^space-/.test(command)) return true;
    else return false;
    return true;
  }
}
module.exports = { ExternalLinksService };
