export const SEARCH_ENGINES = {
  brave: { label: 'Brave Search', logo: 'shiira-asset://site-logos/brave-search.svg' },
  scira: { label: 'Scira AI', logo: 'shiira-asset://site-logos/scira.svg' },
  duckduckgo: { label: 'DuckDuckGo Quick', logo: 'shiira-asset://ui-icons/search.svg' }
};

export function normalizeSearchEngine(engine) {
  return Object.hasOwn(SEARCH_ENGINES, engine) ? engine : 'brave';
}

export function searchUrl(query, engine = 'brave', mode = 'web') {
  return `shiira://search?${new URLSearchParams({ q: query.trim(), engine: normalizeSearchEngine(engine), mode })}`;
}

export function parseSearchUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'shiira:' || url.hostname !== 'search') return null;
    const query = url.searchParams.get('q')?.trim();
    if (!query) return null;
    const provider = normalizeSearchEngine(url.searchParams.get('engine'));
    const mode = provider === 'scira' && ['web', 'reddit', 'x', 'people'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'web';
    return { query, provider, mode };
  } catch { return null; }
}

export function safeResultUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
