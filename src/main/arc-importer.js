// Read-only Arc migration, adapted from YARC's arc-sidebar.ts and chromium.ts
// (https://github.com/yenebeb/arc-shell) and Solamar's arc-parse.ts
// (https://github.com/Bambeek/solamar), both GPL-3.0-or-later.
// See THIRD_PARTY_NOTICES/yarc-GPL-3.0-NOTICE.txt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

const MAX_DEPTH = 32;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ICON_BYTES = 16 * 1024;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
const unwrap = (v) => isObject(v?.value) ? v.value : v;
const importableUrl = (v) => typeof v === 'string' && v.length <= 8192 && /^(https?|file):/i.test(v);

class ArcFormatError extends Error {}

// Swift dictionaries: flat pairs, objects, arrays of objects, or {value: object} wrappers.
function swiftEntries(value) {
  if (isObject(value)) return Object.entries(value).flatMap(([key, raw]) => {
    const entry = unwrap(raw);
    return isObject(entry) ? [[text(entry.id) || key, entry]] : [];
  });
  const out = [];
  let key;
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw === 'string') { key = raw; continue; }
    const entry = unwrap(raw);
    if (isObject(entry)) out.push([text(entry.id) || key || '', entry]);
    key = undefined;
  }
  return out;
}

function roleId(value, role) {
  if (isObject(value)) return text(value[role]);
  if (!Array.isArray(value)) return undefined;
  for (let i = 0; i + 1 < value.length; i++) {
    if (value[i] === role || (isObject(value[i]) && role in value[i])) return text(value[i + 1]);
  }
}

function arcTime(value) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value > 1e11 ? value : 978307200000 + value * 1000);
}

function colorToHex(color) {
  if (!isObject(color) || ![color.red, color.green, color.blue].every(Number.isFinite) || color.alpha <= 0) return undefined;
  // Extended sRGB may exceed 1 slightly. Old exports also used byte components.
  const scale = Math.max(color.red, color.green, color.blue) > 2 ? 1 : 255;
  return '#' + [color.red, color.green, color.blue].map((c) => Math.round(Math.max(0, Math.min(255, c * scale))).toString(16).padStart(2, '0')).join('');
}

function colorOf(theme) {
  const mid = colorToHex(theme?.primaryColorPalette?.midTone);
  if (mid) return mid;
  const queue = [theme?.background];
  let budget = 500;
  while (queue.length && budget-- > 0) {
    const entry = queue.shift();
    const color = colorToHex(entry);
    if (color) return color;
    if (Array.isArray(entry)) queue.push(...entry);
    else if (isObject(entry)) queue.push(...Object.values(entry));
  }
}

const ARC_ICONS = {
  star: '⭐', bookmark: '🔖', heart: '❤️', flag: '🚩', flash: '⚡', triangle: '🔺', medical: '⚕️',
  notifications: '🔔', bulb: '💡', shapes: '🔷', grid: '🔲', apps: '🧩', layers: '🗂️', server: '🗄️',
  albums: '🖼️', copy: '📋', folder: '📁', fileTrayFull: '🗃️', calendar: '📅', mail: '✉️', checkbox: '✅',
  document: '📄', book: '📖', chatBubbleEllipses: '💬', people: '👥', terminal: '⌨️', construction: '🚧',
  square: '🟦', egg: '🥚', ellipse: '🔵', moon: '🌙', sunny: '☀️', planet: '🪐', leaf: '🍃', cloud: '☁️',
  paw: '🐾', bag: '🛍️', gift: '🎁', bed: '🛏️', restaurant: '🍴', barbell: '🏋️', airplane: '✈️',
  musicalNote: '🎵', colorPallete: '🎨', video: '🎬', bandage: '🩹', code: '💻', baseball: '⚾',
  cloudOutline: '🌥️', map: '🗺️', bonfire: '🔥', pizza: '🍕', skull: '💀', receipt: '🧾', thumbsUp: '👍',
  train: '🚆', rss: '📡', github: '🐙', linear: '📐', figma: '🖌️', search: '🔍'
};

function emojiOf(icon) {
  if (!isObject(icon)) return undefined;
  if (text(icon.emoji_v2) || text(icon.emoji)) return text(icon.emoji_v2) || text(icon.emoji);
  if (Object.hasOwn(ARC_ICONS, icon.icon)) return ARC_ICONS[icon.icon];
  if (Number.isInteger(icon.emoji) && icon.emoji > 0) {
    try { return String.fromCodePoint(icon.emoji); } catch {}
  }
}

function profileInfo(desc) {
  const custom = isObject(desc?.custom) ? Object.values(desc.custom).find(isObject) : undefined;
  const directory = text(custom?.directoryBasename) || 'Default';
  return { key: directory === 'Default' ? 'default' : `custom:${directory}`, directory, machine: text(custom?.machineID) };
}

function topAppsPairs(value) {
  const out = [];
  if (!Array.isArray(value)) return out;
  for (let i = 0; i + 1 < value.length; i++) {
    if (isObject(value[i]) && typeof value[i + 1] === 'string') out.push([value[i], value[++i]]);
  }
  return out;
}

function dataContainer(doc, warnings) {
  const raw = doc?.sidebar?.containers;
  const containers = (Array.isArray(raw) ? raw : []).filter((c) => isObject(c) && (c.spaces || c.items));
  containers.sort((a, b) => swiftEntries(b.items).length - swiftEntries(a.items).length);
  if (containers.length) {
    if (containers.length > 1) warnings.push('Merged multiple Arc sidebar containers.');
    return {
      spaces: containers.flatMap((c) => swiftEntries(c.spaces)),
      items: containers.flatMap((c) => swiftEntries(c.items)),
      topApps: containers.flatMap((c) => topAppsPairs(c.topAppsContainerIDs))
    };
  }
  for (const legacy of [doc?.sidebarSyncState, doc?.firebaseSyncState?.syncData]) {
    if (!isObject(legacy) || !swiftEntries(legacy.spaceModels).length) continue;
    warnings.push('Read the legacy Arc sidebar sync layout.');
    const container = unwrap(legacy.container);
    return {
      spaces: swiftEntries(legacy.spaceModels), items: swiftEntries(legacy.items),
      topApps: text(container?.topAppsContainerID) ? [[{ default: true }, container.topAppsContainerID]] : [],
      order: Array.isArray(container?.orderedSpaceIDs) ? container.orderedSpaceIDs : []
    };
  }
  throw new ArcFormatError('This does not look like an Arc sidebar file (no spaces found).');
}

function parseArcSidebar(doc, options = {}) {
  const warnings = [];
  const version = typeof doc?.version === 'number' ? doc.version : 0;
  if (version > 1) throw new ArcFormatError(`Arc sidebar format version ${version} is newer than this importer knows (1).`);
  const main = dataContainer(doc, warnings);
  const now = options.now ?? Date.now();
  const items = new Map();
  for (const [key, item] of main.items) if (key && !items.has(key)) items.set(key, item);
  const byParent = new Map();
  for (const [key, item] of items) {
    if (!text(item.parentID)) continue;
    if (!byParent.has(item.parentID)) byParent.set(item.parentID, []);
    byParent.get(item.parentID).push(key);
  }
  const walk = (id, saved, seen = new Set(), depth = 0) => {
    if (seen.has(id) || depth > MAX_DEPTH) { warnings.push('Skipped an Arc sidebar cycle or deeply nested item.'); return []; }
    seen.add(id);
    const item = items.get(id);
    if (!item) { warnings.push(`Missing Arc sidebar item: ${id}`); return []; }
    const data = item.data || {};
    const children = Array.isArray(item.childrenIds) && item.childrenIds.length ? item.childrenIds : byParent.get(id) || [];
    const kids = () => children.flatMap((child) => typeof child === 'string' ? walk(child, saved, seen, depth + 1) : []);
    if (data.tab) {
      const url = text(data.tab.savedURL);
      if (!importableUrl(url)) { warnings.push('Skipped a tab with an unsupported URL.'); return []; }
      const node = { kind: 'tab', url, title: text(item.title) || text(data.tab.savedTitle) || url };
      if (saved && text(item.title)) node.customTitle = text(item.title);
      node.lastActiveAt = saved ? arcTime(data.tab.timeLastActiveAt) || arcTime(item.createdAt) || now : now;
      const favicon = options.favicon?.(id);
      if (favicon) node.favicon = favicon;
      return [node];
    }
    if (data.list) return [{ kind: 'folder', title: text(item.title) || 'Folder', children: kids() }];
    // Split views become ordinary tabs in the same order; unknown wrappers retain children.
    return kids();
  };
  const section = (id, saved) => id ? walk(id, saved) : [];
  const profiles = new Map();
  const ensureProfile = (desc) => {
    const info = profileInfo(desc);
    if (!profiles.has(info.key)) profiles.set(info.key, { key: info.key, directory: info.directory, favorites: [] });
    return profiles.get(info.key);
  };
  const uniqueSpaces = new Map();
  for (const [key, space] of main.spaces) if (key && !uniqueSpaces.has(key)) uniqueSpaces.set(key, space);
  let entries = [...uniqueSpaces];
  if (main.order?.length) {
    const rank = (id) => main.order.includes(id) ? main.order.indexOf(id) : Infinity;
    entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  }
  const machines = new Map();
  const spaces = entries.map(([key, space]) => {
    const profile = ensureProfile(space.profile);
    const info = profileInfo(space.profile);
    if (info.machine) {
      if (!machines.has(info.key)) machines.set(info.key, new Set());
      machines.get(info.key).add(info.machine);
    }
    const root = (role) => roleId(space.containerIDs, role) || roleId(space.newContainerIDs, role);
    return {
      id: text(space.id) || key, title: text(space.title) || (key === 'thebrowser.company.defaultPersonalSpaceID' ? 'Personal' : 'Space'),
      emoji: emojiOf(space.customInfo?.iconType), color: colorOf(space.customInfo?.windowTheme), profile: profile.key,
      pinned: section(root('pinned'), true), today: section(root('unpinned'), false)
    };
  });
  if (!spaces.length) throw new ArcFormatError('No spaces found in the Arc sidebar file.');
  let topApps = main.topApps;
  if (!topApps.length) {
    topApps = [...items].flatMap(([id, item]) => {
      const top = item.data?.itemContainer?.containerType?.topApps;
      return top ? [[top._0 || top, id]] : [];
    });
  }
  const topIds = new Set();
  for (const [desc, id] of topApps) {
    if (topIds.has(id)) continue;
    topIds.add(id);
    const info = profileInfo(desc);
    if (info.machine && machines.has(info.key) && !machines.get(info.key).has(info.machine)) {
      warnings.push(`Skipped favorites for ${info.directory} from another computer.`);
      continue;
    }
    const profile = ensureProfile(desc);
    const have = new Set(profile.favorites.map((tab) => tab.url));
    for (const tab of section(id, true).flatMap(flattenTabs)) {
      if (have.has(tab.url)) continue;
      have.add(tab.url);
      profile.favorites.push(tab);
    }
  }
  const favoriteUrls = new Set();
  const favorites = [...profiles.values()].flatMap((p) => p.favorites).filter((tab) => !favoriteUrls.has(tab.url) && favoriteUrls.add(tab.url));
  return { version, spaces, profiles: [...profiles.values()], favorites,
    archive: options.archive === undefined ? [] : parseArcArchive(options.archive, { now }), warnings };
}

function parseArcArchive(doc, { now = Date.now() } = {}) {
  return swiftEntries(doc?.items || doc).flatMap(([, entry]) => {
    const item = entry.sidebarItem;
    const tab = item?.data?.tab;
    if (!importableUrl(tab?.savedURL)) return [];
    return [{ url: tab.savedURL, title: text(item.title) || text(tab.savedTitle) || tab.savedURL,
      archivedAt: arcTime(entry.archivedAt) || arcTime(tab.timeLastActiveAt) || now,
      spaceArcId: text(entry.source?.space?._0) }];
  }).sort((a, b) => b.archivedAt - a.archivedAt);
}

function flattenTabs(node) {
  return node.kind === 'tab' ? [node] : (node.children || []).flatMap(flattenTabs);
}

function countNodes(nodes) {
  let tabs = 0;
  let folders = 0;
  for (const node of nodes) {
    if (node.kind === 'tab') tabs++;
    else { const children = countNodes(node.children || []); folders += 1 + children.folders; tabs += children.tabs; }
  }
  return { tabs, folders };
}

function summarizePlan(plan) {
  const totals = { spaces: plan.spaces.length, pinned: 0, today: 0, folders: 0, favorites: plan.favorites.length,
    profiles: plan.profiles?.length || 1, archive: plan.archive?.length || 0, historyProfiles: plan.historyProfiles?.length || 0 };
  for (const space of plan.spaces) {
    const pinned = countNodes(space.pinned);
    const today = countNodes(space.today);
    totals.pinned += pinned.tabs;
    totals.today += today.tabs;
    totals.folders += pinned.folders + today.folders;
  }
  return totals;
}

function locateArcSidebar(env = process.env, platform = process.platform, home = os.homedir()) {
  const candidates = [];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    try {
      for (const dir of fs.readdirSync(path.join(local, 'Packages'))) {
        if (dir.startsWith('TheBrowserCompany.Arc_')) candidates.push(path.join(local, 'Packages', dir, 'LocalCache', 'Local', 'Arc', 'StorableSidebar.json'));
      }
    } catch {}
    candidates.push(path.join(local, 'Arc', 'StorableSidebar.json'));
  } else if (platform === 'darwin') candidates.push(path.join(home, 'Library', 'Application Support', 'Arc', 'StorableSidebar.json'));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveArcSource(source) {
  const absolute = path.resolve(source);
  if (fs.statSync(absolute).isFile()) return { sidebarFile: absolute, root: path.dirname(absolute) };
  const dirs = [absolute, path.dirname(absolute), path.join(absolute, 'Arc'), path.join(absolute, 'LocalCache', 'Local', 'Arc')];
  const sidebarFile = dirs.map((dir) => path.join(dir, 'StorableSidebar.json')).find((file) => fs.existsSync(file));
  if (!sidebarFile) throw new ArcFormatError('No StorableSidebar.json found in this folder. Choose the Arc folder or its sidebar file.');
  return { sidebarFile, root: path.dirname(sidebarFile) };
}

function readArcJson(raw) {
  try { return JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch {
    try { return JSON.parse(raw.replace(/^\uFEFF/, '').replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')); }
    catch { throw new ArcFormatError('The file is not valid JSON.'); }
  }
}

function readJsonFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new ArcFormatError('The Arc data file is too large to import.');
  return readArcJson(fs.readFileSync(file, 'utf8'));
}

// SQLite only opens a disposable copy, including WAL/journal sidecars.
function readHistory(profileDir, limit = 1000) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-arc-history-'));
  try {
    const source = path.join(profileDir, 'History');
    const copy = path.join(temp, 'History');
    fs.copyFileSync(source, copy);
    for (const suffix of ['-wal', '-journal']) if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copy + suffix);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(copy);
    try {
      const hasHidden = db.prepare('PRAGMA table_info(urls)').all().some(column => column.name === 'hidden');
      // Chromium's microseconds exceed JS's safe integer range. Convert to a REAL
      // in SQL before node:sqlite reads it; millisecond precision remains intact.
      const rows = db.prepare(`SELECT url, title, CAST(last_visit_time AS REAL) AS last_visit_time FROM urls ${hasHidden ? 'WHERE hidden = 0' : ''} ORDER BY last_visit_time DESC LIMIT ?`).all(limit);
      return rows.filter((row) => importableUrl(row.url)).map((row) => ({ url: row.url, title: text(row.title) || row.url,
        timestamp: Math.max(0, Math.round(Number(row.last_visit_time) / 1000 - 11644473600000)) }));
    } finally { db.close(); }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function readArcPlan(source, { includeHistory = false } = {}) {
  const { sidebarFile, root } = resolveArcSource(source);
  const plan = parseArcSidebar(readJsonFile(sidebarFile), { favicon: (id) => {
    const file = path.join(root, 'SidebarItemsFaviconCache', createHash('md5').update(id).digest('hex'));
    try {
      if (fs.statSync(file).size > MAX_ICON_BYTES) return undefined;
      const bytes = fs.readFileSync(file);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined;
      return `data:image/png;base64,${bytes.toString('base64')}`;
    } catch { return undefined; }
  } });
  const optional = (name) => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return undefined;
    try { return readJsonFile(file); }
    catch { plan.warnings.push(`Could not read ${name}; other Arc data can still be imported.`); }
  };
  const archive = optional('StorableArchiveItems.json');
  if (archive) plan.archive = parseArcArchive(archive);
  const windows = optional('StorableWindows.json');
  plan.focusedSpaceId = text(windows?.lastFocusedSpaceID);
  const width = windows?.sidebarViewPreferences?.sidebarWidth;
  if (Number.isFinite(width)) plan.sidebarWidth = Math.round(Math.min(420, Math.max(200, width)));
  const userData = path.join(root, 'User Data');
  const names = optional(path.join('User Data', 'Local State'))?.profile?.info_cache;
  plan.historyProfiles = [];
  plan.history = [];
  for (const profile of plan.profiles) {
    profile.name = text(names?.[profile.directory]?.name) || profile.directory;
    // Profile descriptors are untrusted; never let them escape User Data.
    if (profile.directory !== 'Default' && !/^Profile \d+$/.test(profile.directory)) continue;
    const dir = path.join(userData, profile.directory);
    if (!fs.existsSync(path.join(dir, 'History'))) continue;
    plan.historyProfiles.push(profile.name);
    if (includeHistory) {
      try { plan.history.push(...readHistory(dir)); }
      catch { plan.warnings.push(`Could not read history for ${profile.name}. Quit Arc and try again.`); }
    }
  }
  plan.history.sort((a, b) => a.timestamp - b.timestamp);
  return plan;
}

module.exports = { ArcFormatError, parseArcSidebar, parseArcArchive, arcTime, colorToHex, flattenTabs, countNodes, summarizePlan,
  locateArcSidebar, resolveArcSource, readArcJson, readArcPlan, readHistory };
