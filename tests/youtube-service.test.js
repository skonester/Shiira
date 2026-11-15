const test = require('node:test');
const assert = require('node:assert/strict');
const { YouTubeService, CLIENTS } = require('../src/main/youtube-service');
const { videoIdFromUrl, playbackVideoIdFromUrl, isYouTubeShortsUrl, startSeconds, isYouTubePlaybackRequest } = require('../src/shared/youtube');

const ID = 'jNQXAC9IVRw';
const URL = 'https://rr1.googlevideo.com/videoplayback?expire=9999999999&id=test';
const format = (has_audio) => ({ has_audio, has_video: !has_audio, url: URL, init_range: { start: 0, end: 99 }, index_range: { start: 100, end: 199 } });
function playable(overrides = {}) {
  return { basic_info: { title: 'Fixture video' }, playability_status: { status: 'OK' },
    streaming_data: { adaptive_formats: [format(true), format(false)] },
    toDash: async () => `<MPD><BaseURL>${URL.replaceAll('&', '&amp;')}</BaseURL></MPD>`, ...overrides };
}
function service(options = {}) {
  return new YouTubeService({ createClient: async () => ({ userAgent: 'fixture-client', getInfo: async () => playable() }), ...options });
}

test('local media analytics retains exact range, HTTP status, elapsed time and final method without transport URLs', async () => {
  let now = 1000;
  const records = [];
  const api = service({ now: () => now, onMediaRequest: record => records.push(record), fetchImpl: async (_url, options) => {
    now += 25;
    return options.method === 'GET' ? new Response('', { status: 403 }) : new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4' } });
  } });
  const source = { videoId: ID, client: 'IOS', kind: 'dash', userAgent: 'test' };
  const uri = api.registerUrl('https://rr1.googlevideo.com/videoplayback?itag=140&signature=secret', source);
  await api.media({ uri, range: 'bytes=20-22', requestId: 'request' });
  const { source: retained, ...record } = records[0];
  assert.equal(retained, source);
  assert.deepEqual(record, { outcome: 'completed', status: 206, bytes: 3, method: 'POST', protocol: 'dash',
    durationMs: 50, itag: 140, rangeStart: 20, rangeEnd: 22,
    httpAttempts: [{ method: 'GET', status: 403, headersMs: 25 }, { method: 'POST', status: 206, headersMs: 25 }] });
  assert.ok(!JSON.stringify(record).includes('secret'));
  api.fetchImpl = async () => { now += 10; return new Response('', { status: 403 }); };
  await assert.rejects(api.media({ uri, range: 'bytes=23-25', requestId: 'failed' }), /HTTP 403/);
  assert.equal(records[1].status, 403);
  assert.equal(records[1].outcome, 'failed');
  assert.equal(records[1].method, 'POST');
});

test('YouTube URLs are host-scoped and preserve watch, short, live, embed and timestamp links', () => {
  for (const path of [`/watch?v=${ID}`, `/shorts/${ID}`, `/live/${ID}`, `/embed/${ID}`]) {
    assert.equal(videoIdFromUrl(`https://www.youtube.com${path}`), ID);
  }
  assert.equal(videoIdFromUrl(`https://youtu.be/${ID}?t=10`), ID);
  for (const url of [`https://youtube.com.evil.test/watch?v=${ID}`, `https://evil.test/?v=${ID}`, 'https://youtube.com/watch?v=x', 'http://youtube.com/watch?v=jNQXAC9IVRw']) {
    assert.equal(videoIdFromUrl(url), null);
  }
  assert.equal(startSeconds(`https://youtu.be/${ID}?t=1h2m3s`), 3723);
  assert.equal(startSeconds(`https://youtu.be/${ID}#t=12`), 12);
  assert.equal(startSeconds(`https://youtu.be/${ID}?t=-9`), 0);
  assert.equal(isYouTubePlaybackRequest({ url: URL }), true);
  assert.equal(isYouTubePlaybackRequest({ url: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false' }), true);
  assert.equal(isYouTubePlaybackRequest({ url: 'https://www.youtube.com/api/stats/ads' }), false);
  assert.equal(isYouTubePlaybackRequest({ url: 'https://googlevideo.com.evil.test/video' }), false);
});

test('Shorts defaults to native playback while ordinary video URLs remain eligible', () => {
  for (const url of [
    `https://www.youtube.com/shorts/${ID}`, `https://m.youtube.com/shorts/${ID}?feature=share`,
    'https://youtube.com/shorts', 'https://youtube.com/shorts/'
  ]) {
    assert.equal(isYouTubeShortsUrl(url), true, url);
    assert.equal(playbackVideoIdFromUrl(url), null, url);
  }
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtu.be/${ID}`,
    `https://www.youtube.com/live/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`
  ]) {
    assert.equal(isYouTubeShortsUrl(url), false, url);
    assert.equal(playbackVideoIdFromUrl(url), ID, url);
  }
  for (const url of ['https://youtube.com.evil.test/shorts/test', 'https://example.com/shorts/test', 'https://youtube.com/shortstuff', 'not a URL']) {
    assert.equal(isYouTubeShortsUrl(url), false, url);
  }
});

test('starts with Litube VisionOS route, shares in-flight work and uses a bounded stream cache', async () => {
  const calls = [];
  let now = 0;
  const api = service({ now: () => now, createClient: async ({ client }) => ({ getInfo: async () => {
    calls.push(client); await new Promise(resolve => setTimeout(resolve, 5)); return playable();
  } }) });
  const [a, b] = await Promise.all([api.resolve(ID), api.resolve(ID)]);
  assert.equal(a, b);
  assert.deepEqual(calls, ['VISIONOS']);
  await api.resolve(ID);
  assert.equal(calls.length, 1);
  now = 120001;
  await api.resolve(ID);
  assert.equal(calls.length, 2);
});

test('fallback rejects SABR-only and unplayable clients, promotes a client only after playback', async () => {
  const calls = [];
  const api = service({ createClient: async ({ client }) => ({ getInfo: async () => {
    calls.push(client);
    if (client === 'VISIONOS') return playable({ playability_status: { status: 'LOGIN_REQUIRED' } });
    if (client === 'WEB') return playable({ streaming_data: { adaptive_formats: [], server_abr_streaming_url: 'sabr://' } });
    return playable();
  } }) });
  const source = await api.resolve(ID);
  assert.equal(source.client, 'WEB_EMBEDDED');
  assert.deepEqual(calls, ['VISIONOS', 'WEB', 'WEB_EMBEDDED']);
  assert.equal(api.order[0], 'VISIONOS');
  api.notePlaying(source);
  assert.equal(api.order[0], 'WEB_EMBEDDED');
  const recovered = await api.resolve(ID, { fresh: true, rejectedClient: 'WEB_EMBEDDED' });
  assert.equal(recovered.client, 'WEB_SAFARI');
});

test('a stale shared resolution cannot overwrite a fresh recovery or another account identity', async () => {
  let release;
  let cookie = 'SID=account-a';
  let calls = 0;
  const api = service({ getCookie: async () => cookie, createClient: async () => ({ getInfo: async () => {
    const call = ++calls;
    if (call === 1) await new Promise(resolve => { release = resolve; });
    return playable({ basic_info: { title: String(call) } });
  } }) });
  const stale = api.resolve(ID);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const fresh = await api.resolve(ID, { fresh: true });
  release();
  await stale;
  assert.equal((await api.resolve(ID)).title, fresh.title);
  cookie = 'SID=account-b';
  assert.equal((await api.resolve(ID)).title, '3');
});

test('media refusal defers the exact client for thirty seconds without excluding it or blaming network errors', async () => {
  let now = 1000;
  let status = 403;
  const calls = [];
  let onlyVisionWorks = false;
  const api = service({ now: () => now, createClient: async ({ client }) => ({ getInfo: async () => {
    calls.push(client);
    if (onlyVisionWorks && client !== 'VISIONOS') throw new Error('No source');
    return playable();
  } }), fetchImpl: async () => new Response('', { status }) });
  const source = await api.resolve(ID);
  const uri = api.registerUrl(URL, source);
  await assert.rejects(api.media({ uri, requestId: 'refused' }), /HTTP 403/);
  calls.length = 0;
  assert.equal((await api.resolve(ID, { fresh: true })).client, 'WEB');
  assert.equal(calls[0], 'WEB');
  onlyVisionWorks = true;
  calls.length = 0;
  assert.equal((await api.resolve(ID, { fresh: true })).client, 'VISIONOS');
  assert.equal(calls.at(-1), 'VISIONOS', 'a deferred route remains the final available source');
  now += 30001;
  calls.length = 0;
  await api.resolve(ID, { fresh: true });
  assert.equal(calls[0], 'VISIONOS');
  status = 500;
  await assert.rejects(api.media({ uri, requestId: 'server-failure' }), /HTTP 500/);
  calls.length = 0;
  await api.resolve(ID, { fresh: true });
  assert.equal(calls[0], 'VISIONOS', 'a server/transport failure does not defer the client');
});

test('resolution diagnostics identify the failed phase without leaking URLs, cookies or server messages', async () => {
  const diagnostics = [];
  const api = service({ onDiagnostic: event => diagnostics.push(event), createClient: async ({ client }) => ({ getInfo: async () => {
    if (client === 'VISIONOS') return playable({ playability_status: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' } });
    throw Object.assign(new Error('secret-cookie and https://example.com/signed?token=secret'), { code: 'SECRET_CREDENTIAL' });
  } }) });
  await assert.rejects(api.resolve(ID), { code: 'VERIFICATION_REQUIRED' });
  assert.equal(diagnostics.length, CLIENTS.length);
  assert.equal(diagnostics[0].code, 'VERIFICATION_REQUIRED');
  assert.equal(diagnostics[1].phase, 'player');
  assert.equal(diagnostics[1].code, 'FAILED');
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|credential|https/i);
});

test('consent cookie churn cannot erase current media-refusal feedback, while account changes remain isolated', async () => {
  let cookie = 'SID=account-a; CONSENT=before';
  const api = service({ getCookie: async () => cookie,
    fetchImpl: async () => new Response('', { status: 403 }) });
  const source = await api.resolve(ID);
  const uri = api.registerUrl(URL, source);
  await assert.rejects(api.media({ uri, requestId: 'first-account' }), /HTTP 403/);
  cookie = 'YSC=rotated; CONSENT=after; SID=account-a';
  assert.equal((await api.resolve(ID, { fresh: true })).client, 'WEB');
  cookie = 'SID=account-b; CONSENT=after';
  assert.equal((await api.resolve(ID, { fresh: true })).client, 'VISIONOS');
});

test('a hanging client has a deadline and failures do not poison the cache', async () => {
  let works = false;
  const api = service({ attemptMs: 10, totalMs: 500, createClient: async ({ client }) => ({ getInfo: async () => {
    if (works) return playable();
    if (client === 'VISIONOS') return new Promise(() => {});
    throw new Error('sensitive response data');
  } }) });
  await assert.rejects(api.resolve(ID), /Try again or use the YouTube player/);
  assert.equal(api.cache.size, 0);
  works = true;
  assert.equal((await api.resolve(ID)).client, 'VISIONOS');
});

test('navigation and disposal cancel extraction immediately and late results cannot populate caches', async () => {
  let complete;
  const api = service({ createClient: async () => ({ getInfo: () => new Promise(resolve => { complete = resolve; }) }) });
  const pending = api.resolve(ID);
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  api.cancelResolutions();
  await rejected;
  complete(playable());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.cache.size, 0);
  assert.equal(api.inFlight.size, 0);
  api.dispose();
  await assert.rejects(api.resolve(ID), /disposed/);
});

test('the total resolution deadline also bounds identity retrieval and preserves its diagnostic phase', async () => {
  const diagnostics = [];
  const api = service({ totalMs: 10, getCookie: () => new Promise(() => {}), onDiagnostic: event => diagnostics.push(event) });
  await assert.rejects(api.resolve(ID), { code: 'TIMEOUT' });
  assert.deepEqual(diagnostics, [{ stage: 'resolve_failed', phase: 'identity', code: 'TIMEOUT' }]);
});

test('concurrent equal n/signature challenges share isolated evaluation and failed solves remain retryable', async () => {
  let solves = 0;
  let broken = false;
  const api = service({ evaluate: async () => {
    solves++;
    await new Promise(resolve => setImmediate(resolve));
    return broken ? { n: 'enhanced_except_invalid' } : { n: 'solved', sig: 'signature' };
  } });
  const code = 'known solver source and bound arguments';
  const results = await Promise.all(Array.from({ length: 48 }, () => api.evaluateScript(code)));
  assert.equal(solves, 1, 'all representations sharing the challenge must join one evaluation');
  assert.ok(results.every(result => result.n === 'solved'));
  await api.evaluateScript(code);
  assert.equal(solves, 1);
  await api.evaluateScript('new script revision or arguments');
  assert.equal(solves, 2);
  broken = true;
  await assert.rejects(api.evaluateScript('retryable solve'), { code: 'SOLVER_FAILED' });
  broken = false;
  await api.evaluateScript('retryable solve');
  assert.equal(solves, 4);
  api.dispose();
  assert.equal(api.solutions.size, 0);
});

test('signed media expiry shortens the stream cache lifetime', async () => {
  let now = 0;
  let calls = 0;
  const api = service({ now: () => now, createClient: async () => ({ getInfo: async () => {
    calls++;
    const info = playable();
    info.streaming_data.expires = new Date(now + 40000);
    return info;
  } }) });
  await api.resolve(ID);
  now = 11000;
  await api.resolve(ID);
  assert.equal(calls, 2);
});

test('signed DASH and HLS URL expiry bounds caching even when expiresInSeconds is missing', async () => {
  for (const kind of ['dash', 'hls']) {
    let now = 100000;
    let calls = 0;
    const api = service({ now: () => now, createClient: async () => ({ getInfo: async () => {
      calls++;
      const expiry = (now + 40000) / 1000;
      const signed = `https://rr1.googlevideo.com/videoplayback?expire=${expiry}&id=secret`;
      return kind === 'dash' ? playable({ toDash: async () => `<MPD><BaseURL>${signed.replaceAll('&', '&amp;')}</BaseURL></MPD>` })
        : playable({ streaming_data: { hls_manifest_url: `https://manifest.googlevideo.com/api/manifest/hls/expire/${expiry}/index.m3u8` } });
    } }) });
    assert.ok((await api.resolve(ID)).expires <= 140000);
    now = 141000;
    await api.resolve(ID);
    assert.equal(calls, 2);
  }
});

test('malformed formats are filtered before manifest generation and all valid ABR tracks remain', async () => {
  const good = [format(true), format(false), { ...format(false), bitrate: 500000 }];
  const bad = [
    { ...format(false), url: 'sabr://stream' }, { ...format(false), url: 'https://evil.test/video' },
    { ...format(false), init_range: { start: 100, end: 0 } },
    { ...format(false), index_range: { start: NaN, end: 10 } },
    { ...format(false), drm_families: ['WIDEVINE'] }, { ...format(false), is_type_otf: true }
  ];
  const api = service({ createClient: async () => ({ getInfo: async () => playable({
    streaming_data: { adaptive_formats: [...good, ...bad] }, toDash: async ({ format_filter }) => {
      assert.deepEqual([...good, ...bad].filter(value => !format_filter(value)), good);
      return `<MPD><BaseURL>${URL.replaceAll('&', '&amp;')}</BaseURL></MPD>`;
    }
  }) }) });
  assert.equal((await api.resolve(ID)).client, 'VISIONOS');
});

test('unsupported DASH and HLS transports fail at the manifest phase before they are cached', async () => {
  for (const streaming_data of [
    { hls_manifest_url: 'http://localhost/secret' },
    { hls_manifest_url: 'sabr://stream' },
    { adaptive_formats: [format(true), format(false)] }
  ]) {
    const diagnostics = [];
    const api = service({ onDiagnostic: event => diagnostics.push(event), createClient: async ({ client }) => ({ getInfo: async () => {
      if (client !== 'VISIONOS') return playable();
      return playable({ streaming_data, toDash: async () => '<MPD><BaseURL>https://evil.test/secret</BaseURL></MPD>' });
    } }) });
    assert.equal((await api.resolve(ID)).client, 'WEB');
    assert.equal(diagnostics[0].phase, 'manifest');
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret|localhost|sabr|evil/);
  }
});

test('adaptive ranges remain bounded and redirects cannot override the requested bytes', async () => {
  const calls = [];
  const api = service({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response('', { status: 302, headers: {
      location: 'https://rr2.googlevideo.com/videoplayback?range=99-100'
    } }) : new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
  } });
  const uri = api.registerUrl(URL, await api.resolve(ID));
  for (const range of ['bytes=1-', 'bytes=9-1', 'bytes=0-9007199254740992']) {
    await assert.rejects(api.media({ uri, requestId: range, range }), /Invalid media request/);
  }
  await api.media({ uri, requestId: 'redirect', range: 'bytes=1-2' });
  assert.equal(new global.URL(calls[1].url).searchParams.get('range'), '1-2');
});

test('opaque routes retain the exact source identity and readiness window when upstream URLs are equal', async () => {
  const api = service();
  const first = await api.resolve(ID);
  const next = { ...first, identity: 'another-account', availableAt: 16000 };
  const a = api.registerUrl(URL, first);
  const b = api.registerUrl(URL, next);
  assert.notEqual(a, b);
  assert.equal(api.routes.get(b).source, next);
  assert.equal(api.registerUrl(URL, next), b);
});

test('timeouts and invalid redirects produce fixed media diagnostics without deferring a client', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const diagnostics = [];
  let mode = 'timeout';
  const api = service({ onDiagnostic: event => diagnostics.push(event), fetchImpl: async (_url, options) => {
    if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'https://evil.test/secret' } });
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  const uri = api.registerUrl(URL, await api.resolve(ID));
  const pending = api.media({ uri, requestId: 'timeout' });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await advanceTimers(context, 20000);
  await rejected;
  mode = 'redirect';
  await assert.rejects(api.media({ uri, requestId: 'redirect' }), /Invalid media redirect/);
  assert.deepEqual(diagnostics.filter(event => event.stage === 'media_failed').map(event => event.code), ['TIMEOUT', 'INVALID_REDIRECT']);
  assert.equal(api.deferred.size, 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|https|googlevideo/);
});

test('DASH manifests expose opaque routes, range reads preserve media identity and reject arbitrary URLs', async () => {
  const calls = [];
  const api = service({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4' } });
  } });
  const source = await api.resolve(ID);
  const exposed = api.expose(source);
  assert.equal(JSON.stringify(exposed).includes('googlevideo'), false);
  const manifest = new TextDecoder().decode((await api.media({ uri: exposed.uri, requestId: 'manifest' })).data);
  const uri = /<BaseURL>([^<]+)/.exec(manifest)[1];
  assert.equal(manifest.includes('googlevideo'), false);
  const chunk = await api.media({ uri, requestId: 'chunk', range: 'bytes=0-2' });
  assert.deepEqual([...chunk.data], [1, 2, 3]);
  assert.equal(calls[0].url, `${URL}&range=0-2`);
  assert.equal(calls[0].options.headers['User-Agent'], 'fixture-client');
  assert.equal(calls[0].options.headers.Range, undefined);
  assert.equal(calls[0].options.credentials, 'omit');
  await assert.rejects(api.media({ uri: 'https://localhost/secret', requestId: 'evil' }), /Invalid media request/);
  assert.throws(() => api.registerUrl('https://evil.test/video', source), /Invalid YouTube media host/);
  api.clearMedia();
  await assert.rejects(api.media({ uri, requestId: 'old' }), /Invalid media request/);
});

test('HLS variants, relative segments and keys stay inside the isolated media transport', async () => {
  const api = service({ createClient: async () => ({ userAgent: 'live-client', getInfo: async () => playable({
    basic_info: { is_live: true }, streaming_data: { hls_manifest_url: 'https://manifest.googlevideo.com/path/master.m3u8' }
  }) }), fetchImpl: async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\nsegment.ts\n', {
    headers: { 'content-type': 'application/x-mpegurl' }
  }) });
  const source = api.expose(await api.resolve(ID));
  const response = await api.media({ uri: source.uri, requestId: 'live' });
  const body = new TextDecoder().decode(response.data);
  assert.equal(body.includes('googlevideo'), false);
  assert.match(body, /URI="shiira-youtube:\/\/media\//);
  assert.equal([...api.routes.values()].some(route => route.url === 'https://manifest.googlevideo.com/path/segment.ts'), true);
  assert.equal([...api.routes.values()].some(route => route.url === 'https://manifest.googlevideo.com/path/key'), true);
});

test('a refused adaptive GET uses the same source and range for POST and remembers successful transport', async () => {
  const calls = [];
  let extractions = 0;
  const api = service({ createClient: async () => ({ userAgent: 'same-client', getInfo: async () => {
    extractions++;
    return playable();
  } }), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return new Response('', { status: 403 });
    return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4' } });
  } });
  const uri = api.registerUrl(URL, await api.resolve(ID));
  for (const [requestId, range] of [['first', 'bytes=0-2'], ['next', 'bytes=3-5']]) {
    const response = await api.media({ uri, requestId, range });
    assert.deepEqual([...response.data], [1, 2, 3]);
    assert.equal(response.uri, uri);
  }
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST', 'POST']);
  assert.deepEqual(calls.map(call => call.url), [`${URL}&range=0-2`, `${URL}&range=0-2`, `${URL}&range=3-5`]);
  for (const { options } of calls.slice(1)) {
    assert.deepEqual([...options.body], [0x78, 0]);
    assert.equal(options.headers.Range, undefined);
    assert.equal(options.headers['User-Agent'], 'same-client');
    assert.equal(options.credentials, 'omit');
  }
  assert.equal(extractions, 1);
});

test('adaptive CDN redirects retain the requested range and client identity', async () => {
  const calls = [];
  const target = 'https://rr2.googlevideo.com/videoplayback?id=redirected';
  const api = service({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response('', { status: 302, headers: { location: target } });
    return new Response(new Uint8Array([1]), { status: 206, headers: { 'content-type': 'video/mp4' } });
  } });
  const uri = api.registerUrl(URL, await api.resolve(ID));
  await api.media({ uri, requestId: 'redirect-range', range: 'bytes=10-12' });
  assert.equal(calls[1].url, `${target}&range=10-12`);
  assert.equal(calls[1].options.headers['User-Agent'], 'fixture-client');
  assert.equal(calls[1].options.headers.Range, undefined);
});

test('HLS refusals retain GET and standard Range headers without adaptive POST fallback', async () => {
  const calls = [];
  const api = service({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response('', { status: 403 });
  } });
  const source = { ...await api.resolve(ID), kind: 'hls' };
  const uri = api.registerUrl(URL, source);
  await assert.rejects(api.media({ uri, requestId: 'hls-refusal', range: 'bytes=0-2' }), /HTTP 403/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, URL);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Range, 'bytes=0-2');
});

test('media HTTP refusal, invalid response and cancellation reach bounded source recovery', async () => {
  let mode = '403';
  const api = service({ fetchImpl: async (_url, options) => {
    if (mode === '403') return new Response('', { status: 403 });
    if (mode === 'html') return new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } });
    if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'http://localhost/private' } });
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  const source = await api.resolve(ID);
  const uri = api.registerUrl(URL, source);
  await assert.rejects(api.media({ uri, requestId: 'refused' }), /HTTP 403/);
  mode = 'html';
  await assert.rejects(api.media({ uri, requestId: 'invalid' }), /Invalid YouTube media response/);
  mode = 'redirect';
  await assert.rejects(api.media({ uri, requestId: 'redirect' }), /Invalid media redirect/);
  mode = 'cancel';
  const request = api.media({ uri, requestId: 'cancel' });
  api.cancel('cancel');
  await assert.rejects(request, /aborted/);
  assert.equal(api.requests.size, 0);
  assert.equal(CLIENTS.at(-1), 'ANDROID_VR');
});

test('the real YouTube.js adapter retains pre-roll timing from the raw player answer', async () => {
  const answer = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: ID, title: 'Readiness', lengthSeconds: '10' },
    adPlacements: [{ adPlacementRenderer: {
      config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_START' } },
      renderer: { instreamVideoAdRenderer: { skipOffsetMilliseconds: 15000 } }
    } }]
  };
  const api = new YouTubeService({ now: () => 1000, fetchImpl: async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input.url;
    assert.match(requestUrl, /\/youtubei\/v1\/player/);
    const body = JSON.parse(init?.body || await input.clone().text());
    assert.equal(body.videoId, ID);
    assert.equal(body.context.client.clientName, 'VISIONOS');
    return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
  } });
  const client = await api.createInnertube({ client: 'VISIONOS' });
  assert.equal((await client.getInfo(ID)).mediaAvailableAt, 16000);
  answer.adPlacements[0].adPlacementRenderer.renderer.instreamVideoAdRenderer.skipOffsetMilliseconds = 90000;
  assert.equal((await client.getInfo(ID)).mediaAvailableAt, 31000, 'readiness is capped at 30 seconds');
  answer.adPlacements[0].adPlacementRenderer.config.adPlacementConfig.kind = 'AD_PLACEMENT_KIND_MIDDLE';
  assert.equal((await client.getInfo(ID)).mediaAvailableAt, 0, 'mid-roll metadata cannot delay the whole stream');
});

async function advanceTimers(context, milliseconds) {
  context.mock.timers.tick(milliseconds);
  await new Promise(resolve => setImmediate(resolve));
}

test('raw readiness follows modern ad slots, playerVars and unknown fulfillment exactly as Litube does', async () => {
  const placement = renderer => ({ adPlacementRenderer: {
    config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_START' } }, renderer
  } });
  const slot = fulfillmentContent => ({ adSlotRenderer: {
    adSlotMetadata: { triggerEvent: 'SLOT_TRIGGER_EVENT_BEFORE_CONTENT' }, fulfillmentContent
  } });
  const ad = fields => ({ instreamVideoAdRenderer: fields });
  let answer;
  const api = new YouTubeService({ now: () => 1000, fetchImpl: async () =>
    new Response(JSON.stringify({ playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: ID, title: 'Readiness', lengthSeconds: '60' }, ...answer }),
    { headers: { 'content-type': 'application/json' } }) });
  const client = await api.createInnertube({ client: 'VISIONOS' });
  const cases = [
    [{ adSlots: [slot({ fulfilledLayout: { content: ad({ skipOffsetMilliseconds: 7000 }) } })] }, 8000],
    [{ adSlots: [slot({ pendingLayout: {} })] }, 16000],
    [{ adPlacements: [placement({ clientForecastingAdRenderer: {} })] }, 16000],
    [{ adPlacements: [placement(ad({ playerVars: 'foo=bar&length_seconds=12.5' }))] }, 13500],
    [{ adPlacements: [placement(ad({ playerVars: 'length_seconds=invalid' }))] }, 16000],
    [{ adPlacements: [placement(ad({ skipOffsetMilliseconds: 0 }))] }, 0],
    [{ adSlots: [slot(ad({ skipOffsetMilliseconds: 4000 }))],
      adPlacements: [placement(ad({ skipOffsetMilliseconds: 25000 }))] }, 5000],
    [{ adSlots: [slot(ad({ skipOffsetMilliseconds: 25000 })), slot({})] }, 31000],
    [{ adSlots: [{ adSlotRenderer: { adSlotMetadata: { triggerEvent: 'SLOT_TRIGGER_EVENT_MID_ROLL' },
      fulfillmentContent: ad({ skipOffsetMilliseconds: 20000 }) } }] }, 0]
  ];
  for (const [value, expected] of cases) {
    answer = value;
    assert.equal((await client.getInfo(ID)).mediaAvailableAt, expected);
  }
});

test('VOD HLS path challenges are solved before exposing the manifest, while live paths remain unchanged', async context => {
  const { Player } = await import('youtubei.js');
  const challenges = [];
  context.mock.method(Player, 'create', async () => ({
    signature_timestamp: 1,
    decipher: async url => {
      const parsed = new global.URL(url);
      challenges.push(parsed.searchParams.get('n'));
      parsed.searchParams.set('n', 'solved+value');
      return parsed.href;
    }
  }));
  let live = false;
  const hls = 'https://manifest.googlevideo.com/api/manifest/hls_variant/n/original%2Bvalue/file/index.m3u8';
  const api = new YouTubeService({ fetchImpl: async () => new Response(JSON.stringify({
    playabilityStatus: { status: 'OK' }, videoDetails: { videoId: ID, title: 'Manifest', lengthSeconds: '60', isLive: live },
    streamingData: { hlsManifestUrl: hls }
  }), { headers: { 'content-type': 'application/json' } }) });
  const adapter = await api.createInnertube({ client: 'VISIONOS' });
  assert.equal((await adapter.getInfo(ID)).streaming_data.hls_manifest_url, hls.replace('original%2Bvalue', 'solved%2Bvalue'));
  assert.deepEqual(challenges, ['original+value']);
  live = true;
  assert.equal((await adapter.getInfo(ID)).streaming_data.hls_manifest_url, hls);
  assert.equal(challenges.length, 1);
});

test('WEB_SAFARI uses WEB payloads with matching Safari request/media identity and prefers its HLS route', async context => {
  const { Player } = await import('youtubei.js');
  context.mock.method(Player, 'create', async () => ({ signature_timestamp: 12345 }));
  const hls = 'https://manifest.googlevideo.com/manifest/index.m3u8';
  let requestAgent;
  const api = new YouTubeService({ fetchImpl: async (input, init) => {
    const body = JSON.parse(init.body || await input.clone().text());
    const headers = new Headers(init.headers);
    assert.equal(body.context.client.clientName, 'WEB');
    assert.equal(body.context.client.browserName, 'Safari');
    assert.equal(body.context.client.osName, 'Macintosh');
    assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp, 12345);
    requestAgent = headers.get('user-agent');
    assert.match(requestAgent, /Version\/15\.5 Safari/);
    assert.equal(body.context.client.userAgent, requestAgent);
    return new Response(JSON.stringify({ playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: ID, title: 'Safari route', lengthSeconds: '60' },
      streamingData: { hlsManifestUrl: hls } }), { headers: { 'content-type': 'application/json' } });
  } });
  api.order = ['WEB_SAFARI'];
  const source = await api.resolve(ID);
  assert.equal(source.client, 'WEB_SAFARI');
  assert.equal(source.kind, 'hls');
  assert.equal(source.url, hls);
  assert.equal(source.userAgent, requestAgent);
});

test('fixed-profile clients use the same HTTP user agent for player extraction and media', async context => {
  const { Player } = await import('youtubei.js');
  context.mock.method(Player, 'create', async () => ({ signature_timestamp: 12345 }));
  let requestAgent;
  const api = new YouTubeService({ fetchImpl: async (_input, init) => {
    requestAgent = new Headers(init.headers).get('user-agent');
    const payload = JSON.parse(init.body);
    assert.equal(payload.context.client.userAgent, requestAgent);
    return new Response(JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
      { headers: { 'content-type': 'application/json' } });
  } });
  for (const name of ['TV', 'VISIONOS', 'IOS', 'ANDROID_VR']) {
    const client = await api.createInnertube({ client: name });
    await client.getInfo(ID);
    assert.equal(client.userAgent, requestAgent, name);
  }
});

test('a temporary pre-roll refusal retries the same media handle and client through its availability deadline', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const calls = [];
  let extractions = 0;
  const api = service({ createClient: async () => ({ userAgent: 'same-client', getInfo: async () => {
    extractions++;
    return playable({ mediaAvailableAt: 16000 });
  } }), fetchImpl: async (url, options) => {
    calls.push({ url, options, time: Date.now() });
    if (calls.length < 3) return new Response('', { status: 403 });
    return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4' } });
  } });
  const source = await api.resolve(ID);
  assert.equal(api.expose(source).availableAt, 16000);
  const uri = api.registerUrl(URL, source);
  const pending = api.media({ uri, requestId: 'held-media', range: 'bytes=0-2' });
  await advanceTimers(context, 0);
  await advanceTimers(context, 599);
  assert.equal(calls.length, 1);
  await advanceTimers(context, 1);
  assert.equal(calls.length, 2, 'probe the original source after 600 ms');
  await advanceTimers(context, 14399);
  assert.equal(calls.length, 2);
  await advanceTimers(context, 1);
  const response = await pending;
  assert.deepEqual([...response.data], [1, 2, 3]);
  assert.equal(response.uri, uri);
  assert.deepEqual(calls.map(call => call.time), [1000, 1600, 16000]);
  assert.ok(calls.every(call => call.url === `${URL}&range=0-2` && call.options.headers.Range === undefined &&
    call.options.headers['User-Agent'] === 'same-client' && call.options.credentials === 'omit'));
  assert.equal(extractions, 1, 'media readiness does not resolve a replacement source');
  assert.equal(api.requests.size, 0);
});

test('readiness waits cancel immediately on a cancelled request or departing video', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  const api = service({ fetchImpl: async () => { calls++; return new Response('', { status: 403 }); } });
  const source = { ...await api.resolve(ID), availableAt: 16000 };
  for (const release of ['cancel', 'clearMedia']) {
    const uri = api.registerUrl(URL, source);
    const pending = api.media({ uri, requestId: release });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await advanceTimers(context, 0);
    if (release === 'cancel') api.cancel(release);
    else api.clearMedia();
    await rejected;
    assert.equal(api.requests.size, 0);
  }
  await advanceTimers(context, 30000);
  assert.equal(calls, 2, 'cancelled holds cannot issue late media requests');
});

test('persistent refusals leave readiness handling after its deadline and unrelated HTTP failures fail immediately', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  let status = 403;
  const api = service({ fetchImpl: async () => { calls++; return new Response('', { status }); } });
  const source = { ...await api.resolve(ID), availableAt: 16000 };
  const uri = api.registerUrl(URL, source);
  const pending = api.media({ uri, requestId: 'persistent' });
  const rejected = assert.rejects(pending, /HTTP 403/);
  await advanceTimers(context, 0);
  await advanceTimers(context, 600);
  await advanceTimers(context, 14400);
  await rejected;
  assert.equal(calls, 4, 'an exhausted readiness hold permits one same-source POST attempt');
  await assert.rejects(api.media({ uri, requestId: 'expired-window' }), /HTTP 403/);
  assert.equal(calls, 6);
  source.availableAt = Date.now() + 15000;
  for (status of [404, 429, 500]) {
    const before = calls;
    await assert.rejects(api.media({ uri, requestId: `status-${status}` }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, before + 1);
  }
});

test('HLS child requests inherit the original source availability window', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let childRequests = 0;
  const api = service({ createClient: async () => ({ userAgent: 'hls-client', getInfo: async () => playable({
    basic_info: { is_live: true }, mediaAvailableAt: 16000,
    streaming_data: { hls_manifest_url: 'https://manifest.googlevideo.com/path/master.m3u8' }
  }) }), fetchImpl: async url => {
    if (url.endsWith('master.m3u8')) return new Response('#EXTM3U\nsegment.ts\n', { headers: { 'content-type': 'application/x-mpegurl' } });
    if (++childRequests === 1) return new Response('', { status: 403 });
    return new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-type': 'video/mp2t' } });
  } });
  const exposed = api.expose(await api.resolve(ID));
  const manifest = await api.media({ uri: exposed.uri, requestId: 'master' });
  const child = new TextDecoder().decode(manifest.data).split('\n')[1];
  const pending = api.media({ uri: child, requestId: 'segment' });
  await advanceTimers(context, 0);
  await advanceTimers(context, 600);
  assert.deepEqual([...(await pending).data], [4, 5, 6]);
  assert.equal(childRequests, 2);
});

test('a held media request retains its normal transport timeout after readiness', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  let activeSignal;
  const api = service({ fetchImpl: async (_url, options) => {
    if (++calls < 3) return new Response('', { status: 403 });
    activeSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  const source = { ...await api.resolve(ID), availableAt: 31000 };
  const uri = api.registerUrl(URL, source);
  const pending = api.media({ uri, requestId: 'transport-timeout' });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await advanceTimers(context, 0);
  await advanceTimers(context, 600);
  await advanceTimers(context, 29400);
  assert.equal(calls, 3);
  await advanceTimers(context, 19999);
  assert.equal(activeSignal.aborted, false);
  await advanceTimers(context, 1);
  await rejected;
  assert.equal(api.requests.size, 0);
});
