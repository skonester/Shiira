// Chrome extensions in Shiira's window: the toolbar in the navigation bar, the "Add extension?" dialog,
// Settings > Extensions, and tabs that extensions open, select or close.
// Adapted from Solamar's ExtensionsUI (https://github.com/Bambeek/solamar, GPL-3.0-or-later).

import { escapeHtml } from './utils.js';

const PARTITION = 'persist:main';
const WEB_STORE = 'https://chromewebstore.google.com/';

function iconUrl(id) {
  return `crx://extension-icon/${id}/32/2?partition=${encodeURIComponent(PARTITION)}`;
}

export const ExtensionsMixin = {
  initExtensions() {
    this.installedExtensions = [];
    this.extensionToolbar = document.getElementById('extension-actions');
    this.extensionDialog = document.getElementById('extension-install-dialog');
    const api = window.shiiraAPI.extensions;
    if (!api) return;

    api.onCreateTab((request) => this.openTabForExtension(request));
    api.onSelectTab((wcId) => {
      const tab = this.findTabByWebContentsId(wcId);
      if (tab) this.switchTab(tab.id);
    });
    api.onCloseTab((wcId) => {
      const tab = this.findTabByWebContentsId(wcId);
      if (tab) this.closeTab(tab.id);
    });
    api.onInstallPrompt((prompt) => this.showExtensionInstallDialog(prompt));
    api.onChanged(() => void this.refreshExtensions());

    document.getElementById('extension-install-allow')?.addEventListener('click', () => this.decideExtensionInstall(true));
    document.getElementById('extension-install-cancel')?.addEventListener('click', () => this.decideExtensionInstall(false));
    this.extensionDialog?.addEventListener('click', (event) => {
      if (event.target === this.extensionDialog) this.decideExtensionInstall(false);
    });
    document.getElementById('settings-open-webstore')?.addEventListener('click', () => {
      this.hideSettings?.();
      this.createTab(WEB_STORE);
    });

    void this.refreshExtensions();
  },

  webContentsIdOf(tab) {
    try {
      return tab?.webview?.getWebContentsId?.() ?? null;
    } catch {
      return null; // Not attached yet.
    }
  },

  findTabByWebContentsId(wcId) {
    return this.tabs.find(tab => this.webContentsIdOf(tab) === wcId) || null;
  },

  // chrome.tabs.create / windows.create from an extension: a normal Shiira tab, reported back once attached.
  openTabForExtension({ requestId, url, active }) {
    const tabId = this.createTab(url || 'about:blank', { background: active === false });
    const tab = this.tabs.find(t => t.id === tabId);
    const report = () => {
      const wcId = this.webContentsIdOf(tab);
      if (wcId !== null) window.shiiraAPI.extensions.tabCreated(requestId, wcId);
      return wcId !== null;
    };
    if (!tab?.webview) return;
    if (!report()) tab.webview.addEventListener('did-attach', report, { once: true });
  },

  async refreshExtensions() {
    try {
      this.installedExtensions = await window.shiiraAPI.extensions.list();
    } catch (error) {
      console.warn('[Extensions] Could not list extensions:', error);
      this.installedExtensions = [];
    }
    this.updateExtensionToolbar();
    const page = document.querySelector('[data-settings-page="extensions"]');
    if (page && !page.classList.contains('hidden')) this.renderExtensionSettings();
  },

  // The toolbar shows the buttons of extensions for the tab on screen; private tabs and the home page get none.
  updateExtensionToolbar() {
    const toolbar = this.extensionToolbar;
    if (!toolbar) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    const wcId = tab && !tab.isHome && !tab.privateMode ? this.webContentsIdOf(tab) : null;
    const visible = this.installedExtensions.length > 0 && wcId !== null;
    toolbar.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (toolbar.getAttribute('tab') !== String(wcId)) toolbar.setAttribute('tab', String(wcId));
    window.shiiraAPI.extensions.tabSelected(wcId).catch(() => {});
  },

  // Called when a tab is shown or its page attaches.
  onActiveTabChanged() {
    this.updateExtensionToolbar();
  },

  showExtensionInstallDialog(prompt) {
    // A newer "Add to Chrome" replaces an unanswered one; the store gets a cancel for the old one.
    if (this.extensionPrompt && this.extensionPrompt.id !== prompt.id) {
      window.shiiraAPI.extensions.decideInstall(this.extensionPrompt.id, false);
    }
    this.extensionPrompt = prompt;
    const dialog = this.extensionDialog;
    if (!dialog) {
      window.shiiraAPI.extensions.decideInstall(prompt.id, false);
      return;
    }
    document.getElementById('extension-install-title').textContent = `Add “${prompt.name}” to Shiira?`;
    const icon = document.getElementById('extension-install-icon');
    if (prompt.icon) {
      icon.src = prompt.icon;
      icon.classList.remove('hidden');
    } else {
      icon.classList.add('hidden');
    }
    const list = document.getElementById('extension-install-permissions');
    const intro = document.getElementById('extension-install-intro');
    if (prompt.permissions?.length) {
      intro.textContent = 'It will be able to:';
      list.replaceChildren(...prompt.permissions.map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }));
      list.classList.remove('hidden');
    } else {
      intro.textContent = 'It asks for no special access.';
      list.replaceChildren();
      list.classList.add('hidden');
    }
    dialog.classList.remove('hidden');
    document.getElementById('extension-install-allow')?.focus();
  },

  decideExtensionInstall(ok) {
    const prompt = this.extensionPrompt;
    this.extensionPrompt = null;
    this.extensionDialog?.classList.add('hidden');
    if (!prompt) return;
    window.shiiraAPI.extensions.decideInstall(prompt.id, ok);
    if (ok) this.setStatus?.(`Adding ${prompt.name}…`, 3000);
  },

  renderExtensionSettings() {
    const list = document.getElementById('settings-extension-list');
    if (!list) return;
    const status = document.getElementById('settings-extension-status');
    if (!this.installedExtensions.length) {
      list.innerHTML = '<p class="extension-empty">No extensions yet. Open the Chrome Web Store, choose one and press <strong>Add to Chrome</strong>.</p>';
      return;
    }
    list.replaceChildren(...this.installedExtensions.map((extension) => {
      const row = document.createElement('div');
      row.className = 'extension-row';
      row.innerHTML = `
        <img class="extension-icon" src="${escapeHtml(iconUrl(extension.id))}" width="24" height="24" alt="">
        <span class="extension-text">
          <span class="extension-name">${escapeHtml(extension.name)}</span>
          <span class="extension-meta">${escapeHtml(extension.version)}${extension.description ? ` · ${escapeHtml(extension.description)}` : ''}</span>
        </span>
        <button type="button" class="settings-action extension-remove">Remove</button>`;
      row.querySelector('.extension-icon').addEventListener('error', (event) => { event.currentTarget.style.visibility = 'hidden'; });
      row.querySelector('.extension-remove').addEventListener('click', async () => {
        const ok = await this.showConfirmation(`Remove “${extension.name}”?`, 'Its files and settings are deleted from Shiira.', { confirmText: 'Remove', danger: true });
        if (!ok) return;
        const result = await window.shiiraAPI.extensions.uninstall(extension.id);
        if (status) status.textContent = result?.success ? `${extension.name} was removed.` : (result?.error || 'Could not remove the extension.');
        await this.refreshExtensions();
        this.renderExtensionSettings();
      });
      return row;
    }));
  }
};
