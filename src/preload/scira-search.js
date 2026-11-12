// Scira's website uses enabled sources in addition to the URL's group. Set
// both before its scripts run, so an explicit homepage search cannot inherit
// Web (or another source) from the website's defaults or saved preferences.
// This preload exposes no Electron bridge or credentials to webpages.
(() => {
  if (window.top !== window) return;
  const url = new URL(window.location.href);
  if (url.origin !== 'https://scira.ai' || url.pathname !== '/') return;
  if (!(url.searchParams.get('q') || url.searchParams.get('query'))?.trim()) return;
  const group = url.searchParams.get('group');
  if (!['web', 'reddit', 'x'].includes(group)) return;
  try {
    localStorage.setItem('scira-selected-group', JSON.stringify(group));
    localStorage.setItem('scira-delegate-enabled-groups', JSON.stringify([group]));
    localStorage.setItem('scira-multi-agent-enabled', 'false');
  } catch {
    // Browsing remains available if the site disallows local storage.
  }
})();
