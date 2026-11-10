// Reads Arc's StorableSidebar.json and turns it into a plain import plan.
// Arc's files are only ever read, never changed.
//
// The parser is adapted from Solamar's src/main/arc-parse.ts
// (https://github.com/Bambeek/solamar, GPL-3.0-or-later), used here under GPL-3.0.
// Arc writes Swift dictionaries as flat alternating lists: [key, value, key, value, ...].

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_DEPTH = 24;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

class ArcFormatError extends Error {}

/** Swift dictionary (alternating list) or plain object -> ordered [key, object] entries. */
function swiftEntries(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i + 1 < value.length; i += 2) {
      const key = value[i];
      const entry = value[i + 1];
      if (entry && typeof entry === 'object') {
        out.push([typeof key === 'string' ? key : JSON.stringify(key), entry]);
      }
    }
    return out;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).filter(([, entry]) => entry && typeof entry === 'object');
  }
  return [];
}

/** ["pinned", id, "unpinned", id] -> { pinned: id, unpinned: id }. Keys may be strings or {pinned: {}} objects. */
function containerMap(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = list[i];
    const id = list[i + 1];
    if (typeof id !== 'string') continue;
    const name = typeof key === 'string' ? key : key && typeof key === 'object' ? Object.keys(key)[0] : '';
    if (name && !out[name]) out[name] = id;
  }
  return out;
}

function colorOf(theme) {
  const c = theme?.primaryColorPalette?.midTone;
  if (!c || typeof c.red !== 'number') return undefined;
  // Arc normally stores 0-1 components; treat anything above 1 as 0-255.
  const big = Math.max(c.red, c.green, c.blue) > 1;
  const to = (x) => Math.max(0, Math.min(255, Math.round(big ? x : x * 255)));
  return '#' + [c.red, c.green, c.blue].map((x) => to(Number(x) || 0).toString(16).padStart(2, '0')).join('');
}

function emojiOf(icon) {
  if (!icon) return undefined;
  if (typeof icon.emoji_v2 === 'string' && icon.emoji_v2) return icon.emoji_v2;
  if (typeof icon.emoji === 'number' && icon.emoji > 0) {
    try {
      return String.fromCodePoint(icon.emoji);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function profileKey(profile) {
  if (!profile || profile.default) return 'default';
  return 'custom:' + JSON.stringify(profile).slice(0, 120);
}

function parseArcSidebar(doc) {
  const containers = doc?.sidebar?.containers;
  if (!Array.isArray(containers)) {
    throw new ArcFormatError('This does not look like an Arc sidebar file (no sidebar.containers).');
  }
  const version = typeof doc.version === 'number' ? doc.version : 0;
  if (version > 1) {
    throw new ArcFormatError(`Arc sidebar format version ${version} is newer than this importer knows (1).`);
  }
  const main = containers.find((c) => c && c.spaces && c.items);
  if (!main) throw new ArcFormatError('No spaces found in the Arc sidebar file.');

  const items = new Map(swiftEntries(main.items));

  const walk = (id, seen, depth) => {
    if (seen.has(id) || depth > MAX_DEPTH) return [];
    seen.add(id);
    const item = items.get(id);
    if (!item) return [];
    const data = item.data || {};
    const kids = () => (Array.isArray(item.childrenIds) ? item.childrenIds : [])
      .flatMap((child) => (typeof child === 'string' ? walk(child, seen, depth + 1) : []));
    if (data.tab) {
      const url = data.tab.savedURL;
      if (typeof url !== 'string' || !url) return [];
      const title = (typeof item.title === 'string' && item.title) || data.tab.savedTitle || undefined;
      return [{ kind: 'tab', url, title }];
    }
    if (data.list) return [{ kind: 'folder', title: item.title || 'Folder', children: kids() }];
    // Containers, split views and anything newer: keep their tabs, drop the wrapper.
    return kids();
  };

  const sectionOf = (containerId) => (containerId ? walk(containerId, new Set(), 0) : []);

  const spaces = swiftEntries(main.spaces).map(([key, space]) => {
    const ids = containerMap(space.containerIDs || space.newContainerIDs);
    return {
      id: typeof space.id === 'string' ? space.id : key,
      title: typeof space.title === 'string' && space.title ? space.title : 'Space',
      emoji: emojiOf(space.customInfo?.iconType),
      color: colorOf(space.customInfo?.windowTheme),
      profile: profileKey(space.profile),
      pinned: sectionOf(ids.pinned),
      today: sectionOf(ids.unpinned)
    };
  });

  // Favorites: topAppsContainerIDs = [{default: true}, containerId, ...]; take the default profile's set.
  let favorites = [];
  const top = main.topAppsContainerIDs;
  if (Array.isArray(top)) {
    for (let i = 0; i + 1 < top.length; i += 2) {
      const key = top[i];
      if (typeof top[i + 1] === 'string' && (key?.default || i === 0)) {
        favorites = sectionOf(top[i + 1]).flatMap(flattenTabs);
        if (key?.default) break;
      }
    }
  }

  return { version, spaces, favorites };
}

function flattenTabs(node) {
  return node.kind === 'tab' ? [node] : (node.children || []).flatMap(flattenTabs);
}

function countNodes(nodes) {
  let tabs = 0;
  let folders = 0;
  const visit = (node) => {
    if (node.kind === 'tab') tabs++;
    else {
      folders++;
      (node.children || []).forEach(visit);
    }
  };
  nodes.forEach(visit);
  return { tabs, folders };
}

function summarizePlan(plan) {
  const totals = { spaces: plan.spaces.length, pinned: 0, today: 0, folders: 0, favorites: plan.favorites.length };
  for (const space of plan.spaces) {
    const pinned = countNodes(space.pinned);
    const today = countNodes(space.today);
    totals.pinned += pinned.tabs;
    totals.today += today.tabs;
    totals.folders += pinned.folders + today.folders;
  }
  return totals;
}

/** Where Arc keeps its sidebar file on this computer, or null. */
function locateArcSidebar(env = process.env, platform = process.platform, home = os.homedir()) {
  const candidates = [];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const packages = path.join(local, 'Packages');
    try {
      for (const dir of fs.readdirSync(packages)) {
        if (dir.startsWith('TheBrowserCompany.Arc_')) {
          candidates.push(path.join(packages, dir, 'LocalCache', 'Local', 'Arc', 'StorableSidebar.json'));
        }
      }
    } catch {
      // No Packages folder: Arc is not installed from the Store.
    }
  } else if (platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Arc', 'StorableSidebar.json'));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readArcPlan(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new ArcFormatError('The Arc sidebar file is too large to import.');
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    throw new ArcFormatError('The file is not valid JSON.');
  }
  return parseArcSidebar(doc);
}

module.exports = {
  ArcFormatError,
  parseArcSidebar,
  flattenTabs,
  countNodes,
  summarizePlan,
  locateArcSidebar,
  readArcPlan
};
