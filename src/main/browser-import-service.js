const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');

function runImportTask(request) {
  return new Promise((resolve, reject) => {
    let received = false;
    const worker = new Worker(path.join(__dirname, 'import-worker.js'), { workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Import took too long. Try an exported bookmarks HTML file.')); }, 20000);
    worker.once('message', result => { received = true; clearTimeout(timer); resolve(result); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); if (code || !received) reject(new Error('Could not read this import source.')); });
  });
}

function installBrowserImports({ ipcMain, dialog, BrowserWindow, bookmarksService, isTrusted }) {
  const previews = new Map();
  const owners = new WeakSet();
  const busy = new Set();
  const withOwner = action => async (event, ...args) => {
    if (!isTrusted(event)) return { error: 'Unavailable.' };
    if (busy.has(event.sender.id)) return { error: 'An import is already running.' };
    busy.add(event.sender.id);
    try { return await action(event, ...args); }
    catch (error) { return { error: error.message }; }
    finally { busy.delete(event.sender.id); }
  };
  ipcMain.handle('browser-import-detect', withOwner(() => runImportTask({ task: 'detect' })));
  ipcMain.handle('browser-import-preview', withOwner(async (event, source) => {
    let request;
    if (source?.kind === 'file') {
      const chosen = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Import bookmarks', properties: ['openFile'], filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }]
      });
      if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
      request = { task: 'file', file: chosen.filePaths[0] };
    } else {
      if (typeof source?.browserId !== 'string' || typeof source?.profileId !== 'string') return { error: 'Choose a browser profile.' };
      request = { task: 'browser', browserId: source.browserId, profileId: source.profileId };
    }
    const data = await runImportTask(request);
    if (data.error) return data;
    const token = randomUUID();
    // One expiring preview per UI window; disk paths never come from the renderer.
    previews.set(event.sender.id, { token, data, expires: Date.now() + 15 * 60000 });
    if (!owners.has(event.sender)) {
      owners.add(event.sender);
      event.sender.once('destroyed', () => previews.delete(event.sender.id));
    }
    return { ...data, nodes: undefined, token };
  }));
  ipcMain.handle('browser-import-apply', withOwner((event, token, target) => {
    const preview = previews.get(event.sender.id);
    if (!preview || preview.token !== token || preview.expires < Date.now()) return { error: 'Choose the source again to refresh its preview.' };
    if (!['bar', 'space', 'new-space'].includes(target)) return { error: 'Choose an import destination.' };
    if (target === 'bar') {
      const result = bookmarksService.importTree(preview.data.nodes, preview.data.name || 'Imported Bookmarks');
      if (!result.success) return { error: result.error };
      previews.delete(event.sender.id);
      return { success: true, ...result };
    }
    previews.delete(event.sender.id);
    return { success: true, data: preview.data };
  }));
}

module.exports = { installBrowserImports, runImportTask };
