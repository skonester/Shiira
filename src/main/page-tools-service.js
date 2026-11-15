const fs = require('node:fs/promises');

function installPageTools({ ipcMain, webContents, dialog, clipboard, ClipboardItem, nativeImage, BrowserWindow, isTrusted, isBusy = () => false }) {
  const captureDeadline = promise => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Capture timed out. Keep the page visible and try again.')), 10000);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  function ownedPage(event, id) {
    if (!isTrusted(event) || !Number.isInteger(id)) throw new Error('Unavailable.');
    const page = webContents.fromId(id);
    if (!page || page.isDestroyed() || page.getType() !== 'webview' || page.hostWebContents !== event.sender) throw new Error('This page is no longer available.');
    return page;
  }
  ipcMain.handle('page-can-sleep', (event, id) => {
    try {
      const page = ownedPage(event, id);
      return !page.isLoading() && !page.isCurrentlyAudible() && !page.isDevToolsOpened() && !page.isBeingCaptured() && !isBusy(page);
    } catch { return false; }
  });
  ipcMain.handle('spaces-export-html', async (event, title, html) => {
    if (!isTrusted(event) || typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024 || !html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')) return { error: 'Invalid bookmark export.' };
    try {
      const name = String(title || 'Space').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80);
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Export Space as bookmarks', defaultPath: `${name}.html`, filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.writeFile(result.filePath, html, 'utf8');
      return { success: true };
    } catch (error) { return { error: error.message }; }
  });
  ipcMain.handle('page-media-control', async (event, id, action, value = 0) => {
    try {
      const page = ownedPage(event, id);
      if (!['toggle', 'pause', 'mute', 'seek', 'back', 'forward', 'auto-pip', 'exit-auto-pip'].includes(action) || !Number.isFinite(value)) return false;
      // World 999 is Electron's isolated preload world. Preserve the user
      // gesture for playback and picture-in-picture in the closed player.
      return await page.executeJavaScriptInIsolatedWorld(999, [{ code: `globalThis.__shiiraMediaControl?.(${JSON.stringify(action)}, ${Math.max(0, value)}) ?? false` }], true);
    } catch { return false; }
  });
  ipcMain.handle('page-capture', async (event, id, options = {}) => {
    let debuggerAttached = false;
    let page;
    try {
      page = ownedPage(event, id);
      if (!['area', 'visible', 'full'].includes(options.mode)) throw new Error('Choose a capture mode.');
      let captured;
      if (options.mode === 'full') {
        if (page.debugger.isAttached() || page.isDevToolsOpened()) throw new Error('Close this page’s developer tools before a full-page capture.');
        page.debugger.attach('1.3');
        debuggerAttached = true;
        const { cssContentSize: size } = await captureDeadline(page.debugger.sendCommand('Page.getLayoutMetrics'));
        const width = Math.ceil(size.width), height = Math.ceil(size.height);
        if (!width || !height || width > 16384 || height > 32768 || width * height > 40000000) throw new Error('This page is too large for a full-page capture. Capture an area instead.');
        const result = await captureDeadline(page.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale: 1 } }));
        captured = nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'));
      } else {
        let rect;
        if (options.mode === 'area') {
          rect = options.rect;
          if (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isInteger(rect[k]) && rect[k] >= 0) || !rect.width || !rect.height || rect.x + rect.width > 32768 || rect.y + rect.height > 32768 || rect.width * rect.height > 40000000) throw new Error('Choose an area within the page.');
        }
        captured = await captureDeadline(page.capturePage(rect));
      }
      if (captured.isEmpty()) throw new Error('This page could not be captured.');
      if (options.destination === 'copy') {
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([captured.toPNG()], { type: 'image/png' }) })]);
        return { success: true, copied: true };
      }
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Save page capture', defaultPath: 'Shiira Capture.png', filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.writeFile(result.filePath, captured.toPNG());
      return { success: true };
    } catch (error) { return { error: error.message }; }
    finally { try { if (debuggerAttached && !page.isDestroyed() && page.debugger.isAttached()) page.debugger.detach(); } catch {} }
  });
}
module.exports = { installPageTools };
