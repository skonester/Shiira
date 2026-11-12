// Adapted from Litube's Extractor.kt / MscPlayback.kt and MediaServiceCore's
// PlayerClientQueues.kt. See THIRD_PARTY_NOTICES/litube-GPL-3.0-NOTICE.txt.
const { createHash, randomUUID } = require('node:crypto');
const { isMediaUrl } = require('../shared/youtube');

// WEB_SAFARI is represented by IOS (HLS) in YouTube.js. Unsupported MSC clients
// are omitted; ANDROID_VR remains the last emergency pool, as in Litube.
const CLIENTS = ['VISIONOS', 'WEB', 'WEB_EMBEDDED', 'IOS', 'TV', 'ANDROID_VR'];
const DIRECT_CLIENTS = new Set(['VISIONOS', 'IOS', 'ANDROID_VR']);

function deadline(promise, ms, message = 'YouTube request timed out') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  })]).finally(() => clearTimeout(timer));
}

class YouTubeService {
  constructor({ fetchImpl = fetch, getCookie = async () => '', evaluate, createClient, now = Date.now,
    attemptMs = 5000, totalMs = 18000 } = {}) {
    Object.assign(this, { fetchImpl, getCookie, evaluate, now, attemptMs, totalMs });
    this.createClient = createClient || ((options) => this.createInnertube(options));
    this.clients = new Map();
    this.cache = new Map();
    this.inFlight = new Map();
    this.epochs = new Map();
    this.order = [...CLIENTS];
    this.routes = new Map();
    this.routeKeys = new Map();
    this.requests = new Map();
  }

  async createInnertube({ client, cookie }) {
    const { Innertube, Platform, Player, Constants } = await import('youtubei.js');
    // Execute the extracted solver only in a separate, sandboxed Chromium page.
    // YouTube code must never be evaluated in Electron's privileged main process.
    Platform.shim.eval = (data) => this.evaluate(data.output);
    const request = (input, init = {}) => this.fetchImpl(input, {
      ...init, signal: AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(this.attemptMs)])
    });
    const api = await Innertube.create({
      fetch: request, cookie: DIRECT_CLIENTS.has(client) ? undefined : cookie || undefined,
      retrieve_player: false, retrieve_innertube_config: false,
      generate_session_locally: true, enable_session_cache: false, lang: 'en', location: 'US'
    });
    let playerTask;
    return {
      userAgent: Constants.CLIENTS[client]?.USER_AGENT || api.session.context.client.userAgent,
      getInfo: async (videoId) => {
        if (!DIRECT_CLIENTS.has(client)) {
          playerTask ||= Player.create(undefined, request).catch((error) => { playerTask = null; throw error; });
          api.session.player = await playerTask;
        }
        const info = await api.getBasicInfo(videoId, { client });
        // A direct client normally avoids the web solver. If its URLs contain
        // n/signature challenges, solve those before exposing any media URL.
        const formats = [...(info.streaming_data?.adaptive_formats || []), ...(info.streaming_data?.formats || [])];
        if (formats.some((format) => format.signature_cipher || format.cipher ||
          (format.url && new URL(format.url).searchParams.has('n')))) {
          playerTask ||= Player.create(undefined, request).catch((error) => { playerTask = null; throw error; });
          api.session.player = await playerTask;
        }
        return info;
      }
    };
  }

  async resolve(videoId, { fresh = false, rejectedClient } = {}) {
    if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('Invalid YouTube video');
    if (rejectedClient && !CLIENTS.includes(rejectedClient)) throw new Error('Invalid playback client');
    const cookie = await this.getCookie();
    const identity = createHash('sha256').update(cookie).digest('hex');
    const key = `${identity}:${videoId}`;
    if (fresh) {
      this.cache.delete(key);
      this.epochs.set(key, (this.epochs.get(key) || 0) + 1);
    }
    const epoch = this.epochs.get(key) || 0;
    const taskKey = `${key}:${epoch}`;
    const cached = this.cache.get(key);
    if (!fresh && cached?.expires > this.now()) return cached.value;
    if (this.inFlight.has(taskKey)) return this.inFlight.get(taskKey);
    const task = this.load(videoId, cookie, identity, rejectedClient).then((value) => {
      if ((this.epochs.get(key) || 0) === epoch) {
        this.cache.delete(key);
        this.cache.set(key, { value, expires: value.expires });
        while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
      }
      return value;
    }).finally(() => { if (this.inFlight.get(taskKey) === task) this.inFlight.delete(taskKey); });
    this.inFlight.set(taskKey, task);
    return task;
  }

  async load(videoId, cookie, identity, rejectedClient) {
    const until = this.now() + this.totalMs;
    const attempts = [];
    const order = this.order.filter((client) => client !== rejectedClient);
    for (const client of order) {
      const remaining = until - this.now();
      if (remaining <= 0) break;
      try {
        const value = await deadline((async () => {
          const key = `${DIRECT_CLIENTS.has(client) ? 'anonymous' : identity}:${client}`;
          if (!this.clients.has(key)) {
            const creating = this.createClient({ client, cookie }).catch((error) => {
              if (this.clients.get(key) === creating) this.clients.delete(key);
              throw error;
            });
            this.clients.set(key, creating);
            while (this.clients.size > 12) this.clients.delete(this.clients.keys().next().value);
          }
          const api = await this.clients.get(key);
          const info = await api.getInfo(videoId);
          const stream = info.streaming_data;
          if (info.playability_status?.status !== 'OK' || !stream) throw new Error('Client returned no playable stream');
          const source = { videoId, client, userAgent: api.userAgent, title: info.basic_info?.title || 'YouTube',
            live: !!info.basic_info?.is_live, expires: this.now() + 120000 };
          if (Number.isFinite(Number(stream.expires))) source.expires = Math.min(source.expires, Number(stream.expires) - 30000);
          if (source.live && stream.hls_manifest_url) return { ...source, kind: 'hls', url: stream.hls_manifest_url };
          // DASH keeps the complete audio/video pool for adaptive selection. SABR,
          // DRM, and OTF formats are not sources this player can consume.
          const usable = (format) => !format.drm_families?.length && !format.drm_track_type &&
            !format.is_type_otf && !!format.init_range && !!format.index_range &&
            !!(format.url || format.signature_cipher || format.cipher);
          const formats = (stream.adaptive_formats || []).filter(usable);
          if (!source.live && formats.some((f) => f.has_audio) && formats.some((f) => f.has_video)) {
            const manifest = await info.toDash({ format_filter: (format) => !usable(format) });
            if (!manifest || manifest.includes('sabr://')) throw new Error('Unsupported stream transport');
            return { ...source, kind: 'dash', manifest };
          }
          if (stream.hls_manifest_url) return { ...source, kind: 'hls', url: stream.hls_manifest_url };
          throw new Error('No DASH or HLS streams');
        })(), Math.min(this.attemptMs, remaining));
        value.attempts = [...attempts, client];
        return value;
      } catch {
        // No URLs, tokens, cookies, or server response bodies enter diagnostics.
        attempts.push(client);
      }
    }
    throw new Error('YouTube stream loading failed. Try again or use the YouTube player.');
  }

  notePlaying(source) {
    if (source.attempts?.length > 1) this.order = [source.client, ...this.order.filter((client) => client !== source.client)];
  }

  registerUrl(url, source) {
    if (!isMediaUrl(url)) throw new Error('Invalid YouTube media host');
    const key = `${source.client}:${url}`;
    if (this.routeKeys.has(key)) return this.routeKeys.get(key);
    const uri = `shiira-youtube://media/${randomUUID()}`;
    this.routes.set(uri, { url, source });
    this.routeKeys.set(key, uri);
    // Bound long-running live streams without discarding their manifest URL.
    if (this.routes.size > 4096) {
      for (const [oldUri, old] of this.routes) {
        if (!old.manifest) {
          this.routes.delete(oldUri);
          this.routeKeys.delete(`${old.source.client}:${old.url}`);
          if (this.routes.size <= 3072) break;
        }
      }
    }
    return uri;
  }

  expose(source) {
    let uri;
    if (source.kind === 'dash') {
      uri = `shiira-youtube://manifest/${randomUUID()}`;
      const manifest = source.manifest.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_match, escaped) => {
        const url = escaped.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return `<BaseURL>${this.registerUrl(url, source)}</BaseURL>`;
      });
      this.routes.set(uri, { manifest, source });
    } else {
      uri = this.registerUrl(source.url, source);
      this.routes.get(uri).manifest = true;
    }
    return { videoId: source.videoId, client: source.client, title: source.title, live: source.live, uri,
      mimeType: source.kind === 'dash' ? 'application/dash+xml' : 'application/x-mpegurl' };
  }

  async media({ uri, range, requestId }) {
    const route = this.routes.get(uri);
    if (!route || typeof requestId !== 'string' || requestId.length > 100 || this.requests.has(requestId) ||
      (range && !/^bytes=\d+-\d*$/.test(range))) throw new Error('Invalid media request');
    if (typeof route.manifest === 'string') {
      return { data: new TextEncoder().encode(route.manifest), headers: { 'content-type': 'application/dash+xml' }, uri };
    }
    if (this.requests.size >= 16) throw new Error('Too many media requests');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    this.requests.set(requestId, controller);
    try {
      const headers = { 'User-Agent': route.source.userAgent, Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/' };
      if (range) headers.Range = range;
      let target = route.url;
      let response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (!isMediaUrl(target)) throw new Error('Invalid media redirect');
        response = await this.fetchImpl(target, { headers, signal: controller.signal, credentials: 'omit', redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        target = new URL(response.headers.get('location'), target).href;
        if (redirects === 3) throw new Error('Too many media redirects');
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`YouTube media HTTP ${response.status}`); }
      const type = response.headers.get('content-type') || '';
      if (/text\/html|application\/json/.test(type)) { await response.body?.cancel(); throw new Error('Invalid YouTube media response'); }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('YouTube media chunk too large'); }
        chunks.push(value);
      }
      let data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      if (/mpegurl/i.test(type) || new TextDecoder().decode(data.subarray(0, 7)) === '#EXTM3U') {
        const playlist = new TextDecoder().decode(data).split('\n').map((line) => {
          if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, value) =>
            `URI="${this.registerUrl(new URL(value, target).href, route.source)}"`);
          return line.trim() ? this.registerUrl(new URL(line.trim(), target).href, route.source) : line;
        }).join('\n');
        data = new TextEncoder().encode(playlist);
      }
      return { data, headers: { 'content-type': type }, uri };
    } finally {
      clearTimeout(timer);
      if (this.requests.get(requestId) === controller) this.requests.delete(requestId);
    }
  }

  cancel(requestId) { this.requests.get(requestId)?.abort(); }
  clearMedia() {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.routes.clear();
    this.routeKeys.clear();
  }
  dispose() {
    this.clearMedia();
    this.cache.clear();
    this.clients.clear();
    this.epochs.clear();
  }
}

module.exports = { YouTubeService, CLIENTS, deadline };
