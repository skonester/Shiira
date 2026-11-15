const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createStartupSplash } = require('../src/main/startup');

function startup(context, { splashFails = false } = {}) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(console, 'warn', () => {});
  const windows = [];
  class Window extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.destroyed = false;
      this.shows = 0;
      this.maximizes = 0;
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.shows++; }
    maximize() { this.maximizes++; }
    async loadFile(file) {
      this.file = file;
      if (splashFails) throw new Error('Missing splash');
    }
  }
  const app = new EventEmitter();
  app.quits = 0;
  app.quit = () => { app.quits++; app.emit('before-quit'); };
  const ipcMain = new EventEmitter();
  const splashController = createStartupSplash({ app, BrowserWindow: Window, ipcMain });
  const splash = windows[0];
  const browser = new Window();
  splashController.attachTo(browser);
  context.after(() => app.emit('before-quit'));
  const ready = (sender = browser.webContents, senderFrame = sender.mainFrame) =>
    ipcMain.emit('startup-ready', { sender, senderFrame });
  return { app, ipcMain, splash, browser, ready };
}

test('the logo splash hands off once both browser paint and renderer initialization finish', context => {
  const { splash, browser, ipcMain, ready } = startup(context);
  assert.equal(splash.options.webPreferences.javascript, false);
  assert.equal(splash.options.webPreferences.nodeIntegration, false);
  assert.equal(splash.options.webPreferences.sandbox, true);
  assert.ok(fs.existsSync(splash.options.icon));
  assert.ok(fs.existsSync(splash.file));
  splash.emit('ready-to-show');
  assert.equal(splash.shows, 1);
  browser.emit('ready-to-show');
  ready({ mainFrame: {} });
  ready(browser.webContents, {});
  assert.equal(browser.shows, 0, 'another window or subframe cannot dismiss the splash');
  ready();
  assert.equal(browser.shows, 1);
  assert.equal(browser.maximizes, 1);
  assert.equal(splash.destroyed, true);
  ready();
  context.mock.timers.tick(15000);
  assert.equal(browser.shows, 1);
  assert.equal(ipcMain.listenerCount('startup-ready'), 0);
});

test('renderer readiness arriving before first paint still waits for the painted browser', context => {
  const { splash, browser, ready } = startup(context);
  ready();
  assert.equal(browser.shows, 0);
  browser.emit('ready-to-show');
  assert.equal(browser.shows, 1);
  splash.emit('ready-to-show');
  assert.equal(splash.shows, 0, 'a late splash paint cannot cover the browser');
});

test('a failed browser document load releases the splash while subframe failures leave startup running', context => {
  const { splash, browser } = startup(context);
  browser.webContents.emit('did-fail-load', {}, -3, 'Frame failed', 'about:blank', false);
  assert.equal(browser.shows, 0);
  browser.webContents.emit('did-fail-load', {}, -6, 'File missing', 'file:///index.html', true);
  assert.equal(browser.shows, 1);
  assert.equal(splash.destroyed, true);
  assert.equal(browser.webContents.listenerCount('render-process-gone'), 0);
});

test('a browser crash during startup releases the splash immediately', context => {
  const { splash, browser } = startup(context);
  browser.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(browser.shows, 1);
  assert.equal(splash.destroyed, true);
});

test('startup timeout waits for a painted document before exposing the browser', context => {
  const { splash, browser, ipcMain } = startup(context);
  context.mock.timers.tick(15000);
  assert.equal(browser.shows, 0);
  assert.equal(splash.destroyed, false);
  browser.emit('ready-to-show');
  assert.equal(browser.shows, 1);
  assert.equal(splash.destroyed, true);
  assert.equal(ipcMain.listenerCount('startup-ready'), 0);
});

test('closing the browser cancels delayed startup work', context => {
  const { splash, browser, ipcMain, ready } = startup(context);
  browser.destroy();
  ready();
  context.mock.timers.tick(15000);
  assert.equal(browser.shows, 0);
  assert.equal(splash.destroyed, true);
  assert.equal(ipcMain.listenerCount('startup-ready'), 0);
});

test('quitting during startup cleans up the splash and pending callbacks', context => {
  const { app, splash, browser, ipcMain, ready } = startup(context);
  app.quit();
  ready();
  browser.emit('ready-to-show');
  context.mock.timers.tick(15000);
  assert.equal(splash.destroyed, true);
  assert.equal(browser.shows, 0);
  assert.equal(ipcMain.listenerCount('startup-ready'), 0);
});

test('closing the splash cancels application startup', context => {
  const { app, splash, browser, ready } = startup(context);
  splash.destroy();
  ready();
  browser.emit('ready-to-show');
  assert.equal(app.quits, 1);
  assert.equal(browser.shows, 0);
});

test('an unavailable splash page still allows the browser to open', async context => {
  const { splash, browser, ready, app } = startup(context, { splashFails: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(splash.destroyed, true);
  assert.equal(app.quits, 0);
  browser.emit('ready-to-show');
  ready();
  assert.equal(browser.shows, 1);
});

test('persistent V8 cache supports dynamic imports, source updates and an unavailable cache directory', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-startup-cache-'));
  context.after(() => {
    assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('shiira-startup-cache-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const commonjs = path.join(directory, 'fixture.cjs');
  const esm = path.join(directory, 'fixture.mjs');
  fs.writeFileSync(commonjs, "module.exports = () => import('./fixture.mjs');");
  fs.writeFileSync(esm, 'export const value = 42;');
  const script = `
    (async () => {
      const fs = require('node:fs');
      const moduleCache = require('node:module');
      const { enableCodeCache } = require(process.argv[1]);
      const result = enableCodeCache({ getPath: () => process.argv[2] });
      const { value } = await require(process.argv[3])();
      moduleCache.flushCompileCache();
      const cache = moduleCache.getCompileCacheDir();
      console.log(JSON.stringify({ status: result.status, value,
        files: cache ? fs.readdirSync(cache).length : 0 }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  function launch(userData) {
    const environment = { ...process.env };
    delete environment.NODE_COMPILE_CACHE;
    delete environment.NODE_DISABLE_COMPILE_CACHE;
    const result = spawnSync(process.execPath, ['-e', script, require.resolve('../src/main/startup'), userData, commonjs], {
      env: environment,
      encoding: 'utf8', windowsHide: true, timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  }
  for (let launchNumber = 0; launchNumber < 2; launchNumber++) {
    const result = launch(directory);
    assert.equal(result.status, 1);
    assert.equal(result.value, 42);
    assert.ok(result.files >= 2, 'CommonJS and ESM compilation both produce cache entries');
  }
  fs.writeFileSync(esm, 'export const value = 43;');
  assert.equal(launch(directory).value, 43, 'updated source replaces previously cached bytecode');
  const unavailable = path.join(directory, 'unavailable');
  fs.mkdirSync(unavailable);
  fs.writeFileSync(path.join(unavailable, 'v8-compile-cache'), 'file blocking the cache directory');
  const result = launch(unavailable);
  assert.equal(result.status, 0);
  assert.equal(result.value, 43, 'cache failure preserves module loading');
});
