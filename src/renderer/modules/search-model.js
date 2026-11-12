export const SEARCH_ENGINES = {
  brave: { label: 'Brave Search', logo: 'shiira-asset://site-logos/brave-search.svg' },
  scira: { label: 'Scira AI', logo: 'shiira-asset://site-logos/scira.svg' },
  duckduckgo: { label: 'DuckDuckGo Quick', logo: 'shiira-asset://site-logos/duckduckgo.svg' }
};

export function normalizeSearchEngine(engine) {
  return Object.hasOwn(SEARCH_ENGINES, engine) ? engine : 'brave';
}

export const SCIRA_SCOPES = {
  web: { label: 'Web' },
  reddit: { label: 'Reddit' },
  x: { label: 'X' },
  people: { label: 'People' }
};

export function normalizeSearchMode(provider, mode) {
  return provider === 'scira' && Object.hasOwn(SCIRA_SCOPES, mode) ? mode : 'web';
}

export function searchUrl(query, engine = 'brave', mode = 'web') {
  engine = normalizeSearchEngine(engine);
  return `shiira://search?${new URLSearchParams({ q: query.trim(), engine, mode: normalizeSearchMode(engine, mode) })}`;
}

export function websiteSearchUrl(query, provider, mode = 'web') {
  if (typeof query !== 'string' || !query.trim()) return null;
  const endpoint = { brave: 'https://search.brave.com/search', scira: 'https://scira.ai/' };
  if (!Object.hasOwn(endpoint, provider)) return null;
  const url = new URL(endpoint[provider]);
  url.searchParams.set('q', query.trim());
  if (provider === 'brave') url.searchParams.set('source', 'web');
  if (provider === 'scira') url.searchParams.set('group', normalizeSearchMode(provider, mode));
  return url.href;
}

export function parseSearchUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'shiira:' || url.hostname !== 'search') return null;
    const query = url.searchParams.get('q')?.trim();
    if (!query) return null;
    const provider = normalizeSearchEngine(url.searchParams.get('engine'));
    const mode = normalizeSearchMode(provider, url.searchParams.get('mode'));
    return { query, provider, mode };
  } catch { return null; }
}

export function safeResultUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
