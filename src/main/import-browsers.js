// Browser bookmark readers adapted from Orbe (MIT, Amadou Ba / PIXEWORK).
// Windows Firefox uses bundled node:sqlite on a disposable copy. Run readers in an import worker.
// See THIRD_PARTY_NOTICES/orbe-MIT.txt.
const fs = require('fs');
const os = require('os');
const path = require('path');

const bm = require('./import-bookmarks');

const MAX_JSON = 48 * 1024 * 1024;
const MAX_PLIST = 48 * 1024 * 1024;
const MAX_SQLITE = 400 * 1024 * 1024;
const MAX_LZ4 = 96 * 1024 * 1024;
const MAX_ITEMS = 60000;
const MAX_PROFILES = 40;
const MAX_TEXT = 64 * 1024 * 1024;

const MAX_NEST = 120;

const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', kind: 'chromium', darwin: 'Library/Application Support/Google/Chrome', win32: ['local', 'Google/Chrome/User Data'], linux: '.config/google-chrome' },
  { id: 'brave', name: 'Brave', kind: 'chromium', darwin: 'Library/Application Support/BraveSoftware/Brave-Browser', win32: ['local', 'BraveSoftware/Brave-Browser/User Data'], linux: '.config/BraveSoftware/Brave-Browser' },
  { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', darwin: 'Library/Application Support/Microsoft Edge', win32: ['local', 'Microsoft/Edge/User Data'], linux: '.config/microsoft-edge' },
  { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', darwin: 'Library/Application Support/Vivaldi', win32: ['local', 'Vivaldi/User Data'], linux: '.config/vivaldi' },
  { id: 'opera', name: 'Opera', kind: 'chromium', darwin: 'Library/Application Support/com.operasoftware.Opera', win32: ['roaming', 'Opera Software/Opera Stable'], linux: '.config/opera' },
  { id: 'chromium', name: 'Chromium', kind: 'chromium', darwin: 'Library/Application Support/Chromium', win32: ['local', 'Chromium/User Data'], linux: '.config/chromium' },
  { id: 'firefox', name: 'Firefox', kind: 'firefox', darwin: 'Library/Application Support/Firefox', win32: ['roaming', 'Mozilla/Firefox'], linux: '.mozilla/firefox' },
  { id: 'safari', name: 'Safari', kind: 'safari', darwin: 'Library/Safari' },
];

const conf = { home: os.homedir(), local: process.env.LOCALAPPDATA || '', roaming: process.env.APPDATA || '', platform: process.platform, labels: { menu: 'Bookmarks Menu', other: 'Other Bookmarks', mobile: 'Mobile Bookmarks' } };
function configure(o) {
  Object.assign(conf, o);
}

function rootOf(b, platform = conf.platform) {
  if (!conf.home) return '';
  const spec = b[platform];
  if (!spec) return '';
  if (typeof spec === 'string') return path.join(conf.home, spec);
  const base = spec[0] === 'local' ? (conf.local || path.join(conf.home, 'AppData', 'Local')) : (conf.roaming || path.join(conf.home, 'AppData', 'Roaming'));
  return path.join(base, spec[1]);
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

const denied = (err) => !!err && (err.code === 'EPERM' || err.code === 'EACCES');

function readCapped(file, max) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw Object.assign(new Error('unreadable'), { code: 'SHIIRA_UNREADABLE' });
  if (st.size > max) throw Object.assign(new Error('tooBig'), { code: 'SHIIRA_TOO_BIG' });
  return fs.readFileSync(file);
}

function build(top) {
  const st = { bookmarks: 0, folders: 0, dropped: 0, truncated: false, seen: 0 };
  const walk = (raw, depth, nest) => {
    const out = [];
    if (!Array.isArray(raw) || nest > MAX_NEST) return out;
    for (const n of raw) {
      if (st.seen >= MAX_ITEMS) { st.truncated = true; break; }
      st.seen += 1;
      if (!n || typeof n !== 'object') continue;
      if (Array.isArray(n.children)) {

        if (depth >= bm.MAX_DEPTH || st.folders >= bm.MAX_FOLDERS) {
          if (st.folders >= bm.MAX_FOLDERS) st.truncated = true;
          out.push(...walk(n.children, depth, nest + 1));
          continue;
        }
        st.folders += 1;
        const kids = walk(n.children, depth + 1, nest + 1);
        if (kids.length) out.push({ type: 'folder', name: bm.clean(n.title) || '—', children: kids });
        else st.folders -= 1;
      } else if (n.url !== undefined) {
        const url = bm.webUrl(n.url);
        if (!url) st.dropped += 1;
        else if (st.bookmarks >= bm.MAX_BOOKMARKS) st.truncated = true;
        else { st.bookmarks += 1; out.push({ type: 'tab', url, title: bm.clean(n.title) || url }); }
      }
    }
    return out;
  };
  const nodes = walk(top, 0, 0);
  return { nodes, bookmarks: st.bookmarks, folders: st.folders, dropped: st.dropped, truncated: st.truncated };
}

const layout = (bar, groups) => [...(Array.isArray(bar) ? bar : []), ...groups.filter((g) => g && Array.isArray(g.children) && g.children.length).map((g) => ({ title: g.title, children: g.children }))];

function chromiumTree(json) {
  const roots = json && typeof json === 'object' && json.roots && typeof json.roots === 'object' ? json.roots : null;
  if (!roots) throw new Error('unreadable');
  const conv = (n, nest) => {
    if (!n || typeof n !== 'object' || nest > MAX_NEST) return null;
    if (n.type === 'url') return { title: n.name, url: typeof n.url === 'string' ? n.url : '' };
    if (n.type === 'folder' || Array.isArray(n.children)) return { title: n.name, children: (Array.isArray(n.children) ? n.children : []).map((c) => conv(c, nest + 1)).filter(Boolean) };
    return null;
  };
  const kids = (r) => { const c = conv(r, 0); return c && c.children ? c : { title: '', children: [] }; };
  const bar = kids(roots.bookmark_bar);
  return layout(bar.children, [kids(roots.other), kids(roots.synced)]);
}

function readChromium(file) {
  const json = JSON.parse(readCapped(file, MAX_JSON).toString('utf8'));
  return { ...build(chromiumTree(json)), source: 'bookmarks' };
}

function chromiumProfiles(root) {
  const names = {};
  try {
    const state = JSON.parse(readCapped(path.join(root, 'Local State'), 8 * 1024 * 1024).toString('utf8'));
    const cache = state && state.profile && state.profile.info_cache;
    if (cache && typeof cache === 'object') for (const [dir, info] of Object.entries(cache).slice(0, 200)) if (info && typeof info.name === 'string') names[dir] = bm.clean(info.name).slice(0, 60);
  } catch {}
  const out = [];

  if (isFile(path.join(root, 'Bookmarks'))) out.push({ id: '.', name: '' });
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter((d) => d === 'Default' || /^Profile \d{1,4}$/.test(d)); } catch {}
  dirs.sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  for (const d of dirs) if (out.length < MAX_PROFILES && isFile(path.join(root, d, 'Bookmarks'))) out.push({ id: d, name: names[d] || d });
  return out;
}

function firefoxProfiles(root) {
  let ini = '';
  try { ini = readCapped(path.join(root, 'profiles.ini'), 1024 * 1024).toString('utf8'); } catch { return []; }
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur || !cur.Path || out.length >= MAX_PROFILES) return;
    const rel = cur.IsRelative !== '0';
    const dir = rel ? path.join(root, cur.Path) : cur.Path;

    if (rel && !path.resolve(dir).startsWith(path.resolve(root) + path.sep)) return;
    if (isFile(path.join(dir, 'places.sqlite')) || isDir(path.join(dir, 'bookmarkbackups'))) out.push({ id: cur.Path, name: bm.clean(cur.Name || '').slice(0, 60) || path.basename(dir), dir });
  };
  for (const line of ini.split(/\r?\n/).slice(0, 5000)) {
    const sec = /^\[(.+)\]\s*$/.exec(line);
    if (sec) { flush(); cur = /^Profile\d+$/i.test(sec[1]) ? {} : null; continue; }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (cur && kv) cur[kv[1]] = kv[2].trim();
  }
  flush();
  return out;
}

function lz4Block(src, size) {
  if (!Number.isInteger(size) || size < 0 || size > MAX_LZ4) throw new Error('tooBig');
  const out = Buffer.alloc(size);
  let i = 0;
  let o = 0;
  const more = (n) => { let b; do { if (i >= src.length) throw new Error('lz4'); b = src[i++]; n += b; } while (b === 255); return n; };
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) lit = more(lit);
    if (i + lit > src.length || o + lit > size) throw new Error('lz4');
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    if (i + 2 > src.length) throw new Error('lz4');
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    if (off === 0 || off > o) throw new Error('lz4');
    let len = token & 15;
    if (len === 15) len = more(len);
    len += 4;
    if (o + len > size) throw new Error('lz4');
    for (let k = 0; k < len; k++, o++) out[o] = out[o - off];
  }
  if (o !== size) throw new Error('lz4');
  return out;
}

function mozlz4(buf) {
  if (buf.length < 12 || buf.subarray(0, 8).toString('latin1') !== 'mozLz40\0') throw new Error('unreadable');
  return lz4Block(buf.subarray(12), buf.readUInt32LE(8));
}

const FF_ROOTS = { toolbarFolder: 'bar', bookmarksMenuFolder: 'menu', unfiledBookmarksFolder: 'other', mobileFolder: 'mobile' };
function firefoxJsonTree(json) {
  const conv = (n, nest) => {
    if (!n || typeof n !== 'object' || nest > MAX_NEST) return null;
    if (n.type === 'text/x-moz-place') return { title: n.title, url: typeof n.uri === 'string' ? n.uri : '' };
    if (n.type === 'text/x-moz-place-container') return { title: n.title, children: (Array.isArray(n.children) ? n.children : []).map((c) => conv(c, nest + 1)).filter(Boolean) };
    return null;
  };
  const found = {};
  for (const r of Array.isArray(json && json.children) ? json.children.slice(0, 20) : []) {
    const key = r && FF_ROOTS[r.root];
    const c = key && conv(r, 0);
    if (c && c.children) found[key] = c;
  }
  if (!Object.keys(found).length) throw new Error('unreadable');
  const named = (k) => (found[k] ? { title: conf.labels[k], children: found[k].children } : null);
  return layout(found.bar && found.bar.children, [named('menu'), named('other'), named('mobile')]);
}

function latestBackup(dir) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'bookmarkbackups')).filter((f) => /^bookmarks-\d{4}-\d{2}-\d{2}.*\.jsonlz4$/.test(f)); } catch {}
  files.sort();
  const name = files.pop();
  return name ? { file: path.join(dir, 'bookmarkbackups', name), date: name.slice(10, 20) } : null;
}

function readFirefoxBackup(dir) {
  const b = latestBackup(dir);
  if (!b) throw new Error('unreadable');
  const json = JSON.parse(mozlz4(readCapped(b.file, MAX_JSON)).toString('utf8'));
  return { ...build(firefoxJsonTree(json)), source: 'backup', date: b.date };
}

const FF_GUIDS = { toolbar_____: 'bar', menu________: 'menu', unfiled_____: 'other', mobile______: 'mobile' };
function firefoxRowsTree(rows) {
  const by = new Map();
  const roots = {};
  for (const r of Array.isArray(rows) ? rows.slice(0, MAX_ITEMS) : []) {
    if (!r || typeof r !== 'object') continue;
    if (FF_GUIDS[r.guid]) roots[FF_GUIDS[r.guid]] = r;
    if (!by.has(r.parent)) by.set(r.parent, []);
    by.get(r.parent).push(r);
  }

  const opened = new Set();
  let made = 0;
  const kids = (id, nest) => {
    if (nest > MAX_NEST || opened.has(id)) return [];
    opened.add(id);
    const out = [];
    for (const r of by.get(id) || []) {
      if (++made > MAX_ITEMS) break;
      if (r.type === 1) out.push({ title: r.title, url: typeof r.url === 'string' ? r.url : '' });
      else if (r.type === 2) out.push({ title: r.title, children: kids(r.id, nest + 1) });
    }
    return out;
  };
  if (!Object.keys(roots).length) throw new Error('unreadable');
  const group = (k) => (roots[k] ? { title: conf.labels[k], children: kids(roots[k].id, 0) } : null);
  return layout(roots.bar ? kids(roots.bar.id, 0) : [], [group('menu'), group('other'), group('mobile')]);
}

async function readFirefoxSqlite(dir) {
  const db = path.join(dir, 'places.sqlite');
  if (!isFile(db)) throw new Error('unreadable');
  if (fs.statSync(db).size > MAX_SQLITE) throw new Error('tooBig');
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shiira-import-'));
  let database;
  try {
    const copy = path.join(tmp, 'places.sqlite');
    await fs.promises.copyFile(db, copy);
    for (const suffix of ['-wal', '-journal']) {
      if (isFile(db + suffix)) {
        if (fs.statSync(db + suffix).size > MAX_SQLITE) throw new Error('tooBig');
        await fs.promises.copyFile(db + suffix, copy + suffix);
      }
    }
    const { DatabaseSync } = require('node:sqlite');
    database = new DatabaseSync(copy, { readOnly: true, enableExtensions: false });
    database.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;');
    const rows = database.prepare('SELECT b.id, b.type, b.parent, b.guid, b.title, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position LIMIT ' + MAX_ITEMS).all();
    return { ...build(firefoxRowsTree(rows)), source: 'sqlite' };
  } finally {
    database?.close();
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}

async function readFirefox(dir) {
  try { return await readFirefoxSqlite(dir); } catch (err) { if (denied(err)) throw err; }
  return readFirefoxBackup(dir);
}

function bplist(buf) {
  if (buf.length < 40 || buf.subarray(0, 8).toString('latin1') !== 'bplist00') throw new Error('unreadable');
  const tr = buf.length - 32;
  const offSize = buf[tr + 6];
  const refSize = buf[tr + 7];
  const count = Number(buf.readBigUInt64BE(tr + 8));
  const top = Number(buf.readBigUInt64BE(tr + 16));
  const table = Number(buf.readBigUInt64BE(tr + 24));
  if (![1, 2, 3, 4, 8].includes(offSize) || ![1, 2, 3, 4, 8].includes(refSize) || count < 1 || count > 4e6 || top >= count || table < 8 || table + count * offSize > tr) throw new Error('unreadable');
  const uint = (at, n) => { if (at < 0 || at + n > tr) throw new Error('unreadable'); let v = 0; for (let k = 0; k < n; k++) v = v * 256 + buf[at + k]; return v; };
  let visited = 0;
  let decoded = 0;

  const memo = new Map();
  const BUSY = Symbol('decoding');
  const lenAt = (at, info) => {
    if (info !== 15) return [info, at + 1];
    const m = buf[at + 1];
    if ((m >> 4) !== 1) throw new Error('unreadable');
    const n = 1 << (m & 15);
    return [uint(at + 2, n), at + 2 + n];
  };
  const read = (ref, nest) => {
    if (memo.has(ref)) { const v = memo.get(ref); if (v === BUSY) throw new Error('unreadable'); return v; }
    memo.set(ref, BUSY);
    const v = decode(ref, nest);
    memo.set(ref, v);
    return v;
  };
  const decode = (ref, nest) => {
    if (ref >= count || nest > MAX_NEST || ++visited > 600000) throw new Error('unreadable');
    const at = uint(table + ref * offSize, offSize);
    if (at < 8 || at >= table) throw new Error('unreadable');
    const marker = buf[at];
    const type = marker >> 4;
    const info = marker & 15;
    if (type === 0) return info === 9 ? true : info === 8 ? false : null;
    if (type === 1) return uint(at + 1, Math.min(8, 1 << info));
    if (type === 2) return info === 2 ? buf.readFloatBE(at + 1) : info === 3 ? buf.readDoubleBE(at + 1) : 0;
    if (type === 5 || type === 6) {
      const [n, from] = lenAt(at, info);
      const bytes = type === 5 ? n : n * 2;
      if (n > 1e6 || from + bytes > table || (decoded += n) > MAX_TEXT) throw new Error('unreadable');
      if (type === 5) return buf.toString('latin1', from, from + bytes);
      const swapped = Buffer.from(buf.subarray(from, from + bytes));
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    if (type === 10 || type === 13) {
      const [n, from] = lenAt(at, info);
      if (n > 1e6 || from + n * refSize * (type === 13 ? 2 : 1) > table) throw new Error('unreadable');
      if (type === 10) { const arr = []; for (let k = 0; k < n; k++) arr.push(read(uint(from + k * refSize, refSize), nest + 1)); return arr; }
      const obj = Object.create(null);
      for (let k = 0; k < n; k++) {
        const key = read(uint(from + k * refSize, refSize), nest + 1);
        if (typeof key === 'string') obj[key] = read(uint(from + (n + k) * refSize, refSize), nest + 1);
      }
      return obj;
    }
    return null;
  };
  return read(top, 0);
}

function safariTree(root) {
  if (!root || typeof root !== 'object' || !Array.isArray(root.Children)) throw new Error('unreadable');
  let made = 0;
  const conv = (n, nest) => {
    if (!n || typeof n !== 'object' || nest > MAX_NEST || ++made > MAX_ITEMS) return null;
    if (n.WebBookmarkType === 'WebBookmarkTypeLeaf') return { title: n.URIDictionary && typeof n.URIDictionary === 'object' ? n.URIDictionary.title : n.Title, url: typeof n.URLString === 'string' ? n.URLString : '' };
    if (n.WebBookmarkType === 'WebBookmarkTypeList') return { title: n.Title, children: (Array.isArray(n.Children) ? n.Children : []).map((c) => conv(c, nest + 1)).filter(Boolean) };
    return null;
  };
  let bar = [];
  const groups = [];
  const loose = [];
  for (const c of root.Children) {
    const n = conv(c, 0);
    if (!n) continue;
    if (!n.children) loose.push(n);
    else if (c.Title === 'BookmarksBar') bar = n.children;
    else if (c.Title === 'com.apple.ReadingList') continue;
    else groups.push(c.Title === 'BookmarksMenu' ? { title: conf.labels.menu, children: n.children } : n);
  }
  return layout([...bar, ...loose], groups);
}

function readSafari(file) {
  return { ...build(safariTree(bplist(readCapped(file, MAX_PLIST)))), source: 'plist' };
}

function profilesOf(b, root) {
  if (b.kind === 'chromium') return chromiumProfiles(root);
  if (b.kind === 'firefox') return firefoxProfiles(root).map((p) => ({ id: p.id, name: p.name }));
  return [{ id: '.', name: '' }];
}

function detect({ platform = conf.platform } = {}) {
  const out = [];
  for (const b of BROWSERS) {
    const root = rootOf(b, platform);
    if (!root) continue;
    if (b.kind === 'safari') {
      const file = path.join(root, 'Bookmarks.plist');
      try { fs.closeSync(fs.openSync(file, 'r')); out.push({ id: b.id, name: b.name, profiles: [{ id: '.', name: '' }] }); } catch (err) {
        if (denied(err)) out.push({ id: b.id, name: b.name, profiles: [{ id: '.', name: '' }], blocked: 'fullDiskAccess' });
      }
      continue;
    }
    if (!isDir(root)) continue;
    const profiles = profilesOf(b, root);
    if (profiles.length) out.push({ id: b.id, name: b.name, profiles });
  }
  return out;
}

async function read(browserId, profileId, { platform = conf.platform } = {}) {
  const b = BROWSERS.find((x) => x.id === browserId);
  const root = b ? rootOf(b, platform) : '';
  if (!root) return { error: 'missing' };
  try {
    let data;
    if (b.kind === 'safari') data = readSafari(path.join(root, 'Bookmarks.plist'));
    else if (b.kind === 'chromium') {
      const p = chromiumProfiles(root).find((x) => x.id === profileId);
      if (!p) return { error: 'missing' };
      data = readChromium(path.join(root, p.id, 'Bookmarks'));
    } else {
      const p = firefoxProfiles(root).find((x) => x.id === profileId);
      if (!p) return { error: 'missing' };
      data = await readFirefox(p.dir);
    }
    if (!data.bookmarks) return { error: 'empty', ...data, browser: b.id, name: b.name };
    return { ...data, browser: b.id, name: b.name };
  } catch (err) {
    if (denied(err)) return { error: b.kind === 'safari' ? 'fullDiskAccess' : 'unreadable' };
    return { error: err && (err.code === 'SHIIRA_TOO_BIG' || err.message === 'tooBig') ? 'tooBig' : 'unreadable' };
  }
}

module.exports = { firefoxRowsTree, safariTree, MAX_ITEMS, BROWSERS, configure, detect, read, build, readChromium, readSafari, readFirefoxBackup, readFirefoxSqlite, firefoxProfiles, chromiumProfiles, bplist, lz4Block, mozlz4, rootOf, conf };
