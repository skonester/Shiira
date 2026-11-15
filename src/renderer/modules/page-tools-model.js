// Clean link copy adapted from Orbe (MIT). See THIRD_PARTY_NOTICES/orbe-MIT.txt.
const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|yclid|twclid|ttclid|li_fat_id|_hsenc|_hsmi|__hssc|__hstc|__hsfp|hsctatracking|mkt_tok|vero_id|vero_conv|oly_anon_id|oly_enc_id|s_cid|ref_src|ref_url|rb_clickid|srsltid|_openstat|wickedid|_ga|_gl|si)$/i;


const AMAZON = /(^|\.)amazon\.(com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|com\.be|ie|com\.tr|ae|sa|eg|in|co\.jp|com\.au|sg|cn|co\.za)$/i;
export function cleanUrl(input) {
  let u;
  try { u = new URL(input); } catch { return input; }
  if (!/^https?:$/.test(u.protocol)) return input;

  const share = /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i.test(u.hostname);
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    if (!TRACKING.test(key) || (key.toLowerCase() === 'si' && !share)) continue;
    u.searchParams.delete(key);
    changed = true;
  }
  const product = AMAZON.test(u.hostname) && /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/.exec(u.pathname);
  if (product) return `${u.origin}/dp/${product[1]}`;
  if (!changed) return input;
  return u.toString().replace(/\?(#|$)/, '$1');
}




export function mdLink(title, url) {
  const text = String(title || url || '').replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
  const href = String(url || '').replace(/[()<>\s\\]/g, (c) => encodeURIComponent(c).replace(/[()]/g, (x) => '%' + x.charCodeAt(0).toString(16).toUpperCase()));
  return `[${text}](${href})`;
}

const html = text => String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function spaceBookmarksHtml(space, tabs, folders) {
  const walk = (parentId, depth = 0) => {
    if (depth > 32) return '';
    const entries = [...tabs.filter(t => t.spaceId === space.id && t.section === 'pinned' && !t.privateMode && (t.parentId || null) === parentId).map(t => ({ tab: t, position: t.position })),
      ...folders.filter(f => f.spaceId === space.id && (f.parentId || null) === parentId).map(f => ({ folder: f, position: f.position }))].sort((a, b) => (a.position || 0) - (b.position || 0));
    return entries.map(({ tab, folder }) => {
      if (folder) return `<DT><H3>${html(folder.title)}</H3>\n<DL><p>\n${walk(folder.id, depth + 1)}</DL><p>\n`;
      const url = tab.pinnedUrl || tab.url;
      if (!/^https?:\/\//i.test(url || '')) return '';
      return `<DT><A HREF="${html(url)}">${html(tab.customTitle || tab.title || url)}</A>\n`;
    }).join('');
  };
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>${html(space.title)}</TITLE>\n<H1>${html(space.title)}</H1>\n<DL><p>\n${walk(null)}</DL><p>\n`;
}

export function recentTabs(tabs, activeId, limit = 8) {
  return tabs.filter(t => !t.element?.classList.contains('closing')).sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return (b.activationOrder || 0) - (a.activationOrder || 0) || (b.lastActiveAt || 0) - (a.lastActiveAt || 0);
  }).slice(0, limit).map(t => t.id);
}
