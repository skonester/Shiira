const path = require('node:path');
const nodeModule = require('node:module');

function enableCodeCache(app) {
  const result = nodeModule.enableCompileCache(path.join(app.getPath('userData'), 'v8-compile-cache'));
  if (result.status === nodeModule.constants.compileCacheStatus.FAILED) {
    console.warn('[Startup] V8 compile cache unavailable:', result.message);
  }
  return result;
}

function createStartupSplash({ app, BrowserWindow, ipcMain }) {
  let splash = new BrowserWindow({
    width: 360,
    height: 300,
    title: 'Shiira',
    icon: path.join(__dirname, '../../assets/shiira.png'),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#020308',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      devTools: false
    }
  });
  let browserWindow;
  let painted = false;
  let rendererReady = false;
  let readinessTimedOut = false;
  let finished = false;
  let timeout;

  function dismiss() {
    if (!splash) return;
    splash.removeListener('closed', onSplashClosed);
    if (!splash.isDestroyed()) splash.destroy();
    splash = null;
  }

  function cleanup() {
    clearTimeout(timeout);
    ipcMain.removeListener('startup-ready', onRendererReady);
    app.removeListener('before-quit', cancel);
    browserWindow?.removeListener('ready-to-show', onPaint);
    browserWindow?.removeListener('closed', cancel);
    browserWindow?.webContents.removeListener('did-fail-load', onLoadFailed);
    browserWindow?.webContents.removeListener('render-process-gone', onRendererGone);
  }

  function reveal(force = false) {
    if (finished || !browserWindow || browserWindow.isDestroyed()) return;
    if (!force && (!painted || (!rendererReady && !readinessTimedOut))) return;
    finished = true;
    cleanup();
    browserWindow.maximize();
    browserWindow.show();
    dismiss();
  }

  function onPaint() {
    painted = true;
    reveal();
  }

  function onRendererReady(event) {
    if (event.sender !== browserWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return;
    rendererReady = true;
    reveal();
  }

  function onLoadFailed(_event, code, description, _url, isMainFrame) {
    if (!isMainFrame) return;
    console.warn('[Startup] Browser UI failed to load:', code, description);
    reveal(true);
  }

  function onRendererGone(_event, details) {
    console.warn('[Startup] Browser renderer exited:', details.reason);
    reveal(true);
  }

  function cancel() {
    finished = true;
    cleanup();
    dismiss();
  }

  function onSplashClosed() {
    splash = null;
    cancel();
    app.quit();
  }

  app.once('before-quit', cancel);
  splash.once('closed', onSplashClosed);
  splash.once('ready-to-show', () => {
    if (!finished && splash && !splash.isDestroyed()) splash.show();
  });
  splash.loadFile(path.join(__dirname, '../renderer/splash.html')).catch(error => {
    if (finished) return;
    console.warn('[Startup] Splash unavailable:', error.message);
    dismiss();
  });

  return {
    attachTo(window) {
      browserWindow = window;
      if (finished) return;
      window.once('ready-to-show', onPaint);
      window.once('closed', cancel);
      window.webContents.on('did-fail-load', onLoadFailed);
      window.webContents.once('render-process-gone', onRendererGone);
      ipcMain.on('startup-ready', onRendererReady);
      // A renderer failure must leave the browser window accessible for recovery.
      timeout = setTimeout(() => {
        console.warn('[Startup] Browser readiness timed out');
        readinessTimedOut = true;
        reveal();
      }, 15000);
    }
  };
}

module.exports = { enableCodeCache, createStartupSplash };
