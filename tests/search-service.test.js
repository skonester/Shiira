const test = require('node:test');
const assert = require('node:assert/strict');
const { SearchService, validateRequest, normalizeResponse } = require('../src/main/search-service');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const request = (provider = 'brave', extra = {}) => ({ id: 'search-1', provider, query: 'browser tabs & privacy', ...extra });
const env = { BRAVE_SEARCH_API_KEY: 'test-brave-secret', SCIRA_API_KEY: 'test-scira-secret' };
function keychain() {
  const values = new Map();
  return { values, getPassword: async (_service, provider) => values.get(provider), setPassword: async (_service, provider, value) => values.set(provider, value), deletePassword: async (_service, provider) => values.delete(provider) };
}

test('validates provider, query limits, modes and pagination before sending anything', () => {
  for (const input of [null, request('unknown'), request('brave', { query: '' }), request('brave', { query: 'a'.repeat(601) }), request('brave', { query: 'x '.repeat(76) }), request('brave', { mode: 'reddit' }), request('scira', { page: 1 }), request('brave', { page: 10 }), request('brave', { page: 0.5 })]) assert.throws(() => validateRequest(input));
  assert.equal(validateRequest(request('scira', { mode: 'reddit' })).mode, 'reddit');
});

test('Brave uses the documented endpoint/header and normalizes safe web results', async () => {
  const calls = [];
  const service = new SearchService({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json({ query: { more_results_available: true, altered: 'browser tab privacy' }, web: { results: [
      { url: 'https://example.com/tabs', title: '<b>Browser tabs</b>', description: '<img src=x onerror=alert(1)>' },
      { url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com/' }, { url: 'https://example.com/tabs' }
    ] } });
  } });
  const response = await service.search(1, request('brave', { page: 2 }));
  assert.equal(response.success, true);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://api.search.brave.com');
  assert.equal(url.pathname, '/res/v1/web/search');
  assert.equal(url.searchParams.get('q'), 'browser tabs & privacy');
  assert.equal(url.searchParams.get('offset'), '2');
  assert.equal(url.searchParams.get('text_decorations'), 'false');
  assert.equal(calls[0].options.headers['X-Subscription-Token'], env.BRAVE_SEARCH_API_KEY);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(response.result.results.length, 1);
  assert.equal(response.result.more, true);
  assert.equal(JSON.stringify(response).includes(env.BRAVE_SEARCH_API_KEY), false);
});

test('Scira Web, Reddit, X and People use their documented JSON contracts', async () => {
  const calls = [];
  const service = new SearchService({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/people') ? { profile: { name: 'A person', bio: 'Researcher', github: 'https://github.com/example', website: 'javascript:bad' } } : {
      text: 'An answer with sources.', sources: ['https://example.org/source', 'data:text/html,bad'], results: [{ url: 'https://example.org/result', title: 'Result', excerpt: 'Source excerpt' }]
    });
  } });
  for (const mode of ['web', 'reddit', 'x', 'people']) {
    const response = await service.search(2, request('scira', { mode }));
    assert.equal(response.success, true);
    assert.ok(response.result.answer);
    assert.ok(response.result.results.every(item => item.url.startsWith('https://')));
  }
  assert.deepEqual(calls.map(call => call.url), ['https://api.scira.ai/api/search', 'https://api.scira.ai/api/reddit', 'https://api.scira.ai/api/xsearch', 'https://api.scira.ai/api/people']);
  assert.deepEqual(JSON.parse(calls[0].options.body), { messages: [{ role: 'user', content: 'browser tabs & privacy' }] });
  assert.deepEqual(JSON.parse(calls[1].options.body), { query: 'browser tabs & privacy' });
  assert.equal(calls[0].options.headers['x-api-key'], env.SCIRA_API_KEY);
});

test('DuckDuckGo Quick needs no key and flattens related topics safely', async () => {
  const service = new SearchService({ env: {}, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.duckduckgo.com');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return json({ AbstractText: 'An instant answer.', AbstractURL: 'https://en.wikipedia.org/wiki/Browser', Heading: 'Browser', RelatedTopics: [{ Topics: [{ FirstURL: 'https://duckduckgo.com/Tab', Text: 'Tab' }] }] });
  } });
  const response = await service.search(3, request('duckduckgo'));
  assert.equal(response.result.answer, 'An instant answer.');
  assert.equal(response.result.results.length, 2);
});

test('DuckDuckGo’s real JavaScript MIME type still contains JSON and succeeds on the first request', async () => {
  let calls = 0;
  const service = new SearchService({ env: {}, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ AbstractText: 'A browser is an application.', AbstractURL: 'https://example.com/browser', Heading: 'Browser' }), { headers: { 'content-type': 'application/x-javascript; charset=utf-8' } });
  } });
  const response = await service.search(3, request('duckduckgo'));
  assert.equal(response.success, true);
  assert.equal(response.result.answer, 'A browser is an application.');
  assert.equal(calls, 1);
});

test('legacy DuckDuckGo content types never execute JavaScript or JSONP', async () => {
  const service = new SearchService({ env: {}, fetchImpl: async () => new Response('callback({"AbstractText":"not JSON"});', { headers: { 'content-type': 'application/x-javascript' } }) });
  assert.equal((await service.search(3, request('duckduckgo'))).code, 'invalid_response');
  const brave = new SearchService({ env, fetchImpl: async () => new Response('{"web":{"results":[]}}', { headers: { 'content-type': 'application/x-javascript' } }) });
  assert.equal((await brave.search(3, request('brave'))).code, 'invalid_response');
});

test('Scira’s live empty HTTP 500 shape retains the provider, status and support request ID', async () => {
  const service = new SearchService({ env, fetchImpl: async () => new Response(null, { status: 500, headers: { 'x-vercel-id': 'cle1::fra1::request-123' } }) });
  const response = await service.search(3, request('scira'));
  assert.equal(response.success, false);
  assert.equal(response.status, 500);
  assert.equal(response.requestId, 'cle1::fra1::request-123');
  assert.match(response.error, /Scira API returned a server error \(HTTP 500\)/);
  assert.equal(response.code, 'provider_error');
});

test('provider validation details are visible without exposing reflected credentials', async () => {
  const service = new SearchService({ env, fetchImpl: async () => json({ error: `Missing messages; credential ${env.SCIRA_API_KEY}` }, 400) });
  const response = await service.search(3, request('scira'));
  assert.match(response.error, /HTTP 400/);
  assert.match(response.error, /Missing messages/);
  assert.equal(response.error.includes(env.SCIRA_API_KEY), false);
  assert.match(response.error, /\[redacted\]/);
});

test('missing keys produce a setup response and never call a search webpage or another provider', async () => {
  let count = 0;
  const service = new SearchService({ env: {}, fetchImpl: async () => { count++; throw new Error('Should not send'); } });
  assert.equal((await service.search(1, request())).code, 'missing_key');
  assert.equal((await service.search(1, request('scira'))).code, 'missing_key');
  assert.equal(count, 0);
});

test('API keys save/remove through the keychain and status never returns secrets', async () => {
  const store = keychain();
  const service = new SearchService({ env, keychain: store });
  assert.equal((await service.status()).brave.source, 'environment');
  const saved = await service.setKey('brave', 'user-owned-secret');
  assert.equal(saved.success, true);
  assert.equal(saved.status.brave.source, 'keychain');
  assert.equal((await service.credential('brave')).key, 'user-owned-secret');
  assert.equal(JSON.stringify(saved).includes('user-owned-secret'), false);
  assert.equal((await service.setKey('brave', '')).status.brave.source, 'environment');
  assert.equal((await service.setKey('__proto__', 'bad')).success, false);
  assert.equal((await service.setKey('brave', 'header\r\ninjection')).success, false);
  const broken = new SearchService({ env: {}, keychain: { setPassword: async () => { throw new Error('secret value'); } } });
  const failed = await broken.setKey('brave', 'do-not-leak');
  assert.equal(failed.success, false);
  assert.equal(JSON.stringify(failed).includes('secret value'), false);
});

test('authentication, rate limits, invalid responses and oversized bodies are readable errors', async () => {
  for (const [status, code] of [[401, 'authentication'], [403, 'authentication'], [429, 'rate_limit'], [500, 'provider_error']]) {
    const service = new SearchService({ env, fetchImpl: async () => json({ error: env.BRAVE_SEARCH_API_KEY }, status) });
    const response = await service.search(4, request());
    assert.equal(response.code, code);
    assert.equal(JSON.stringify(response).includes(env.BRAVE_SEARCH_API_KEY), false);
  }
  for (const response of [new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }), new Response('broken', { headers: { 'content-type': 'application/json' } }), json({ bad: true }), json({ text: 'x'.repeat(2 * 1024 * 1024) })]) {
    const service = new SearchService({ env, fetchImpl: async () => response });
    assert.equal((await service.search(4, request())).code, 'invalid_response');
  }
});

test('cancellation and timeout stop pending requests and clean their owner state', async () => {
  const service = new SearchService({ env, timeoutMs: 20, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const canceled = service.search(5, request());
  await new Promise(resolve => setTimeout(resolve, 1));
  service.cancel(6, 'search-1'); // Another renderer cannot cancel this request.
  assert.equal(service.active.size, 1);
  service.cancel(5, 'search-1');
  assert.equal((await canceled).code, 'canceled');
  assert.equal(service.active.size, 0);
  assert.equal((await service.search(5, request())).code, 'timeout');
  assert.equal(service.active.size, 0);
});

test('official Brave autosuggest uses the key, caches queries, and never falls back to web-app endpoints', async () => {
  let calls = 0;
  const service = new SearchService({ env, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, '/res/v1/suggest/search');
    assert.equal(options.headers['X-Subscription-Token'], env.BRAVE_SEARCH_API_KEY);
    return json({ results: [{ query: 'browser tabs' }, { query: 'browser tabs' }, { query: 'browser privacy' }] });
  } });
  assert.deepEqual(await service.suggest('browser'), ['browser tabs', 'browser privacy']);
  await service.suggest('BROWSER');
  assert.equal(calls, 1);
  assert.deepEqual(await service.suggest('browser', 'scira'), []);
  assert.deepEqual(await service.suggest('browser', 'duckduckgo'), []);
  assert.equal(calls, 1);
});

test('malformed provider payloads are rejected instead of being presented as AI answers', () => {
  assert.throws(() => normalizeResponse('scira', {}, 'test'));
  assert.throws(() => normalizeResponse('brave', [], 'test'));
});
