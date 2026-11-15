const loadShakaPlayer = require('./vendor/shaka-player-analytics/index.ts').default;
const { cleanState, cleanEvent } = require('../shared/youtube-analytics');

function createPlaybackAnalytics({ player, video, shaka, ipcRenderer, videoId,
  now = () => performance.now(), schedule = setInterval, cancel = clearInterval }) {
  const started = now();
  const metrics = { observedMs: 0, watchMs: 0, rebufferCount: 0, rebufferMs: 0, seekCount: 0,
    seekCompleted: 0, seekMs: 0, sourceLoads: 0, recoveries: 0, errorCount: 0,
    criticalErrorCount: 0, variantChanges: 0, upshifts: 0, downshifts: 0 };
  let phase = 'loading', sessionId, uri = null, sequence = 0, stopped = false;
  let lastTick = now(), lastTime = video.currentTime || 0, lastStableTime = video.currentTime || 0, seekStart = null, seekFrom = 0;
  let loaded = false, failed = false, firstFrame = false, sourceFrame = false, lastBandwidth = 0, events = [];
  const listeners = [];
  function tick() {
    const time = now(), elapsed = Math.max(0, time - lastTick);
    if (phase === 'playing' && !video.paused && !video.seeking && video.readyState >= 2 && video.currentTime > lastTime) {
      metrics.watchMs += Math.min(elapsed, (video.currentTime - lastTime) * 1000 / Math.max(.01, video.playbackRate || 1));
    }
    if (phase === 'buffering') metrics.rebufferMs += elapsed;
    metrics.observedMs = Math.max(0, time - started);
    if (!video.seeking && phase !== 'seeking') lastStableTime = video.currentTime || 0;
    lastTick = time;
    lastTime = video.currentTime || 0;
  }
  function event(name, data = {}) {
    const value = cleanEvent({ event: name, atMs: Math.max(0, now() - started), time: video.currentTime, ...data });
    if (value) { events.push(value); if (events.length > 100) events.shift(); }
  }
  function snapshot() {
    tick();
    let stats = {}, track = {}, quality = {};
    try { stats = player.getStats(); track = player.getVariantTracks().find(track => track.active) || {}; } catch { /* Not attached yet. */ }
    try { quality = video.getVideoPlaybackQuality(); } catch { /* Not supported on every decoder. */ }
    const ranges = value => value ? Array.from({ length: Math.min(16, value.length) }, (_, i) => [value.start(i), value.end(i)]) : [];
    const buffered = ranges(video.buffered);
    const containing = buffered.find(range => range[0] <= video.currentTime && range[1] >= video.currentTime);
    const state = cleanState({ time: video.currentTime, duration: video.duration,
      bufferAheadMs: containing ? (containing[1] - video.currentTime) * 1000 : 0,
      width: video.videoWidth, height: video.videoHeight, frames: quality.totalVideoFrames,
      droppedFrames: quality.droppedVideoFrames ?? stats.droppedFrames,
      bandwidth: track.bandwidth, audioBandwidth: track.audioBandwidth, estimatedBandwidth: stats.estimatedBandwidth,
      frameRate: track.frameRate, readyState: video.readyState, playbackRate: video.playbackRate,
      paused: video.paused, seeking: video.seeking, muted: video.muted,
      failed,
      videoCodec: track.videoCodec, audioCodec: track.audioCodec, language: track.language, hdr: track.hdr,
      buffered, seekable: ranges(video.seekable), liveLatency: stats.liveLatency });
    return { phase: failed && phase !== 'stopped' ? 'failed' : phase,
      metrics: { ...metrics, seekPendingMs: seekStart == null ? 0 : now() - seekStart }, state };
  }
  function flush() {
    if (stopped || !sessionId) return;
    const packet = { ...snapshot(), videoId, sessionId, uri, sequence: ++sequence, events };
    events = [];
    try { ipcRenderer.send('youtube:analytics', packet); } catch { /* Departing document. */ }
  }
  function onEvent({ event: name, data }) {
    if (stopped) return;
    const previousTime = lastStableTime;
    tick();
    if (name === 'timeupdate' || name === 'requestCompleted' || name === 'destroy') return;
    if (name === 'variantChanged') {
      const bandwidth = data.video_source_bitrate;
      if (lastBandwidth && Number.isFinite(bandwidth) && bandwidth !== lastBandwidth) {
        metrics.variantChanges++;
        if (bandwidth > lastBandwidth) metrics.upshifts++; else metrics.downshifts++;
      }
      if (Number.isFinite(bandwidth)) lastBandwidth = bandwidth;
    }
    if (loaded) {
      if (name === 'seeking') {
        if (!sourceFrame) return; // Shaka's initial/resume seek belongs to loading.
        if (seekStart == null) { seekStart = now(); seekFrom = previousTime; metrics.seekCount++; }
        phase = 'seeking';
      } else if (name === 'seeked') {
        if (seekStart != null) {
          const durationMs = now() - seekStart;
          metrics.seekMs += durationMs; metrics.seekCompleted++;
          event('seeked', { from: seekFrom, to: video.currentTime, durationMs });
          seekStart = null;
        }
        phase = video.paused ? 'paused' : 'playing';
      } else if (name === 'playing') phase = 'playing';
      else if (name === 'pause' && phase !== 'failed') phase = 'paused';
      else if ((name === 'waiting' || name === 'stalled') && firstFrame && !video.paused && seekStart == null && phase !== 'failed') {
        if (phase !== 'buffering') metrics.rebufferCount++;
        phase = 'buffering';
      } else if (name === 'ended') phase = 'ended';
    }
    if (name !== 'seeked') event(name);
  }
  // Use the supplied adapter's real player/media/network instrumentation with
  // Shiira's local sink. Raw Shaka error.data is intentionally not dispatched.
  loadShakaPlayer(player, { automaticErrorTracking: false, data: {}, onEvent }, shaka);
  const onError = event => error(event.detail, 'playback');
  player.addEventListener('error', onError);
  listeners.push(() => player.removeEventListener('error', onError));
  const timer = schedule(flush, 2000);
  function error(value, errorPhase) {
    tick(); metrics.errorCount++;
    if (value?.severity === 2 && !value.handled && value.code !== 7001) metrics.criticalErrorCount++;
    event('error', { code: value?.code, category: value?.category, severity: value?.severity,
      handled: !!value?.handled, phase: errorPhase,
      httpStatus: value?.code === 1001 && Number.isInteger(value.data?.[1]) ? value.data[1] : undefined });
    flush();
  }
  return {
    snapshot, flush, error,
    setSource(source) { sessionId = source.sessionId; uri = source.uri ?? null; flush(); },
    loadStart() { tick(); loaded = false; failed = false; sourceFrame = false; phase = 'loading'; metrics.sourceLoads++; event('loadstart'); },
    loadComplete() { tick(); loaded = true; phase = video.paused ? 'paused' : 'playing'; event('loaded'); flush(); },
    recover() { tick(); loaded = false; seekStart = null; phase = 'recovering'; metrics.recoveries++; event('recovery'); flush(); },
    // A terminal overlay can coexist with buffered video still playing. Keep
    // observing its real progress and seeks, while preserving the failure flag.
    fail() { tick(); failed = true; event('failed'); flush(); },
    firstFrame(frame) {
      tick();
      sourceFrame = true;
      if (!firstFrame) { firstFrame = true; metrics.startupMs = now() - started; }
      event('first_frame', frame); flush();
    },
    stop() {
      if (stopped) return;
      tick(); phase = 'stopped'; event('stopped'); flush(); stopped = true;
      cancel(timer); listeners.forEach(remove => remove()); player.fp?.destroy();
    }
  };
}
module.exports = { createPlaybackAnalytics };
