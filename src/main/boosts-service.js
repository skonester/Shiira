const fs = require('node:fs');
const path = require('node:path');
const { validSelector, tooBroad } = require('./boost-selectors');

function originOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}
function sanitizeBoost(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return { enabled: value.enabled !== false, css: String(value.css || '').slice(0, 50000),
    zaps: [...new Set((Array.isArray(value.zaps) ? value.zaps : []).filter(s => validSelector(s) && !tooBroad(s)))].slice(0, 200) };
}
class BoostsService {
  constructor(file) { this.file = file; this.values = {}; }
  load() {
    try {
      if (fs.statSync(this.file).size > 4 * 1024 * 1024) return;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [origin, boost] of Object.entries(data).slice(0, 300)) if (originOf(origin) === origin) this.values[origin] = sanitizeBoost(boost);
    } catch {}
  }
  get(origin) { return sanitizeBoost(this.values[origin]); }
  set(origin, patch) {
    if (!origin || originOf(origin) !== origin) throw new Error('Open a website to customize it.');
    const next = { ...this.values, [origin]: sanitizeBoost(patch) };
    if (!next[origin].css.trim() && !next[origin].zaps.length) delete next[origin];
    if (Object.keys(next).length > 300 || Buffer.byteLength(JSON.stringify(next)) > 4 * 1024 * 1024) throw new Error('The saved Boosts limit has been reached.');
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    this.values = next;
    return this.get(origin);
  }
}

function installBoosts({ app, ipcMain, webContents, isTrusted }) {
  let service;
  const applied = new WeakMap();
  const revisions = new WeakMap();
  async function apply(page) {
    try {
    if (!service || page.isDestroyed() || page.getType() !== 'webview') return;
    const revision = (revisions.get(page) || 0) + 1;
    revisions.set(page, revision);
    const previous = applied.get(page);
    applied.delete(page);
    if (previous) await page.removeInsertedCSS(previous).catch(() => {});
    if (page.isDestroyed()) return;
    const origin = originOf(page.getURL());
    if (!origin || revisions.get(page) !== revision) return;
    const boost = service.get(origin);
    if (!boost.enabled) return;
    // Keep the browser-owned video player outside Zap selectors.
    const css = boost.css + '\n' + boost.zaps.map(s => `${s}:not(#shiira-youtube-player):not(#shiira-youtube-player *):not(:has(#shiira-youtube-player)) { display: none !important; }`).join('\n');
    if (!css.trim()) return;
    const key = await page.insertCSS(css, { cssOrigin: 'user' }).catch(() => null);
    if (!key) return;
    if (page.isDestroyed()) return;
    if (originOf(page.getURL()) !== origin || revisions.get(page) !== revision) await page.removeInsertedCSS(key).catch(() => {});
    else applied.set(page, key);
    } catch { /* Navigation or destruction can invalidate a native page mid-apply. */ }
  }
  const wire = page => {
    if (page.getType() !== 'webview') return;
    page.on('dom-ready', () => { void apply(page); });
    page.on('did-navigate-in-page', () => { void apply(page); });
    page.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        revisions.set(page, (revisions.get(page) || 0) + 1);
        const key = applied.get(page);
        applied.delete(page);
        if (key) page.removeInsertedCSS(key).catch(() => {});
      }
    });
  };
  app.on('web-contents-created', (_event, page) => wire(page));
  app.whenReady().then(() => {
    service = new BoostsService(path.join(app.getPath('userData'), 'boosts.json'));
    service.load();
  });
  function pageFor(event, id) {
    if (!isTrusted(event)) throw new Error('Unavailable.');
    const page = Number.isInteger(id) && webContents.fromId(id);
    if (!service || !page || page.isDestroyed() || page.getType() !== 'webview' || page.hostWebContents !== event.sender || !originOf(page.getURL())) throw new Error('Open a website to customize it.');
    return page;
  }
  ipcMain.handle('boosts-get', (event, id) => {
    try { const page = pageFor(event, id); const origin = originOf(page.getURL()); return { origin, boost: service.get(origin) }; }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle('boosts-save', async (event, id, expectedOrigin, patch) => {
    try {
      const page = pageFor(event, id);
      const origin = originOf(page.getURL());
      if (origin !== expectedOrigin) throw new Error('The page changed sites. Reopen Boosts for the current site.');
      const boost = service.set(origin, patch);
      await Promise.all(webContents.getAllWebContents().filter(p => p.getType() === 'webview' && originOf(p.getURL()) === origin).map(apply));
      return { success: true, origin, boost };
    } catch (error) { return { error: error.message }; }
  });
}
module.exports = { BoostsService, installBoosts, originOf, sanitizeBoost };
