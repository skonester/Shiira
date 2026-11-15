// Keep-alive rules adapted from Orbe (MIT). See THIRD_PARTY_NOTICES/orbe-MIT.txt.
const RULES = [
  { host: 'twitter.com', sub: true }, { host: 'x.com' },
  { host: 'app.slack.com', path: '/client' },
  { host: 'mail.google.com', path: '/mail' },
  { host: 'calendar.google.com', path: '/calendar' },
  { host: 'notion.so', sub: true }, { host: 'app.notion.com' },
  { host: 'dropbox.com', sub: true },
  { host: 'aws.amazon.com', sub: true },
  { host: 'open.spotify.com' },
  { host: 'linear.app' },
  { host: 'instagram.com', sub: true },
  { host: 'messenger.com', sub: true },
  { host: 'facebook.com', sub: true },
  { host: 'web.whatsapp.com' },
  { host: 'sentry.io', sub: true },
  { host: 'figma.com', sub: true, path: '/file/' }, { host: 'figma.com', sub: true, path: '/design/' },
  { host: 'docs.google.com', path: '/document' },
  { host: 'docs.google.com', path: '/presentation' },
  { host: 'docs.google.com', path: '/spreadsheets' },
  { host: 'outlook.live.com', path: '/mail' }, { host: 'outlook.live.com', path: '/calendar' },
  { host: 'outlook.office.com', path: '/mail' }, { host: 'outlook.office.com', path: '/calendar' },
  { host: 'teams.microsoft.com' },
  { host: 'discord.com', path: '/channels' },
  { host: 'web.telegram.org' },
  { host: 'music.youtube.com' },
  { host: 'music.apple.com' },
  { host: 'deezer.com', sub: true },
];

export function keepAliveSite(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return RULES.some((r) => (host === r.host || (r.sub && host.endsWith('.' + r.host))) && (!r.path || u.pathname.startsWith(r.path)));
}

export function protectsWork(tab) {
  return !!(tab.hasUserInput || tab.isPictureInPicture || tab.hasMediaPermission || tab.isPlayingAudio || tab.sleepBlocked || keepAliveSite(tab.url));
}
