// Real Shiira main/preload/Ghostery/Shaka with synthetic DASH media. Optional
// SHIIRA_YOUTUBE_LIVE=1 also plays a public video through the live resolver.
const { app, BrowserWindow, session, webContents } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const appRoot = process.env.SHIIRA_SMOKE_APP_ROOT ? path.resolve(process.env.SHIIRA_SMOKE_APP_ROOT) : path.resolve(__dirname, '..');
const loadApp = file => require(path.join(appRoot, file));
if (process.env.SHIIRA_SMOKE_APP_ROOT) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) });
  app.getAppPath = () => appRoot;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-youtube-'));
const artifacts = path.resolve(__dirname, '../tmp/youtube-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
loadApp('src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
const { YouTubeService } = loadApp('src/main/youtube-service');
const originalCreate = YouTubeService.prototype.createInnertube;
const fixtureDir = path.join(__dirname, 'fixtures/youtube');
const mpd = fs.readFileSync(path.join(fixtureDir, 'manifest.mpd'), 'utf8')
  .replace(/<BaseURL>([^<]+)<\/BaseURL>/g, '<BaseURL>https://fixture.googlevideo.com/$1</BaseURL>');
const plays = [];
const resolves = [];
const media = [];
const errors = [];
const liveDiagnostics = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (mode === 'live' && details.level === 'error') errors.push(details.message);
  });
});
let mode = 'fixture';
let failMedia = false;
YouTubeService.prototype.createInnertube = async function (options) {
  if (mode === 'live') return originalCreate.call(this, options);
  this.fetchImpl = async (url, init) => {
    assert.equal(new URL(url).hostname, 'fixture.googlevideo.com');
    const file = path.basename(new URL(url).pathname);
    assert.ok(['fixture-0.mp4', 'fixture-1.mp4'].includes(file));
    media.push({ client: init.headers['User-Agent'], range: init.headers.Range });
    if (failMedia && init.headers['User-Agent'] === 'VISIONOS') return new Response('', { status: 403 });
    const data = fs.readFileSync(path.join(fixtureDir, file));
    const match = /^bytes=(\d+)-(\d*)$/.exec(init.headers.Range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
    return new Response(data.subarray(start, end + 1), { status: match ? 206 : 200, headers: {
      'content-type': file === 'fixture-0.mp4' ? 'video/mp4' : 'audio/mp4',
      'content-range': `bytes ${start}-${end}/${data.length}`
    } });
  };
  return { userAgent: options.client, getInfo: async (id) => {
    resolves.push({ id, client: options.client });
    if (id === 'unavailable') throw new Error('Fixture unavailable');
    if (id === 'slowvideo01') await new Promise(resolve => setTimeout(resolve, 300));
    const format = has_audio => ({ has_audio, has_video: !has_audio, url: 'https://fixture.googlevideo.com/fixture-0.mp4',
      init_range: { start: 0, end: 100 }, index_range: { start: 101, end: 150 } });
    return { basic_info: { title: 'Synthetic YouTube fixture' }, playability_status: { status: 'OK' },
      streaming_data: { adaptive_formats: [format(true), format(false)] }, toDash: async () => mpd };
  } };
};
const originalPlaying = YouTubeService.prototype.notePlaying;
const originalLoad = YouTubeService.prototype.load;
YouTubeService.prototype.load = async function (...args) {
  try {
    const source = await originalLoad.apply(this, args);
    if (mode === 'live') liveDiagnostics.push({ phase: 'resolved', client: source.client, kind: source.kind, attempts: source.attempts });
    return source;
  } catch (error) { if (mode === 'live') liveDiagnostics.push({ phase: 'resolution-failed', message: error.message }); throw error; }
};
const originalMedia = YouTubeService.prototype.media;
YouTubeService.prototype.media = async function (options) {
  try { return await originalMedia.call(this, options); }
  catch (error) { if (mode === 'live') liveDiagnostics.push({ phase: 'media-failed', message: error.message }); throw error; }
};
YouTubeService.prototype.notePlaying = function (source) {
  plays.push({ id: source.videoId, client: source.client });
  return originalPlaying.call(this, source);
};
let finished = false;
let watchdog;
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error,
    error: error?.stack, temporaryProfile: root, packaged: app.isPackaged, plays, resolves, mediaRequests: media.length, errors, liveDiagnostics }, null, 2));
  BrowserWindow.getAllWindows().forEach(win => win.destroy());
  app.exit(error ? 1 : 0);
}
process.on('unhandledRejection', finish);
loadApp('src/main/main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function playbackPosition(guest) {
  if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
  const { root } = await guest.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
  function find(node, inPlayer = false) {
    const attributes = node.attributes || [];
    inPlayer ||= attributes.some((value, index) => value === 'id' && attributes[index + 1] === 'shiira-youtube-player');
    if (inPlayer && node.localName === 'video') return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const found = find(child, inPlayer); if (found) return found;
    }
  }
  const node = find(root);
  if (!node) return null;
  const { object } = await guest.debugger.sendCommand('DOM.resolveNode', { nodeId: node.nodeId });
  const { result } = await guest.debugger.sendCommand('Runtime.callFunctionOn', { objectId: object.objectId,
    functionDeclaration: 'function(){return {time:this.currentTime,paused:this.paused,width:this.videoWidth,rate:this.playbackRate}}', returnByValue: true });
  return result.value;
}
app.whenReady().then(async () => {
  watchdog = setTimeout(() => finish(new Error('YouTube smoke exceeded deadline')), process.env.SHIIRA_YOUTUBE_LIVE === '1' ? 110000 : 55000);
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await waitFor(() => win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.tabs)'), 'browser startup');
    const website = async request => new URL(request.url).pathname === '/shiira-native-fixture.mp4'
      ? new Response(fs.readFileSync(path.join(fixtureDir, 'fixture-0.mp4')), { headers: { 'content-type': 'video/mp4' } })
      : new Response(`<!doctype html><style>body{margin:0;background:#111}#movie_player{width:640px;height:360px;background:#222}</style>
      <title>YouTube transport fixture</title><div id="movie_player"><video></video><div>Native player fixture</div></div>
      <script>window.nativeMutations=0;window.addEventListener('error',e=>console.error(e.message));</script>`, { headers: {
        'content-type': 'text/html', 'content-security-policy': "require-trusted-types-for 'script'; trusted-types default goog#html shaka-player#xml"
      } });
    await session.fromPartition('persist:main').protocol.handle('https', website);
    const tabId = await win.webContents.executeJavaScript("window.ShiiraBrowser.createTab('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1')");
    let guest;
    await waitFor(async () => {
      const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t=>t.id===${JSON.stringify(tabId)})?.webview?.getWebContentsId()`);
      guest = id && webContents.fromId(id); return guest && !guest.isLoading();
    }, 'attached YouTube tab');
    guest.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
    await waitFor(() => plays.some(p => p.id === 'jNQXAC9IVRw'), 'first decoded frame');
    await waitFor(async () => (await playbackPosition(guest))?.time > 1.4, 'video progress from timestamp');
    assert.equal((await playbackPosition(guest)).width, 320);
    assert.equal(await guest.executeJavaScript("typeof window.shiiraAPI + ':' + typeof window.shaka"), 'undefined:undefined');
    assert.ok(media.some(request => request.range), 'Actual media must use range requests');
    for (const id of ['secondvid01', 'thirdvideo1']) {
      await guest.executeJavaScript(`history.pushState({},'', '/watch?v=${id}');document.dispatchEvent(new Event('yt-navigate-finish'));`);
      await waitFor(() => plays.some(p => p.id === id), `SPA playback ${id}`);
      assert.equal(await guest.executeJavaScript("document.querySelectorAll('#shiira-youtube-player').length"), 1);
    }
    // Use a deterministic ad request to exercise the real session hooks. Its
    // outcome must follow the current SPA page, rather than an old referrer.
    const blocker = loadApp('src/main/ad-blocker').getAdBlocker();
    await waitFor(() => blocker.initialized, 'ad blocker startup');
    const engine = blocker.ghosteryBlocker || blocker.ruleEngine;
    const method = blocker.ghosteryBlocker ? 'match' : 'shouldBlock';
    const originalFilter = engine[method];
    engine[method] = function (request, ...args) {
      if (request.url.includes('/shiira-ad-fixture')) return method === 'match' ? { match: true } : { action: 'block' };
      return originalFilter.call(this, request, ...args);
    };
    const adRequestAllowed = () => guest.executeJavaScript("fetch('/shiira-ad-fixture', {cache:'no-store'}).then(()=>true,()=>false)");
    assert.equal(await adRequestAllowed(), false, 'Watch pages still filter advertising');
    const beforeShorts = resolves.length;
    await guest.executeJavaScript("history.pushState({},'', '/shorts/thirdvideo1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => guest.executeJavaScript("!document.querySelector('#shiira-youtube-player') && !document.querySelector('[data-shiira-player]')"), 'Shorts releases the same-video replacement');
    assert.equal(await adRequestAllowed(), true, 'Shorts bypasses advertising filters');
    await guest.executeJavaScript("const native = document.querySelector('#movie_player video'); native.src='/shiira-native-fixture.mp4'; native.play();", true);
    await waitFor(() => guest.executeJavaScript("document.querySelector('#movie_player video').currentTime > 0.25"), 'native Shorts video keeps playing');
    assert.equal(resolves.length, beforeShorts, 'Shorts does not extract any streams');
    const beforeReturn = plays.length;
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=thirdvideo1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => plays.length > beforeReturn, 'watch playback resumes after Shorts');
    assert.equal(await adRequestAllowed(), false, 'Filtering resumes after leaving Shorts');

    // Direct Shorts loads also stay native, then allow SPA watch playback.
    const beforeDirectShorts = resolves.length;
    await guest.loadURL('https://www.youtube.com/shorts/shortsvideo');
    await delay(750);
    assert.equal(await guest.executeJavaScript("Boolean(document.querySelector('#shiira-youtube-player'))"), false);
    assert.equal(resolves.length, beforeDirectShorts);
    assert.equal(await adRequestAllowed(), true);
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=returnvid01');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => plays.some(p => p.id === 'returnvid01'), 'watch playback after a direct Shorts load');
    assert.equal(await adRequestAllowed(), false);
    engine[method] = originalFilter;
    // Recover a refused media URL onto a different client without looping.
    failMedia = true;
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=recovervid1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => plays.some(p => p.id === 'recovervid1' && p.client !== 'VISIONOS'), '403 source recovery');
    failMedia = false;
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=slowvideo01');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await delay(50);
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=latestvid01');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => plays.some(p => p.id === 'latestvid01'), 'rapid navigation latest video');
    assert.equal(plays.some(p => p.id === 'slowvideo01'), false, 'A stale extraction must not replace the current video');
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=unavailable');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => guest.executeJavaScript("!document.querySelector('#shiira-youtube-player') && !document.querySelector('[data-shiira-player]')"), 'native fallback');
    await guest.executeJavaScript("history.pushState({},'', '/results?search_query=fixture');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => guest.executeJavaScript("!document.querySelector('#shiira-youtube-player')"), 'browse cleanup');
    // Private tabs run the same sandboxed preload without sharing account state.
    const privateId = await win.webContents.executeJavaScript("window.ShiiraBrowser.createTab('https://www.youtube.com/watch?v=privatevid1', {privateMode:true})");
    let privateGuest;
    await waitFor(async () => {
      const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t=>t.id===${JSON.stringify(privateId)})?.webview?.getWebContentsId()`);
      privateGuest = id && webContents.fromId(id); return !!privateGuest;
    }, 'private tab attach');
    await privateGuest.session.protocol.handle('https', website);
    await privateGuest.loadURL('https://www.youtube.com/watch?v=privatevid1');
    await waitFor(() => plays.some(p => p.id === 'privatevid1'), 'private playback');
    if (process.env.SHIIRA_YOUTUBE_LIVE === '1') {
      mode = 'live';
      await session.fromPartition('persist:main').protocol.unhandle('https');
      const previous = plays.length;
      const liveId = await win.webContents.executeJavaScript("window.ShiiraBrowser.createTab('https://www.youtube.com/watch?v=jNQXAC9IVRw')");
      await waitFor(async () => {
        const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t=>t.id===${JSON.stringify(liveId)})?.webview?.getWebContentsId()`);
        guest = id && webContents.fromId(id); return !!guest;
      }, 'live tab attach');
      await waitFor(() => plays.length > previous && plays.at(-1).id === 'jNQXAC9IVRw', 'live public video playback', 45000);
      await waitFor(async () => (await playbackPosition(guest))?.time > 1, 'live playback progress', 10000);
    }
    finish();
  } catch (error) {
    if (mode === 'live') {
      for (const wc of webContents.getAllWebContents().filter(wc=>wc.getType()==='webview')) {
        liveDiagnostics.push(await wc.executeJavaScript(`({url:location.href,title:document.title,players:document.querySelectorAll('#shiira-youtube-player').length,native:!!document.querySelector('#movie_player'),text:document.body?.innerText?.slice(0,150)})`).catch(()=>({unavailable:true})));
      }
    }
    finish(error);
  }
});
