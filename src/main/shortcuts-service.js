// Orbe's defaults + overrides + explicit conflict reassignment, adapted for Shiira.
const fs = require('node:fs');
const { canon, F_KEY } = require('./shortcut-keys');

const DEFINITIONS = [
  ['new-tab', 'New tab / command bar', 'Tabs', ['Primary+T']],
  ['close-tab', 'Close or unload tab', 'Tabs', ['Primary+W']],
  ['reopen-tab', 'Reopen closed tab', 'Tabs', ['Primary+Shift+T']],
  ['private-tab', 'New private tab', 'Tabs', ['Primary+Shift+N']],
  ['pin-tab', 'Pin or unpin tab', 'Tabs', ['Primary+D']],
  ['next-tab', 'Next tab in sidebar order', 'Tabs', []],
  ['prev-tab', 'Previous tab in sidebar order', 'Tabs', []],
  ['archive', 'Show archived tabs', 'Tabs', ['Primary+Shift+A']],
  ['tab-expose', 'Tab Expose', 'Tabs', ['Primary+Shift+E']],
  ['next-space', 'Next Space', 'Spaces', ['Primary+Alt+Right']],
  ['prev-space', 'Previous Space', 'Spaces', ['Primary+Alt+Left']],
  ['focus-url', 'Focus address bar', 'Navigation', ['Primary+L']],
  ['go-back', 'Go back', 'Navigation', ['Alt+Left']],
  ['go-forward', 'Go forward', 'Navigation', ['Alt+Right']],
  ['reload', 'Reload page', 'Navigation', ['Primary+R', 'F5']],
  ['hard-reload', 'Reload without cache', 'Navigation', ['Primary+Shift+R']],
  ['copy-url', 'Copy clean link', 'Navigation', ['Primary+Shift+C']],
  ['copy-markdown', 'Copy link as Markdown', 'Navigation', ['Primary+Alt+Shift+C']],
  ['show-history', 'History', 'Navigation', ['Primary+H']],
  ['little-window', 'New Little Shiira window', 'Windows', ['Primary+Alt+N']],
  ['promote-little', 'Open Little window in Shiira', 'Windows', ['Primary+O']],
  ['show-settings', 'Settings', 'Browser', ['Primary+,']],
  ['toggle-sidebar', 'Show or hide sidebar', 'Browser', ['Primary+S']],
  ['toggle-bookmarks-bar', 'Show or hide bookmarks bar', 'Browser', ['Primary+Shift+B']],
  ['split-view', 'Toggle Split View', 'Browser', ['Primary+Shift+\\']],
  ['capture-area', 'Capture an area', 'Tools', ['Primary+Shift+2']],
  ['page-devtools', 'Page developer tools', 'Tools', ['Primary+Shift+I']],
  ['zoom-in', 'Zoom in', 'Tools', ['Primary+=', 'Primary+Shift+=', 'Primary+Plus']],
  ['zoom-out', 'Zoom out', 'Tools', ['Primary+-']],
  ['zoom-reset', 'Reset zoom', 'Tools', ['Primary+0']],
  ['show-boosts', 'Boost this site', 'Tools', []],
  ['import-bookmarks', 'Import bookmarks', 'Tools', []]
];
const KEY_ALIASES = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Enter: 'Return', ' ': 'Space', '+': 'Plus', Esc: 'Escape' };
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);
function inputAccel(input) {
  if (!input || MODIFIER_KEYS.has(input.key)) return null;
  let key = KEY_ALIASES[input.key] || input.key;
  if (input.shift && /^Digit\d$/.test(input.code || '')) key = input.code.slice(-1);
  if (input.shift && ['Equal', 'Minus', 'Backslash', 'Backquote', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash'].includes(input.code)) {
    key = ({ Equal: '=', Minus: '-', Backslash: '\\', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' })[input.code];
  }
  return canon([input.control && 'Ctrl', input.alt && 'Alt', input.shift && 'Shift', input.meta && 'Cmd', key].filter(Boolean).join('+'));
}

class ShortcutsService {
  constructor(platform = process.platform) {
    this.platform = platform;
    this.overrides = {};
    this.recording = new Map();
    this.definitions = DEFINITIONS.map(([id, label, category, keys]) => ({ id, label, category,
      defaults: keys.map(k => canon((id === 'show-history' && platform === 'darwin' ? 'Primary+Y' : k).replace('Primary', platform === 'darwin' ? 'Cmd' : 'Ctrl'))) }));
    this.byId = new Map(this.definitions.map(d => [d.id, d]));
  }
  initialize(file) {
    this.file = file;
    try {
      if (fs.statSync(file).size > 100000) return;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const clean = {};
      for (const [id, key] of Object.entries(saved).slice(0, 100)) {
        if (!this.byId.has(id)) continue;
        if (key === null) clean[id] = null;
        else if (!this.check(key).error && canon(key) === key) clean[id] = key;
      }
      // Reject a damaged map as a whole; never silently steal a binding on load.
      const seen = new Set();
      for (const d of this.definitions) for (const key of this.keys(d.id, clean)) {
        if (seen.has(key)) return;
        seen.add(key);
      }
      this.overrides = clean;
    } catch {}
  }
  keys(id, map = this.overrides) {
    if (Object.hasOwn(map, id)) return map[id] ? [map[id]] : [];
    return this.byId.get(id)?.defaults || [];
  }
  list() {
    return { platform: this.platform, commands: this.definitions.map(d => ({ id: d.id, label: d.label, category: d.category,
      accels: this.keys(d.id), defaultAccels: d.defaults, changed: Object.hasOwn(this.overrides, d.id) })) };
  }
  reserved(key) {
    const primary = this.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    const keys = ['Ctrl+Tab', 'Ctrl+Shift+Tab', 'Escape', ...['C', 'V', 'X', 'A', 'Z', ...(this.platform === 'darwin' ? [] : ['Y']), 'Shift+V', 'Shift+Z'].map(k => `${primary}+${k}`)];
    for (let n = 1; n <= 9; n++) keys.push(`Alt+${n}`);
    if (this.platform === 'darwin') keys.push('Cmd+Q', 'Cmd+H', 'Cmd+M', 'Cmd+Tab', 'Cmd+Shift+Tab', 'Cmd+Space', 'Ctrl+Cmd+Q', 'Alt+Cmd+Escape', 'Cmd+Shift+3', 'Cmd+Shift+4', 'Cmd+Shift+5');
    else keys.push('Alt+F4', 'Alt+Tab', 'Alt+Shift+Tab', 'Ctrl+Alt+Delete', 'Ctrl+Shift+Escape', 'Ctrl+Escape', 'Alt+Space', 'Alt+Escape', 'Alt+Return', 'F10');
    return keys.some(k => canon(k) === key);
  }
  check(accel) {
    const key = canon(accel);
    if (!key || (this.platform !== 'darwin' && key.includes('Cmd+'))) return { error: 'That key combination is not supported.' };
    if (this.reserved(key)) return { error: 'This shortcut is reserved for editing, navigation or the operating system.' };
    const parts = key.split('+');
    const strong = this.platform === 'darwin' ? parts.includes('Cmd') || parts.includes('Ctrl') : parts.includes('Ctrl') || parts.includes('Alt');
    if (!F_KEY.test(parts.at(-1)) && !strong) return { error: 'Include Ctrl or Command, or use a function key.' };
    return { accel: key };
  }
  owner(key, except, map = this.overrides) { return this.definitions.find(d => d.id !== except && this.keys(d.id, map).includes(key)); }
  save(map) {
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(map, null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
      this.overrides = map;
      return { success: true, ...this.list() };
    } catch (error) { return { error: error.message }; }
  }
  assign(id, key, { force = false } = {}) {
    if (!this.byId.has(id)) return { error: 'Unknown command.' };
    if (key === null) return this.save({ ...this.overrides, [id]: null });
    const checked = this.check(key);
    if (checked.error) return checked;
    const other = this.owner(checked.accel, id);
    if (other && !force) return { conflict: other.id, label: other.label, accel: checked.accel };
    const next = { ...this.overrides, [id]: checked.accel };
    if (other) next[other.id] = null;
    return this.save(next);
  }
  reset(id, { force = false } = {}) {
    if (id === null) return this.save({});
    if (!this.byId.has(id)) return { error: 'Unknown command.' };
    const next = { ...this.overrides };
    delete next[id];
    const conflicts = this.keys(id, next).map(key => ({ key, other: this.owner(key, id, next) })).filter(c => c.other);
    if (conflicts.length && !force) return { conflict: conflicts[0].other.id, label: conflicts[0].other.label, reset: true };
    for (const { other } of conflicts) next[other.id] = null;
    return this.save(next);
  }
  resolve(input) {
    const key = inputAccel(input);
    if (!key) return null;
    if (key === 'Escape') return 'close-popups';
    if (key === 'Ctrl+Tab') return 'next-recent-tab';
    if (key === 'Ctrl+Shift+Tab') return 'previous-recent-tab';
    const space = /^Alt\+([1-9])$/.exec(key);
    if (space) return `space-${space[1]}`;
    // Space cycling has its own bindings and remains configurable below.
    return this.owner(key)?.id || null;
  }
  record(owner, id, recordId) {
    if (!this.byId.has(id)) return { error: 'Unknown command.' };
    this.recording.set(owner, { id, recordId, expires: Date.now() + 30000 });
    return { success: true };
  }
  capture(owner, input) {
    const record = this.recording.get(owner);
    if (!record) return null;
    if (record.expires < Date.now()) { this.recording.delete(owner); return { canceled: true, id: record.id, recordId: record.recordId }; }
    if (input.type !== 'keyDown' || MODIFIER_KEYS.has(input.key)) return { waiting: true };
    this.recording.delete(owner);
    if (input.key === 'Escape') return { canceled: true, id: record.id, recordId: record.recordId };
    const checked = this.check(inputAccel(input));
    return { id: record.id, recordId: record.recordId, ...checked };
  }
}

function installShortcuts({ service, ipcMain, BrowserWindow, isTrusted }) {
  const recordingOwners = new WeakSet();
  const changed = result => {
    if (result.success) for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('shortcuts-changed', service.list());
    return result;
  };
  ipcMain.handle('shortcuts-get', event => isTrusted(event) ? service.list() : { error: 'Unavailable.' });
  ipcMain.handle('shortcuts-assign', (event, id, key, options) => isTrusted(event) ? changed(service.assign(id, key, options || {})) : { error: 'Unavailable.' });
  ipcMain.handle('shortcuts-reset', (event, id, options) => isTrusted(event) ? changed(service.reset(id, options || {})) : { error: 'Unavailable.' });
  ipcMain.handle('shortcuts-record', (event, id, recordId) => {
    if (!isTrusted(event)) return { error: 'Unavailable.' };
    if (!recordingOwners.has(event.sender)) {
      recordingOwners.add(event.sender);
      const ownerId = event.sender.id;
      event.sender.once('destroyed', () => service.recording.delete(ownerId));
    }
    return service.record(event.sender.id, id, recordId);
  });
  ipcMain.handle('shortcuts-cancel-record', event => { if (isTrusted(event)) service.recording.delete(event.sender.id); });
}
module.exports = { ShortcutsService, installShortcuts, inputAccel };
