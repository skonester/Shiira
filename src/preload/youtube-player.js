const { playbackVideoIdFromUrl, startSeconds } = require('../shared/youtube');

// Runs in the tab's isolated, sandboxed preload. No API is exposed to the site.
function installPlayer({ ipcRenderer, shaka, window, document }) {
  let current = null;
  let sequence = 0;
  let mediaSequence = 0;
  let checking = false;
  let lastUrl = '';
  let nativeVideoId = null;
  let disposed = false;
  shaka.polyfill.installAll();
  shaka.net.NetworkingEngine.registerScheme('shiira-youtube', (uri, request) => {
    const requestId = `${Date.now()}-${++mediaSequence}`;
    const promise = ipcRenderer.invoke('youtube:media', {
      uri, requestId, range: request.headers.Range || request.headers.range
    }).then((response) => {
      if (response.error) throw new shaka.util.Error(shaka.util.Error.Severity.CRITICAL,
        shaka.util.Error.Category.NETWORK, shaka.util.Error.Code.HTTP_ERROR, uri, response.error);
      const bytes = new Uint8Array(response.data);
      return { uri, originalUri: uri, data: bytes.buffer, headers: response.headers,
        fromCache: false, timeMs: 0 };
    });
    return new shaka.util.AbortableOperation(promise, async () => { ipcRenderer.send('youtube:cancel-media', requestId); });
  }, shaka.net.NetworkingEngine.PluginPriority.APPLICATION);

  const pauseNative = (event) => {
    if (!current || !playbackVideoIdFromUrl(window.location.href) || playbackVideoIdFromUrl(window.location.href) === nativeVideoId) return;
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
    clearTimeout(old.startTimer);
    clearTimeout(old.stallTimer);
    old.container.removeAttribute('data-shiira-player');
    old.overlay.remove();
    old.style.remove();
    old.video.pause();
    // Destroy aborts pending media work and releases buffers even when the user
    // switches videos before load() or recovery has completed.
    old.destroyed = old.player.destroy().catch(() => {});
    ipcRenderer.send('youtube:release');
  }

  function useNative(state) {
    if (current !== state) return;
    nativeVideoId = state.videoId;
    stop();
    state.container.querySelector('video')?.play().catch(() => {});
  }

  async function load(state, fresh = false) {
    const generation = ++sequence;
    state.loading = true;
    clearTimeout(state.startTimer);
    clearTimeout(state.stallTimer);
    state.status.textContent = fresh ? 'Reconnecting…' : 'Loading video…';
    state.status.hidden = false;
    const position = fresh ? state.video.currentTime || state.start : state.start;
    const paused = fresh && state.hasPlayed && state.video.paused;
    try {
      const response = await ipcRenderer.invoke('youtube:resolve', {
        videoId: state.videoId, fresh, rejectedClient: fresh ? state.client : undefined
      });
      if (current !== state || generation !== sequence) return;
      if (response.error) { useNative(state); return; }
      state.client = response.source.client;
      await state.player.load(response.source.uri, response.source.live && !position ? undefined : position, response.source.mimeType);
      if (current !== state || generation !== sequence) return;
      state.loading = false;
      state.status.hidden = true;
      if (!paused) await state.video.play().catch(() => {});
      if (!paused) {
        const loadedPosition = state.video.currentTime;
        state.startTimer = setTimeout(() => {
          if (current === state && !state.video.paused && !state.video.ended &&
            state.video.currentTime < loadedPosition + 0.25) recover(state);
        }, 12000);
      }
    } catch {
      if (current !== state || generation !== sequence) return;
      state.loading = false;
      if (fresh || state.recoveries >= 1) useNative(state);
      else recover(state);
    }
  }

  function recover(state) {
    if (current !== state || state.loading || state.recovering) return;
    if (state.recoveries >= 1) { useNative(state); return; }
    state.recoveries++;
    state.recovering = true;
    state.player.unload().then(() => {
      if (current === state) return load(state, true);
    }).catch(() => useNative(state)).finally(() => { state.recovering = false; });
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
      .status[hidden]{display:none}.tools{position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:0;transition:opacity .15s}
      :host(:hover) .tools,:host(:focus-within) .tools{opacity:1}
      button{border:1px solid #777;background:#151515df;color:#fff;border-radius:6px;padding:6px 9px;cursor:pointer}
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
    tools.append(retryButton, nativeButton);
    root.append(playerStyle, video, status, tools);
    try {
      const volume = Number(window.localStorage.getItem('shiira-youtube-volume') ?? 1);
      if (Number.isFinite(volume) && volume >= 0 && volume <= 1) video.volume = volume;
    } catch { /* Website storage can be disabled. */ }
    const style = document.createElement('style');
    style.textContent = '[data-shiira-player="active"]{position:relative!important}[data-shiira-player="active"]>:not(#shiira-youtube-player){visibility:hidden!important;pointer-events:none!important}';
    (document.head || document.documentElement).appendChild(style);
    container.setAttribute('data-shiira-player', 'active');
    container.appendChild(overlay);
    container.querySelectorAll('video').forEach((native) => { if (native !== video) native.pause(); });
    const player = new shaka.Player();
    const state = { videoId, video, container, overlay, style, player, start: startSeconds(window.location.href),
      status, recoveries: 0, hasPlayed: false, loading: true };
    current = state;
    player.configure({
      streaming: { bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 20, stallEnabled: true,
        retryParameters: { maxAttempts: 2, baseDelay: 500, backoffFactor: 2, timeout: 20000, connectionTimeout: 8000 } },
      manifest: { retryParameters: { maxAttempts: 2, baseDelay: 400, timeout: 12000 } },
      abr: { defaultBandwidthEstimate: 1500000 }
    });
    player.addEventListener('error', () => { if (!state.loading) recover(state); });
    video.addEventListener('playing', () => {
      if (current !== state) return;
      state.hasPlayed = true;
      state.status.hidden = true;
      clearTimeout(state.startTimer);
      clearTimeout(state.stallTimer);
      ipcRenderer.send('youtube:playing');
    });
    video.addEventListener('waiting', () => {
      if (current !== state || video.paused || state.loading || state.recovering) return;
      clearTimeout(state.stallTimer);
      const position = video.currentTime;
      state.stallTimer = setTimeout(() => {
        if (current === state && !video.paused && !video.seeking && video.currentTime < position + 0.25) recover(state);
      }, 10000);
    });
    video.addEventListener('volumechange', () => {
      try { window.localStorage.setItem('shiira-youtube-volume', String(video.volume)); } catch { /* Optional preference. */ }
    });
    video.addEventListener('ended', () => {
      // Continue an existing playlist without transferring playback to the hidden
      // web player. Ordinary watch pages remain at the end of the chosen video.
      if (new URL(window.location.href).searchParams.has('list')) container.querySelector('.ytp-next-button')?.click();
    });
    nativeButton.addEventListener('click', () => useNative(state));
    retryButton.addEventListener('click', () => {
      if (state.loading || state.recovering) return;
      state.recoveries = 0;
      recover(state);
    });
    player.attach(video).then(() => { if (current === state) return load(state); }).catch(() => useNative(state));
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
      if (current && (current.videoId !== id || !current.container.isConnected || !current.overlay.isConnected)) stop();
      if (!id || id === nativeVideoId || current) return;
      const container = document.querySelector('#movie_player, #player-container #player');
      if (container) mount(container, id);
    });
  }

  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true });
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
