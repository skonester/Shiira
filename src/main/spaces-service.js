// Persists the Arc-style sidebar: spaces, pinned folders, pinned tabs, favorites and the archive.
// Today tabs are not stored here; they follow the session restore setting (session.dat).

const fs = require('fs');

const LIMITS = { spaces: 50, folders: 1000, items: 3000, archive: 500 };
const SECTIONS = new Set(['pinned', 'favorites']);
const DEFAULT_COLOR = '#7c6cf2';

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function id(value) {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : null;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function color(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  return /^(https?|file|shiira):/i.test(value) ? value : null;
}

function safeFavicon(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  return /^(https?|shiira-asset):/i.test(value) ? value : null;
}

function sanitize(doc) {
  const input = doc && typeof doc === 'object' ? doc : {};
  const spaces = [];
  const spaceIds = new Set();
  for (const space of Array.isArray(input.spaces) ? input.spaces : []) {
    const spaceId = id(space?.id);
    if (!spaceId || spaceIds.has(spaceId) || spaces.length >= LIMITS.spaces) continue;
    spaceIds.add(spaceId);
    spaces.push({
      id: spaceId,
      title: text(space.title, 60) || 'Space',
      icon: text(space.icon, 16),
      color: color(space.color),
      position: finite(space.position, spaces.length)
    });
  }

  const folders = [];
  const folderIds = new Set();
  for (const folder of Array.isArray(input.folders) ? input.folders : []) {
    const folderId = id(folder?.id);
    if (!folderId || folderIds.has(folderId) || !spaceIds.has(folder.spaceId) || folders.length >= LIMITS.folders) continue;
    folderIds.add(folderId);
    folders.push({
      id: folderId,
      spaceId: folder.spaceId,
      parentId: id(folder.parentId),
      title: text(folder.title, 120) || 'Folder',
      collapsed: folder.collapsed === true,
      position: finite(folder.position)
    });
  }
  // A folder whose parent is gone moves to the top of its section.
  for (const folder of folders) {
    if (folder.parentId && !folderIds.has(folder.parentId)) folder.parentId = null;
  }

  const items = [];
  const itemIds = new Set();
  for (const item of Array.isArray(input.items) ? input.items : []) {
    const itemId = id(item?.id);
    const url = safeUrl(item?.url);
    if (!itemId || !url || itemIds.has(itemId) || !SECTIONS.has(item.section) || items.length >= LIMITS.items) continue;
    const favorite = item.section === 'favorites';
    if (!favorite && !spaceIds.has(item.spaceId)) continue;
    itemIds.add(itemId);
    const parentId = favorite ? null : id(item.parentId);
    items.push({
      id: itemId,
      spaceId: favorite ? null : item.spaceId,
      section: item.section,
      parentId: parentId && folderIds.has(parentId) ? parentId : null,
      url,
      pinnedUrl: safeUrl(item.pinnedUrl) || url,
      title: text(item.title, 300),
      customTitle: text(item.customTitle, 120),
      favicon: safeFavicon(item.favicon),
      position: finite(item.position)
    });
  }

  const archive = [];
  for (const entry of Array.isArray(input.archive) ? input.archive : []) {
    const url = safeUrl(entry?.url);
    if (!url || archive.length >= LIMITS.archive) continue;
    archive.push({
      url,
      title: text(entry.title, 300),
      favicon: safeFavicon(entry.favicon),
      spaceId: spaceIds.has(entry.spaceId) ? entry.spaceId : null,
      archivedAt: finite(entry.archivedAt, Date.now())
    });
  }

  const activeBySpace = {};
  if (input.activeBySpace && typeof input.activeBySpace === 'object') {
    for (const [spaceId, itemId] of Object.entries(input.activeBySpace)) {
      if (spaceIds.has(spaceId) && id(itemId)) activeBySpace[spaceId] = itemId;
    }
  }

  return {
    version: 1,
    focusedSpaceId: spaceIds.has(input.focusedSpaceId) ? input.focusedSpaceId : (spaces[0]?.id || null),
    spaces,
    folders,
    items,
    archive,
    activeBySpace
  };
}

class SpacesService {
  constructor() {
    this.filePath = null;
  }

  initialize(filePath) {
    this.filePath = filePath;
  }

  load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return null;
    try {
      const doc = sanitize(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
      return doc.spaces.length ? doc : null;
    } catch (error) {
      console.error('[Spaces] Could not read spaces file:', error.message);
      return null;
    }
  }

  save(doc) {
    if (!this.filePath) return { success: false, error: 'Spaces storage is not ready.' };
    const clean = sanitize(doc);
    if (!clean.spaces.length) return { success: false, error: 'At least one space is required.' };
    const temp = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(clean), 'utf-8');
      fs.renameSync(temp, this.filePath);
      return { success: true };
    } catch (error) {
      try { fs.unlinkSync(temp); } catch {}
      return { success: false, error: error.message };
    }
  }
}

module.exports = SpacesService;
module.exports.sanitize = sanitize;
module.exports.LIMITS = LIMITS;
