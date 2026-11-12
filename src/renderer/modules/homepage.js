export function normalizeHomepage(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function getHomepage() {
  return normalizeHomepage(localStorage.getItem('shiira-homepage-url')) || 'shiira://home';
}
