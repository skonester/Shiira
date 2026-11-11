// Pinned/favorite tabs keep their page while links to other hosts open in Peek.
export function linkRoute({ href, currentUrl, pinned, peekEnabled, type = 'click', button = 0,
  ctrlKey = false, metaKey = false, shiftKey = false, altKey = false, target = '', rel = '', download = false }) {
  if (download || !/^https?:\/\//i.test(href || '') || (button !== 0 && button !== 1)) return null;
  const plainClick = type === 'click' && button === 0 && !ctrlKey && !metaKey && !altKey;
  let otherHost = false;
  try { otherHost = new URL(href).hostname.replace(/^www\./, '') !== new URL(currentUrl).hostname.replace(/^www\./, ''); } catch {}
  if (peekEnabled && plainClick && (shiftKey || (pinned && otherHost))) return 'peek';
  if (button === 1 || ctrlKey || metaKey || shiftKey || /^(?:_blank|blank)$/i.test(target) || /\bexternal\b/i.test(rel)) return 'tab';
  return null;
}

export function linkRoutingScript(options) {
  return `(() => {
    window.__shiiraLinkRoutingOptions = ${JSON.stringify(options)};
    if (window.__shiiraLinkRoutingInstalled) return;
    window.__shiiraLinkRoutingInstalled = true;
    const decide = ${linkRoute.toString()};
    const route = event => {
      const anchor = event.composedPath?.().find(node => node?.matches?.('a[href]')) || event.target?.closest?.('a[href]');
      if (!anchor) return;
      const action = decide({ ...window.__shiiraLinkRoutingOptions, href: anchor.href, currentUrl: location.href,
        type: event.type, button: event.button, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        shiftKey: event.shiftKey, altKey: event.altKey, target: anchor.getAttribute('target') || '',
        rel: anchor.getAttribute('rel') || '', download: anchor.hasAttribute('download') });
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      console.log((action === 'peek' ? '[SHIIRA_PEEK_LINK] ' : '[SHIIRA_OPEN_LINK] ') + anchor.href);
    };
    document.addEventListener('click', route, true);
    document.addEventListener('auxclick', route, true);
  })();`;
}
