// Notes block model and Easel item bounds adapted from Orbe (MIT).
// See THIRD_PARTY_NOTICES/orbe-MIT.txt. Documents and images stay outside Spaces.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const ID = /^[a-f0-9]{16}$/;
const IMAGE = /^[a-f0-9]{16}\.png$/;
const TYPES = new Set(['text', 'note', 'image', 'rect', 'ellipse', 'arrow', 'pen']);
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo']);
const num = (v, min, max, fallback = 0) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const coord = v => Math.round(num(v, -1e7, 1e7) * 100) / 100;
function safeLink(href) {
  if (typeof href !== 'string' || href.length > 2000) return '';
  try { const u = new URL(href.trim()); return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
function cleanBlocks(input) {
  const blocks = []; let room = 200000;
  for (const b of (Array.isArray(input) ? input : []).slice(0, 5000)) {
    if (!b || !BLOCKS.has(b.t)) continue;
    const block = { t: b.t, runs: [] };
    if (b.t === 'todo' && b.done === true) block.done = true;
    for (const r of (Array.isArray(b.runs) ? b.runs : []).slice(0, 400)) {
      if (!r || typeof r.s !== 'string' || room <= 0) continue;
      const s = r.s.replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, room);
      if (!s) continue;
      room -= s.length;
      block.runs.push({ s, ...(r.b === true ? { b: true } : {}), ...(r.i === true ? { i: true } : {}), ...(safeLink(r.a) ? { a: safeLink(r.a) } : {}) });
    }
    blocks.push(block);
  }
  return blocks;
}
function plain(blocks) {
  let n = 0;
  return blocks.map(b => { n = b.t === 'ol' ? n + 1 : 0; return (b.t === 'ul' ? '- ' : b.t === 'ol' ? `${n}. ` : b.t === 'todo' ? b.done ? '[x] ' : '[ ] ' : '') + b.runs.map(r => r.s).join(''); }).join('\n');
}
function cleanItem(it) {
  if (!it || !TYPES.has(it.type) || !/^[\w-]{1,32}$/.test(it.id || '')) return null;
  const arrow = it.type === 'arrow';
  const o = { id: it.id, type: it.type, x: coord(it.x), y: coord(it.y), w: arrow ? coord(it.w) : Math.max(1, coord(it.w)), h: arrow ? coord(it.h) : Math.max(1, coord(it.h)) };
  if (/^[a-z]{1,12}$/.test(it.color || '')) o.color = it.color;
  if (['text', 'note'].includes(it.type)) { o.text = String(it.text || '').slice(0, 20000); o.size = num(it.size, 8, 200, 18); }
  if (['rect', 'ellipse'].includes(it.type)) o.fill = it.fill === true;
  if (['rect', 'ellipse', 'arrow', 'pen'].includes(it.type)) o.sw = num(it.sw, 1, 24, 2);
  if (it.type === 'image') {
    if (!IMAGE.test(it.img || '')) return null;
    o.img = it.img;
    if (/^https?:/.test(safeLink(it.sourceUrl))) { o.sourceUrl = safeLink(it.sourceUrl); o.sourceTitle = String(it.sourceTitle || '').slice(0, 300); }
    if (typeof it.alt === 'string') o.alt = it.alt.slice(0, 500);
  }
  if (it.type === 'pen') {
    if (!Array.isArray(it.pts) || it.pts.length < 2 || it.pts.length > 40000) return null;
    o.pts = it.pts.slice(0, it.pts.length - it.pts.length % 2).map(coord);
    o.pw = Math.max(1, coord(it.pw)); o.ph = Math.max(1, coord(it.ph));
  }
  return o;
}
function fileName(title) {
  const base = String(title).replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80);
  return !base || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base) ? 'Untitled' : base;
}
class WorkspaceService {
  constructor(root, hasProfile = () => true) { this.root = root; this.hasProfile = hasProfile; fs.mkdirSync(root, { recursive: true }); }
  file(id) { if (!ID.test(id || '')) throw new Error('Invalid document.'); return path.join(this.root, id + '.json'); }
  read(id) {
    const file = this.file(id);
    if (fs.statSync(file).size > 24 * 1024 * 1024) throw new Error('This document is too large.');
    return this.clean(JSON.parse(fs.readFileSync(file, 'utf8')), id);
  }
  clean(input, id) {
    if (!['note', 'easel'].includes(input.kind) || !this.hasProfile(input.profileId)) throw new Error('Profile or document unavailable.');
    const doc = { id, kind: input.kind, profileId: input.profileId, title: String(input.title || 'Untitled').slice(0, 120), revision: num(input.revision, 0, 1e12),
      created: num(input.created, 0, 9e15, Date.now()), updated: num(input.updated, 0, 9e15, Date.now()) };
    if (doc.kind === 'note') doc.blocks = cleanBlocks(input.blocks);
    else {
      const seen = new Set(); doc.items = [];
      for (const raw of (Array.isArray(input.items) ? input.items : []).slice(0, 5000)) {
        const it = cleanItem(raw); if (it && !seen.has(it.id)) { seen.add(it.id); doc.items.push(it); }
      }
      const v = input.view || {}; doc.view = { x: coord(v.x), y: coord(v.y), z: num(v.z, .1, 8, 1) };
    }
    return doc;
  }
  list(profileId) {
    if (!this.hasProfile(profileId)) throw new Error('Profile unavailable.');
    if (!this.index) {
      this.index = new Map();
      for (const n of fs.readdirSync(this.root).filter(n => /^[a-f0-9]{16}\.json$/.test(n))) {
        try { const d = this.read(n.slice(0, -5)); this.index.set(d.id, this.meta(d)); } catch {}
      }
    }
    return [...this.index.values()].filter(d => d.profileId === profileId).sort((a, b) => b.updated - a.updated).map(d => ({ ...d }));
  }
  meta(d) { return { id: d.id, profileId: d.profileId, title: d.title, kind: d.kind, updated: d.updated, revision: d.revision }; }
  write(doc) { const file = this.file(doc.id); fs.writeFileSync(file + '.tmp', JSON.stringify(doc)); fs.renameSync(file + '.tmp', file); this.index?.set(doc.id, this.meta(doc)); return doc; }
  create(kind, profileId, title = '') {
    if (this.list(profileId).length >= 500) throw new Error('The profile document limit is 500.');
    return this.write(this.clean({ kind, profileId, title: title || (kind === 'note' ? 'Untitled note' : 'Untitled Easel'), revision: 1 }, randomBytes(8).toString('hex')));
  }
  save(input) {
    if (!input || Buffer.byteLength(JSON.stringify(input)) > 24 * 1024 * 1024) throw new Error('This document is too large.');
    const current = this.read(input.id);
    if (current.revision !== input.revision) return { error: 'Changed in another window. Save your edits as a copy or reload the saved version.', conflict: true, doc: current };
    const doc = this.clean({ ...input, kind: current.kind, profileId: current.profileId, created: current.created, updated: Date.now(), revision: current.revision + 1 }, current.id);
    if (doc.items?.some(it => it.type === 'image' && !fs.existsSync(path.join(this.root, doc.id, it.img)))) throw new Error('An image is missing. Add it again before saving.');
    return { success: true, doc: this.write(doc) };
  }
  remove(id, revision) {
    const doc = this.read(id);
    if (doc.revision !== revision) throw new Error('Changed in another window. Reload before deleting.');
    fs.unlinkSync(this.file(id));
    this.index?.delete(id);
    // Keep orphan images: a concurrent editor can still save its work as a copy.
    return doc;
  }
  addImage(id, image) {
    const doc = this.read(id); if (doc.kind !== 'easel') throw new Error('Choose an Easel.');
    const bytes = image.toPNG(); if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
    const size = image.getSize(); if (size.width * size.height > 40000000) throw new Error('Choose an image smaller than 40 megapixels.');
    const name = randomBytes(8).toString('hex') + '.png'; const dir = path.join(this.root, id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
    return { name, width: size.width, height: size.height, data: 'data:image/png;base64,' + bytes.toString('base64') };
  }
  image(id, name) {
    this.file(id); if (!IMAGE.test(name || '')) throw new Error('Invalid image.');
    const file = path.join(this.root, id, name); if (fs.statSync(file).size > 25 * 1024 * 1024) throw new Error('Image too large.');
    return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  }
}
function installWorkspaces({ app, ipcMain, BrowserWindow, webContents, dialog, nativeImage, isTrusted, hasProfile }) {
  let service;
  app.whenReady().then(() => { service = new WorkspaceService(path.join(app.getPath('userData'), 'workspaces'), hasProfile); });
  const changed = (doc, deleted = false) => { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('workspace-changed', { id: doc.id, profileId: doc.profileId, revision: doc.revision, deleted }); };
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (!isTrusted(event) || !service) return { error: 'Unavailable.' };
    try { return await fn(event, ...args); } catch (error) { return { error: error.message }; }
  });
  handle('workspace-list', (_e, profileId) => service.list(profileId));
  handle('workspace-read', (_e, id) => service.read(id));
  handle('workspace-create', (_e, kind, profileId, title) => { const doc = service.create(kind, profileId, title); changed(doc); return doc; });
  handle('workspace-save', (_e, input) => { const result = service.save(input); if (result.success) changed(result.doc); return result; });
  handle('workspace-copy', (_e, input) => {
    const doc = service.create(input.kind, input.profileId, `${input.title} (copy)`);
    for (const it of input.items || []) if (it.type === 'image' && IMAGE.test(it.img || '')) {
      const src = service.image(input.id, it.img); const image = nativeImage.createFromDataURL(src); it.img = service.addImage(doc.id, image).name;
    }
    const result = service.save({ ...input, id: doc.id, revision: doc.revision, title: doc.title }); if (result.success) changed(result.doc); return result;
  });
  handle('workspace-delete', (_e, id, revision) => { const doc = service.remove(id, revision); changed(doc, true); return { success: true }; });
  handle('workspace-image', (_e, id, name) => service.image(id, name));
  handle('workspace-add-image', async (event, id, options = {}) => {
    service.read(id); let image, sourceUrl = '', sourceTitle = '';
    if (options.pageId) {
      const page = Number.isInteger(options.pageId) && webContents.fromId(options.pageId);
      if (!page || page.isDestroyed() || page.getType() !== 'webview' || page.hostWebContents !== event.sender) throw new Error('The source page is unavailable.');
      const operation = page.capturePage(undefined, { stayHidden: true, stayAwake: true });
      image = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Capture timed out.')), 10000); operation.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); }); });
      sourceUrl = page.getURL(); sourceTitle = page.getTitle();
    } else {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Add image to Easel', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (result.canceled || !result.filePaths.length) return { canceled: true };
      if (fs.statSync(result.filePaths[0]).size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
      image = nativeImage.createFromPath(result.filePaths[0]);
    }
    if (image.isEmpty()) throw new Error('This image could not be read.');
    return { ...service.addImage(id, image), sourceUrl, sourceTitle };
  });
  handle('workspace-export', async (event, id, png) => {
    const doc = service.read(id); const note = doc.kind === 'note';
    if (!note && (typeof png !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(png) || png.length > 40 * 1024 * 1024)) throw new Error('The Easel export is too large.');
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title: note ? 'Export note' : 'Export Easel', defaultPath: fileName(doc.title) + (note ? '.txt' : '.png'), filters: [{ name: note ? 'Text' : 'PNG image', extensions: [note ? 'txt' : 'png'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, note ? plain(doc.blocks) : Buffer.from(png.slice(22), 'base64'));
    return { success: true };
  });
}
module.exports = { WorkspaceService, installWorkspaces, cleanBlocks, cleanItem, plain, safeLink, fileName };
