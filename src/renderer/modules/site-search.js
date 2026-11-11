// Arc's Tab to Search, adapted from YARC's src/shared/site-search.ts
// (https://github.com/yenebeb/arc-shell, GPL-3.0-or-later).
// See THIRD_PARTY_NOTICES/yarc-GPL-3.0-NOTICE.txt.
export const SITE_SEARCHES = [
  ['Google Drive', 'drive.google.com', 'https://drive.google.com/drive/search?q=%s'],
  ['Gmail', 'mail.google.com', 'https://mail.google.com/mail/u/0/#search/%s'],
  ['Google Maps', 'maps.google.com', 'https://www.google.com/maps/search/%s'],
  ['Google Calendar', 'calendar.google.com', 'https://calendar.google.com/calendar/u/0/r/search?q=%s'],
  ['Google Docs', 'docs.google.com', 'https://docs.google.com/document/u/0/?q=%s'],
  ['Dropbox', 'dropbox.com', 'https://www.dropbox.com/search/personal?query=%s'],
  ['Amazon', 'amazon.com', 'https://www.amazon.com/s?k=%s'],
  ['GitHub', 'github.com', 'https://github.com/search?q=%s'],
  ['Figma', 'figma.com', 'https://www.figma.com/files/search?q=%s'],
  ['X', 'x.com', 'https://x.com/search?q=%s'],
  ['X', 'twitter.com', 'https://x.com/search?q=%s'],
  ['YouTube', 'youtube.com', 'https://www.youtube.com/results?search_query=%s'],
  ['Wikipedia', 'wikipedia.org', 'https://wikipedia.org/w/index.php?search=%s'],
  ['Reddit', 'reddit.com', 'https://www.reddit.com/search/?q=%s'],
  ['SoundCloud', 'soundcloud.com', 'https://soundcloud.com/search?q=%s'],
  ['Asana', 'asana.com', 'https://app.asana.com/0/search?q=%s'],
  ['LinkedIn', 'linkedin.com', 'https://www.linkedin.com/search/results/all/?keywords=%s'],
  ['Apple Music', 'music.apple.com', 'https://music.apple.com/us/search?term=%s'],
  ['Spotify', 'spotify.com', 'https://open.spotify.com/search/%s'],
  ['Google', 'google.com', 'https://www.google.com/search?q=%s'],
  ['Microsoft Bing', 'bing.com', 'https://www.bing.com/search?q=%s'],
  ['DuckDuckGo', 'duckduckgo.com', 'shiira://search?engine=duckduckgo&q=%s'],
  ['Ecosia', 'ecosia.org', 'https://www.ecosia.org/search?q=%s'],
  ['Brave', 'search.brave.com', 'shiira://search?engine=brave&q=%s'],
  ['Scira AI', 'scira.ai', 'shiira://search?engine=scira&q=%s'],
  ['Qwant', 'qwant.com', 'https://www.qwant.com/?q=%s'],
  ['PrivacyWall', 'privacywall.org', 'https://www.privacywall.org/search/secure/?q=%s'],
  ['Perplexity', 'perplexity.ai', 'https://www.perplexity.ai/search?q=%s']
].map(([name, keyword, url]) => ({ name, keyword, url }));

export function matchSiteSearch(input) {
  const text = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  if (!text) return undefined;
  const exact = SITE_SEARCHES.find(s => s.keyword === text || s.name.toLowerCase() === text);
  if (exact || text.length < 2) return exact;
  return SITE_SEARCHES.find(s => s.keyword.startsWith(text)) || SITE_SEARCHES.find(s => s.name.toLowerCase().startsWith(text));
}

export function siteSearchUrl(site, query) {
  return site.url.replace('%s', encodeURIComponent(query.trim()));
}
