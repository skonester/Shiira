const { playbackVideoIdFromUrl, startSeconds } = require('../shared/youtube');

// Runs in the tab's isolated, sandboxed preload. No API is exposed to the site.
function installPlayer({ ipcRenderer, shaka, window, document, registerMedia = () => () => {}, createAnalytics = () => null }) {
  let current = null;
  let sequence = 0;
  let mediaSequence = 0;
  let checking = false;
  let lastUrl = '';
  let nativeVideoId = null;
  let disposed = false;
  shaka.polyfill.installAll();
  shaka.net.NetworkingEngine.registerScheme('shiira-youtube', (uri, request, requestType) => {
    const requestId = `${Date.now()}-${++mediaSequence}`;
    let rejectOperation;
    let aborted = false;
    const abortPromise = new Promise((_, reject) => {
      rejectOperation = reject;
    });
    const mediaPromise = ipcRenderer.invoke('youtube:media', {
      uri, requestId, range: request.headers.Range || request.headers.range
    }).then((response) => {
      if (aborted) {
        throw new shaka.util.Error(shaka.util.Error.Severity.RECOVERABLE,
          shaka.util.Error.Category.PLAYER, shaka.util.Error.Code.OPERATION_ABORTED, uri);
      }
      if (response.error) {
        const finalAttempt = request.attempt + 1 >= request.retryParameters.maxAttempts;
        const severity = finalAttempt ? shaka.util.Error.Severity.CRITICAL : shaka.util.Error.Severity.RECOVERABLE;
        const status = /^YouTube media HTTP (\d{3})$/.exec(response.error);
        if (status) throw new shaka.util.Error(severity, shaka.util.Error.Category.NETWORK,
          shaka.util.Error.Code.BAD_HTTP_STATUS, uri, Number(status[1]), '', {}, requestType);
        throw new shaka.util.Error(severity,
          shaka.util.Error.Category.NETWORK, shaka.util.Error.Code.HTTP_ERROR, uri, response.error);
      }
      const bytes = new Uint8Array(response.data);
      return { uri, originalUri: uri, data: bytes.buffer, headers: response.headers,
        fromCache: false };
    });
    mediaPromise.catch(() => {});
    const promise = Promise.race([mediaPromise, abortPromise]);
    const abort = async () => {
      if (!aborted) {
        aborted = true;
        ipcRenderer.send('youtube:cancel-media', requestId);
        rejectOperation(new shaka.util.Error(
          shaka.util.Error.Severity.RECOVERABLE,
          shaka.util.Error.Category.PLAYER,
          shaka.util.Error.Code.OPERATION_ABORTED,
          uri
        ));
      }
    };
    return new shaka.util.AbortableOperation(promise, abort);
  }, shaka.net.NetworkingEngine.PluginPriority.APPLICATION);

  const pauseNative = (event) => {
    if (!playbackVideoIdFromUrl(window.location.href) || playbackVideoIdFromUrl(window.location.href) === nativeVideoId) return;
    const video = event.target;
    if (video?.tagName === 'VIDEO' && video !== current?.video) video.pause();
  };
  document.addEventListener('play', pauseNative, true);
  document.addEventListener('playing', pauseNative, true);

  function stop() {
    sequence++;
    const old = current;
    current = null;
    if (!old) return;
    old.analytics?.stop();
    clearInterval(old.statsTimer);
    old.releaseMedia();
    if (old.frameCallback != null) old.video.cancelVideoFrameCallback(old.frameCallback);
    old.container.removeAttribute('data-shiira-player');
    old.overlay.remove();
    old.style.remove();
    old.video.pause();
    // Destroy aborts pending media work and releases buffers even when the user
    // switches videos before load() or recovery has completed.
    old.destroyed = old.player.destroy().catch(() => {});
    ipcRenderer.send('youtube:release', { videoId: old.videoId, uri: old.uri });
  }

  function useNative(state) {
    if (current !== state) return;
    nativeVideoId = state.videoId;
    stop();
    state.container.querySelector('video')?.play().catch(() => {});
  }

  function fail(state) {
    if (current !== state) return;
    if (state.frameCallback != null) state.video.cancelVideoFrameCallback(state.frameCallback);
    state.frameCallback = null;
    state.loading = false;
    state.unloading = false;
    state.failed = true;
    state.analytics?.fail();
    state.status.textContent = 'Stream unavailable. Retry, or choose the YouTube player.';
    state.status.hidden = false;
    state.overlay.setAttribute('data-failed', '');
  }

  function attachToContainer(state, container) {
    const wasDetached = state.wasDetached || !state.overlay.isConnected || state.overlay.parentNode !== container;
    if (state.container !== container) state.container.removeAttribute('data-shiira-player');
    state.container = container;
    if (!state.style.isConnected) (document.head || document.documentElement).appendChild(state.style);
    if (container.getAttribute('data-shiira-player') !== 'active') container.setAttribute('data-shiira-player', 'active');
    if (state.overlay.parentNode !== container) {
      // YouTube rebuilds its player during ad transitions. Retain the video,
      // decoder and buffered source when its surrounding DOM changes.
      if (state.overlay.isConnected && typeof container.moveBefore === 'function') container.moveBefore(state.overlay, null);
      else container.appendChild(state.overlay);
    }
    if (wasDetached && state.wantsPlay && state.hasPlayed && !state.loading && !state.failed && state.video.paused) {
      state.video.play().catch(() => {});
    }
    state.wasDetached = false;
    container.querySelectorAll('video').forEach(video => { if (video !== state.video && !video.paused) video.pause(); });
  }

  function confirmPlayback(state) {
    if (state.loading || state.failed || !state.uri || state.frameCallback != null || state.confirmedUri === state.uri) return;
    const uri = state.uri;
    const generation = sequence;
    state.frameCallback = state.video.requestVideoFrameCallback((_time, frame) => {
      if (current !== state || generation !== sequence || state.uri !== uri || state.loading || state.failed) return;
      state.frameCallback = null;
      if (![frame.width, frame.height].every(value => Number.isInteger(value) && value > 0 && value <= 32768) ||
        !Number.isSafeInteger(frame.presentedFrames) || frame.presentedFrames < 1) {
        confirmPlayback(state);
        return;
      }
      state.confirmedUri = uri;
      state.analytics?.firstFrame({ width: frame.width, height: frame.height, frames: frame.presentedFrames });
      // A native YouTube video or a play event cannot establish successful
      // Shiira playback. Report a frame from this closed-shadow video only.
      ipcRenderer.send('youtube:playing', { uri, width: frame.width, height: frame.height,
        frames: frame.presentedFrames });
    });
  }

  function reportError(state, error, phase) {
    if (current !== state) return;
    if (phase !== 'playback') state.analytics?.error(error, phase);
    ipcRenderer.send('youtube:error', { uri: state.uri, videoId: state.videoId, phase,
      code: Number.isInteger(error?.code) ? error.code : 0,
      category: Number.isInteger(error?.category) ? error.category : 0,
      severity: Number.isInteger(error?.severity) ? error.severity : 0 });
  }

  async function load(state, fresh = false, playback = { position: state.start }) {
    const generation = ++sequence;
    state.loading = true;
    state.analytics?.loadStart();
    state.failed = false;
    if (state.frameCallback != null) state.video.cancelVideoFrameCallback(state.frameCallback);
    state.frameCallback = null;
    state.confirmedUri = null;
    state.overlay.removeAttribute('data-failed');
    state.status.textContent = fresh ? 'Reconnecting…' : 'Loading video…';
    state.status.hidden = false;
    try {
      const response = await ipcRenderer.invoke('youtube:resolve', {
        videoId: state.videoId, fresh
      });
      if (current !== state || generation !== sequence) return;
      state.analytics?.setSource({ sessionId: response.analytics?.sessionId, uri: response.source?.uri ?? null });
      if (response.error) { fail(state); return; }
      state.client = response.source.client;
      state.uri = response.source.uri;
      state.availableAt = response.source.availableAt || 0;
      const readinessWait = Math.max(0, state.availableAt - Date.now());
      state.player.configure({
        streaming: { retryParameters: { timeout: 20000 + readinessWait, connectionTimeout: 8000 + readinessWait } },
        manifest: { retryParameters: { timeout: 12000 + readinessWait } }
      });
      const targetPosition = state.seekPosition != null ? state.seekPosition : (playback.position ?? state.start);
      // Shaka's startup seek is not a new user choice. Retain a newer seek
      // arriving during load(), then apply it once the media is attached.
      const seekRevision = state.seekRevision;
      state.loadPosition = targetPosition;
      await state.player.load(response.source.uri, response.source.live && !targetPosition ? undefined : targetPosition, response.source.mimeType);
      if (current !== state || generation !== sequence) return;
      if (state.seekRevision !== seekRevision && state.seekPosition != null) {
        state.video.currentTime = state.seekPosition;
      }
      state.loadPosition = null;
      state.seekPosition = null;
      state.loading = false;
      state.analytics?.loadComplete();
      state.status.hidden = true;
      confirmPlayback(state);
      if (state.wantsPlay) await state.video.play().catch(() => {});
      else state.video.pause();
    } catch (error) {
      if (current !== state || generation !== sequence) return;
      reportError(state, error, 'load');
      state.loading = false;
      if (fresh || state.recoveries >= 1) fail(state);
      else recover(state);
    }
  }

  function recover(state) {
    if (current !== state || state.loading || state.recovering) return;
    if (state.recoveries >= 1) { fail(state); return; }
    state.recoveries++;
    state.recovering = true;
    state.analytics?.recover();
    sequence++;
    if (state.frameCallback != null) state.video.cancelVideoFrameCallback(state.frameCallback);
    state.frameCallback = null;
    const playback = {
      position: (state.hasPlayed || state.seekPosition != null) ? (state.seekPosition ?? state.video.currentTime) : state.start
    };
    // unload() resets currentTime and can emit seeking/pause events. Preserve
    // the chosen position separately and ignore those internal reset events.
    state.unloading = true;
    state.seekPosition = playback.position;
    // Pause explicitly so only this reset event is ignored. Later user play/pause
    // choices remain authoritative throughout unload and source resolution.
    if (!state.video.paused) {
      state.ignoreResetPause = true;
      state.video.pause();
    }
    state.player.unload().then(() => {
      state.unloading = false;
      if (current === state) return load(state, true, playback);
    }).catch(() => fail(state)).finally(() => { state.recovering = false; });
  }

  function mount(container, videoId) {
    const overlay = document.createElement('div');
    overlay.id = 'shiira-youtube-player';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:2200;visibility:visible;background:#000;';
    const root = overlay.attachShadow({ mode: 'closed' });
    const playerStyle = document.createElement('style');
    playerStyle.textContent = `
      :host{color:#fff;font:13px system-ui,sans-serif}*{box-sizing:border-box}
      video{width:100%;height:100%;display:block;background:#000;object-fit:contain}
      .status{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;background:#0008}
      .status[hidden]{display:none}.tools{position:absolute;top:8px;left:8px;right:8px;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;opacity:0;transition:opacity .15s}
      :host(:hover) .tools,:host(:focus-within) .tools,:host([data-failed]) .tools{opacity:1}
      button{border:1px solid #777;background:#151515df;color:#fff;border-radius:6px;padding:6px 9px;cursor:pointer}
      .diagnostics{position:absolute;top:48px;right:8px;max-width:calc(100% - 16px);max-height:calc(100% - 100px);overflow:auto;background:#101218f2;border:1px solid #555;border-radius:8px;padding:12px;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace}
      .diagnostics[hidden]{display:none}.diagnostics button{margin-top:8px}
    `;
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'auto';
    const status = document.createElement('div');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading video…';
    const tools = document.createElement('div');
    tools.className = 'tools';
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Reload video';
    const nativeButton = document.createElement('button');
    nativeButton.type = 'button';
    nativeButton.textContent = 'Use YouTube player';
    const statsButton = document.createElement('button');
    statsButton.type = 'button';
    statsButton.textContent = 'Playback stats';
    const statsPanel = document.createElement('div');
    statsPanel.className = 'diagnostics';
    statsPanel.hidden = true;
    const statsText = document.createElement('div');
    statsText.setAttribute('role', 'status');
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Save JSON report';
    statsPanel.append(statsText, exportButton);
    tools.append(statsButton, retryButton, nativeButton);
    root.append(playerStyle, video, status, tools, statsPanel);
    try {
      const volume = Number(window.localStorage.getItem('shiira-youtube-volume') ?? 1);
      if (Number.isFinite(volume) && volume >= 0 && volume <= 1) video.volume = volume;
    } catch { /* Website storage can be disabled. */ }
    const style = document.createElement('style');
    style.textContent = '[data-shiira-player="active"]{position:relative!important}[data-shiira-player="active"]>:not(#shiira-youtube-player){visibility:hidden!important;pointer-events:none!important}[data-shiira-player="active"]>#shiira-youtube-player{display:block!important;visibility:visible!important}';
    (document.head || document.documentElement).appendChild(style);
    container.setAttribute('data-shiira-player', 'active');
    container.appendChild(overlay);
    container.querySelectorAll('video').forEach((native) => { if (native !== video) native.pause(); });
    const player = new shaka.Player();
    const state = { videoId, video, container, overlay, style, player, start: startSeconds(window.location.href),
      status, recoveries: 0, hasPlayed: false, loading: true, wantsPlay: true, seekRevision: 0 };
    current = state;
    state.analytics = createAnalytics({ player, video, shaka, ipcRenderer, videoId });
    state.releaseMedia = registerMedia(video);
    async function showStats() {
      if (current !== state || statsPanel.hidden) return;
      const panelTop = tools.offsetTop + tools.offsetHeight + 8;
      statsPanel.style.top = `${panelTop}px`;
      statsPanel.style.maxHeight = `calc(100% - ${panelTop + 48}px)`;
      try {
        const report = await ipcRenderer.invoke('youtube:analytics-get');
        if (current !== state || statsPanel.hidden) return;
        if (!report) { statsText.textContent = 'Waiting for playback diagnostics…'; return; }
        const m = report.metrics, s = report.state, t = report.transport, source = report.sources.at(-1);
        const seconds = value => `${((value || 0) / 1000).toFixed(2)}s`;
        statsText.textContent = [
          `Playback: ${report.phase} · ${source?.client || 'resolving'} · ${source?.protocol || ''}`,
          `Video: ${s.width || 0}×${s.height || 0} · audio ${s.language || 'unspecified'}`,
          `Startup: ${m.startupMs == null ? 'waiting for a frame' : seconds(m.startupMs)} · watched ${seconds(m.watchMs)}`,
          `Rebuffering: ${m.rebufferCount || 0} · ${seconds(m.rebufferMs)}`,
          `Seeks: ${m.seekCompleted || 0}/${m.seekCount || 0} · pending ${seconds(m.seekPendingMs)}`,
          `Buffer ahead: ${seconds(s.bufferAheadMs)} · dropped frames ${s.droppedFrames || 0}`,
          `Requests: ${t.completed} completed · ${t.failed} failed · ${t.cancelled} cancelled`,
          `HTTP 403: ${t.httpStatuses['403'] || 0} · recoveries ${m.recoveries || 0}`
        ].join('\n');
      } catch { statsText.textContent = 'Playback diagnostics unavailable.'; }
    }
    statsButton.addEventListener('click', () => {
      statsPanel.hidden = !statsPanel.hidden;
      state.analytics?.flush();
      void showStats();
    });
    exportButton.addEventListener('click', async () => {
      state.analytics?.flush();
      const result = await ipcRenderer.invoke('youtube:analytics-export').catch(() => ({ error: 'Report could not be saved.' }));
      if (result?.error) statsText.textContent = result.error;
    });
    state.statsTimer = setInterval(showStats, 2000);
    const languages = [...new Set(window.navigator?.languages?.length
      ? window.navigator.languages : [window.navigator?.language || 'en'])];
    player.configure({
      // Shaka 5 matches BCP-47 tags, including regional fallbacks. Preserve all
      // manifest variants for ABR; prefer the original/main role if none match.
      preferredAudio: [...languages.map(language => ({ language })), { role: 'main' }],
      preferredText: languages.map(language => ({ language })),
      streaming: { bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 20, stallEnabled: true,
        retryParameters: { maxAttempts: 2, baseDelay: 500, backoffFactor: 2, timeout: 20000, connectionTimeout: 8000 } },
      manifest: { retryParameters: { maxAttempts: 2, baseDelay: 400, timeout: 12000 } },
      abr: { defaultBandwidthEstimate: 1500000 }
    });
    player.addEventListener('error', (event) => {
      const error = event.detail;
      if (current === state && !state.loading && !state.recovering && !state.failed && error?.severity === shaka.util.Error.Severity.CRITICAL) {
        if (error.handled || error.code === shaka.util.Error.Code.OPERATION_ABORTED || error.code === 7001) return;
        reportError(state, error, 'playback');
        recover(state);
      }
    });
    video.addEventListener('play', () => { state.wantsPlay = true; });
    video.addEventListener('pause', () => {
      if (state.ignoreResetPause) {
        state.ignoreResetPause = false;
        return;
      }
      if (!state.overlay.isConnected) state.wasDetached = true;
      else state.wantsPlay = false;
    });
    video.addEventListener('seeking', () => {
      if (current !== state || state.unloading || state.failed) return;
      if (state.loading && state.loadPosition != null && Math.abs(video.currentTime - state.loadPosition) < 0.01) return;
      state.seekRevision++;
      state.seekPosition = state.loading || state.recovering || !state.hasPlayed ? video.currentTime : null;
    });
    video.addEventListener('seeked', () => {
      if (current !== state || state.loading || state.recovering || state.failed) return;
      state.seekPosition = null;
      // Paused seeks need not emit playing. Do not leave a buffering overlay
      // over a successfully completed seek or reload the source to clear it.
      state.status.hidden = true;
    });
    video.addEventListener('playing', () => {
      if (current !== state || state.failed || state.unloading) return;
      state.hasPlayed = true;
      if (!state.loading && !state.recovering) state.seekPosition = null;
      state.status.hidden = true;
      confirmPlayback(state);
    });
    video.addEventListener('waiting', () => {
      if (current !== state || video.paused || state.loading || state.recovering || state.failed) return;
      // As in Litube, buffering itself does not invalidate a source. The
      // request layer owns readiness and transport deadlines; only an actual
      // terminal Shaka error may request source recovery.
      state.status.textContent = 'Buffering…';
      state.status.hidden = false;
    });
    video.addEventListener('volumechange', () => {
      try { window.localStorage.setItem('shiira-youtube-volume', String(video.volume)); } catch { /* Optional preference. */ }
    });
    video.addEventListener('ended', () => {
      // Continue an existing playlist without transferring playback to the hidden
      // web player. Ordinary watch pages remain at the end of the chosen video.
      if (new URL(window.location.href).searchParams.has('list')) state.container.querySelector('.ytp-next-button')?.click();
    });
    nativeButton.addEventListener('click', () => useNative(state));
    retryButton.addEventListener('click', () => {
      if (state.loading || state.recovering) return;
      state.recoveries = 0;
      recover(state);
    });
    player.attach(video).then(() => { if (current === state) return load(state); }).catch(error => {
      reportError(state, error, 'attach');
      fail(state);
    });
  }

  function check() {
    if (checking || disposed) return;
    checking = true;
    queueMicrotask(() => {
      checking = false;
      if (disposed) return;
      const href = window.location.href;
      const id = playbackVideoIdFromUrl(href);
      if (href !== lastUrl) {
        lastUrl = href;
        if (nativeVideoId !== id) nativeVideoId = null;
      }
      if (current && current.videoId !== id) stop();
      if (!id || id === nativeVideoId) return;
      const container = document.querySelector('#movie_player, #player-container #player');
      if (current) {
        if (!current.overlay.isConnected) current.wasDetached = true;
        if (container) attachToContainer(current, container);
        return;
      }
      if (container) mount(container, id);
    });
  }

  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-shiira-player'] });
  document.addEventListener('yt-navigate-finish', check);
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  // pushState is in the site's world. Poll only its URL; no page API is patched.
  const navigationTimer = setInterval(check, 500);
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearInterval(navigationTimer);
    observer.disconnect();
    document.removeEventListener('play', pauseNative, true);
    document.removeEventListener('playing', pauseNative, true);
    stop();
  }, { once: true });
  check();
}

module.exports = { installPlayer };
