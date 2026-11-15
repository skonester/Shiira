// Opt-in real-network playback and seeking. Uses an isolated, signed-out profile
// and the production main/preload/Shaka path; no media or resolver fixtures.
const { app, BrowserWindow, webContents, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { playbackVideoIdFromUrl } = require('../src/shared/youtube');

const target = new URL(process.argv[2] || 'https://www.youtube.com/watch?v=ksMN3cZR8D4');
// Shiira also routes URL command-line arguments into tabs. The harness owns its
// test tab, so do not accidentally start a second copy of the same stream.
process.argv.splice(2);
const videoId = playbackVideoIdFromUrl(target.href);
if (!videoId) throw new Error('Supply a YouTube watch, live or embedded video URL');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-youtube-live-'));
const artifacts = path.resolve(__dirname, '../tmp/youtube-live-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
require('../src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };

const result = { url: target.href, profile: 'isolated, signed out', sources: [], diagnostics: [],
  confirmations: [], playerErrors: [], samples: [], seeks: [], media: { requests: 0, completed: 0, failed: 0, cancelled: 0, formats: {} } };
let phase = 'startup', guest, win, finished = false, watchdog;
const started = Date.now();
const elapsed = () => Math.round((Date.now() - started) / 10) / 100;
const { YouTubeService } = require('../src/main/youtube-service');
const diagnose = YouTubeService.prototype.diagnose;
YouTubeService.prototype.diagnose = function (stage, fields) {
  result.diagnostics.push({ at: elapsed(), stage, ...fields });
  return diagnose.call(this, stage, fields);
};
const load = YouTubeService.prototype.load;
YouTubeService.prototype.load = async function (...args) {
  const source = await load.apply(this, args);
  result.sources.push({ at: elapsed(), videoId: source.videoId, title: source.title,
    live: source.live, kind: source.kind, client: source.client,
    audio: [...(source.manifest || '').matchAll(/<AdaptationSet\b([^>]*contentType="audio"[^>]*)>([\s\S]*?)<\/AdaptationSet>/g)]
      .map(match => ({ language: /\blang="([^"]+)"/.exec(match[1])?.[1],
        roles: [...match[2].matchAll(/<Role\b[^>]*value="([^"]+)"/g)].map(role => role[1]) })) });
  console.log(`[Live test] Source: ${source.title} (${source.live ? 'live' : 'recorded'}, ${source.client}, ${source.kind})`);
  return source;
};
const media = YouTubeService.prototype.media;
YouTubeService.prototype.media = async function (...args) {
  result.media.requests++;
  const route = this.routes.get(args[0]?.uri);
  const format = route?.url ? new URL(route.url).searchParams.get('itag') || 'playlist' : 'manifest';
  const stats = result.media.formats[format] ||= { completed: 0, failed: 0, cancelled: 0 };
  try { const response = await media.apply(this, args); result.media.completed++; stats.completed++; return response; }
  catch (error) {
    if (error.name === 'AbortError') { result.media.cancelled++; stats.cancelled++; }
    else { result.media.failed++; stats.failed++; }
    throw error;
  }
};
ipcMain.on('youtube:playing', (event, frame) => {
  if (event.sender === guest) result.confirmations.push({ at: elapsed(), width: frame.width, height: frame.height, frames: frame.frames });
});
ipcMain.on('youtube:error', (event, error) => {
  if (event.sender === guest) result.playerErrors.push({ at: elapsed(), phase: error.phase,
    code: error.code, category: error.category, severity: error.severity });
});

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  Object.assign(result, { success: !error, phase, elapsedSeconds: elapsed(), error: error?.stack, temporaryProfile: root });
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`[Live test] ${error ? 'FAIL' : 'PASS'}: ${phase}`);
  app.exit(error ? 1 : 0);
}
process.on('unhandledRejection', finish);
require('../src/main/main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(250);
  }
  throw new Error(`Timed out: ${label}`);
}

// CDP is confined to this development test. Resolve only Shiira's video inside
// its closed shadow root, so the native YouTube player cannot satisfy assertions.
async function videoCall(functionDeclaration) {
  if (!guest || guest.isDestroyed()) return null;
  if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
  const { root } = await guest.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
  function find(node, inside = false) {
    const attrs = node.attributes || [];
    inside ||= attrs.some((value, index) => value === 'id' && attrs[index + 1] === 'shiira-youtube-player');
    if (inside && node.localName === 'video') return node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const found = find(child, inside); if (found) return found;
    }
  }
  const node = find(root);
  if (!node) return null;
  const { object } = await guest.debugger.sendCommand('DOM.resolveNode', { nodeId: node.nodeId });
  try {
    const { result, exceptionDetails } = await guest.debugger.sendCommand('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration, returnByValue: true
    });
    if (exceptionDetails) throw new Error('Replacement-video inspection failed');
    return result.value;
  } finally { await guest.debugger.sendCommand('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {}); }
}
async function sample(label) {
  const state = await videoCall(`function() {
    const ranges = r => Array.from({length:r.length}, (_,i) => [r.start(i),r.end(i)]);
    if (!this.shiiraTestEvents) {
      this.shiiraTestEvents=[];
      for (const name of ['playing','pause','waiting','stalled','seeking','seeked','ended','emptied','error'])
        this.addEventListener(name, () => this.shiiraTestEvents.push({event:name,time:this.currentTime,at:Date.now()}));
    }
    this.muted=true;
    const quality=this.getVideoPlaybackQuality();
    return {time:this.currentTime,duration:Number.isFinite(this.duration)?this.duration:null,
      paused:this.paused,ended:this.ended,seeking:this.seeking,readyState:this.readyState,
      width:this.videoWidth,height:this.videoHeight,rate:this.playbackRate,error:this.error?.code||null,
      frames:quality.totalVideoFrames,droppedFrames:quality.droppedVideoFrames,
      buffered:ranges(this.buffered),seekable:ranges(this.seekable),events:this.shiiraTestEvents.splice(0)};
  }`).catch(error => {
    // YouTube can rebuild frames between DOM.getDocument and resolveNode.
    // A stale CDP node is a sampling race, not a playback failure.
    if (/No node with given id|Could not find object|Cannot find context|Execution context was destroyed/.test(error.message)) return null;
    throw error;
  });
  if (state) result.samples.push({ label, at: elapsed(), ...state });
  return state;
}
async function inspectPage() {
  return guest?.executeJavaScript(`({title:document.title,
    failed:!!document.querySelector('#shiira-youtube-player[data-failed]'),
    hasReplacement:!!document.querySelector('#shiira-youtube-player'),
    nativeVideos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,paused:v.paused,width:v.videoWidth})),
    notice:document.querySelector('#error-screen')?.innerText?.slice(0,500) || null})`).catch(() => null);
}

async function savePlaybackAnalytics() {
  if (!win || win.isDestroyed()) return;
  const report = await win.webContents.executeJavaScript(`(async () => {
    const entries=await window.shiiraAPI.playbackAnalytics.list();
    const entry=entries.filter(e=>e.videoId===${JSON.stringify(videoId)}).at(-1);
    return entry ? window.shiiraAPI.playbackAnalytics.get(entry.id) : null;
  })()`).catch(() => null);
  if (!report) return;
  fs.writeFileSync(path.join(artifacts, 'playback-analytics.json'), JSON.stringify(report, null, 2));
  result.analytics = { reportFile: path.join(artifacts, 'playback-analytics.json'), phase: report.phase,
    metrics: report.metrics, state: report.state,
    transport: { requests: report.transport.requests, failed: report.transport.failed,
      httpStatuses: report.transport.httpStatuses, formats: report.transport.formats } };
}

app.whenReady().then(async () => {
  watchdog = setTimeout(() => finish(new Error(`Live test exceeded deadline (${phase})`)), 270000);
  try {
    win = BrowserWindow.getAllWindows().find(w => w.webContents.getLastWebPreferences().webviewTag);
    await waitFor(() => win.webContents.executeJavaScript('Boolean(window.ShiiraBrowser?.tabs)'), 'browser startup');
    phase = 'loading supplied YouTube URL';
    const tabId = await win.webContents.executeJavaScript(`window.ShiiraBrowser.createTab(${JSON.stringify(target.href)})`);
    await waitFor(async () => {
      const id = await win.webContents.executeJavaScript(`window.ShiiraBrowser.tabs.find(t=>t.id===${JSON.stringify(tabId)})?.webview?.getWebContentsId()`);
      guest = id && webContents.fromId(id); return !!guest;
    }, 'attached YouTube tab');
    guest.setAudioMuted(true);
    phase = 'waiting for replacement-player decoded frames';
    let painted = false;
    await waitFor(async () => {
      const state = await sample('startup');
      const page = await inspectPage();
      if (page?.failed) throw new Error('Shiira replacement player reports stream unavailable');
      if (state?.readyState >= 2 && !painted) {
        painted = true;
        void guest.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
      }
      // Hidden windows can decode without presenting a compositor frame (rVFC).
      // CDP resolves this exact closed-root video, never the native page video.
      return state?.frames > 0 && state.width > 0 && !state.paused && state.time > .3;
    }, 'replacement-player decoded frames', 90000);

    phase = 'one minute of continuous playback';
    const first = await sample('minute-start');
    console.log(`[Live test] Decoding ${result.sources.at(-1)?.title}; starting one-minute observation`);
    const observationStart = Date.now();
    let previous = first, advancingSeconds = 0, decodedFrames = 0, lastAdvance = Date.now(), sampledAt = Date.now();
    while (Date.now() - observationStart < 65000 || advancingSeconds < 60) {
      await delay(1000);
      const state = await sample('playback');
      if (!state) continue;
      assert.ok(!state.error && !state.ended, 'replacement player must remain available');
      if (state.time > previous.time && state.frames > previous.frames && !state.seeking && !state.paused) {
        advancingSeconds += Math.min(2, state.time - previous.time, (Date.now() - sampledAt) / 1000);
        decodedFrames += state.frames - previous.frames;
        lastAdvance = Date.now();
      }
      assert.ok(Date.now() - lastAdvance < 15000, 'playback stalled for fifteen seconds');
      assert.ok(Date.now() - observationStart < 100000, 'did not accumulate sixty seconds of decoded progress');
      previous = state;
      sampledAt = Date.now();
    }
    result.minute = { elapsedSeconds: (Date.now() - observationStart) / 1000,
      decodedProgressSeconds: advancingSeconds, from: first.time, to: previous.time,
      decodedFrames, sourceRefreshes: result.sources.length - 1, terminalErrors: result.playerErrors.length };
    console.log(`[Live test] Minute passed: ${advancingSeconds.toFixed(1)} seconds decoded`);

    async function seek(label, positions, paused = false) {
      phase = label;
      const entry = { label, targets: positions, startedAt: elapsed() };
      result.seeks.push(entry);
      try {
        const before = await sample(label + '-before');
        assert.ok(before, 'replacement video must be available for seeking');
        await videoCall(`function(){${paused ? 'this.pause();' : ''} for(const time of ${JSON.stringify(positions)}) this.currentTime=time; return this.currentTime;}`);
        const target = positions.at(-1);
        let settled;
        await waitFor(async () => {
          settled = await sample(label);
          if (!settled) return false;
          assert.ok(!settled.error, 'seek must preserve the replacement video');
          return !settled.seeking && settled.readyState >= 2 && Math.abs(settled.time-target) < 3 &&
            (paused ? settled.paused : !settled.paused && settled.time > target + .3 && settled.frames > before.frames);
        }, label, 20000);
        if (paused) {
          await videoCall('function(){this.play();return true;}');
          await waitFor(async () => {
            const state = await sample(label + '-resumed');
            return state && state.time > target + .5 && !state.paused && state.frames > settled.frames;
          }, 'resume after paused seek');
        }
        Object.assign(entry, { success: true, settledTime: settled.time,
          recoveryCount: result.sources.length - 1, elapsedSeconds: elapsed() });
        console.log(`[Live test] ${label}: settled at ${settled.time.toFixed(2)}s`);
      } catch (error) {
        Object.assign(entry, { success: false, error: error.message, elapsedSeconds: elapsed(), lastState: await sample(label + '-failed') });
        console.log(`[Live test] ${label}: ${error.message}`);
      }
    }
    let current = await sample('before-seeks');
    const start = current.seekable[0]?.[0] || 0;
    const end = current.seekable.at(-1)?.[1] || current.duration;
    assert.ok(end > start + 30, 'video must have a usable seek window');
    const clamp = time => Math.max(start + 2, Math.min(end - 5, time));
    await seek('backward seek', [clamp(current.time - 30)]);
    current = await sample('after-backward');
    await seek('forward seek', [clamp(current.time + 90)]);
    current = await sample('after-forward');
    await seek('rapid scrubbing', [-25, 40, -10, 100, -20, 15].map(offset => clamp(current.time + offset)));
    current = await sample('after-scrubbing');
    await seek('paused seek and resume', [clamp(current.time - 45)], true);
    phase = 'completed minute playback and seeking';
    result.page = await inspectPage();
    result.adblock = require('../src/main/ad-blocker').getAdBlocker().getStats();
    await savePlaybackAnalytics();
    assert.ok(result.seeks.every(seek => seek.success) && !result.page.failed && !result.playerErrors.length,
      'live playback has failed scenarios or terminal player errors; see the recorded outcomes');
    finish();
  } catch (error) {
    result.page = await inspectPage();
    await sample('failure').catch(() => {});
    await savePlaybackAnalytics();
    finish(error);
  }
});
