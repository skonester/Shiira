// Shared by the sandboxed tab preload, stream service, and filtering hooks.
function hostIs(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port &&
      (hostIs(url.hostname, 'youtube.com') || hostIs(url.hostname, 'youtube-nocookie.com') || url.hostname === 'youtu.be');
  } catch { return false; }
}

function videoIdFromUrl(value) {
  if (!isYouTubeUrl(value)) return null;
  const url = new URL(value);
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
    : url.pathname === '/watch' ? url.searchParams.get('v')
      : /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(url.pathname)?.[1];
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

function startSeconds(value) {
  const url = new URL(value);
  const raw = url.searchParams.get('t') || url.searchParams.get('start') ||
    new URLSearchParams(url.hash.slice(1)).get('t') || '';
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 604800);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  return match ? Math.min(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0), 604800) : 0;
}

function isMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (hostIs(url.hostname, 'googlevideo.com') ||
        (hostIs(url.hostname, 'youtube.com') && url.pathname === '/api/timedtext'));
  } catch { return false; }
}

function isYouTubePlaybackRequest(details) {
  if (isMediaUrl(details.url)) return true;
  try {
    const url = new URL(details.url);
    return url.protocol === 'https:' &&
      (hostIs(url.hostname, 'youtube.com') || url.hostname === 'youtubei.googleapis.com') &&
      /^\/youtubei\/v1\/(?:player|next)(?:$|\?)/.test(url.pathname);
  } catch { return false; }
}

module.exports = { isYouTubeUrl, videoIdFromUrl, startSeconds, isMediaUrl, isYouTubePlaybackRequest };
