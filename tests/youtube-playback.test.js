const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { YouTubeService } = require('../src/main/youtube-service');
const { installYouTubePlayback } = require('../src/main/youtube-playback');

function playbackHarness(context, resolve = async videoId => ({
  videoId, client: 'VISIONOS', kind: 'dash', manifest: '<MPD/>'
}), extra = {}) {
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, callback) => handlers.set(name, callback);
  const app = new EventEmitter();
  const diagnostics = [];
  context.mock.method(YouTubeService.prototype, 'resolve', resolve);
  const installed = installYouTubePlayback({ app, ipcMain, BrowserWindow: class {}, isTrusted: event => event.trusted === true,
    session: { fromPartition: () => ({ fetch() {} }) }, onDiagnostic: event => diagnostics.push(event), ...extra });
  const sender = new EventEmitter();
  sender.id = 18;
  sender.mainFrame = { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' };
  sender.getType = () => 'webview';
  sender.isDestroyed = () => false;
  sender.getURL = () => sender.mainFrame.url;
  sender.session = { cookies: { get: async () => [] } };
  sender.hostWebContents = { id: 22 };
  const event = { sender, senderFrame: sender.mainFrame };
  context.after(() => app.emit('before-quit'));
  return { app, ipcMain, handlers, sender, event, diagnostics, analytics: installed.analytics,
    resolve: (options = {}) => handlers.get('youtube:resolve')(event, { videoId: 'jNQXAC9IVRw', fresh: false, ...options }) };
}

test('playback confirmation requires a decoded frame bound to the owner’s current replacement source', async context => {
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, callback) => handlers.set(name, callback);
  const app = new EventEmitter();
  const diagnostics = [];
  const promoted = [];
  context.mock.method(YouTubeService.prototype, 'resolve', async videoId => ({
    videoId, client: 'VISIONOS', kind: 'dash', manifest: '<MPD/>', attempts: ['WEB', 'VISIONOS']
  }));
  context.mock.method(YouTubeService.prototype, 'notePlaying', source => promoted.push(source));
  installYouTubePlayback({ app, ipcMain, BrowserWindow: class {},
    session: { fromPartition: () => ({ fetch() {} }) }, onDiagnostic: event => diagnostics.push(event) });
  const sender = new EventEmitter();
  sender.id = 17;
  sender.mainFrame = { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' };
  sender.getType = () => 'webview';
  sender.isDestroyed = () => false;
  sender.getURL = () => sender.mainFrame.url;
  sender.session = { cookies: { get: async () => [] } };
  const event = { sender, senderFrame: sender.mainFrame };
  const first = await handlers.get('youtube:resolve')(event, { videoId: 'jNQXAC9IVRw', fresh: false });
  const frame = { uri: first.source.uri, width: 640, height: 360, frames: 1 };
  for (const value of [undefined, {}, { ...frame, frames: 0 }, { ...frame, width: 0 },
    { ...frame, uri: 'shiira-youtube://manifest/another-source' }]) {
    ipcMain.emit('youtube:playing', event, value);
  }
  assert.equal(promoted.length, 0, 'native playback and play events are not replacement-frame evidence');
  ipcMain.emit('youtube:playing', event, frame);
  assert.equal(promoted.length, 1);
  assert.deepEqual(diagnostics, [{ stage: 'first_frame', client: 'VISIONOS', width: 640, height: 360, frames: 1 }]);
  await handlers.get('youtube:resolve')(event, { videoId: 'jNQXAC9IVRw', fresh: true });
  ipcMain.emit('youtube:playing', event, frame);
  assert.equal(promoted.length, 1, 'a previous source’s late frame cannot confirm a replacement');
  app.emit('before-quit');
});

test('IPC source exposure errors preserve a sanitized phase instead of silently disappearing', async context => {
  const page = playbackHarness(context);
  context.mock.method(YouTubeService.prototype, 'expose', () => { throw new TypeError('secret cookie and signed https://example.com/media'); });
  assert.ok((await page.resolve()).error);
  assert.deepEqual(page.diagnostics, [{ stage: 'resolve_failed', phase: 'expose', code: 'FAILED' }]);
});

test('SPA navigation immediately aborts old media and invalidates a resolution even when returning to the same video', async context => {
  let complete;
  const page = playbackHarness(context, videoId => new Promise(resolve => { complete = () => resolve({
    videoId, client: 'VISIONOS', kind: 'dash', manifest: '<MPD/>'
  }); }));
  let clears = 0;
  context.mock.method(YouTubeService.prototype, 'clearMedia', () => { clears++; });
  const pending = page.resolve();
  const before = clears;
  page.sender.mainFrame.url = 'https://www.youtube.com/watch?v=secondvid01';
  page.sender.emit('did-navigate-in-page', {}, page.sender.mainFrame.url, true);
  assert.equal(clears, before + 1, 'navigation releases requests before the preload polls its URL');
  page.sender.mainFrame.url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  page.sender.emit('did-navigate-in-page', {}, page.sender.mainFrame.url, true);
  complete();
  assert.equal((await pending).error, 'Playback was cancelled');
});

test('old-source and wrong-video player errors cannot emit current player diagnostics', async context => {
  const page = playbackHarness(context);
  const { source } = await page.resolve();
  const error = { uri: source.uri, videoId: source.videoId, phase: 'playback', code: 1001, category: 1, severity: 2 };
  page.sender.mainFrame.url = 'https://www.youtube.com/watch?v=secondvid01';
  page.ipcMain.emit('youtube:error', page.event, error);
  assert.equal(page.diagnostics.length, 0);
  page.sender.mainFrame.url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  page.ipcMain.emit('youtube:release', page.event, { videoId: source.videoId, uri: source.uri });
  page.ipcMain.emit('youtube:error', page.event, error);
  assert.equal(page.diagnostics.length, 0, 'released sources cannot report errors');
});

test('a media response completing after ownership changes is cancelled', async context => {
  const page = playbackHarness(context);
  const { source } = await page.resolve();
  let complete;
  context.mock.method(YouTubeService.prototype, 'media', () => new Promise(resolve => { complete = resolve; }));
  const pending = page.handlers.get('youtube:media')(page.event, { uri: source.uri, requestId: 'late' });
  await page.resolve({ fresh: true });
  complete({ data: new Uint8Array([1]), headers: {} });
  assert.equal((await pending).error, 'YouTube media request failed');
});

test('an HTTP media error retains its status through IPC', async context => {
  const page = playbackHarness(context);
  const { source } = await page.resolve();
  for (const status of [403, 429, 503]) {
    context.mock.method(YouTubeService.prototype, 'media', async () => { throw new Error(`YouTube media HTTP ${status}`); });
    assert.deepEqual(await page.handlers.get('youtube:media')(page.event, { uri: source.uri, requestId: String(status) }),
      { error: `YouTube media HTTP ${status}` });
  }
});

test('a late release from a previous video cannot cancel the current source', async context => {
  const page = playbackHarness(context);
  const { source: old } = await page.resolve();
  page.sender.mainFrame.url = 'https://www.youtube.com/watch?v=secondvid01';
  page.sender.emit('did-navigate-in-page', {}, page.sender.mainFrame.url, true);
  const { source } = await page.resolve({ videoId: 'secondvid01' });
  page.ipcMain.emit('youtube:release', page.event, { videoId: old.videoId, uri: old.uri });
  page.ipcMain.emit('youtube:playing', page.event, { uri: source.uri, width: 640, height: 360, frames: 1 });
  assert.equal(page.diagnostics.filter(event => event.stage === 'first_frame').length, 1);
});

test('local analytics IPC is bound to the main frame, current source, video, session and owning chrome window', async context => {
  const page = playbackHarness(context);
  const first = await page.resolve();
  const packet = { sessionId: first.analytics.sessionId, videoId: first.source.videoId, uri: first.source.uri,
    sequence: 1, phase: 'playing', metrics: { watchMs: 2000 }, state: { time: 2 }, events: [] };
  const emit = (event, data) => page.ipcMain.emit('youtube:analytics', event, data);
  for (const invalid of [{ ...packet, uri: 'wrong' }, { ...packet, videoId: 'secondvid01' }, { ...packet, sessionId: 'wrong' }]) emit(page.event, invalid);
  emit({ ...page.event, senderFrame: {} }, packet);
  assert.equal(page.analytics.get(packet.sessionId).metrics.watchMs, undefined);
  emit(page.event, packet);
  assert.equal(page.analytics.get(packet.sessionId).metrics.watchMs, 2000);
  const second = await page.resolve({ fresh: true });
  assert.equal(second.analytics.sessionId, first.analytics.sessionId, 'source recovery retains one view');
  emit(page.event, { ...packet, sequence: 2, metrics: { watchMs: 9999 } });
  assert.equal(page.analytics.get(packet.sessionId).metrics.watchMs, 2000);
  emit(page.event, { ...packet, uri: second.source.uri, sequence: 2, metrics: { watchMs: 3000 } });
  const get = page.handlers.get('youtube-analytics-get');
  assert.equal(get({ trusted: false, sender: { id: 22 } }, packet.sessionId), null);
  assert.equal(get({ trusted: true, sender: { id: 23 } }, packet.sessionId), null);
  assert.equal(get({ trusted: true, sender: { id: 22 } }, packet.sessionId).metrics.watchMs, 3000);
  assert.equal(await page.handlers.get('youtube:analytics-get')({ ...page.event, senderFrame: {} }), null);
  page.sender.emit('did-navigate-in-page', {}, 'https://www.youtube.com/watch?v=secondvid01', true);
  assert.ok(page.analytics.get(packet.sessionId).endedAt);
});

test('JSON export writes the sanitized report chosen by the owner and denies another window', async context => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-analytics-export-'));
  const filename = path.join(directory, 'report.json');
  context.after(() => { fs.rmSync(filename, { force: true }); fs.rmdirSync(directory); });
  let saves = 0;
  const page = playbackHarness(context, undefined, {
    BrowserWindow: { fromWebContents: host => host },
    dialog: { showSaveDialog: async host => { assert.equal(host.id, 22); saves++; return { filePath: filename }; } }
  });
  const response = await page.resolve();
  const id = response.analytics.sessionId;
  page.ipcMain.emit('youtube:analytics', page.event, { sessionId: id, uri: response.source.uri, videoId: response.source.videoId,
    sequence: 1, phase: 'playing', metrics: { startupMs: 100 }, state: { time: 1, signedUrl: 'https://secret' }, events: [] });
  const exportReport = page.handlers.get('youtube-analytics-export');
  assert.ok((await exportReport({ trusted: true, sender: { id: 23 } }, id)).error);
  assert.equal(saves, 0);
  assert.deepEqual(await exportReport({ trusted: true, sender: { id: 22 } }, id), { success: true });
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.equal(report.metrics.startupMs, 100);
  assert.equal(report.state.signedUrl, undefined);
  assert.equal(report.sources[0].client, 'VISIONOS');
});
