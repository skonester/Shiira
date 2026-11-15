const { isYouTubeUrl, playbackVideoIdFromUrl } = require('../shared/youtube');
const { YouTubeService, deadline } = require('./youtube-service');
const { PlaybackAnalyticsStore } = require('./youtube-analytics');

function installYouTubePlayback({ app, BrowserWindow, ipcMain, session, dialog, isTrusted = () => false,
  analytics = new PlaybackAnalyticsStore(), onDiagnostic = () => {} }) {
  const owners = new Map();
  let solverWindow;
  let solverReady;
  function release(owner) {
    analytics.end(owner.analyticsSessionId);
    owner.analyticsSessionId = null;
    owner.generation++;
    owner.source = null;
    owner.sourceUri = null;
    owner.videoId = null;
    owner.service.clearMedia();
    owner.service.cancelResolutions();
  }

  function owns(event, owner, generation = owner.generation) {
    return generation === owner.generation && !event.sender.isDestroyed() &&
      event.senderFrame === event.sender.mainFrame &&
      owner.videoId === playbackVideoIdFromUrl(event.sender.getURL());
  }
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
    return deadline(activeWindow.webContents.executeJavaScript(`(() => { ${output}\n})()`), 10000, 'Player solver timed out')
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
        evaluate,
        onDiagnostic,
        onMediaRequest: request => {
          if (request.source === owner.source) analytics.transport(owner.analyticsSessionId, request);
        }
      });
      owner = { service, generation: 0, source: null, videoId: null };
      owners.set(contents.id, owner);
      contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) release(owner);
      });
      contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame && owner.videoId !== playbackVideoIdFromUrl(url)) release(owner);
      });
      contents.once('destroyed', () => { analytics.end(owner.analyticsSessionId, 'tab-closed'); service.dispose(); owners.delete(contents.id); });
    }
    return owner;
  }

  ipcMain.handle('youtube:resolve', async (event, options = {}) => {
    let owner;
    let generation;
    let phase = 'resolution';
    try {
      owner = ownerFor(event);
      const videoId = playbackVideoIdFromUrl(event.senderFrame.url);
      if (!videoId || options.videoId !== videoId || typeof options.fresh !== 'boolean') throw new Error('Invalid playback target');
      if (owner.videoId && owner.videoId !== videoId) release(owner);
      generation = ++owner.generation;
      owner.service.clearMedia();
      owner.source = null;
      owner.sourceUri = null;
      owner.videoId = videoId;
      owner.analyticsSessionId ||= analytics.start({ ownerId: event.sender.id, hostId: event.sender.hostWebContents?.id,
        videoId, privateMode: event.sender.session.isPersistent?.() === false });
      const source = await owner.service.resolve(videoId, { fresh: options.fresh, rejectedClient: options.rejectedClient });
      if (!owns(event, owner, generation)) {
        return { error: 'Playback was cancelled' };
      }
      phase = 'expose';
      if (source.videoId !== videoId) throw new Error('Invalid playback source');
      const exposed = owner.service.expose(source);
      owner.source = source;
      owner.sourceUri = exposed.uri;
      analytics.source(owner.analyticsSessionId, source, exposed.uri);
      return { source: exposed, analytics: { sessionId: owner.analyticsSessionId } };
    } catch (error) {
      if (owner && generation === owner.generation && error?.name !== 'AbortError') {
        owner.service.clearMedia();
        owner.service.diagnose('resolve_failed', { phase,
          code: ['TIMEOUT', 'VERIFICATION_REQUIRED', 'STREAM_UNAVAILABLE'].includes(error?.code) ? error.code : 'FAILED' });
      }
      return { error: 'YouTube stream loading failed. Try again or use the YouTube player.',
        ...(owner?.analyticsSessionId ? { analytics: { sessionId: owner.analyticsSessionId } } : {}) };
    }
  });
  ipcMain.handle('youtube:media', async (event, options = {}) => {
    try {
      const owner = ownerFor(event);
      if (!owner.source || !owns(event, owner)) throw new Error('Playback was cancelled');
      const generation = owner.generation;
      const response = await owner.service.media(options);
      if (!owns(event, owner, generation)) throw new Error('Playback was cancelled');
      return response;
    } catch (error) {
      return { error: /^YouTube media (?:HTTP \d+|chunk too large)$/.test(error.message) ? error.message : 'YouTube media request failed' };
    }
  });
  ipcMain.on('youtube:cancel-media', (event, requestId) => {
    try { ownerFor(event).service.cancel(requestId); } catch { /* A departing page owns no requests. */ }
  });
  ipcMain.on('youtube:analytics', (event, packet) => {
    try {
      const owner = ownerFor(event);
      if (!owns(event, owner) || packet?.videoId !== owner.videoId || packet.sessionId !== owner.analyticsSessionId ||
        (packet.uri ?? null) !== (owner.sourceUri ?? null)) return;
      analytics.ingest(owner.analyticsSessionId, packet.uri ?? null, packet);
    } catch { /* A stale, subframe or departed document owns no telemetry. */ }
  });
  ipcMain.handle('youtube:analytics-get', event => {
    try { return analytics.get(ownerFor(event).analyticsSessionId); } catch { return null; }
  });
  async function exportReport(event, id) {
    const report = analytics.get(id);
    if (!report || !dialog) return { error: 'Playback report is unavailable.' };
    try {
      const host = event.sender.hostWebContents || event.sender;
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(host), {
        title: 'Save playback diagnostics', defaultPath: `Shiira-YouTube-${report.videoId}.json`,
        filters: [{ name: 'JSON report', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      await require('node:fs/promises').writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
      return { success: true };
    } catch { return { error: 'Playback report could not be saved.' }; }
  }
  ipcMain.handle('youtube:analytics-export', event => {
    try { return exportReport(event, ownerFor(event).analyticsSessionId); } catch { return { error: 'Playback report is unavailable.' }; }
  });
  ipcMain.handle('youtube-analytics-list', event => isTrusted(event) ? analytics.list(event.sender.id) : []);
  ipcMain.handle('youtube-analytics-get', (event, id) => isTrusted(event) && analytics.belongsTo(id, event.sender.id) ? analytics.get(id) : null);
  ipcMain.handle('youtube-analytics-export', (event, id) => isTrusted(event) && analytics.belongsTo(id, event.sender.id)
    ? exportReport(event, id) : { error: 'Playback report is unavailable.' });
  ipcMain.on('youtube:release', (event, source) => {
    try {
      const owner = ownerFor(event);
      if (source?.videoId === owner.videoId && (source.uri ?? null) === (owner.sourceUri ?? null)) release(owner);
    } catch { /* Navigation already released it. */ }
  });
  ipcMain.on('youtube:error', (event, error) => {
    try {
      const owner = ownerFor(event);
      if (!error || !['attach', 'load', 'playback'].includes(error.phase) ||
        (error.phase === 'attach'
          ? !playbackVideoIdFromUrl(event.senderFrame.url) || error.videoId !== playbackVideoIdFromUrl(event.senderFrame.url) || owner.source || error.uri != null
          : !owner.source || !owns(event, owner) || owner.sourceUri !== error.uri) ||
        ![error.code, error.category, error.severity].every(value => Number.isInteger(value) && value >= 0 && value <= 100000)) return;
      onDiagnostic({ stage: 'player_failed', phase: error.phase, code: error.code,
        category: error.category, severity: error.severity });
    } catch { /* Ignore a late error from a departing page. */ }
  });
  ipcMain.on('youtube:playing', (event, frame) => {
    try {
      const owner = ownerFor(event);
      if (!frame || frame.uri !== owner.sourceUri || !Number.isSafeInteger(frame.frames) || frame.frames < 1 ||
        !Number.isInteger(frame.width) || frame.width < 1 || frame.width > 32768 ||
        !Number.isInteger(frame.height) || frame.height < 1 || frame.height > 32768) return;
      if (owner.source && owner.videoId === playbackVideoIdFromUrl(event.senderFrame.url)) {
        owner.service.notePlaying(owner.source);
        onDiagnostic({ stage: 'first_frame', client: owner.source.client,
          width: frame.width, height: frame.height, frames: frame.frames });
      }
    } catch { /* Ignore a late event from a departing page. */ }
  });
  app.on('before-quit', () => {
    for (const owner of owners.values()) { analytics.end(owner.analyticsSessionId, 'app-closed'); owner.service.dispose(); }
    if (solverWindow && !solverWindow.isDestroyed()) solverWindow.destroy();
  });
  return { analytics };
}

module.exports = { installYouTubePlayback };
