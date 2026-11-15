// Netscape bookmark parser adapted from Orbe (MIT, Amadou Ba / PIXEWORK).
// Bounded text parsing; imported files never execute. See THIRD_PARTY_NOTICES/orbe-MIT.txt.
const fs = require('fs');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TAG = 512 * 1024;
const MAX_BOOKMARKS = 3000;
const MAX_FOLDERS = 600;
const MAX_DEPTH = 8;
const MAX_TITLE = 200;
const MAX_URL = 2000;
const MAX_ITEMS = 30000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e) => {
    if (e[0] !== '#') return Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

const clean = (s) => decode(String(s).replace(/<[^>]*>/g, '')).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

function attr(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? decode(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : null;
}

function webUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > MAX_URL || !/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

function parse(text) {
  const src = String(text || '');
  const lower = src.toLowerCase();
  const root = { type: 'folder', name: '', children: [] };
  const stack = [root];
  let pending = null;
  let overflow = 0;
  let bookmarks = 0;
  let folders = 0;
  let dropped = 0;
  let truncated = false;
  let items = 0;
  let i = 0;
  let nextGt = -1;

  const is = (at, name) => lower.startsWith(name, at) && !/[a-z0-9]/.test(lower[at + name.length] || '');

  const inner = (from, closing) => {

    const near = lower.slice(from, from + 4000);
    let end = near.indexOf(closing);
    if (end < 0) end = near.indexOf('<');
    if (end < 0) end = near.length;
    return { text: clean(src.slice(from, from + end)), end: from + end };
  };

  for (;;) {
    i = src.indexOf('<', i);
    if (i < 0) break;
    if (nextGt < i) { nextGt = src.indexOf('>', i); if (nextGt < 0) break; }
    const end = nextGt;
    if (end - i > MAX_TAG) { i += 1; continue; }
    const at = i + 1;
    if (is(at, '/dl')) {
      if (overflow) overflow -= 1;
      else if (stack.length > 1) stack.pop();
      pending = null;
    } else if (is(at, 'dl')) {
      if (pending) {
        if (stack.length > MAX_DEPTH) overflow += 1;
        else { stack[stack.length - 1].children.push(pending); stack.push(pending); folders += 1; }
        pending = null;
      } else if (stack.length > 1 || root.opened) overflow += 1;
      else root.opened = true;
    } else if ((is(at, 'h3') || is(at, 'a')) && ++items > MAX_ITEMS) {
      truncated = true;
      break;
    } else if (is(at, 'h3')) {
      const tag = src.slice(i, end + 1);
      const t = inner(end + 1, '</h3');
      if (folders >= MAX_FOLDERS) { truncated = true; pending = null; }
      else {
        pending = { type: 'folder', name: t.text || '—', children: [] };
        if (/\spersonal_toolbar_folder\s*=\s*["']?true/i.test(tag)) pending.toolbar = true;
      }
    } else if (is(at, 'a')) {
      const tag = src.slice(i, end + 1);
      const url = webUrl(attr(tag, 'href'));
      const t = inner(end + 1, '</a');
      if (!url) dropped += 1;
      else if (bookmarks >= MAX_BOOKMARKS) { truncated = true; break; }
      else { stack[stack.length - 1].children.push({ type: 'tab', url, title: t.text || url }); bookmarks += 1; }
    }
    i = end + 1;
  }

  let kept = 0;
  const prune = (nodes) => nodes.filter((n) => {
    if (n.type !== 'folder') return true;
    n.children = prune(n.children);
    if (n.children.length) kept += 1;
    return n.children.length > 0;
  });
  let nodes = prune(root.children);

  const bar = nodes.find((n) => n.type === 'folder' && n.toolbar);
  if (bar) { nodes = [...bar.children, ...nodes.filter((n) => n !== bar)]; kept -= 1; }
  const strip = (list) => { for (const n of list) if (n.type === 'folder') { delete n.toolbar; strip(n.children); } };
  strip(nodes);

  const head = lower.slice(0, 2000);
  const source = /netscape-bookmark-file/.test(head) ? 'netscape' : '';
  return { nodes, bookmarks, folders: Math.max(0, kept), dropped, truncated, source };
}

function read(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return { error: 'unreadable' }; }
  if (!stat.isFile()) return { error: 'unreadable' };
  if (stat.size > MAX_BYTES) return { error: 'tooBig' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { error: 'unreadable' }; }
  const data = parse(text);
  if (!data.source || !data.bookmarks) return { error: 'notBookmarks', ...data };
  return data;
}

module.exports = { parse, read, clean, webUrl, MAX_BYTES, MAX_BOOKMARKS, MAX_DEPTH, MAX_FOLDERS };
