import { escapeHtml } from './utils.js';
import { uid, SPACE_COLORS } from './spaces-model.js';

const ERRORS = {
  missing: 'That profile is no longer available. Refresh the source list.',
  empty: 'This profile has no supported web bookmarks.',
  notBookmarks: 'Choose a bookmarks HTML export from your browser.',
  unreadable: 'Could not read these bookmarks. Try a bookmarks HTML export.',
  tooBig: 'The source exceeds the import limit. Try a smaller bookmarks HTML export.',
  fullDiskAccess: 'Safari needs macOS Full Disk Access. You can also export Safari bookmarks to an HTML file.'
};

export function bookmarkPlan(nodes, spaceId, { parentId = null } = {}) {
  const folders = [], tabs = [];
  const walk = (list, parent) => list.forEach((node, position) => {
    if (node.type === 'folder') {
      const id = uid('f-');
      folders.push({ id, title: node.name, spaceId, parentId: parent, position, collapsed: true });
      walk(node.children, id);
    } else tabs.push({ url: node.url, title: node.title, customTitle: node.title, spaceId,
      parentId: parent, position, itemId: uid('i-'), section: 'pinned', pinnedUrl: node.url });
  });
  walk(nodes, parentId);
  return { folders, tabs };
}

const field = id => document.getElementById(`browser-import-${id}`);
export const BrowserImportMixin = {
  initBrowserImport() {
    const overlay = document.createElement('div');
    overlay.id = 'browser-import-dialog';
    overlay.className = 'shiira-modal hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'browser-import-title');
    overlay.innerHTML = `<div class="shiira-modal-content browser-import-card">
      <div class="shiira-modal-header"><h3 id="browser-import-title">Bring your bookmarks to Shiira</h3><button class="panel-close-btn" id="browser-import-close" aria-label="Close import">×</button></div>
      <div class="browser-import-body"><p>Keep your folders and bookmark order. Your other browser’s files are only read.</p>
      <label for="browser-import-source">Import from</label><select id="browser-import-source"></select>
      <label for="browser-import-profile">Browser profile</label><select id="browser-import-profile"></select>
      <div class="settings-inline"><button id="browser-import-preview" class="settings-action">Preview bookmarks</button><button id="browser-import-refresh" class="settings-action">Refresh sources</button></div>
      <div id="browser-import-summary" role="status" aria-live="polite"></div>
      <label for="browser-import-target">Destination</label><select id="browser-import-target"><option value="new-space">New Space with pinned tabs</option><option value="space">Current Space, in an imported folder</option><option value="bar">Bookmarks bar</option></select>
      <label for="browser-import-name">Space or folder name</label><input id="browser-import-name" maxlength="60" value="Imported Bookmarks">
      <p>Pinned bookmarks start asleep until you open them. Passwords, cookies and history are not included. For Arc spaces and favorites, choose Arc.</p>
      <div class="settings-inline"><button id="browser-import-apply" class="setup-primary" disabled>Import bookmarks</button></div></div></div>`;
    document.body.appendChild(overlay);
    this.browserImportDialog = overlay;
    field('close').onclick = () => this.hideBrowserImport();
    overlay.addEventListener('click', e => { if (e.target === overlay) this.hideBrowserImport(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hideBrowserImport(); }
      if (e.key === 'Tab') {
        const inputs = [...overlay.querySelectorAll('button,select,input')].filter(el => !el.disabled);
        const first = inputs[0], last = inputs.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    field('source').onchange = () => this.updateBrowserImportProfiles();
    field('profile').onchange = () => this.resetBrowserImportPreview();
    field('refresh').onclick = () => this.refreshBrowserImportSources();
    field('preview').onclick = () => this.previewBrowserImport();
    field('apply').onclick = () => this.applyBrowserImport();
    field('target').onchange = () => { field('name').disabled = field('target').value === 'bar'; };
    document.getElementById('settings-import-browsers')?.addEventListener('click', () => { this.hideSettings(); this.showBrowserImport(); });
    document.getElementById('setup-import-browsers')?.addEventListener('click', () => this.showBrowserImport());
  },
  async showBrowserImport() {
    this.hideMainMenu?.(true);
    this.importReturnFocus = document.activeElement;
    this.browserImportDialog.classList.remove('hidden');
    field('source').focus();
    await this.refreshBrowserImportSources();
  },
  hideBrowserImport() {
    if (this.browserImportBusy || this.browserImportDialog?.classList.contains('hidden')) return;
    this.browserImportDialog?.classList.add('hidden');
    this.importReturnFocus?.focus?.();
  },
  resetBrowserImportPreview() {
    this.browserImportToken = null;
    field('apply').disabled = true;
    field('summary').textContent = '';
  },
  async refreshBrowserImportSources() {
    if (this.browserImportBusy) return;
    this.resetBrowserImportPreview();
    field('source').innerHTML = '<option value="">Looking for browsers…</option>';
    this.setBrowserImportBusy(true);
    try {
      const result = await window.shiiraAPI.browserImport.detect();
      if (!Array.isArray(result)) throw new Error(result?.error || 'Could not find browsers.');
      this.importBrowserSources = result;
      field('source').innerHTML = result.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('') + '<option value="file">Bookmarks HTML file…</option><option value="arc">Arc spaces and favorites…</option>';
      this.updateBrowserImportProfiles();
    } catch (error) {
      field('source').innerHTML = '<option value="file">Bookmarks HTML file…</option><option value="arc">Arc spaces and favorites…</option>';
      this.updateBrowserImportProfiles();
      field('summary').textContent = error.message;
    } finally { this.setBrowserImportBusy(false); }
  },
  updateBrowserImportProfiles() {
    this.resetBrowserImportPreview();
    const source = field('source').value;
    const browser = this.importBrowserSources?.find(b => b.id === source);
    field('profile').innerHTML = (browser?.profiles || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || 'Default')}</option>`).join('') || '<option>Not needed</option>';
    field('profile').disabled = !browser;
    field('preview').textContent = source === 'arc' ? 'Import Arc data…' : source === 'file' ? 'Choose HTML file…' : 'Preview bookmarks';
    if (browser?.blocked) field('summary').textContent = ERRORS[browser.blocked] || 'Cannot read this source.';
    field('name').value = browser ? `${browser.name} Bookmarks` : 'Imported Bookmarks';
  },
  setBrowserImportBusy(busy) {
    this.browserImportBusy = busy;
    this.browserImportDialog.querySelectorAll('button,select,input').forEach(el => { el.disabled = busy; });
    if (!busy) {
      field('profile').disabled = ['file', 'arc'].includes(field('source').value);
      field('name').disabled = field('target').value === 'bar';
      field('apply').disabled = !this.browserImportToken;
    }
  },
  async previewBrowserImport() {
    if (this.browserImportBusy) return;
    const source = field('source').value;
    if (source === 'arc') { this.hideBrowserImport(); await this.importFromArc(); return; }
    this.resetBrowserImportPreview();
    this.setBrowserImportBusy(true);
    field('summary').textContent = 'Reading bookmarks…';
    try {
      const result = await window.shiiraAPI.browserImport.preview(source === 'file' ? { kind: 'file' } : { browserId: source, profileId: field('profile').value });
      if (result?.canceled) { field('summary').textContent = ''; return; }
      if (result?.error) throw new Error(ERRORS[result.error] || result.error);
      this.browserImportToken = result.token;
      field('summary').textContent = `${result.bookmarks} bookmark${result.bookmarks === 1 ? '' : 's'} in ${result.folders} folder${result.folders === 1 ? '' : 's'}.${result.source === 'backup' ? ` From Firefox’s backup dated ${result.date}.` : ''}${result.dropped ? ` Skipped ${result.dropped} unsupported URLs.` : ''}${result.truncated ? ' Import limit reached; only the previewed items will be imported.' : ''}`;
    } catch (error) { field('summary').textContent = error.message; }
    finally { this.setBrowserImportBusy(false); }
  },
  async applyBrowserImport() {
    if (!this.browserImportToken || this.browserImportBusy) return;
    const target = field('target').value;
    const name = field('name').value.trim() || 'Imported Bookmarks';
    if (target !== 'bar' && (!this.spacesLoaded || this.spacesReadOnly)) { field('summary').textContent = 'Wait for Spaces to load, or choose the bookmarks bar.'; return; }
    this.setBrowserImportBusy(true);
    try {
      const result = await window.shiiraAPI.browserImport.apply(this.browserImportToken, target);
      if (!result?.success) throw new Error(result?.error || 'Import failed.');
      this.browserImportToken = null;
      if (target === 'bar') {
        const saved = await window.shiiraAPI.bookmarks.get();
        this.bookmarksData = saved.bookmarks;
        this.bookmarksBarEnabled = saved.barEnabled;
        this.updateBookmarksBarUI();
        this.renderBookmarksBar();
        field('summary').textContent = `Imported ${result.imported.bookmarks} bookmarks. ${result.imported.skipped} duplicates skipped.`;
      } else {
        const count = await this.importBookmarksIntoSpace(result.data, { name, newSpace: target === 'new-space' });
        field('summary').textContent = `Imported ${count} pinned bookmarks. Open the Space to browse them.`;
      }
    } catch (error) { field('summary').textContent = error.message; }
    finally { this.setBrowserImportBusy(false); }
  },
  async importBookmarksIntoSpace(data, { name, newSpace }) {
    const spaceId = newSpace ? uid('s-') : this.focusedSpaceId;
    const parent = newSpace ? null : { id: uid('f-'), title: name, spaceId, parentId: null, collapsed: false,
      position: Math.max(-1, ...this.tabs.filter(t => t.section === 'pinned' && t.spaceId === spaceId && !t.parentId).map(t => t.position || 0), ...this.sidebarFolders.filter(f => f.spaceId === spaceId && !f.parentId).map(f => f.position || 0)) + 1 };
    const plan = bookmarkPlan(data.nodes, spaceId, { parentId: parent?.id });
    const keepers = this.tabs.filter(t => !t.privateMode && !t.isHome && t.section !== 'today');
    if ((newSpace && this.spaces.length >= 50) || this.sidebarFolders.length + plan.folders.length + (parent ? 1 : 0) > 1000 || keepers.length + plan.tabs.length > 3000) throw new Error('This import exceeds the Space, folder or pinned-tab limit. Choose the bookmarks bar or free some space, then preview again.');
    const created = [];
    const previousFocus = this.focusedSpaceId;
    const folderIds = new Set([...plan.folders, ...(parent ? [parent] : [])].map(f => f.id));
    if (newSpace) this.spaces.push({ id: spaceId, title: name.slice(0, 60), icon: '🔖', color: SPACE_COLORS[this.spaces.length % SPACE_COLORS.length], position: this.spaces.length, profileId: this.profileForSpace?.(previousFocus) || 'default' });
    if (parent) this.sidebarFolders.push(parent);
    this.sidebarFolders.push(...plan.folders);
    this.sidebarBatch = true;
    try {
      for (const tab of plan.tabs) created.push(this.createTab(tab.url, { ...tab, deferLoad: true, background: true }));
      this.sidebarBatch = false;
      this.placeTabElements();
      this.focusSpace(spaceId, { activate: false });
      const saved = await this.saveSpacesNow();
      if (!saved?.success) throw new Error(saved?.error || 'Could not save imported bookmarks.');
      this.renderSpaceChrome();
      return created.length;
    } catch (error) {
      const ids = new Set(created);
      this.sidebarBatch = false;
      this.tabs.filter(t => ids.has(t.id)).forEach(t => t.element.remove());
      this.tabs = this.tabs.filter(t => !ids.has(t.id));
      this.sidebarFolders = this.sidebarFolders.filter(f => !folderIds.has(f.id));
      if (newSpace) this.spaces = this.spaces.filter(s => s.id !== spaceId);
      this.focusedSpaceId = previousFocus;
      this.placeTabElements();
      this.renderSpaceChrome();
      throw error;
    } finally { this.sidebarBatch = false; }
  }
};
