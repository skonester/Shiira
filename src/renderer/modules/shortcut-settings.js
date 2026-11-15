import { escapeHtml } from './utils.js';
const status = message => { document.getElementById('shortcut-status').textContent = message; };
const signature = key => String(key || '').split('+').map(p => p.trim().toLowerCase()).sort().join('+');

export const ShortcutSettingsMixin = {
  initShortcutSettings() {
    const nav = document.createElement('button');
    nav.type = 'button';
    nav.dataset.settingsSection = 'shortcuts';
    nav.textContent = 'Keyboard Shortcuts';
    nav.onclick = () => this.selectSettingsSection('shortcuts');
    document.querySelector('.settings-nav')?.appendChild(nav);
    const page = document.createElement('section');
    page.className = 'settings-page hidden';
    page.dataset.settingsPage = 'shortcuts';
    page.innerHTML = `<h4>Keyboard Shortcuts</h4><p>Record a shortcut, then apply it. Editing keys, Ctrl+Tab and system shortcuts stay reserved.</p>
      <div class="settings-inline"><input id="shortcut-search" type="search" placeholder="Find a command" aria-label="Find a shortcut command"><button id="shortcut-reset-all" class="settings-action">Reset all</button><button id="shortcut-cancel" class="settings-action hidden">Cancel recording</button></div>
      <p id="shortcut-status" role="status" aria-live="polite"></p><button id="shortcut-reassign" class="settings-action hidden">Reassign shortcut</button><div id="shortcut-list"></div>`;
    document.querySelector('.settings-pages')?.appendChild(page);
    document.getElementById('shortcut-search').oninput = () => this.renderShortcutSettings();
    document.getElementById('shortcut-reset-all').onclick = () => this.changeShortcut(null, null, { reset: true });
    document.getElementById('shortcut-cancel').onclick = () => this.cancelShortcutRecording();
    document.getElementById('shortcut-reassign').onclick = () => {
      const conflict = this.shortcutConflict;
      if (conflict) this.changeShortcut(conflict.id, conflict.key, { reset: conflict.reset, force: true });
    };
    window.shiiraAPI.shortcuts.onChanged(config => this.applyShortcutConfig(config));
    window.addEventListener('blur', () => { void this.cancelShortcutRecording(false); });
    window.shiiraAPI.shortcuts.onRecorded(result => this.receiveRecordedShortcut(result));
    this.defaultShortcutHints = [...document.querySelectorAll('[title], kbd')].map(element => ({ element, text: element.tagName === 'KBD' ? element.textContent : element.title, kbd: element.tagName === 'KBD' }));
    void this.loadShortcutSettings();
  },
  async loadShortcutSettings() {
    try {
      const config = await window.shiiraAPI.shortcuts.get();
      if (config.error) { status(config.error); return; }
      this.applyShortcutConfig(config);
    } catch (error) { status(error.message); }
  },
  applyShortcutConfig(config) {
    this.shortcutConfig = config;
    for (const { element, text, kbd } of this.defaultShortcutHints || []) {
      const updated = kbd ? this.shortcutHint(text) : text.replace(/(?:Ctrl|Cmd)(?:\+(?:Ctrl|Alt|Shift|Cmd))*\+[A-Za-z0-9,\\]+/g, hint => this.shortcutHint(hint));
      if (kbd) element.textContent = updated || 'Unassigned';
      else element.title = updated;
    }
    this.renderShortcutSettings();
    if (this.isCommandBarOpen?.()) this.renderCommandResults();
  },
  shortcutHint(original) {
    if (!this.shortcutConfig) return original;
    const key = this.shortcutConfig.platform === 'darwin' ? original.replace(/^Ctrl\+/, 'Cmd+') : original;
    const command = this.shortcutConfig.commands.find(c => (this.shortcutConfig.platform === 'darwin' && original === 'Ctrl+H' && c.id === 'show-history') || c.defaultAccels.some(a => signature(a) === signature(key)));
    return command ? command.accels.join(' / ') : original;
  },
  renderShortcutSettings() {
    const host = document.getElementById('shortcut-list');
    if (!host || !this.shortcutConfig) return;
    const query = document.getElementById('shortcut-search').value.trim().toLowerCase();
    host.innerHTML = this.shortcutConfig.commands.filter(c => `${c.label} ${c.category} ${c.accels.join(' ')}`.toLowerCase().includes(query)).map(c => {
      const pending = this.pendingShortcut?.id === c.id;
      const keys = this.recordingCommand === c.id ? 'Press your shortcut…' : pending ? this.pendingShortcut.key : c.accels.join(' / ') || 'Unassigned';
      return `<div class="shortcut-setting-row" data-shortcut-id="${escapeHtml(c.id)}"><div><strong>${escapeHtml(c.label)}</strong><small>${escapeHtml(c.category)}${c.changed ? ' · Customized' : ''}</small><kbd>${escapeHtml(keys)}</kbd></div><div class="shortcut-setting-buttons"><button class="settings-action" data-shortcut-action="record">Record</button>${pending ? '<button class="settings-action" data-shortcut-action="apply">Apply</button>' : ''}<button class="settings-action" data-shortcut-action="clear">Clear</button><button class="settings-action" data-shortcut-action="reset">Reset</button></div></div>`;
    }).join('') || '<p>No matching commands.</p>';
    host.querySelectorAll('[data-shortcut-action]').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-shortcut-id]').dataset.shortcutId;
        const action = button.dataset.shortcutAction;
        if (action === 'record') this.startShortcutRecording(id);
        else if (action === 'apply') this.changeShortcut(id, this.pendingShortcut.key);
        else this.changeShortcut(id, null, { reset: action === 'reset' });
      };
    });
  },
  async startShortcutRecording(id) {
    const canceled = this.cancelShortcutRecording(false);
    const recordId = this.shortcutRecordGeneration = (this.shortcutRecordGeneration || 0) + 1;
    this.recordingCommand = id;
    await canceled;
    if (recordId !== this.shortcutRecordGeneration) return;
    const result = await window.shiiraAPI.shortcuts.record(id, recordId);
    if (recordId !== this.shortcutRecordGeneration || this.recordingCommand !== id) return;
    if (result.error) { this.recordingCommand = null; status(result.error); return; }
    this.pendingShortcut = null;
    this.shortcutConflict = null;
    document.getElementById('shortcut-reassign').classList.add('hidden');
    document.getElementById('shortcut-cancel').classList.remove('hidden');
    status('Press a shortcut. Escape cancels.');
    this.renderShortcutSettings();
    this.shortcutRecordTimer = setTimeout(() => this.cancelShortcutRecording(), 30000);
  },
  async cancelShortcutRecording(showStatus = true) {
    clearTimeout(this.shortcutRecordTimer);
    const generation = this.shortcutRecordGeneration = (this.shortcutRecordGeneration || 0) + 1;
    if (!this.recordingCommand) return;
    this.recordingCommand = null;
    await window.shiiraAPI.shortcuts.cancelRecord();
    if (generation !== this.shortcutRecordGeneration) return;
    document.getElementById('shortcut-cancel').classList.add('hidden');
    if (showStatus) status('Recording cancelled.');
    this.renderShortcutSettings();
  },
  receiveRecordedShortcut(result) {
    if (!this.recordingCommand || result.recordId !== this.shortcutRecordGeneration || result.id !== this.recordingCommand) return;
    clearTimeout(this.shortcutRecordTimer);
    this.recordingCommand = null;
    document.getElementById('shortcut-cancel').classList.add('hidden');
    this.pendingShortcut = result.accel ? { id: result.id, key: result.accel } : null;
    status(result.error || (result.canceled ? 'Recording cancelled.' : 'Shortcut recorded. Choose Apply to save it.'));
    this.renderShortcutSettings();
  },
  async changeShortcut(id, key, { reset = false, force = false } = {}) {
    await this.cancelShortcutRecording(false);
    const result = reset ? await window.shiiraAPI.shortcuts.reset(id, { force }) : await window.shiiraAPI.shortcuts.assign(id, key, { force });
    this.shortcutConflict = result.conflict ? { id, key, reset } : null;
    document.getElementById('shortcut-reassign').classList.toggle('hidden', !result.conflict);
    if (result.conflict) status(`Already used by “${result.label}”. Reassigning will clear that command’s shortcut.`);
    else if (result.error) status(result.error);
    else {
      this.pendingShortcut = null;
      this.applyShortcutConfig(result);
      status('Shortcuts saved.');
    }
    return result;
  }
};
