// Adapted from Litube's Extractor.kt / MscPlayback.kt and MediaServiceCore's
// PlayerClientQueues.kt. See THIRD_PARTY_NOTICES/litube-GPL-3.0-NOTICE.txt.
// Apple-client HLS selection and visitor handling follow Stream Tube's
// src/api/streams.rs. See THIRD_PARTY_NOTICES/stream-tube-MIT.txt.
const { createHash, randomUUID } = require('node:crypto');
const timers = require('node:timers/promises');
const { isMediaUrl } = require('../shared/youtube');

// The Apple clients come first: their HLS manifests need neither a PO token
// nor the player solver, and they work signed out. WEB_SAFARI is a WEB request
// with Safari identity, as in MSC PlayerRequest.kt.
const CLIENTS = ['VISIONOS', 'IOS', 'WEB', 'WEB_EMBEDDED', 'WEB_SAFARI', 'TV', 'ANDROID_VR'];
const SAFARI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)';
const DIRECT_CLIENTS = new Set(['VISIONOS', 'IOS', 'ANDROID_VR']);
// Without a PO token YouTube cuts these clients' adaptive URLs off after about
// 1 MB, which surfaces as 403s once playback or a seek leaves the first chunk.
// Their HLS manifest is the only usable stream, so DASH is never built for them.
const HLS_ONLY_CLIENTS = new Set(['VISIONOS', 'IOS']);
// A server-issued visitor ID makes "confirm you're not a bot" answers far less
// likely than a locally generated one. iOS is the exception (see getInfo).
const SERVER_VISITOR_CLIENTS = new Set(['VISIONOS', 'ANDROID_VR']);
const VISITOR_TTL_MS = 6 * 3600 * 1000;
const IOS_VISITOR_ATTEMPTS = 5;
const validVisitor = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[\w%=-]+$/.test(value);
const MEDIA_TIMEOUT_MS = 20000;
const MAX_MEDIA_WAIT_MS = 30000;
const FAILURE_CODES = new Set(['TIMEOUT', 'VERIFICATION_REQUIRED', 'NO_STREAM', 'SOLVER_FAILED', 'SOLVER_UNAVAILABLE', 'FAILED', 'UNPLAYABLE',
  'ERROR', 'LIVE_STREAM_OFFLINE', 'LOGIN_REQUIRED', 'AGE_CHECK_REQUIRED', 'AGE_VERIFICATION_REQUIRED', 'CONTENT_CHECK_REQUIRED']);
const IDENTITY_COOKIES = new Set(['SID', 'SAPISID', 'APISID', 'HSID', 'SSID', 'LOGIN_INFO',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'VISITOR_INFO1_LIVE']);

function cookieIdentity(cookie) {
  // Consent/telemetry cookies can change while an ad loads. They do not make a
  // new account/visitor or invalidate refusal feedback for an issued source.
  const identity = cookie.split(';').map(part => part.trim())
    .filter(part => IDENTITY_COOKIES.has(part.split('=', 1)[0])).sort().join(';');
  return createHash('sha256').update(identity).digest('hex');
}

function mediaAvailableAt(response, now) {
  const answer = response?.playerResponse || response;
  // MediaServiceCore PlayerReadiness.kt prefers modern pre-content ad slots.
  // Unknown pre-roll fulfillment still carries its conservative 15-second hold.
  const slots = (Array.isArray(answer?.adSlots) ? answer.adSlots : [])
    .map(slot => slot?.adSlotRenderer)
    .filter(slot => slot?.adSlotMetadata?.triggerEvent === 'SLOT_TRIGGER_EVENT_BEFORE_CONTENT');
  const content = slots.length ? slots.map(slot => slot.fulfillmentContent)
    : (Array.isArray(answer?.adPlacements) ? answer.adPlacements : [])
      .map(placement => placement?.adPlacementRenderer)
      .filter(ad => ad?.config?.adPlacementConfig?.kind === 'AD_PLACEMENT_KIND_START')
      .map(ad => ad.renderer);
  function videoAds(value, depth = 0) {
    if (depth > 12 || !value || typeof value !== 'object') return [];
    if (value.instreamVideoAdRenderer) return [value.instreamVideoAdRenderer];
    return Object.values(value).flatMap(child => videoAds(child, depth + 1));
  }
  function adWait(ad) {
    const skip = Number(ad.skipOffsetMilliseconds);
    if (ad.skipOffsetMilliseconds != null && Number.isFinite(skip) && skip >= 0) return Math.min(skip, MAX_MEDIA_WAIT_MS);
    const seconds = new URLSearchParams(typeof ad.playerVars === 'string' ? ad.playerVars : '').get('length_seconds');
    const duration = seconds == null || seconds.trim() === '' ? NaN : Number(seconds);
    return Number.isFinite(duration) && duration >= 0 ? Math.min(duration, 30) * 1000 : 15000;
  }
  const waitMs = content.slice(0, 32).reduce((total, value) => {
    const ads = videoAds(value);
    return total + (ads.length ? ads.slice(0, 32).reduce((sum, ad) => sum + adWait(ad), 0) : 15000);
  }, 0);
  return waitMs > 0 ? now + Math.min(waitMs, MAX_MEDIA_WAIT_MS) : 0;
}

function deadline(promise, ms, message = 'YouTube request timed out') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'TIMEOUT' })), ms);
  })]).finally(() => clearTimeout(timer));
}

function abortable(promise, signal) {
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', abort));
}

function validRange(range, bounded = false) {
  const match = typeof range === 'string' && /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return false;
  const start = Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  return Number.isSafeInteger(start) && start >= 0 &&
    (end === null ? !bounded : Number.isSafeInteger(end) && end >= start);
}

function usableFormat(format) {
  const range = value => value && Number.isSafeInteger(value.start) && value.start >= 0 &&
    Number.isSafeInteger(value.end) && value.end >= value.start;
  const url = format.url || new URLSearchParams(format.signature_cipher || format.cipher || '').get('url');
  return !format.drm_families?.length && !format.drm_track_type && !format.is_type_otf &&
    range(format.init_range) && range(format.index_range) && isMediaUrl(url);
}

// YouTube names every HLS segment seg.ts and serves it as octet-stream, whether
// it is MPEG-TS, fMP4 or packed ADTS AAC. Shaka guesses a segment container
// from its URI or content type and otherwise assumes MP4, which leaves packed
// audio in an MP4 buffer that never initializes. fMP4 keeps the generic type.
function hlsSegmentType(data) {
  if (data.length >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return 'audio/aac'; // ID3 timestamp tag
  if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xf6) === 0xf0) return 'audio/aac'; // ADTS sync word
  if (data.length >= 189 && data[0] === 0x47 && data[188] === 0x47) return 'video/mp2t';
  return null;
}

function decodeManifestUrl(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function dashUrls(manifest) {
  // Only the static byte-range manifests produced by YouTube.js are supported.
  // Reject other request mechanisms before Shaka can select its HTTP plugin.
  if (typeof manifest !== 'string' || !/<MPD(?:\s|>)/.test(manifest) || !/<\/MPD>\s*$/.test(manifest) ||
    /sabr:|<ContentProtection\b|<SegmentTemplate\b|<Location\b|<UTCTiming\b|\b(?:sourceURL|media|initialization|(?:xlink:)?href)\s*=/i.test(manifest)) {
    throw Object.assign(new Error('Unsupported stream transport'), { code: 'NO_STREAM' });
  }
  const urls = [...manifest.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map(match => decodeManifestUrl(match[1]));
  if (!urls.length || urls.some(url => !isMediaUrl(url))) throw Object.assign(new Error('Unsupported stream transport'), { code: 'NO_STREAM' });
  return urls;
}

function boundExpiry(source, url, now) {
  if (!isMediaUrl(url)) throw Object.assign(new Error('Unsupported stream transport'), { code: 'NO_STREAM' });
  const parsed = new URL(url);
  const expiry = parsed.searchParams.get('expire') || /\/expire\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1];
  if (expiry && /^\d+$/.test(expiry) && Number.isFinite(Number(expiry) * 1000)) {
    if (Number(expiry) * 1000 <= now) throw Object.assign(new Error('Expired stream'), { code: 'NO_STREAM' });
    source.expires = Math.min(source.expires, Number(expiry) * 1000 - 30000);
  }
}

class YouTubeService {
  constructor({ fetchImpl = fetch, getCookie = async () => '', evaluate, createClient, onDiagnostic = () => {}, now = Date.now,
    attemptMs = 10000, totalMs = 45000, mediaMs = MEDIA_TIMEOUT_MS, onMediaRequest = () => {} } = {}) {
    Object.assign(this, { fetchImpl, getCookie, evaluate, onDiagnostic, onMediaRequest, now, attemptMs, totalMs, mediaMs });
    this.createClient = createClient || ((options) => this.createInnertube(options));
    this.clients = new Map();
    this.cache = new Map();
    this.inFlight = new Map();
    this.epochs = new Map();
    this.order = [...CLIENTS];
    this.routes = new Map();
    this.routeKeys = new Map();
    this.requests = new Map();
    this.deferred = new Map();
    this.solutions = new Map();
    this.resolutionController = new AbortController();
    this.disposed = false;
    this.visitor = null;
    this.iosVisitor = '';
  }

  // Anonymous visitor ID from YouTube's own endpoint, shared by this tab's
  // direct clients for six hours. A failure falls back to YouTube.js's local one.
  visitorData(request, webVersion) {
    if (this.visitor?.expires > this.now()) return this.visitor.value;
    const pending = (async () => {
      const response = await request('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
        method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Origin: 'https://www.youtube.com' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: webVersion, hl: 'en', gl: 'US' } } })
      });
      if (!response.ok) throw new Error('Visitor request failed');
      const value = (await response.json())?.responseContext?.visitorData;
      if (!validVisitor(value)) throw new Error('Invalid visitor data');
      return value;
    })().then(value => {
      if (this.visitor?.value === pending) this.visitor = { value, expires: this.now() + VISITOR_TTL_MS };
      return value;
    }, () => {
      if (this.visitor?.value === pending) this.visitor = null;
      return '';
    });
    this.visitor = { value: pending, expires: Infinity };
    return pending;
  }

  diagnose(stage, fields) {
    try { this.onDiagnostic({ stage, ...fields }); } catch { /* Diagnostics cannot interrupt playback. */ }
  }

  noteMediaRejected(source) {
    if (!source.identity) return;
    for (const [key, until] of this.deferred) if (until <= this.now()) this.deferred.delete(key);
    this.deferred.set(`${source.identity}:${source.videoId}:${source.client}`, this.now() + 30000);
    while (this.deferred.size > 64) this.deferred.delete(this.deferred.keys().next().value);
  }

  evaluateScript(output) {
    // YouTube.js can decipher dozens of representations concurrently. Litube
    // batches/caches equal challenges instead of recompiling for every itag.
    if (typeof output !== 'string' || output.length > 8 * 1024 * 1024) return Promise.reject(new Error('Invalid player solver'));
    if (typeof this.evaluate !== 'function') return Promise.reject(Object.assign(new Error('Player solver unavailable'), { code: 'SOLVER_UNAVAILABLE' }));
    const key = createHash('sha256').update(output).digest('hex');
    if (this.solutions.has(key)) return this.solutions.get(key);
    const pending = Promise.resolve().then(() => this.evaluate(output)).then(result => {
      if (!result || typeof result !== 'object' || ![result.sig, result.n].some(value => typeof value === 'string' && value.length > 0) ||
        [result.sig, result.n].some(value => typeof value === 'string' && /^(?:enhanced_except_|_w8_)/.test(value))) {
        throw Object.assign(new Error('Player challenge failed'), { code: 'SOLVER_FAILED' });
      }
      return result;
    }).catch(error => {
      if (this.solutions.get(key) === pending) this.solutions.delete(key);
      throw error;
    });
    this.solutions.set(key, pending);
    while (this.solutions.size > 128) this.solutions.delete(this.solutions.keys().next().value);
    return pending;
  }

  async createInnertube({ client, cookie }) {
    const signal = this.resolutionController.signal;
    const { Innertube, Platform, Player, Constants, YT, Utils } = await import('youtubei.js');
    const userAgent = client === 'WEB_SAFARI' ? SAFARI_USER_AGENT : Constants.CLIENTS[client]?.USER_AGENT;
    // Execute the extracted solver only in a separate, sandboxed Chromium page.
    // YouTube code must never be evaluated in Electron's privileged main process.
    Platform.shim.eval = data => this.evaluateScript(data.output);
    const request = (input, init = {}) => {
      // A request made without a visitor must not announce an empty one.
      if (typeof init.headers?.get === 'function' && init.headers.get('x-goog-visitor-id') === '') init.headers.delete('x-goog-visitor-id');
      return this.fetchImpl(input, {
        ...init, signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : []), AbortSignal.timeout(this.attemptMs)])
      });
    };
    const visitor = SERVER_VISITOR_CLIENTS.has(client) ? await this.visitorData(request, Constants.CLIENTS.WEB.VERSION) : '';
    signal.throwIfAborted();
    const api = await Innertube.create({
      fetch: request, cookie: DIRECT_CLIENTS.has(client) ? undefined : cookie || undefined,
      retrieve_player: false, retrieve_innertube_config: false,
      generate_session_locally: true, enable_session_cache: false, lang: 'en', location: 'US',
      ...(visitor ? { visitor_data: visitor } : {}),
      ...(userAgent ? { user_agent: userAgent } : {})
    });
    if (client === 'WEB_SAFARI') Object.assign(api.session.context.client, {
      browserName: 'Safari', browserVersion: '15.5', osName: 'Macintosh', osVersion: '10.15.7'
    });
    let playerTask;
    const preparePlayer = async () => {
      playerTask ||= Player.create(undefined, request).catch(error => { playerTask = null; throw error; });
      api.session.player = await playerTask;
      return api.session.player;
    };
    return {
      userAgent: userAgent || api.session.context.client.userAgent,
      getInfo: async (videoId) => {
        if (!DIRECT_CLIENTS.has(client)) {
          await preparePlayer();
        }
        // Keep the raw answer's readiness estimate, which YouTube.js omits from
        // VideoInfo. Use the same player payload and parser as getBasicInfo().
        const player = () => api.actions.execute('/player', {
          videoId, client: client === 'WEB_SAFARI' ? 'WEB' : client, racyCheckOk: true, contentCheckOk: true,
          playbackContext: { contentPlaybackContext: {
            vis: 0, splay: false, lactMilliseconds: '-1',
            signatureTimestamp: api.session.player?.signature_timestamp
          } },
          ...(api.session.po_token ? { serviceIntegrityDimensions: { poToken: api.session.po_token } } : {})
        });
        let response;
        if (client === 'IOS') {
          // iOS leaves the HLS manifest out for visitors in YouTube's SABR-only
          // experiment. Alternate a visitor that worked before with fresh
          // server-assigned ones, and keep the first fresh one that works.
          for (let attempt = 0; attempt < IOS_VISITOR_ATTEMPTS; attempt++) {
            const kept = this.iosVisitor;
            const visitor = attempt % 2 === 0 ? kept : '';
            if (visitor) api.session.context.client.visitorData = visitor;
            else delete api.session.context.client.visitorData;
            response = await player();
            const answer = response.data;
            if (answer?.streamingData?.hlsManifestUrl) {
              const assigned = answer.responseContext?.visitorData;
              if (!visitor && validVisitor(assigned)) this.iosVisitor = assigned;
              break;
            }
            if (kept && visitor === kept && attempt >= 2) this.iosVisitor = '';
            if (answer?.playabilityStatus?.status !== 'OK') break;
          }
        } else {
          response = await player();
        }
        const availableAt = mediaAvailableAt(response.data, this.now());
        const info = new YT.VideoInfo([response], api.actions, Utils.generateRandomString(16));
        info.mediaAvailableAt = availableAt;
        // A direct client normally avoids the web solver. If its URLs contain
        // n/signature challenges, solve those before exposing any media URL.
        // HLS-only clients never expose their adaptive URLs, so skip them.
        const formats = HLS_ONLY_CLIENTS.has(client) ? []
          : [...(info.streaming_data?.adaptive_formats || []), ...(info.streaming_data?.formats || [])];
        if (formats.some((format) => format.signature_cipher || format.cipher ||
          (format.url && new URL(format.url).searchParams.has('n')))) {
          await preparePlayer();
        }
        // Litube's PlayerChallenges.kt also solves the VOD HLS manifest's
        // path-bound n value. Returning that URL unchanged yields a refused
        // manifest even when no adaptive format needed the solver.
        const hls = info.streaming_data?.hls_manifest_url;
        const throttle = !info.basic_info?.is_live && hls && /\/n\/([^/?#]+)/.exec(hls);
        if (throttle) {
          const player = await preparePlayer();
          const input = decodeURIComponent(throttle[1]);
          const probe = new URL('https://ytjs.googlevideo.com/videoplayback');
          probe.searchParams.set('n', input);
          const solved = new URL(await player.decipher(probe.href)).searchParams.get('n');
          if (!solved || solved.startsWith('enhanced_except_') || solved.startsWith('_w8_')) throw new Error('Manifest challenge failed');
          const start = throttle.index + 3;
          info.streaming_data.hls_manifest_url = hls.slice(0, start) + encodeURIComponent(solved) + hls.slice(start + throttle[1].length);
        }
        return info;
      }
    };
  }

  async resolve(videoId, { fresh = false, rejectedClient } = {}) {
    if (this.disposed) throw new Error('YouTube service is disposed');
    if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('Invalid YouTube video');
    if (rejectedClient && !CLIENTS.includes(rejectedClient)) throw new Error('Invalid playback client');
    const signal = this.resolutionController.signal;
    const started = this.now();
    let cookie;
    try {
      cookie = await deadline(abortable(this.getCookie(), signal), this.totalMs);
    } catch (error) {
      if (!signal.aborted) this.diagnose('resolve_failed', { phase: 'identity', code: error.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED' });
      throw error;
    }
    signal.throwIfAborted();
    const identity = cookieIdentity(cookie);
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
    const remainingMs = Math.max(1, this.totalMs - (this.now() - started));
    const task = this.load(videoId, cookie, identity, rejectedClient, signal, remainingMs).then((value) => {
      signal.throwIfAborted();
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

  async load(videoId, cookie, identity, rejectedClient, signal = this.resolutionController.signal, totalMs = this.totalMs) {
    const until = this.now() + totalMs;
    const attempts = [];
    const deferred = client => client === rejectedClient || (this.deferred.get(`${identity}:${videoId}:${client}`) || 0) > this.now();
    // Litube defers a refused client to the end for this video/identity. It
    // remains eligible when every other route fails; a timeout does not blame it.
    const order = [...this.order.filter(client => !deferred(client)), ...this.order.filter(deferred)];
    let verificationRequired = false;
    for (const client of order) {
      signal.throwIfAborted();
      const remaining = until - this.now();
      if (remaining <= 0) break;
      const started = this.now();
      let phase = 'client';
      try {
        const value = await deadline(abortable((async () => {
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
          signal.throwIfAborted();
          phase = 'player';
          const info = await api.getInfo(videoId);
          signal.throwIfAborted();
          const stream = info.streaming_data;
          const status = info.playability_status?.status;
          if (status !== 'OK' || !stream) {
            const bot = /not a bot|unusual traffic/i.test(String(info.playability_status?.reason || ''));
            throw Object.assign(new Error('Client returned no playable stream'), {
              code: bot ? 'VERIFICATION_REQUIRED' : FAILURE_CODES.has(status) ? status : 'NO_STREAM'
            });
          }
          const source = { videoId, client, identity, userAgent: api.userAgent, title: info.basic_info?.title || 'YouTube',
            live: !!info.basic_info?.is_live, expires: this.now() + 120000,
            availableAt: info.mediaAvailableAt || 0 };
          if (Number.isFinite(Number(stream.expires))) source.expires = Math.min(source.expires, Number(stream.expires) - 30000);
          phase = 'manifest';
          const hlsSource = () => {
            boundExpiry(source, stream.hls_manifest_url, this.now());
            return { ...source, kind: 'hls', url: stream.hls_manifest_url };
          };
          if ((source.live || client === 'WEB_SAFARI' || HLS_ONLY_CLIENTS.has(client)) && isMediaUrl(stream.hls_manifest_url)) return hlsSource();
          if (HLS_ONLY_CLIENTS.has(client)) throw Object.assign(new Error('Client offered no HLS manifest'), { code: 'NO_STREAM' });
          // DASH keeps the complete audio/video pool for adaptive selection. SABR,
          // DRM, and OTF formats are not sources this player can consume.
          const formats = (stream.adaptive_formats || []).filter(usableFormat);
          if (!source.live && formats.some((f) => f.has_audio) && formats.some((f) => f.has_video)) {
            const manifest = await info.toDash({ format_filter: (format) => !usableFormat(format),
              url_transformer: url => { boundExpiry(source, url.toString(), this.now()); return url; } });
            for (const url of dashUrls(manifest)) boundExpiry(source, url, this.now());
            return { ...source, kind: 'dash', manifest };
          }
          if (stream.hls_manifest_url) return hlsSource();
          throw Object.assign(new Error('No DASH or HLS streams'), { code: 'NO_STREAM' });
        })(), signal), Math.min(this.attemptMs, remaining));
        signal.throwIfAborted();
        value.attempts = [...attempts, client];
        this.diagnose('source_selected', { client, kind: value.kind, durationMs: this.now() - started });
        return value;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        // No URLs, tokens, cookies, or server response bodies enter diagnostics.
        const code = FAILURE_CODES.has(error.code) ? error.code : 'FAILED';
        verificationRequired ||= code === 'VERIFICATION_REQUIRED';
        this.diagnose('client_failed', { client, phase, code, durationMs: this.now() - started });
        attempts.push(client);
      }
    }
    throw Object.assign(new Error('YouTube stream loading failed. Try again or use the YouTube player.'), {
      code: verificationRequired ? 'VERIFICATION_REQUIRED' : 'STREAM_UNAVAILABLE'
    });
  }

  notePlaying(source) {
    if (source.attempts?.length > 1) this.order = [source.client, ...this.order.filter((client) => client !== source.client)];
  }

  registerUrl(url, source) {
    if (!isMediaUrl(url)) throw new Error('Invalid YouTube media host');
    let urls = this.routeKeys.get(source);
    if (!urls) this.routeKeys.set(source, urls = new Map());
    if (urls.has(url)) return urls.get(url);
    const uri = `shiira-youtube://media/${randomUUID()}`;
    this.routes.set(uri, { url, source });
    urls.set(url, uri);
    // Bound long-running live streams without discarding their manifest URL.
    if (this.routes.size > 4096) {
      for (const [oldUri, old] of this.routes) {
        if (!old.manifest) {
          this.routes.delete(oldUri);
          const oldUrls = this.routeKeys.get(old.source);
          oldUrls.delete(old.url);
          if (!oldUrls.size) this.routeKeys.delete(old.source);
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
        const url = decodeManifestUrl(escaped);
        return `<BaseURL>${this.registerUrl(url, source)}</BaseURL>`;
      });
      this.routes.set(uri, { manifest, source });
    } else {
      uri = this.registerUrl(source.url, source);
      this.routes.get(uri).manifest = true;
    }
    return { videoId: source.videoId, client: source.client, title: source.title, live: source.live, uri,
      availableAt: source.availableAt,
      mimeType: source.kind === 'dash' ? 'application/dash+xml' : 'application/x-mpegurl' };
  }

  async media({ uri, range, requestId }) {
    const route = this.routes.get(uri);
    if (!route || typeof requestId !== 'string' || requestId.length > 100 || this.requests.has(requestId) ||
      (range != null && !validRange(range, route.source.kind === 'dash'))) throw new Error('Invalid media request');
    if (typeof route.manifest === 'string') {
      return { data: new TextEncoder().encode(route.manifest), headers: { 'content-type': 'application/dash+xml' }, uri };
    }
    if (this.requests.size >= 16) throw new Error('Too many media requests');
    const controller = new AbortController();
    const readinessWait = Math.max(0, Math.min(MAX_MEDIA_WAIT_MS, (route.source.availableAt || 0) - this.now()));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, readinessWait + this.mediaMs);
    this.requests.set(requestId, controller);
    let method = route.usePost ? 'POST' : 'GET';
    let reported = false;
    const requestStarted = this.now();
    const httpAttempts = [];
    let status = 0, bytes = 0, outcome = 'failed';
    try {
      const headers = { 'User-Agent': route.source.userAgent, Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/' };
      const mediaUrl = new URL(route.url);
      const queryRange = route.source.kind === 'dash' && range && /^bytes=\d+-\d+$/.test(range);
      if (queryRange) mediaUrl.searchParams.set('range', range.slice(6));
      else if (range) headers.Range = range;
      let target = mediaUrl.href;
      let response;
      let redirects = 0;
      let readinessRetries = 0;
      while (true) {
        controller.signal.throwIfAborted();
        if (!isMediaUrl(target)) throw Object.assign(new Error('Invalid media redirect'), { code: 'INVALID_REDIRECT' });
        const attemptStarted = this.now();
        response = await this.fetchImpl(target, { method, body: method === 'POST' ? new Uint8Array([0x78, 0]) : undefined,
          headers, signal: controller.signal, credentials: 'omit', redirect: 'manual' });
        status = response.status;
        httpAttempts.push({ method, status, headersMs: Math.max(0, this.now() - attemptStarted) });
        controller.signal.throwIfAborted();
        const remaining = (route.source.availableAt || 0) - this.now();
        if (response.status === 403 && remaining > 0 && readinessRetries < 2) {
          await response.body?.cancel();
          // Litube probes once quickly, then waits out the pre-roll estimate.
          // Keep this media handle, byte range and client throughout the hold.
          const waitMs = readinessRetries++ === 0 ? Math.min(600, remaining) : remaining;
          this.diagnose('media_wait', { client: route.source.client, waitMs, attempt: readinessRetries });
          await timers.setTimeout(waitMs, undefined, { signal: controller.signal });
          continue;
        }
        if (response.status === 403 && method === 'GET' && route.source.kind === 'dash' &&
          new URL(target).pathname === '/videoplayback') {
          await response.body?.cancel();
          method = 'POST';
          continue;
        }
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        const location = response.headers.get('location');
        try {
          if (!location) throw new Error('Missing location');
          target = new URL(location, target).href;
        } catch { throw Object.assign(new Error('Invalid media redirect'), { code: 'INVALID_REDIRECT' }); }
        if (queryRange) {
          const redirected = new URL(target);
          redirected.searchParams.set('range', range.slice(6));
          target = redirected.href;
        }
        if (++redirects > 3) throw Object.assign(new Error('Too many media redirects'), { code: 'INVALID_REDIRECT' });
      }
      if (!response.ok) {
        if (response.status === 403 || (route.manifest && [404, 410].includes(response.status))) this.noteMediaRejected(route.source);
        this.diagnose('media_failed', { client: route.source.client, status: response.status, method });
        reported = true;
        await response.body?.cancel();
        throw new Error(`YouTube media HTTP ${response.status}`);
      }
      const type = response.headers.get('content-type') || '';
      let contentType = type;
      if (/text\/html|application\/(?:[^;]+\+)?json/i.test(type) || !response.body) {
        this.noteMediaRejected(route.source);
        this.diagnose('media_failed', { client: route.source.client, code: 'INVALID_BODY', method });
        reported = true;
        await response.body?.cancel(); throw new Error('Invalid YouTube media response');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        bytes = size;
        if (size > 32 * 1024 * 1024) { await reader.cancel(); throw Object.assign(new Error('YouTube media chunk too large'), { code: 'TOO_LARGE' }); }
        chunks.push(value);
      }
      let data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      if (/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(new TextDecoder().decode(data.subarray(0, 256)))) {
        this.noteMediaRejected(route.source);
        throw Object.assign(new Error('Invalid YouTube media response'), { code: 'INVALID_BODY' });
      }
      if (/mpegurl/i.test(type) || new TextDecoder().decode(data.subarray(0, 7)) === '#EXTM3U') {
        const playlist = new TextDecoder().decode(data).split('\n').map((line) => {
          if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, value) =>
            `URI="${this.registerUrl(new URL(value, target).href, route.source)}"`);
          return line.trim() ? this.registerUrl(new URL(line.trim(), target).href, route.source) : line;
        }).join('\n');
        data = new TextEncoder().encode(playlist);
      } else if (route.source.kind === 'hls') {
        contentType = hlsSegmentType(data) || type;
      }
      controller.signal.throwIfAborted();
      if (method === 'POST') route.usePost = true;
      bytes = size;
      outcome = 'completed';
      return { data, headers: { 'content-type': contentType }, uri };
    } catch (error) {
      if (controller.signal.aborted && !timedOut) outcome = 'cancelled';
      if (!reported && (!controller.signal.aborted || timedOut)) {
        const code = timedOut ? 'TIMEOUT' : ['INVALID_REDIRECT', 'INVALID_BODY', 'TOO_LARGE'].includes(error.code) ? error.code : 'FAILED';
        this.diagnose('media_failed', { client: route.source.client, code, method });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.requests.get(requestId) === controller) this.requests.delete(requestId);
      try {
        const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(range || '');
        const itag = new URL(route.url).searchParams.get('itag');
        this.onMediaRequest({ source: route.source, outcome, status, bytes, method, httpAttempts, protocol: route.source.kind,
          durationMs: Math.max(0, this.now() - requestStarted),
          ...(itag && /^\d+$/.test(itag) ? { itag: Number(itag) } : {}),
          ...(rangeMatch ? { rangeStart: Number(rangeMatch[1]), ...(rangeMatch[2] ? { rangeEnd: Number(rangeMatch[2]) } : {}) } : {}) });
      } catch { /* Local analytics cannot affect media delivery. */ }
    }
  }

  cancel(requestId) { this.requests.get(requestId)?.abort(); }
  cancelResolutions() {
    this.resolutionController.abort();
    this.resolutionController = new AbortController();
    this.inFlight.clear();
    // Cached API instances bind their transport to the departing lifecycle.
    this.clients.clear();
  }
  clearMedia() {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.routes.clear();
    this.routeKeys.clear();
  }
  dispose() {
    this.disposed = true;
    this.cancelResolutions();
    this.clearMedia();
    this.cache.clear();
    this.clients.clear();
    this.epochs.clear();
    this.deferred.clear();
    this.solutions.clear();
    this.visitor = null;
    this.iosVisitor = '';
  }
}

module.exports = { YouTubeService, CLIENTS, deadline };
