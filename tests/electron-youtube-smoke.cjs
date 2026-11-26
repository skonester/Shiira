// Real Shiira main/preload/Ghostery/Shaka with synthetic DASH media. Optional
// SHIIRA_YOUTUBE_LIVE=1 also plays a public video through the live resolver.
const { app, BrowserWindow, session, webContents, ipcMain } = require('electron');
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
const baseMpd = fs.readFileSync(path.join(fixtureDir, 'manifest.mpd'), 'utf8')
  .replace(/<BaseURL>([^<]+)<\/BaseURL>/g, '<BaseURL>https://fixture.googlevideo.com/videoplayback?file=$1</BaseURL>');
const audioSet = baseMpd.match(/<AdaptationSet id="1"[\s\S]*?<\/AdaptationSet>/)[0];
const audioTrack = (language, id, role) => audioSet
  .replace('AdaptationSet id="1"', `AdaptationSet id="${id}" lang="${language}"`)
  .replace('Representation id="1"', `Representation id="${id}"`)
  .replace('<Representation', `<Role schemeIdUri="urn:mpeg:dash:role:2011" value="${role}"/><Representation`)
  .replace('fixture-1.mp4</BaseURL>', `fixture-1.mp4&amp;language=${language}</BaseURL>`);
// Deliberately put French main audio before English alternate audio. A player
// with no language preference chooses the wrong track for an English browser.
const mpd = baseMpd.replace(audioSet, audioTrack('fr', 1, 'main') + audioTrack('en', 2, 'alternate'));
const plays = [];
const resolves = [];
const media = [];
const errors = [];
const liveDiagnostics = [];
const frames = [];
ipcMain.on('youtube:playing', (event, frame) => frames.push({ sender: event.sender.id, frame }));
const diagnostics = [];
const originalDiagnose = YouTubeService.prototype.diagnose;
YouTubeService.prototype.diagnose = function (stage, fields) {
  diagnostics.push({ stage, ...fields });
  return originalDiagnose.call(this, stage, fields);
};
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (mode === 'live' && details.level === 'error') errors.push(details.message);
  });
});
let mode = 'fixture';
let failMedia = false;
let timeoutSource = false;
YouTubeService.prototype.createInnertube = async function (options) {
  if (mode === 'live') return originalCreate.call(this, options);
  this.fetchImpl = async (url, init) => {
    assert.equal(new URL(url).hostname, 'fixture.googlevideo.com');
    const file = new URL(url).searchParams.get('file');
    const videoId = new URL(url).searchParams.get('video');
    assert.ok(['fixture-0.mp4', 'fixture-1.mp4'].includes(file));
    const queryRange = new URL(url).searchParams.get('range');
    const requestedRange = queryRange ? `bytes=${queryRange}` : init.headers.Range;
    media.push({ videoId, language: new URL(url).searchParams.get('language'), client: init.headers['User-Agent'], range: requestedRange, method: init.method, time: Date.now() });
    if (failMedia && init.headers['User-Agent'] === 'WEB') return new Response('', { status: 403 });
    if (timeoutSource && videoId === 'timeoutvid1') return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const data = fs.readFileSync(path.join(fixtureDir, file));
    const match = /^bytes=(\d+)-(\d*)$/.exec(requestedRange || '');
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
    return new Response(data.subarray(start, end + 1), { status: match ? 206 : 200, headers: {
      'content-type': file === 'fixture-0.mp4' ? 'video/mp4' : 'audio/mp4',
      'content-range': `bytes ${start}-${end}/${data.length}`
    } });
  };
  return { userAgent: options.client, getInfo: async (id) => {
    resolves.push({ id, client: options.client, fixtureAccount: /(?:^|;\s*)SID=fixture-account(?:;|$)/.test(options.cookie || ''), time: Date.now() });
    if (id === 'timeoutvid1') {
      this.mediaMs = 80;
      timeoutSource = resolves.filter(value => value.id === id).length === 1;
    } else this.mediaMs = 20000;
    if (id === 'unavailable') throw new Error('Fixture unavailable');
    if (id === 'slowvideo01') await new Promise(resolve => setTimeout(resolve, 300));
    const format = has_audio => ({ has_audio, has_video: !has_audio, url: 'https://fixture.googlevideo.com/fixture-0.mp4',
      init_range: { start: 0, end: 100 }, index_range: { start: 101, end: 150 } });
    return { basic_info: { title: 'Synthetic YouTube fixture' }, playability_status: { status: 'OK' },
      mediaAvailableAt: id === 'recovervid1' ? Date.now() + 1200 : 0,
      streaming_data: { adaptive_formats: [format(true), format(false)] },
      toDash: async () => mpd.replaceAll('?file=', `?video=${id}&amp;file=`) };
  } };
};
const originalPlaying = YouTubeService.prototype.notePlaying;
const originalLoad = YouTubeService.prototype.load;
YouTubeService.prototype.load = async function (...args) {
  // The fixture serves DASH files for every client. VISIONOS and IOS only play
  // HLS, so start each tab's routes at the DASH-capable WEB client, as a real
  // response without an Apple HLS manifest would.
  if (mode !== 'live' && !this.fixtureOrder) {
    this.fixtureOrder = true;
    this.order = [...this.order.filter(client => !['VISIONOS', 'IOS'].includes(client)), 'VISIONOS', 'IOS'];
  }
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
let phase = 'startup';
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error,
    error: error?.stack, temporaryProfile: root, packaged: app.isPackaged, plays, resolves, mediaRequests: media.length, diagnostics, errors, liveDiagnostics }, null, 2));
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
async function playbackPosition(guest, functionDeclaration = 'function(){return {time:this.currentTime,paused:this.paused,width:this.videoWidth,rate:this.playbackRate,readyState:this.readyState,seeking:this.seeking,error:this.error?.code}}') {
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
    functionDeclaration, returnByValue: true });
  return result.value;
}
async function waitForDecoded(guest, check, label) {
  let requestedPaint = false;
  await waitFor(async () => {
    if (check()) return true;
    // Hidden windows need a real compositor paint after a document navigation.
    // Capture stays hidden; only the replacement video's frame callback counts.
    if (!requestedPaint && (await playbackPosition(guest))?.readyState >= 2) {
      requestedPaint = true;
      void guest.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
    }
    return false;
  }, label);
}
app.whenReady().then(async () => {
  watchdog = setTimeout(() => finish(new Error(`YouTube smoke exceeded deadline (${phase})`)), process.env.SHIIRA_YOUTUBE_LIVE === '1' ? 110000 : 55000);
  try {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getLastWebPreferences().webviewTag);
    await waitFor(() => win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.tabs)'), 'browser startup');
    const website = async request => new URL(request.url).pathname === '/shiira-native-fixture.mp4'
      ? new Response(fs.readFileSync(path.join(fixtureDir, 'fixture-0.mp4')), { headers: { 'content-type': 'video/mp4' } })
      : new Response(`<!doctype html><style>body{margin:0;background:#111}#movie_player{width:640px;height:360px;background:#222}</style>
      <title>YouTube transport fixture</title><div id="movie_player"><video></video><div>Native player fixture</div></div>
      <script>window.nativeMutations=0;window.addEventListener('error',e=>console.error(e.message));</script>`, { headers: {
        'content-type': 'text/html', 'content-security-policy': "require-trusted-types-for 'script'; trusted-types default goog#html shaka-player#xml"
      } });
    await session.fromPartition('persist:main').protocol.handle('https', website);
    await session.fromPartition('persist:main').cookies.set({ url: 'https://www.youtube.com', name: 'SID', value: 'fixture-account' });
    const tabId = await win.webContents.executeJavaScript("window.ShiiraBrowser.createTab('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1')");
    let guest;
    await waitFor(async () => {
      const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t=>t.id===${JSON.stringify(tabId)})?.webview?.getWebContentsId()`);
      guest = id && webContents.fromId(id); return guest && !guest.isLoading();
    }, 'attached YouTube tab');
    guest.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
    await waitForDecoded(guest, () => plays.some(p => p.id === 'jNQXAC9IVRw'), 'first decoded frame');
    await waitFor(async () => (await playbackPosition(guest))?.time > 1.4, 'video progress from timestamp');
    assert.equal((await playbackPosition(guest)).width, 320);
    const preferredLanguage = await guest.executeJavaScript('navigator.languages[0]');
    const expectedAudio = preferredLanguage.startsWith('en') ? 'en' : 'fr';
    assert.ok(media.some(request => request.videoId === 'jNQXAC9IVRw' && request.language === expectedAudio), 'Shaka fetches the preferred audio, or the main role when no preferred language exists');
    assert.equal(media.some(request => request.videoId === 'jNQXAC9IVRw' && request.language !== null && request.language !== expectedAudio), false, 'startup cannot fetch an unrelated audio track');
    const inUi = code => win.webContents.executeJavaScript(`(async () => { const b = window.ShiiraBrowser; const t = b.tabs.find(t => t.id === ${JSON.stringify(tabId)}); ${code} })()`);
    await waitFor(() => inUi('return t.mediaState?.duration > 0 && t.mediaState.paused === false;'), 'closed player media state reaches sidebar');
    const analyticsReport = () => inUi(`const reports=await window.shiiraAPI.playbackAnalytics.list();
      const entry=reports.find(r=>r.videoId==='jNQXAC9IVRw' && !r.endedAt); return entry ? window.shiiraAPI.playbackAnalytics.get(entry.id) : null;`);
    await waitFor(async () => (await analyticsReport())?.metrics.startupMs >= 0, 'real decoded frame reaches local analytics');
    let report = await analyticsReport();
    assert.equal(report.state.language, 'en');
    assert.equal(report.state.width, 320);
    assert.ok(report.transport.completed > 0, 'actual main-process media requests reach the report');
    await inUi("await b.controlBackgroundMedia(t, 'pause');");
    assert.equal((await playbackPosition(guest)).paused, true, 'sidebar pauses the closed-root custom player');
    const beforeScrubResolves = resolves.length;
    const beforeScrubSeeks = (await analyticsReport()).metrics.seekCompleted || 0;
    await playbackPosition(guest, 'function(){ for(const time of [4,.1,5,1,3,.2,4.5,2.5]) this.currentTime=time; return this.currentTime; }');
    await waitFor(async () => {
      const state = await playbackPosition(guest);
      return state?.readyState >= 2 && !state.seeking && Math.abs(state.time - 2.5) < .15;
    }, 'rapid paused scrubs settle at the final target');
    assert.equal(resolves.length, beforeScrubResolves, 'scrubbing retains the same source');
    await waitFor(() => inUi('return t.mediaState?.paused === true && Math.abs(t.mediaState.time - 2.5) < .15;'), 'seeked state reaches the sidebar immediately');
    await waitFor(async () => (await analyticsReport())?.metrics.seekCompleted > beforeScrubSeeks, 'seek completion reaches local analytics');
    report = await analyticsReport();
    assert.ok(report.metrics.seekCount >= 1);
    assert.equal(report.metrics.rebufferCount, 0, 'paused scrubbing cannot inflate rebuffering');
    fs.writeFileSync(path.join(artifacts, 'playback-analytics.json'), JSON.stringify(report, null, 2));
    await guest.executeJavaScript("document.querySelector('#movie_player').style.width='320px'");
    await playbackPosition(guest, `function(){
      [...this.getRootNode().querySelectorAll('button')].find(button=>button.textContent==='Playback stats').click(); return true;
    }`);
    await waitFor(() => playbackPosition(guest, `function(){
      const root=this.getRootNode(),panel=root.querySelector('.diagnostics'),tools=root.querySelector('.tools');
      return !panel.hidden && panel.textContent.includes('HTTP 403:') && panel.textContent.includes('Seeks:') &&
        panel.getBoundingClientRect().top >= tools.getBoundingClientRect().bottom;
    }`), 'stats panel shows real metrics below wrapped controls');
    await playbackPosition(guest, `function(){
      [...this.getRootNode().querySelectorAll('button')].find(button=>button.textContent==='Playback stats').click(); return true;
    }`);
    await guest.executeJavaScript("document.querySelector('#movie_player').style.width='640px'");
    await inUi("await b.controlBackgroundMedia(t, 'seek', 0.5); await b.controlBackgroundMedia(t, 'mute');");
    assert.ok((await playbackPosition(guest)).time < 1, 'sidebar seeks the custom video');
    await waitFor(() => inUi('return t.mediaState?.muted === true;'), 'custom mute state reaches sidebar');
    await inUi("await b.controlBackgroundMedia(t, 'toggle');");
    assert.equal((await playbackPosition(guest)).paused, false, 'sidebar resumes the custom player');
    assert.equal(await guest.executeJavaScript('typeof globalThis.__shiiraMediaControl'), 'undefined', 'the site cannot reach private media controls');
    const pip = await inUi("return window.shiiraAPI.pageTools.mediaControl(t.webview.getWebContentsId(), 'auto-pip');");
    assert.equal(pip, true, 'the private bridge preserves the gesture for custom-player PiP');
    await inUi("await window.shiiraAPI.pageTools.mediaControl(t.webview.getWebContentsId(), 'exit-auto-pip');");
    await waitFor(() => inUi('return t.isPictureInPicture === false;'), 'custom-player PiP closes');
    const profile = await win.webContents.executeJavaScript("window.shiiraAPI.profiles.create('Player profile')");
    assert.ok(profile.profile, profile.error);
    const profileSession = session.fromPartition(profile.profile.partition);
    await profileSession.protocol.handle('https', website);
    const profileTabId = await win.webContents.executeJavaScript(`(() => { const b=window.ShiiraBrowser; const s=b.createSpace({title:'Player profile',profileId:${JSON.stringify(profile.profile.id)}}); return b.createTab('https://www.youtube.com/watch?v=profilevid1',{spaceId:s.id}); })()`);
    let profileGuest;
    await waitFor(async () => {
      const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t=>t.id===${JSON.stringify(profileTabId)})?.webview?.getWebContentsId()`);
      profileGuest = id && webContents.fromId(id); return profileGuest && !profileGuest.isLoading();
    }, 'isolated-profile YouTube tab');
    await waitForDecoded(profileGuest, () => plays.some(p=>p.id==='profilevid1'), 'custom player in a separate profile');
    assert.equal(resolves.find(r=>r.id==='profilevid1').fixtureAccount, false, 'the player cannot borrow another profile\'s YouTube login');
    assert.equal((await playbackPosition(profileGuest)).width, 320);
    await win.webContents.executeJavaScript(`(async () => { const b=window.ShiiraBrowser; const t=b.tabs.find(t=>t.id===${JSON.stringify(profileTabId)}); await b.controlBackgroundMedia(t,'pause'); })()`);
    assert.equal((await playbackPosition(profileGuest)).paused, true);
    await win.webContents.executeJavaScript(`window.ShiiraBrowser.closeTab(${JSON.stringify(profileTabId)},true); window.ShiiraBrowser.switchTab(${JSON.stringify(tabId)});`);
    assert.equal(await guest.executeJavaScript("typeof window.shiiraAPI + ':' + typeof window.shaka"), 'undefined:undefined');
    assert.ok(media.some(request => request.range), 'Actual media must use range requests');
    for (const id of ['secondvid01', 'thirdvideo1']) {
      await guest.executeJavaScript(`history.pushState({},'', '/watch?v=${id}');document.dispatchEvent(new Event('yt-navigate-finish'));`);
      await waitForDecoded(guest, () => plays.some(p => p.id === id), `SPA playback ${id}`);
      assert.equal(await guest.executeJavaScript("document.querySelectorAll('#shiira-youtube-player').length"), 1);
    }
    const staleFrame = frames.find(value => value.sender === guest.id).frame;
    const beforeStaleFrame = plays.length;
    ipcMain.emit('youtube:playing', { sender: guest, senderFrame: guest.mainFrame }, staleFrame);
    assert.equal(plays.length, beforeStaleFrame, 'a previous opaque source cannot confirm playback');
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
    phase = 'adblock reset';
    await win.webContents.executeJavaScript('window.shiiraAPI.adBlocker.resetStats()');
    await waitFor(() => inUi('return b.adblockBlockedCount === 0;'), 'live counter reset');
    phase = 'adblock network callback';
    assert.equal(await adRequestAllowed(), false, 'Watch pages still filter advertising');
    assert.equal(blocker.getStats().blocked, 1);
    await waitFor(() => inUi("return b.adblockBlockedCount === 1 && b.adblockStats.textContent === '1 requests blocked' && b.adCounterValue.textContent === '1' && !b.adCounter.classList.contains('hidden');"), 'blocked callback updates both UI badges');
    phase = 'adblock menu layout';
    const menuSeparated = await win.webContents.executeJavaScript(`(async () => {
      const b=window.ShiiraBrowser; b.showMainMenu(); await b.updateAdBlockerStats();
      const row=document.querySelector('[data-action="adblock"]');
      const label=row.querySelector('.menu-item-text').getBoundingClientRect();
      b.adblockStats.textContent='9,007,199,254,740,991 requests blocked';
      const count=b.adblockStats.getBoundingClientRect(), toggle=b.adblockToggle.getBoundingClientRect();
      return count.top>=label.bottom && count.right<=toggle.left && count.bottom<=row.getBoundingClientRect().bottom;
    })()`);
    assert.equal(menuSeparated, true, 'large blocked counts occupy their own line without covering the label or toggle');
    // The knob is a pseudo-element. Check its rendered box, since checking
    // only the switch rectangle missed a knob anchored to the menu row.
    win.webContents.debugger.attach('1.3');
    try {
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#adblock-toggle' });
      const { node } = await win.webContents.debugger.sendCommand('DOM.describeNode', { nodeId });
      const knob = node.pseudoElements.find(element => element.pseudoType === 'after');
      assert.ok(knob, 'the switch has a rendered knob');
      const bounds = quad => ({ left: Math.min(quad[0], quad[2], quad[4], quad[6]),
        right: Math.max(quad[0], quad[2], quad[4], quad[6]), top: Math.min(quad[1], quad[3], quad[5], quad[7]),
        bottom: Math.max(quad[1], quad[3], quad[5], quad[7]) });
      for (const active of [false, true]) {
        await win.webContents.executeJavaScript(`document.getElementById('adblock-toggle').classList.toggle('active', ${active})`);
        const trackBox = bounds((await win.webContents.debugger.sendCommand('DOM.getBoxModel', { nodeId })).model.border);
        const knobBox = bounds((await win.webContents.debugger.sendCommand('DOM.getBoxModel', { nodeId: knob.nodeId })).model.border);
        assert.ok(knobBox.left >= trackBox.left && knobBox.right <= trackBox.right &&
          knobBox.top >= trackBox.top && knobBox.bottom <= trackBox.bottom,
        `the ${active ? 'enabled' : 'disabled'} knob stays inside its switch`);
      }
    } finally { win.webContents.debugger.detach(); }
    await inUi('await b.updateAdBlockerStats(); b.hideMainMenu(true);');
    phase = 'navigation and recovery';
    const beforeShorts = resolves.length;
    await guest.executeJavaScript("history.pushState({},'', '/shorts/thirdvideo1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => guest.executeJavaScript("!document.querySelector('#shiira-youtube-player') && !document.querySelector('[data-shiira-player]')"), 'Shorts releases the same-video replacement');
    assert.equal(await adRequestAllowed(), true, 'Shorts bypasses advertising filters');
    await guest.executeJavaScript("const native = document.querySelector('#movie_player video'); native.src='/shiira-native-fixture.mp4'; native.play();", true);
    await waitFor(() => guest.executeJavaScript("document.querySelector('#movie_player video').currentTime > 0.25"), 'native Shorts video keeps playing');
    assert.equal(resolves.length, beforeShorts, 'Shorts does not extract any streams');
    const beforeReturn = plays.length;
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=thirdvideo1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitForDecoded(guest, () => plays.length > beforeReturn, 'watch playback resumes after Shorts');
    assert.equal(await adRequestAllowed(), false, 'Filtering resumes after leaving Shorts');

    // Direct Shorts loads also stay native, then allow SPA watch playback.
    const beforeDirectShorts = resolves.length;
    await guest.loadURL('https://www.youtube.com/shorts/shortsvideo');
    await delay(750);
    assert.equal(await guest.executeJavaScript("Boolean(document.querySelector('#shiira-youtube-player'))"), false);
    assert.equal(resolves.length, beforeDirectShorts);
    assert.equal(await adRequestAllowed(), true);
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=returnvid01');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitForDecoded(guest, () => plays.some(p => p.id === 'returnvid01'), 'watch playback after a direct Shorts load');
    assert.equal(await adRequestAllowed(), false);
    engine[method] = originalFilter;
    // Recover a refused media URL onto a different client without looping.
    failMedia = true;
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=recovervid1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitForDecoded(guest, () => plays.some(p => p.id === 'recovervid1' && p.client !== 'WEB'), '403 source recovery');
    const refused = media.filter(value => value.videoId === 'recovervid1' && value.client === 'WEB');
    assert.ok(refused.some(value => value.method === 'POST'), 'same-source compatibility transport runs before client recovery');
    assert.ok(diagnostics.some(value => value.stage === 'media_wait' && value.attempt === 2), 'same-source readiness probes reach the deadline');
    assert.ok(resolves.find(value => value.id === 'recovervid1' && value.client === 'WEB_EMBEDDED').time - refused[0].time >= 1000);
    failMedia = false;
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=timeoutvid1');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitForDecoded(guest, () => plays.some(p => p.id === 'timeoutvid1'), 'transport timeout recovery');
    assert.deepEqual(resolves.filter(value => value.id === 'timeoutvid1').map(value => value.client), ['WEB', 'WEB'],
      'a transport timeout retries the same client without deferral');
    assert.ok(diagnostics.some(value => value.stage === 'media_failed' && value.code === 'TIMEOUT'));
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=slowvideo01');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await delay(50);
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=latestvid01');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitForDecoded(guest, () => plays.some(p => p.id === 'latestvid01'), 'rapid navigation latest video');
    assert.equal(plays.some(p => p.id === 'slowvideo01'), false, 'A stale extraction must not replace the current video');
    await guest.executeJavaScript("history.pushState({},'', '/watch?v=unavailable');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitFor(() => guest.executeJavaScript("Boolean(document.querySelector('#shiira-youtube-player[data-failed]'))"), 'explicit stream failure');
    assert.equal(await guest.executeJavaScript("document.querySelector('#movie_player video').paused"), true, 'terminal failure never starts native YouTube');
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
    await waitForDecoded(privateGuest, () => plays.some(p => p.id === 'privatevid1'), 'private playback');
    assert.equal(resolves.find(value => value.id === 'jNQXAC9IVRw').fixtureAccount, true);
    assert.equal(resolves.find(value => value.id === 'privatevid1').fixtureAccount, false);
    const previousPrivatePlays = plays.length;
    const previousPrivateResolves = resolves.length;
    await privateGuest.executeJavaScript("history.pushState({},'', '/watch?v=jNQXAC9IVRw');document.dispatchEvent(new Event('yt-navigate-finish'));");
    await waitForDecoded(privateGuest, () => plays.length > previousPrivatePlays, 'private independent cache');
    assert.ok(resolves.slice(previousPrivateResolves).some(value => value.id === 'jNQXAC9IVRw' && !value.fixtureAccount),
      'private playback cannot reuse the normal tab account source');
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
    for (const wc of webContents.getAllWebContents().filter(wc => wc.getType() === 'webview')) {
      liveDiagnostics.push({ phase: 'fixture-state', playback: await playbackPosition(wc).catch(() => null),
        overlay: await wc.executeJavaScript("document.querySelector('#shiira-youtube-player')?.outerHTML").catch(() => null) });
    }
    if (mode === 'live') {
      for (const wc of webContents.getAllWebContents().filter(wc=>wc.getType()==='webview')) {
        liveDiagnostics.push(await wc.executeJavaScript(`({url:location.href,title:document.title,players:document.querySelectorAll('#shiira-youtube-player').length,native:!!document.querySelector('#movie_player'),text:document.body?.innerText?.slice(0,150)})`).catch(()=>({unavailable:true})));
      }
    }
    finish(error);
  }
});
