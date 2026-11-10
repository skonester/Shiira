// Pure helpers for the Arc-style sidebar: spaces, sections, folders, ordering, archive and sleep rules.
// No DOM access here, so this file can be tested with node:test.
// The data model follows Solamar (https://github.com/Bambeek/solamar, GPL-3.0-or-later):
// favorites are shared by every space, each space has pinned tabs (with folders) and today tabs.

export const SPACE_COLORS = ['#7c6cf2', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#28d7ef', '#64748b'];
export const SPACE_ICONS = ['🏠', '💼', '🎮', '📚', '🎵', '✈️', '🛒', '🧪', '💡', '🌙', '⭐', '🔥', '🎨', '📰', '💬', '🌿'];

export const DEFAULT_SPACE_ID = 'space-personal';
export const SECTIONS = ['favorites', 'pinned', 'today'];

export function uid(prefix = 'i-') {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16)
    || Math.random().toString(36).slice(2, 18);
  return `${prefix}${random}`;
}

export function defaultSpace() {
  return { id: DEFAULT_SPACE_ID, title: 'Personal', icon: '🏠', color: SPACE_COLORS[0], position: 0 };
}

export function sortByPosition(list) {
  return [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The tabs and folders directly under one parent of one section, in order.
 * tabs: [{ id, section, spaceId, parentId, position }], folders: [{ id, spaceId, parentId, position }]
 */
export function siblings(tabs, folders, { section, spaceId, parentId = null }) {
  const sameSpace = (entry) => section === 'favorites' || entry.spaceId === spaceId;
  const list = [
    ...tabs
      .filter((tab) => tab.section === section && sameSpace(tab) && (tab.parentId || null) === parentId)
      .map((tab) => ({ kind: 'tab', id: tab.id, ref: tab, position: tab.position ?? 0 })),
    ...(section === 'pinned'
      ? folders
        .filter((folder) => folder.spaceId === spaceId && (folder.parentId || null) === parentId)
        .map((folder) => ({ kind: 'folder', id: folder.id, ref: folder, position: folder.position ?? 0 }))
      : [])
  ];
  return list.sort((a, b) => a.position - b.position);
}

/** Puts `moved` at `index` among `list` (which must not contain it) and renumbers positions 0..n. */
export function insertAt(list, moved, index) {
  const ordered = list.filter((entry) => !(entry.kind === moved.kind && entry.id === moved.id));
  const at = Math.max(0, Math.min(Number.isFinite(index) ? index : ordered.length, ordered.length));
  ordered.splice(at, 0, moved);
  ordered.forEach((entry, i) => {
    entry.ref.position = i;
  });
  return ordered;
}

/** True when `folderId` is `ancestorId` or sits somewhere inside it. */
export function isInsideFolder(folders, folderId, ancestorId) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = folderId;
  for (let guard = 0; current && guard < 64; guard++) {
    if (current === ancestorId) return true;
    current = byId.get(current)?.parentId || null;
  }
  return false;
}

/** Every folder id under `folderId`, including itself. */
export function folderTree(folders, folderId) {
  return folders.filter((folder) => isInsideFolder(folders, folder.id, folderId)).map((folder) => folder.id);
}

/**
 * The visible order of a space, top to bottom: favorites, pinned (folders opened depth-first), today.
 * Collapsed folders still contribute their tabs when `includeCollapsed` is true.
 */
export function visibleOrder(tabs, folders, spaceId, { includeCollapsed = true } = {}) {
  const out = [];
  const walk = (section, parentId) => {
    for (const entry of siblings(tabs, folders, { section, spaceId, parentId })) {
      if (entry.kind === 'tab') out.push(entry.ref);
      else if (includeCollapsed || !entry.ref.collapsed) walk(section, entry.id);
    }
  };
  walk('favorites', null);
  walk('pinned', null);
  walk('today', null);
  return out;
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Today tabs nobody looked at for `hours` go to the archive. Never the tab on screen, one playing sound, or a private tab. */
export function shouldArchive(tab, { now, hours, activeIds = [] }) {
  if (!hours || hours <= 0) return false;
  if (tab.section !== 'today' || tab.isHome || tab.privateMode || tab.isPlayingAudio) return false;
  if (activeIds.includes(tab.id)) return false;
  return now - (tab.lastActiveAt || now) >= hours * HOUR;
}

/** Tabs idle for `minutes` give up their page process; they reload when opened again. */
export function shouldSleep(tab, { now, minutes, activeIds = [] }) {
  if (!minutes || minutes <= 0) return false;
  if (!tab.webview || tab.isHome || tab.privateMode || tab.isPlayingAudio) return false;
  if (activeIds.includes(tab.id)) return false;
  return now - (tab.lastActiveAt || now) >= minutes * MINUTE;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A letter and a hue for sites with no favicon (no third-party icon service). */
export function letterIcon(url, title = '') {
  const site = hostOf(url).replace(/^(m|mail|app|web)\./, '') || title || '?';
  let hue = 0;
  for (const char of site) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return { letter: (site[0] || '?').toUpperCase(), hue };
}

/** The letter icon as an SVG data URL, for <img> elements. Made locally; nothing is fetched. */
export function letterIconUrl(url, title = '') {
  const { letter, hue } = letterIcon(url, title);
  const safe = /^[\p{L}\p{N}]$/u.test(letter) ? letter : '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="hsl(${hue},45%,46%)"/><text x="16" y="22" font-family="Segoe UI,Arial,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Space colour lighter or darker, for gradients. amount -1..1 */
export function shade(hex, amount) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : SPACE_COLORS[0];
  const channels = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const target = amount >= 0 ? 255 : 0;
  const mixed = channels.map((c) => Math.round(c + (target - c) * Math.abs(amount)));
  return '#' + mixed.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Turns an Arc import plan (from src/main/arc-importer.js) into Shiira spaces, folders and tabs.
 * Nothing existing is changed; spaces with a taken name get " (Arc)".
 */
export function planFromArc(plan, { existingSpaces = [], existingFavoriteUrls = [], includeToday = false, makeId = uid } = {}) {
  const spaces = [];
  const folders = [];
  const tabs = [];
  let position = Math.max(-1, ...existingSpaces.map((space) => space.position ?? 0)) + 1;
  const taken = new Set(existingSpaces.map((space) => space.title));

  const add = (nodes, spaceId, section, parentId) => {
    nodes.forEach((node, index) => {
      if (node.kind === 'tab') {
        if (!/^https?:/i.test(node.url || '')) return;
        tabs.push({ itemId: makeId('i-'), spaceId, section, parentId, url: node.url, title: node.title || '', position: index });
      } else {
        const folderId = makeId('f-');
        folders.push({ id: folderId, spaceId, parentId, title: node.title || 'Folder', collapsed: false, position: index });
        add(node.children || [], spaceId, section, folderId);
      }
    });
  };

  (plan?.spaces || []).forEach((arcSpace, index) => {
    const spaceId = makeId('s-');
    const title = taken.has(arcSpace.title) ? `${arcSpace.title} (Arc)` : arcSpace.title;
    taken.add(title);
    spaces.push({
      id: spaceId,
      title: String(title || 'Space').slice(0, 60),
      icon: arcSpace.emoji || SPACE_ICONS[(index + 1) % SPACE_ICONS.length],
      color: /^#[0-9a-f]{6}$/i.test(arcSpace.color || '') ? arcSpace.color.toLowerCase() : SPACE_COLORS[(index + 1) % SPACE_COLORS.length],
      position: position++
    });
    add(arcSpace.pinned || [], spaceId, 'pinned', null);
    // Folders only live in the pinned section here, so Arc's today folders come over as plain today tabs.
    if (includeToday) {
      const flat = [];
      const flatten = (nodes) => nodes.forEach((node) => (node.kind === 'tab' ? flat.push(node) : flatten(node.children || [])));
      flatten(arcSpace.today || []);
      add(flat, spaceId, 'today', null);
    }
  });

  const haveFavorite = new Set(existingFavoriteUrls);
  let favoritePosition = existingFavoriteUrls.length;
  for (const favorite of plan?.favorites || []) {
    if (!/^https?:/i.test(favorite.url || '') || haveFavorite.has(favorite.url)) continue;
    haveFavorite.add(favorite.url);
    tabs.push({ itemId: makeId('i-'), spaceId: null, section: 'favorites', parentId: null, url: favorite.url, title: favorite.title || '', position: favoritePosition++ });
  }

  return { spaces, folders, tabs };
}
