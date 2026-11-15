const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const path = require('node:path');
const { PlaybackAnalyticsStore } = require('../src/main/youtube-analytics');
const { cleanPacket } = require('../src/shared/youtube-analytics');

const compiled = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/preload/youtube-analytics.js')],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;

function analyticsPage() {
  let clock = 0, interval, cancelled = false;
  const packets = [], document = {};
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require, console, Date,
    window: { document }, document, performance: { now: () => clock }, setInterval, clearInterval });
  class Target extends EventEmitter {
    addEventListener(name, fn) { this.on(name, fn); }
    removeEventListener(name, fn) { this.off(name, fn); }
  }
  const video = Object.assign(new Target(), { currentTime: 0, duration: 120, paused: true,
    seeking: false, readyState: 4, playbackRate: 1, defaultPlaybackRate: 1, videoWidth: 1920, videoHeight: 1080,
    preload: 'auto', buffered: { length: 1, start: () => 0, end: () => 100 }, seekable: { length: 1, start: () => 0, end: () => 120 },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 120, droppedVideoFrames: 2 }) });
  class Player extends Target { static version = '5.3.4'; }
  const filters = new Set();
  const tracks = [{ active: true, bandwidth: 1500000, videoCodec: 'avc1.42c00c', audioCodec: 'mp4a.40.2',
    language: 'en', width: 1920, height: 1080, audioBandwidth: 128000 }];
  const player = Object.assign(new Player(), {
    getMediaElement: () => video, getStats: () => ({ width: 1920, height: 1080, droppedFrames: 2, estimatedBandwidth: 2000000 }),
    getVariantTracks: () => tracks, getAssetUri: () => 'shiira-youtube://manifest/secret',
    getAdManager: () => null, getNetworkingEngine: () => ({
      registerResponseFilter: filter => filters.add(filter), unregisterResponseFilter: filter => filters.delete(filter)
    })
  });
  const analytics = module.exports.createPlaybackAnalytics({ player, video, shaka: {}, videoId: 'jNQXAC9IVRw',
    ipcRenderer: { send: (_channel, value) => packets.push(JSON.parse(JSON.stringify(value))) }, now: () => clock,
    schedule: callback => { interval = callback; return 1; }, cancel: () => { cancelled = true; } });
  return { analytics, video, player, filters, tracks, packets, advance: ms => { clock += ms; },
    periodic: () => interval(), cancelled: () => cancelled };
}

test('the supplied adapter measures startup, watch time, buffering and seeks separately and removes its real listeners', () => {
  const page = analyticsPage(), { analytics, player, video } = page;
  analytics.loadStart();
  video.emit('waiting'); page.advance(500);
  analytics.setSource({ sessionId: 'session', uri: 'source' });
  analytics.loadComplete();
  video.paused = false; video.emit('playing');
  analytics.firstFrame({ width: 1920, height: 1080, frames: 1 });
  player.emit('loaded');
  page.advance(3000); video.currentTime = 3; video.emit('timeupdate');
  video.emit('waiting'); page.advance(2000); video.emit('playing');
  page.advance(1000); video.currentTime = 4; video.emit('timeupdate');
  video.currentTime = 80; video.seeking = true; video.emit('seeking'); video.emit('waiting');
  page.advance(1500); video.seeking = false; video.emit('seeked');
  analytics.flush();
  const packet = page.packets.at(-1);
  assert.equal(packet.metrics.startupMs, 500);
  assert.equal(packet.metrics.watchMs, 4000);
  assert.equal(packet.metrics.rebufferCount, 1);
  assert.equal(packet.metrics.rebufferMs, 2000);
  assert.equal(packet.metrics.seekCount, 1);
  assert.equal(packet.metrics.seekCompleted, 1);
  assert.equal(packet.metrics.seekMs, 1500);
  assert.equal(packet.state.language, 'en');
  assert.equal(packet.state.bandwidth, 1500000);
  assert.deepEqual(packet.events.find(event => event.event === 'seeked'), { event: 'seeked', atMs: 8000,
    time: 80, from: 4, to: 80, durationMs: 1500 });
  analytics.stop(); analytics.stop();
  assert.equal(page.cancelled(), true);
  assert.equal(page.filters.size, 0, 'the actual adapter response filter is unregistered');
  assert.equal(video.listenerCount('playing'), 0, 'cleanup removes the original callbacks');
  assert.equal(player.listenerCount('loaded'), 0);
  assert.equal(player.listenerCount('error'), 0);
});

test('recoveries retain one analytics view and failed seeks remain pending without inflating rebuffer time', () => {
  const page = analyticsPage(), { analytics, video, player } = page;
  analytics.loadStart(); analytics.setSource({ sessionId: 'view', uri: 'old' }); analytics.loadComplete();
  video.paused = false; video.emit('playing'); analytics.firstFrame({ width: 1920, height: 1080, frames: 1 });
  video.currentTime = 42; video.seeking = true; video.emit('seeking');
  page.advance(5000); video.emit('waiting');
  analytics.flush();
  assert.equal(page.packets.at(-1).metrics.seekPendingMs, 5000);
  assert.equal(page.packets.at(-1).metrics.rebufferCount, 0);
  player.emit('error', { detail: { code: 1001, severity: 2, category: 1, data: ['https://signed.example/?cookie=secret', 403] } });
  analytics.recover(); video.currentTime = 0; video.emit('seeking');
  analytics.loadStart(); analytics.setSource({ sessionId: 'view', uri: 'new' }); analytics.loadComplete();
  analytics.flush();
  const packet = page.packets.at(-1);
  assert.equal(packet.sessionId, 'view');
  assert.equal(packet.uri, 'new');
  assert.equal(packet.metrics.recoveries, 1);
  assert.equal(packet.metrics.sourceLoads, 2);
  assert.equal(packet.metrics.seekCount, 1, 'unload and startup seeks are excluded');
  assert.equal(packet.metrics.criticalErrorCount, 1);
  assert.ok(!JSON.stringify(page.packets).includes('signed.example'));
  assert.ok(page.packets.flatMap(packet => packet.events).some(event => event.httpStatus === 403));
  analytics.stop();
});

test('analytics records actual rendition shifts once, and periodic flushes cannot mutate player configuration', () => {
  const page = analyticsPage();
  page.analytics.setSource({ sessionId: 'view', uri: 'source' });
  page.player.emit('loaded');
  page.tracks[0].bandwidth = 3000000; page.player.emit('adaptation'); page.player.emit('adaptation');
  page.tracks[0].bandwidth = 750000; page.player.emit('variantchanged');
  page.periodic();
  const metrics = page.packets.at(-1).metrics;
  assert.equal(metrics.variantChanges, 2); assert.equal(metrics.upshifts, 1); assert.equal(metrics.downshifts, 1);
  page.analytics.stop();
});

test('a failed overlay does not hide continued buffered progress or a later stuck seek', () => {
  const page = analyticsPage(), { analytics, video } = page;
  analytics.loadStart(); analytics.setSource({ sessionId: 'view', uri: 'source' }); analytics.loadComplete();
  video.paused = false; video.emit('playing'); analytics.firstFrame({ width: 1920, height: 1080, frames: 1 });
  analytics.fail();
  page.advance(1000); video.currentTime = 1; video.emit('timeupdate');
  video.currentTime = 90; video.seeking = true; video.emit('seeking');
  page.advance(5000); analytics.flush();
  const report = page.packets.at(-1);
  assert.equal(report.phase, 'failed');
  assert.equal(report.state.failed, true);
  assert.equal(report.metrics.watchMs, 1000);
  assert.equal(report.metrics.seekCount, 1);
  assert.equal(report.metrics.seekPendingMs, 5000);
  analytics.stop();
});

test('a queued pause during a paused seek retains the last stable position as the seek origin', () => {
  const page = analyticsPage(), { analytics, video } = page;
  analytics.loadStart(); analytics.setSource({ sessionId: 'view', uri: 'source' }); analytics.loadComplete();
  analytics.firstFrame({ width: 1920, height: 1080, frames: 1 });
  video.currentTime = 30; video.emit('timeupdate');
  video.currentTime = 75; video.seeking = true;
  video.emit('pause'); video.emit('seeking');
  page.advance(100); video.seeking = false; video.emit('seeked'); analytics.flush();
  const seek = page.packets.at(-1).events.find(event => event.event === 'seeked');
  assert.equal(seek.from, 30); assert.equal(seek.to, 75);
  analytics.stop();
});

test('local reports reject stale generations, strip URL/header/error strings, bound memory and expose immutable copies', () => {
  let clock = 1000;
  const store = new PlaybackAnalyticsStore({ now: () => clock, limit: 2 });
  const id = store.start({ ownerId: 1, hostId: 2, videoId: 'jNQXAC9IVRw' });
  store.source(id, { client: 'IOS', kind: 'dash' }, 'source-a');
  const packet = { sequence: 1, phase: 'playing', metrics: { watchMs: 1000, startupMs: NaN, cookies: 'secret' },
    state: { time: 1, duration: Infinity, language: 'en', videoCodec: 'https://signed.example', url: 'secret' },
    events: [{ event: 'error', atMs: 10, code: 1001, httpStatus: 403, data: 'secret', message: 'https://signed.example' }] };
  assert.equal(store.ingest(id, 'source-a', packet), true);
  assert.equal(store.ingest(id, 'source-a', packet), false);
  store.source(id, { client: 'WEB', kind: 'hls' }, 'source-b');
  assert.equal(store.ingest(id, 'source-a', { ...packet, sequence: 2 }), false);
  for (let i = 0; i < 500; i++) {
    clock++;
    store.ingest(id, 'source-b', { ...packet, sequence: i + 2 });
    store.transport(id, { outcome: 'failed', status: 403, itag: 140, rangeStart: 200, rangeEnd: 300,
      method: 'POST', bytes: 0, durationMs: 25, url: 'https://signed.example' });
  }
  const report = store.get(id);
  assert.equal(report.events.length, 400); assert.equal(report.samples.length, 180);
  assert.equal(report.transport.recent.length, 150);
  assert.equal(report.transport.failed, 500);
  assert.equal(report.transport.httpStatuses[403], 500);
  assert.ok(!/secret|signed.example|cookies/.test(JSON.stringify(report)));
  report.metrics.watchMs = 0;
  assert.equal(store.get(id).metrics.watchMs, 1000);
  store.end(id);
  assert.equal(store.ingest(id, 'source-b', { ...packet, sequence: 1000 }), false);
  store.start({ hostId: 3, videoId: 'secondvid01' }); store.start({ hostId: 3, videoId: 'thirdvideo1' });
  assert.equal(store.get(id), null); assert.equal(store.list(2).length, 0); assert.equal(store.list(3).length, 2);
  assert.equal(cleanPacket({ ...packet, phase: 'https://secret' }), null);
});
