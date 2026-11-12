const test = require('node:test');
const assert = require('node:assert/strict');
const { YouTubeService, CLIENTS } = require('../src/main/youtube-service');
const { videoIdFromUrl, startSeconds, isYouTubePlaybackRequest } = require('../src/shared/youtube');

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
  assert.equal(recovered.client, 'IOS');
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
  assert.equal(calls[0].url, URL);
  assert.equal(calls[0].options.headers['User-Agent'], 'fixture-client');
  assert.equal(calls[0].options.headers.Range, 'bytes=0-2');
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
