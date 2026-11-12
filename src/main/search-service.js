// Official provider APIs only. Keys stay in the main process and OS keychain.
// Contracts: https://api.scira.ai/docs and https://api-dashboard.search.brave.com/documentation
const PROVIDERS = new Set(['brave', 'scira', 'duckduckgo']);
const SCIRA_MODES = new Set(['web', 'reddit', 'x', 'people']);
const KEYCHAIN_SERVICE = 'Shiira Search API';
const ENV_KEYS = { brave: 'BRAVE_SEARCH_API_KEY', scira: 'SCIRA_API_KEY' };
const MAX_BYTES = 2 * 1024 * 1024;
const safeUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
};
const text = (value, max = 10000) => typeof value === 'string' ? value.slice(0, max) : '';
class SearchError extends Error {
  constructor(code, message, { status, requestId } = {}) {
    super(message); this.code = code; this.status = status; this.requestId = requestId;
  }
}

function validateRequest(input) {
  if (!input || !PROVIDERS.has(input.provider)) throw new SearchError('invalid_request', 'Choose a supported search provider.');
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > 600 || query.split(/\s+/).length > 75) throw new SearchError('invalid_request', 'Enter a search of up to 600 characters and 75 words.');
  const mode = input.mode || 'web';
  if (!SCIRA_MODES.has(mode) || (input.provider !== 'scira' && mode !== 'web')) throw new SearchError('invalid_request', 'Choose a supported search mode.');
  const page = input.page ?? 0;
  if (!Number.isInteger(page) || page < 0 || page > 9 || (input.provider !== 'brave' && page !== 0)) throw new SearchError('invalid_request', 'Invalid results page.');
  return { provider: input.provider, query, mode, page };
}

function normalizeResponse(provider, data, query, mode = 'web', page = 0) {
  const result = { provider, query, mode, page, answer: '', results: [], more: false };
  const seen = new Set();
  const add = (url, title, description) => {
    const safe = safeUrl(url);
    if (!safe || seen.has(safe) || result.results.length >= 30) return;
    seen.add(safe);
    result.results.push({ url: safe, title: text(title, 300) || new URL(safe).hostname, description: text(description, 2000) });
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SearchError('invalid_response', 'The search provider returned an unreadable response.');
  if (provider === 'brave') {
    if (!data.web && !data.query) throw new SearchError('invalid_response', 'Brave returned an unreadable response.');
    for (const item of Array.isArray(data.web?.results) ? data.web.results : []) add(item.url, item.title, item.description);
    result.more = data.query?.more_results_available === true && page < 9;
    result.correctedQuery = text(data.query?.altered, 600);
  } else if (provider === 'scira') {
    if (mode === 'people') {
      const profile = data.profile;
      if (!profile || typeof profile !== 'object') throw new SearchError('invalid_response', 'Scira returned no profile information.');
      result.answer = [text(profile.name, 300), text(profile.bio)].filter(Boolean).join('\n\n');
      for (const key of ['website', 'linkedin', 'github', 'x']) add(profile[key], `${profile.name || 'Profile'} · ${key}`);
    } else {
      if (typeof data.text !== 'string') throw new SearchError('invalid_response', 'Scira returned no answer.');
      result.answer = text(data.text, 100000);
      for (const item of Array.isArray(data.results) ? data.results : []) add(item.url, item.title || item.author, item.excerpt || item.description || item.tweet?.text);
      for (const source of Array.isArray(data.sources) ? data.sources : []) add(typeof source === 'string' ? source : source?.url, source?.title);
    }
  } else {
    result.answer = text(data.AbstractText || data.Abstract || data.Answer, 30000);
    add(data.AbstractURL, data.Heading || data.AbstractSource, data.AbstractText);
    const topics = [...(Array.isArray(data.Results) ? data.Results : []), ...(Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [])];
    let budget = 100;
    while (topics.length && budget-- > 0) {
      const topic = topics.shift();
      if (!topic || typeof topic !== 'object') continue;
      add(topic.FirstURL, topic.Text, '');
      if (Array.isArray(topic.Topics)) topics.push(...topic.Topics);
    }
  }
  return result;
}

class SearchService {
  constructor({ keychain, fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 45000 } = {}) {
    this.keychain = keychain;
    this.fetch = fetchImpl;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.active = new Map();
    this.suggestionCache = new Map();
    this.sciraFailures = new Map();
  }

  async credential(provider) {
    let saved;
    let unreadable = false;
    try { saved = await this.keychain?.getPassword(KEYCHAIN_SERVICE, provider); } catch { unreadable = true; }
    if (saved) return { key: saved, source: 'keychain' };
    const key = this.env[ENV_KEYS[provider]];
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed) return { key: trimmed, source: 'environment' };
    return { key: '', source: null, ...(unreadable ? { error: 'Shiira could not read the saved API key from the system keychain. Try again or open Search settings.' } : {}) };
  }

  async status() {
    const status = {};
    for (const provider of ['brave', 'scira']) {
      const { key, source, error } = await this.credential(provider);
      status[provider] = { configured: Boolean(key), source, ...(error ? { error } : {}) };
    }
    return status;
  }

  async setKey(provider, value) {
    if (!Object.hasOwn(ENV_KEYS, provider) || typeof value !== 'string' || value.length > 2048 || /[\r\n\x00-\x1f]/.test(value)) return { success: false, error: 'Invalid API key.' };
    if (!this.keychain) return { success: false, error: 'The system keychain is unavailable. Set the provider’s environment variable instead.' };
    try {
      const key = value.trim();
      if (key) await this.keychain.setPassword(KEYCHAIN_SERVICE, provider, key);
      else await this.keychain.deletePassword(KEYCHAIN_SERVICE, provider);
      const saved = await this.keychain.getPassword(KEYCHAIN_SERVICE, provider);
      if (key ? saved !== key : Boolean(saved)) {
        return { success: false, error: 'The system keychain did not apply the change. Try again.' };
      }
      this.suggestionCache.clear();
      if (provider === 'scira') this.sciraFailures.clear();
      return { success: true, status: await this.status() };
    } catch { return { success: false, error: 'The API key could not be saved in the system keychain.' }; }
  }

  async readBody(response, maxBytes = MAX_BYTES) {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new SearchError('invalid_response', 'The search response was too large. Try a more focused query.'); }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
  }

  async json(url, options, signal) {
    const response = await this.fetch(url, { ...options, redirect: 'error', signal });
    const host = new URL(url).hostname;
    const provider = host === 'api.scira.ai' ? 'Scira' : host === 'api.search.brave.com' ? 'Brave Search' : 'DuckDuckGo Quick';
    const secrets = Object.entries(options?.headers || {}).filter(([name]) => /^(x-api-key|x-subscription-token|authorization)$/i.test(name))
      .flatMap(([, value]) => [String(value), String(value).replace(/^Bearer\s+/i, '')]).filter(Boolean);
    const redact = value => secrets.reduce((out, secret) => out.replaceAll(secret, '[redacted]'), value);
    const rawRequestId = redact(response.headers.get('x-request-id') || response.headers.get('x-vercel-id') || '');
    const requestId = /^[a-z0-9:_.-]{1,200}$/i.test(rawRequestId) ? rawRequestId : undefined;
    const context = { status: response.status, requestId };
    if (!response.ok) {
      let detail = '';
      try {
        const data = JSON.parse(await this.readBody(response, 64 * 1024));
        const message = typeof data.error === 'string' ? data.error : data.error?.message || data.message;
        if (typeof message === 'string') detail = redact(message).replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 400).trim();
      } catch { /* Empty/non-JSON server errors still retain their HTTP status. */ }
      if (response.status === 401 || response.status === 403) throw new SearchError('authentication', `${provider} rejected the API credentials (HTTP ${response.status}). Check the key and endpoint access in Search settings.`, context);
      if (response.status === 429) throw new SearchError('rate_limit', `${provider} reached its request limit (HTTP 429). Try again later or choose another provider.`, context);
      const reason = response.status >= 500 ? 'returned a server error' : 'rejected this request';
      throw new SearchError('provider_error', `${provider} API ${reason} (HTTP ${response.status}).${detail ? ` ${detail}` : ''} ${response.status >= 500 ? 'Try again later or choose another provider.' : 'Check the request and try again.'}`, context);
    }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // DuckDuckGo's real Instant Answer endpoint serves JSON under this legacy
    // JavaScript MIME type. Parse it as JSON only; never evaluate JavaScript/JSONP.
    const duckJson = host === 'api.duckduckgo.com' && /^(application\/(?:x-)?javascript|text\/javascript)$/.test(contentType);
    if (!/^(application|text)\/(?:[a-z0-9.+-]+\+)?json$/.test(contentType) && !duckJson) {
      await response.body?.cancel();
      throw new SearchError('invalid_response', `${provider} returned an unsupported response type.`, context);
    }
    try { return JSON.parse(await this.readBody(response)); }
    catch (error) {
      if (error instanceof SearchError) throw error;
      throw new SearchError('invalid_response', `${provider} returned invalid JSON.`, context);
    }
  }

  cancel(owner, id) { this.active.get(`${owner}:${id}`)?.abort(); }
  cancelOwner(owner) { for (const [id, controller] of this.active) if (id.startsWith(`${owner}:`)) controller.abort(); }

  async search(owner, input) {
    let request;
    try { request = validateRequest(input); }
    catch (error) { return { success: false, code: error.code, error: error.message }; }
    if (typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id)) return { success: false, code: 'invalid_request', error: 'Invalid search request.' };
    const token = `${owner}:${input.id}`;
    this.cancel(owner, input.id);
    if ([...this.active.keys()].filter(key => key.startsWith(`${owner}:`)).length >= 4) return { success: false, code: 'busy', error: 'Wait for an active search to finish.' };
    const controller = new AbortController();
    this.active.set(token, controller);
    let expired = false;
    let usedKey = '';
    const timer = setTimeout(() => { expired = true; controller.abort(); }, this.timeoutMs);
    try {
      const { provider, query, mode, page } = request;
      let key = '';
      if (provider !== 'duckduckgo') {
        const credential = await this.credential(provider);
        if (credential.error) throw new SearchError('credential_unavailable', credential.error);
        key = credential.key;
        if (!key) throw new SearchError('missing_key', `Add a ${provider === 'brave' ? 'Brave Search' : 'Scira'} API key in Settings → Search, or use DuckDuckGo Quick.`);
      }
      if (controller.signal.aborted) throw new SearchError('canceled', 'Search canceled.');
      if (provider === 'scira') {
        usedKey = key;
        const failure = [this.sciraFailures.get('*'), this.sciraFailures.get(mode)]
          .find(failure => failure?.key === key && failure.until > Date.now());
        if (failure && input.retry !== true) {
          return { ...failure.response, retryBlocked: true };
        }
      }
      let url;
      let options = { headers: { Accept: 'application/json' } };
      if (provider === 'brave') {
        url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.search = new URLSearchParams({ q: query, count: '10', offset: String(page), text_decorations: 'false', result_filter: 'web' }).toString();
        options.headers['X-Subscription-Token'] = key;
      } else if (provider === 'scira') {
        const endpoint = { web: 'search', reddit: 'reddit', x: 'xsearch', people: 'people' }[mode];
        url = `https://api.scira.ai/api/${endpoint}`;
        options = { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': key },
          body: JSON.stringify(mode === 'web' ? { messages: [{ role: 'user', content: query }] } : { query }) };
      } else {
        url = new URL('https://api.duckduckgo.com/');
        url.search = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' }).toString();
      }
      const data = await this.json(String(url), options, controller.signal);
      const result = normalizeResponse(provider, data, query, mode, page);
      if (provider === 'scira') { this.sciraFailures.delete('*'); this.sciraFailures.delete(mode); }
      return { success: true, result };
    } catch (error) {
      if (controller.signal.aborted) return { success: false, code: expired ? 'timeout' : 'canceled', error: expired ? 'Search took too long. Try again.' : 'Search canceled.' };
      const response = { success: false, code: error instanceof SearchError ? error.code : 'network',
        status: error instanceof SearchError ? error.status : undefined, requestId: error instanceof SearchError ? error.requestId : undefined,
        error: error instanceof SearchError ? error.message : 'The search provider could not be reached. Check your connection and try again.' };
      if (request.provider === 'scira' && usedKey && (response.status >= 500 || ['authentication', 'rate_limit', 'invalid_response'].includes(response.code))) {
        const scope = ['authentication', 'rate_limit'].includes(response.code) ? '*' : request.mode;
        if (scope !== '*') this.sciraFailures.delete('*');
        this.sciraFailures.set(scope, { key: usedKey, until: Date.now() + 60000, response });
      }
      return response;
    } finally {
      clearTimeout(timer);
      if (this.active.get(token) === controller) this.active.delete(token);
    }
  }

  async suggest(query, provider = 'brave') {
    if (!PROVIDERS.has(provider) || typeof query !== 'string' || query.trim().length < 2 || query.length > 200) return [];
    query = query.trim();
    // Scira's documented API has no autocomplete endpoint. Its web app's
    // /api/suggest is a DuckDuckGo proxy, not an AI search API; don't call it.
    if (provider !== 'brave') return [];
    const { key } = await this.credential('brave');
    if (!key) return [];
    const cacheKey = query.toLowerCase();
    const cached = this.suggestionCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.items;
    try {
      const url = new URL('https://api.search.brave.com/res/v1/suggest/search');
      url.search = new URLSearchParams({ q: query, count: '5' }).toString();
      const data = await this.json(String(url), { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }, AbortSignal.timeout(2000));
      const items = [...new Set((Array.isArray(data.results) ? data.results : []).map(item => text(item.query, 200)).filter(Boolean))].slice(0, 5);
      if (this.suggestionCache.size >= 100) this.suggestionCache.delete(this.suggestionCache.keys().next().value);
      this.suggestionCache.set(cacheKey, { items, expires: Date.now() + 5 * 60 * 1000 });
      return items;
    } catch { return []; }
  }
}

module.exports = { SearchService, SearchError, validateRequest, normalizeResponse, safeUrl };
