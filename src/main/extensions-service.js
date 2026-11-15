// Chrome extensions for Shiira's tabs.
// electron-chrome-extensions (MIT) gives pages and extensions the chrome.tabs /
// windows / action APIs; electron-chrome-web-store installs and updates extensions from the Chrome Web Store.
// Adapted from Solamar's src/main/extensions.ts (https://github.com/Bambeek/solamar, GPL-3.0-or-later).
//
// Each browser profile has its own extension engine and install directory.
// Default retains 'persist:main'. Private sessions never join an extension engine.

const fs = require('fs');
const path = require('path');
const { app, session, ipcMain, webContents, BrowserWindow } = require('electron');

const PARTITION = 'persist:main';
const BROAD = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'];
const PERMISSION_WORDS = {
  tabs: 'See your open tabs and their addresses',
  history: 'Read and change your browsing history',
  bookmarks: 'Read and change your bookmarks',
  cookies: 'Read and change cookies',
  downloads: 'Manage your downloads',
  clipboardRead: 'Read what you copy',
  clipboardWrite: 'Change what is on the clipboard',
  nativeMessaging: 'Talk to programs installed on this computer',
  webRequest: 'See your network traffic',
  declarativeNetRequest: 'Block or change content on pages',
  notifications: 'Show notifications',
  scripting: 'Run scripts on the pages it can access',
  debugger: 'Use the page debugger (full control of pages)',
  management: 'Manage your other extensions',
  privacy: 'Change privacy settings',
  proxy: 'Change how Shiira connects to the internet',
  geolocation: 'Know your location'
};

/** What an extension may do, in plain words, for the "Add extension?" dialog. */
function describePermissions(manifest = {}) {
  const out = [];
  const hosts = [
    ...(manifest.host_permissions || []),
    ...(manifest.content_scripts || []).flatMap((script) => script.matches || [])
  ];
  if (hosts.some((host) => BROAD.includes(host))) {
    out.push('Read and change everything on all websites');
  } else {
    const names = [...new Set(hosts
      .map((host) => String(host).replace(/^[a-z*]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, ''))
      .filter(Boolean))];
    if (names.length) {
      out.push(`Read and change your data on ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more sites` : ''}`);
    }
  }
  for (const permission of manifest.permissions || []) {
    const words = PERMISSION_WORDS[permission];
    if (words && !out.includes(words)) out.push(words);
  }
  return out;
}

class ExtensionsService {
  constructor(profileId = 'default', partition = PARTITION, master = null) {
    this.profileId = profileId; this.partition = partition; this.master = master || this;
    this.engines = master ? master.engines : new Map();
    this.engines.set(profileId, this);
    this.ready = false;
    this.session = null;
    this.extensions = null;
    this.windows = new Set();
    this.pendingTabs = new Map();
    this.pendingInstalls = new Map();
    this.counter = 0;
  }

  /**
   * Turns extensions on. `getWindow` returns the browser window that should open tabs extensions ask for.
   * Errors are logged, never thrown: Shiira works without extensions.
   */
  initialize({ getWindow }) {
    this.getWindow = getWindow;
    this.extensionsPath = path.join(app.getPath('userData'), this.profileId === 'default' ? 'Extensions' : `Extensions-${this.profileId}`);
    try {
      const { ElectronChromeExtensions } = require('electron-chrome-extensions');
      const { installChromeWebStore } = require('electron-chrome-web-store');
      this.session = session.fromPartition(this.partition);
      // Extension icons in Shiira's own window come through crx:// in the UI's session.
      if (this.master === this) ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
      this.extensions = new ElectronChromeExtensions({
        session: this.session,
        createTab: (details) => this.createTab(details.url, details.active !== false),
        selectTab: (wc) => this.sendToHost(wc, 'extensions-select-tab', wc.id),
        // The library also calls this when a page goes away (Shiira putting a tab to sleep);
        // only a live tab that an extension asked to close is closed.
        removeTab: (wc) => setImmediate(() => {
          if (!wc.isDestroyed()) this.sendToHost(wc, 'extensions-close-tab', wc.id);
        }),
        createWindow: async (details) => {
          const urls = [details.url || []].flat();
          let lastWindow = null;
          for (const url of urls.length ? urls : ['about:blank']) {
            const [, win] = await this.createTab(url, true);
            lastWindow = win;
          }
          return lastWindow || this.getWindow();
        },
        requestPermissions: async () => true
      });

      const events = this.session.extensions || this.session;
      events.on('extension-loaded', () => this.notifyChanged());
      events.on('extension-unloaded', () => this.notifyChanged());

      installChromeWebStore({
        session: this.session,
        extensionsPath: this.extensionsPath,
        beforeInstall: (details) => this.confirmInstall(details)
      }).catch((error) => console.error('[Extensions] Chrome Web Store support failed:', error));

      if (this.master === this) { this.installToolbarPreload(); this.registerIpc(); }
      this.ready = true;
      console.log('[Extensions] Ready');
    } catch (error) {
      console.error('[Extensions] Could not start extension support:', error);
    }
  }

  // The toolbar is a <browser-action-list> element defined by the library's browser-action script.
  // Shiira's preload is sandboxed and cannot require packages, so the script (which only needs 'electron')
  // is wrapped into a frame preload for the UI session. It only runs in Shiira's main window page.
  installToolbarPreload() {
    try {
      const source = fs.readFileSync(require.resolve('electron-chrome-extensions/browser-action'), 'utf-8');
      const wrapped = [
        '// Generated by Shiira from electron-chrome-extensions/browser-action (MIT, Samuel Maddock). Do not edit.',
        '(function () {',
        "  if (!/\\/renderer\\/index\\.html$/.test(location.pathname)) return;",
        '  var module = { exports: {} };',
        '  var exports = module.exports;',
        source,
        '  module.exports.injectBrowserAction();',
        '})();',
        ''
      ].join('\n');
      const target = path.join(app.getPath('userData'), 'browser-action-preload.js');
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf-8') !== wrapped) fs.writeFileSync(target, wrapped, 'utf-8');
      const ui = session.defaultSession;
      if (typeof ui.registerPreloadScript === 'function') {
        ui.registerPreloadScript({ id: 'shiira-browser-action', type: 'frame', filePath: target });
      } else {
        ui.setPreloads([...ui.getPreloads(), target]);
      }
    } catch (error) {
      console.error('[Extensions] Toolbar preload failed:', error);
    }
  }

  /** Every webview in a Shiira window becomes a tab extensions can see (if it uses the extensions session). */
  watchWindow(win) {
    if (!win || this.windows.has(win)) return;
    this.windows.add(win);
    win.on('closed', () => this.windows.delete(win));
    win.webContents.on('did-attach-webview', (event, guest) => {
      const engine = [...this.engines.values()].find(e => e.ready && e.session === guest.session);
      if (!engine) return;
      try {
        engine.extensions.addTab(guest, win);
      } catch (error) {
        console.warn('[Extensions] Could not add tab:', error.message);
      }
    });
  }

  hostWindowOf(wc) {
    const host = wc?.hostWebContents;
    return (host && BrowserWindow.fromWebContents(host)) || this.getWindow();
  }

  sendToHost(wc, channel, ...args) {
    const win = this.hostWindowOf(wc);
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  // Extensions open tabs through Shiira's renderer, which reports back the new tab's WebContents.
  createTab(url, active) {
    return new Promise((resolve, reject) => {
      const win = this.getWindow();
      if (!win || win.isDestroyed()) {
        reject(new Error('No Shiira window is open.'));
        return;
      }
      const requestId = this.profileId === 'default' ? ++this.counter : `${this.profileId}:${++this.counter}`;
      const timer = setTimeout(() => {
        this.pendingTabs.delete(requestId);
        reject(new Error('Shiira did not open the tab in time.'));
      }, 15000);
      this.pendingTabs.set(requestId, { resolve, reject, win, timer });
      win.webContents.send('extensions-create-tab', { requestId, url: typeof url === 'string' && url ? url : 'about:blank', active, profileId: this.profileId });
    });
  }

  // "Add this extension to Shiira?" is answered in the window; the store waits for the answer.
  confirmInstall(details) {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return Promise.resolve({ action: 'deny' });
    const id = `install-${this.profileId}-${++this.counter}`;
    let icon = '';
    try {
      if (details.icon && !details.icon.isEmpty()) icon = details.icon.resize({ width: 48, height: 48 }).toDataURL();
    } catch {
      icon = '';
    }
    return new Promise((resolve) => {
      const finish = (ok) => {
        this.pendingInstalls.delete(id);
        resolve({ action: ok ? 'allow' : 'deny' });
      };
      this.pendingInstalls.set(id, finish);
      finish.owner = win.webContents;
      win.once('closed', () => this.pendingInstalls.has(id) && finish(false));
      win.webContents.send('extensions-install-prompt', {
        id,
        extensionId: details.id,
        profileId: this.profileId,
        name: details.localizedName || details.manifest?.name || details.id,
        icon,
        permissions: describePermissions(details.manifest)
      });
    });
  }

  list() {
    if (!this.ready) return [];
    const source = this.session.extensions || this.session;
    return source.getAllExtensions()
      .map((extension) => ({
        id: extension.id,
        name: extension.name,
        version: extension.version,
        description: String(extension.manifest?.description || '').slice(0, 200),
        hasAction: Boolean(extension.manifest?.action || extension.manifest?.browser_action)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async uninstall(id) {
    if (!this.ready || typeof id !== 'string' || !/^[a-p]{32}$/.test(id)) return { success: false, error: 'Unknown extension.' };
    const source = this.session.extensions || this.session;
    if (!source.getExtension(id)) return { success: false, error: 'This extension is not installed.' };
    try {
      const { uninstallExtension } = require('electron-chrome-web-store');
      await uninstallExtension(id, { session: this.session, extensionsPath: this.extensionsPath });
    } catch (error) {
      // Not from the store (or files already gone): unload it at least.
      source.removeExtension(id);
    }
    this.notifyChanged();
    return { success: true };
  }

  notifyChanged() {
    for (const win of this.master.windows) {
      if (!win.isDestroyed()) win.webContents.send('extensions-changed');
    }
  }

  registerIpc() {
    ipcMain.handle('extensions-list', (_event, profileId = 'default') => this.engines.get(profileId)?.list() || []);
    ipcMain.handle('extensions-uninstall', (_event, id, profileId = 'default') => this.engines.get(profileId)?.uninstall(id) || { error: 'Profile unavailable.' });
    ipcMain.handle('extensions-tab-created', (event, requestId, wcId) => {
      const engine = [...this.engines.values()].find(e => e.pendingTabs.has(requestId));
      const pending = engine?.pendingTabs.get(requestId);
      if (!pending) return false;
      if (pending.win.webContents !== event.sender) return false;
      engine.pendingTabs.delete(requestId);
      clearTimeout(pending.timer);
      const wc = webContents.fromId(wcId);
      if (!wc || wc.hostWebContents !== event.sender || wc.session !== engine.session) {
        pending.reject(new Error('The tab closed before it opened.'));
        return false;
      }
      pending.resolve([wc, pending.win]);
      return true;
    });
    // The renderer tells the library which tab is on screen (for chrome.tabs.query({ active: true })).
    ipcMain.handle('extensions-tab-selected', (event, wcId) => {
      const wc = Number.isInteger(wcId) ? webContents.fromId(wcId) : null;
      const engine = wc && [...this.engines.values()].find(e => e.session === wc.session);
      if (!wc || wc.isDestroyed() || wc.hostWebContents !== event.sender || !engine) return false;
      try {
        engine.extensions.selectTab(wc);
      } catch (error) {
        // The library has not seen this tab yet; it will once it attaches.
      }
      return true;
    });
    ipcMain.handle('extensions-install-decision', (event, id, ok) => {
      const engine = [...this.engines.values()].find(e => e.pendingInstalls.has(id));
      const finish = engine?.pendingInstalls.get(id);
      if (finish?.owner !== event.sender) return false;
      finish(ok === true);
      return true;
    });
  }

  ensureProfile(profileId, partition) {
    if (this.engines.has(profileId)) return this.engines.get(profileId);
    const engine = new ExtensionsService(profileId, partition, this);
    engine.initialize({ getWindow: this.getWindow });
    return engine;
  }
}

module.exports = ExtensionsService;
module.exports.describePermissions = describePermissions;
module.exports.PARTITION = PARTITION;
