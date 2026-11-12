const { isYouTubeUrl, videoIdFromUrl } = require('../shared/youtube');
const { YouTubeService, deadline } = require('./youtube-service');

function installYouTubePlayback({ app, BrowserWindow, ipcMain, session }) {
  const owners = new Map();
  let solverWindow;
  let solverReady;
  async function evaluate(output) {
    if (typeof output !== 'string' || output.length > 8 * 1024 * 1024) throw new Error('Invalid player solver');
    if (!solverWindow || solverWindow.isDestroyed()) {
      solverWindow = new BrowserWindow({ show: false, skipTaskbar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
      solverWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      solverWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      solverReady = solverWindow.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; script-src %27unsafe-eval%27">');
    }
    await solverReady;
    const activeWindow = solverWindow;
    return deadline(activeWindow.webContents.executeJavaScript(`(() => { ${output}\n})()`), 3000, 'Player solver timed out')
      .catch((error) => { if (!activeWindow.isDestroyed()) activeWindow.destroy(); throw error; });
  }

  function ownerFor(event) {
    const contents = event.sender;
    if (contents.isDestroyed() || contents.getType() !== 'webview' ||
      event.senderFrame !== contents.mainFrame || !isYouTubeUrl(event.senderFrame.url)) {
      throw new Error('YouTube playback is only available in a YouTube tab');
    }
    let owner = owners.get(contents.id);
    if (!owner) {
      // Separate transient transport: API identity and media headers are preserved,
      // with no Ghostery hooks or browser header overrides on stream requests.
      const transport = session.fromPartition(`youtube-transport:${contents.id}`);
      const service = new YouTubeService({
        fetchImpl: (input, options) => transport.fetch(input, { ...options, credentials: 'omit' }),
        getCookie: async () => (await contents.session.cookies.get({ url: 'https://www.youtube.com' }))
          .map(({ name, value }) => `${name}=${value}`).join('; '),
        evaluate
      });
      owner = { service, generation: 0, source: null, videoId: null };
      owners.set(contents.id, owner);
      contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) { owner.generation++; owner.source = null; service.clearMedia(); }
      });
      contents.once('destroyed', () => { service.dispose(); owners.delete(contents.id); });
    }
    return owner;
  }

  ipcMain.handle('youtube:resolve', async (event, options = {}) => {
    try {
      const owner = ownerFor(event);
      const videoId = videoIdFromUrl(event.senderFrame.url);
      if (!videoId || options.videoId !== videoId || typeof options.fresh !== 'boolean') throw new Error('Invalid playback target');
      const generation = ++owner.generation;
      owner.service.clearMedia();
      owner.source = null;
      owner.videoId = videoId;
      const source = await owner.service.resolve(videoId, { fresh: options.fresh, rejectedClient: options.rejectedClient });
      if (generation !== owner.generation || event.sender.isDestroyed() || videoIdFromUrl(event.sender.getURL()) !== videoId) {
        return { error: 'Playback was cancelled' };
      }
      owner.source = source;
      return { source: owner.service.expose(source) };
    } catch { return { error: 'YouTube stream loading failed. Try again or use the YouTube player.' }; }
  });
  ipcMain.handle('youtube:media', async (event, options = {}) => {
    try {
      const owner = ownerFor(event);
      if (!owner.source || videoIdFromUrl(event.senderFrame.url) !== owner.videoId) throw new Error('Playback was cancelled');
      return await owner.service.media(options);
    } catch (error) {
      return { error: /^YouTube media (?:HTTP \d+|chunk too large)$/.test(error.message) ? error.message : 'YouTube media request failed' };
    }
  });
  ipcMain.on('youtube:cancel-media', (event, requestId) => {
    try { ownerFor(event).service.cancel(requestId); } catch { /* A departing page owns no requests. */ }
  });
  ipcMain.on('youtube:release', (event) => {
    try { const owner = ownerFor(event); owner.generation++; owner.source = null; owner.service.clearMedia(); } catch { /* Navigation already released it. */ }
  });
  ipcMain.on('youtube:playing', (event) => {
    try {
      const owner = ownerFor(event);
      if (owner.source && owner.videoId === videoIdFromUrl(event.senderFrame.url)) owner.service.notePlaying(owner.source);
    } catch { /* Ignore a late event from a departing page. */ }
  });
  app.on('before-quit', () => {
    for (const owner of owners.values()) owner.service.dispose();
    if (solverWindow && !solverWindow.isDestroyed()) solverWindow.destroy();
  });
}

module.exports = { installYouTubePlayback };
