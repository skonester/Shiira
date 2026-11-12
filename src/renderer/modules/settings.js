// Zenium-inspired first-run setup and settings, using Shiira's existing preference methods.
import { normalizeHomepage } from './homepage.js';

const SETUP_THEMES = [
  ['shiira-night', 'Shiira Night'], ['shiira-pearl', 'Shiira Pearl'],
  ['shiira-classic-dark', 'Classic Dark'], ['abyssal-red', 'Abyssal Red'],
  ['steelheart', 'Steelheart'], ['rustveil', 'Rustveil'],
  ['sakura-shadow', 'Sakura Shadow']
];

const SETUP_SEARCH = [['brave', 'Brave Search'], ['duckduckgo', 'DuckDuckGo Quick'], ['scira', 'Scira AI']];

function setStatus(id, message) {
  const element = document.getElementById(id);
  if (element) element.textContent = message;
}

function keepFocusInside(dialog, event) {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled):not(.hidden), input:not(:disabled), select:not(:disabled)')]
    .filter(element => !element.closest('.hidden'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export const SettingsMixin = {
  initWelcomeSettings() {
    this.settingsModal = document.getElementById('settings-modal');
    this.setupOverlay = document.getElementById('setup-overlay');
    this.setupStep = 0;
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.hideSettings());
    this.settingsModal?.addEventListener('click', event => {
      if (event.target === this.settingsModal) this.hideSettings();
    });
    this.settingsModal?.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.hideSettings();
      keepFocusInside(this.settingsModal, event);
    });
    this.setupOverlay?.addEventListener('keydown', event => keepFocusInside(this.setupOverlay, event));
    document.querySelectorAll('[data-settings-section]').forEach(button => {
      button.addEventListener('click', () => this.selectSettingsSection(button.dataset.settingsSection));
    });
    document.getElementById('settings-find')?.addEventListener('input', () => this.searchSettings());
    document.getElementById('settings-save-homepage')?.addEventListener('click', () => this.saveHomepageSetting());
    document.getElementById('settings-homepage')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.saveHomepageSetting();
    });
    document.getElementById('settings-reset-homepage')?.addEventListener('click', () => {
      localStorage.removeItem('shiira-homepage-url');
      document.getElementById('settings-homepage').value = '';
      setStatus('settings-homepage-status', 'Home and new tabs now open Shiira’s home page.');
    });
    document.getElementById('settings-restore-session')?.addEventListener('change', async event => {
      const enabled = event.target.checked;
      localStorage.setItem('shiira-restore-session', String(enabled));
      if (!enabled) await window.shiiraAPI.session.clear();
    });
    document.getElementById('settings-layout')?.addEventListener('change', event => this.setLayout(event.target.value));
    document.getElementById('settings-archive-hours')?.addEventListener('change', event => {
      localStorage.setItem('shiira-archive-hours', event.target.value);
    });
    document.getElementById('settings-sleep-minutes')?.addEventListener('change', event => {
      localStorage.setItem('shiira-sleep-minutes', event.target.value);
    });
    document.getElementById('settings-peek')?.addEventListener('change', event => {
      localStorage.setItem('shiira-peek-links', String(event.target.checked));
      this.tabs.forEach(tab => { if (tab.webview) this.injectLinkRouting?.(tab.webview, this.currentTabUrl(tab)); });
    });
    document.getElementById('settings-import-arc')?.addEventListener('click', () => {
      this.hideSettings();
      this.importFromArc();
    });
    document.getElementById('settings-search-engine')?.addEventListener('change', event => {
      this.selectSearchEngine(event.target.value);
    });
    document.getElementById('settings-replay-welcome')?.addEventListener('click', () => {
      this.hideSettings();
      this.showWelcomeSetup();
    });
    document.getElementById('settings-open-themes')?.addEventListener('click', () => {
      this.hideSettings();
      this.showThemesModal();
    });
    document.getElementById('settings-open-about')?.addEventListener('click', () => {
      this.hideSettings();
      this.showAboutPanel();
    });
    const openFromSettings = (id, action) => document.getElementById(id)?.addEventListener('click', () => {
      this.hideSettings();
      action.call(this);
    });
    openFromSettings('settings-open-history', this.showHistoryPanel);
    openFromSettings('settings-open-tab-expose', this.showTabExpose);
    openFromSettings('settings-open-archive', this.showArchivePanel);
    openFromSettings('settings-open-passwords', this.showPasswordAnvil);
    openFromSettings('settings-open-vault', this.showVault);
    const brightness = document.getElementById('settings-brightness');
    brightness?.addEventListener('input', () => {
      this.currentBrightness = Number(brightness.value);
      if (this.brightnessSlider) this.brightnessSlider.value = brightness.value;
      this.updateBrightnessSliderFill();
      this.applyBrightness();
      localStorage.setItem('webview-brightness', brightness.value);
      document.getElementById('settings-brightness-value').textContent = `${brightness.value}%`;
    });
    document.getElementById('settings-bookmarks-bar')?.addEventListener('change', () => this.toggleBookmarksBar());
    document.getElementById('settings-favorites')?.addEventListener('change', () => this.toggleFavoritesEnabled());
    document.getElementById('settings-force-dark')?.addEventListener('change', event => {
      localStorage.setItem('shiira-force-dark-pages', String(event.target.checked));
      this.reload();
    });
    document.getElementById('settings-url-suggestions')?.addEventListener('change', async event => {
      const result = await window.shiiraAPI.privacy.setSetting('enableUrlSuggestions', event.target.checked);
      if (!result?.success) event.target.checked = !event.target.checked;
    });
    document.getElementById('settings-adblock')?.addEventListener('change', () => this.toggleAdBlocker());
    document.getElementById('settings-shield')?.addEventListener('change', () => this.toggleShield());
    document.getElementById('settings-clear-on-exit')?.addEventListener('change', event => {
      const enabled = event.target.checked;
      localStorage.setItem('shiira-clear-on-exit', String(enabled));
      if (this.clearOnExitToggle) this.clearOnExitToggle.checked = enabled;
    });
    document.getElementById('settings-clear-data')?.addEventListener('click', () => this.clearDataFromSettings());
    document.getElementById('settings-clear-history')?.addEventListener('click', () => this.clearHistoryFromSettings());
    document.getElementById('settings-clear-permissions')?.addEventListener('click', () => this.clearAllPermissionsFromSettings());
    document.getElementById('settings-ask-download')?.addEventListener('change', async event => {
      const result = await window.shiiraAPI.browserSettings.set('askWhereToSave', event.target.checked);
      if (!result?.success) {
        event.target.checked = !event.target.checked;
        setStatus('settings-download-status', result?.error || 'Could not save this setting.');
      }
    });
    document.getElementById('settings-change-download-folder')?.addEventListener('click', async () => {
      const result = await window.shiiraAPI.browserSettings.chooseDownloadDirectory();
      if (result?.canceled) return;
      setStatus('settings-download-status', result?.success ? 'Download folder updated.' : result?.error || 'Could not change folder.');
      await this.loadBrowserSettings();
    });
    document.getElementById('settings-reset-download-folder')?.addEventListener('click', async () => {
      const result = await window.shiiraAPI.browserSettings.resetDownloadDirectory();
      setStatus('settings-download-status', result?.success ? 'Using the system downloads folder.' : result?.error || 'Could not reset folder.');
      await this.loadBrowserSettings();
    });
    document.getElementById('settings-open-download-folder')?.addEventListener('click', async () => {
      const result = await window.shiiraAPI.browserSettings.openDownloadDirectory();
      if (!result?.success) setStatus('settings-download-status', result?.error || 'Could not open folder.');
    });
    document.getElementById('settings-auto-updates')?.addEventListener('change', async event => {
      const result = await window.shiiraAPI.browserSettings.set('autoCheckUpdates', event.target.checked);
      if (!result?.success) event.target.checked = !event.target.checked;
    });
    document.getElementById('settings-check-updates')?.addEventListener('click', async () => {
      setStatus('settings-update-status', 'Checking for updates…');
      const result = await window.shiiraAPI.updates.checkForUpdates();
      if (result?.success === false) setStatus('settings-update-status', result.error || 'Update check failed.');
    });
    document.getElementById('settings-download-update')?.addEventListener('click', async () => {
      const result = await window.shiiraAPI.updates.downloadUpdate();
      if (result?.success === false) setStatus('settings-update-status', result.error || 'Download failed.');
    });
    document.getElementById('settings-install-update')?.addEventListener('click', () => window.shiiraAPI.updates.installUpdate());
    window.shiiraAPI.updates.onUpdateStatus(data => this.renderSettingsUpdateStatus(data));

    this.buildWelcomeChoices();
    document.getElementById('setup-back')?.addEventListener('click', () => this.setWelcomeStep(this.setupStep - 1));
    document.getElementById('setup-next')?.addEventListener('click', () => {
      if (this.setupStep === 3) this.finishWelcomeSetup();
      else this.setWelcomeStep(this.setupStep + 1);
    });
    document.getElementById('setup-skip')?.addEventListener('click', () => this.finishWelcomeSetup());
    if (localStorage.getItem('shiira-welcome-complete') !== 'true') this.showWelcomeSetup();
  },

  showSettings(section = 'general') {
    if (this.setupOverlay && !this.setupOverlay.classList.contains('hidden')) return;
    this.hideMainMenu(true);
    document.getElementById('settings-find').value = '';
    this.searchSettings();
    this.selectSettingsSection(section);
    document.getElementById('settings-homepage').value = localStorage.getItem('shiira-homepage-url') || '';
    setStatus('settings-homepage-status', '');
    document.getElementById('settings-restore-session').checked = localStorage.getItem('shiira-restore-session') !== 'false';
    document.getElementById('settings-layout').value = this.layout || 'sidebar';
    // Keep custom values (set before these menus existed) selectable.
    const showChoice = (id, value) => {
      const select = document.getElementById(id);
      if (!select) return;
      if (![...select.options].some(option => option.value === String(value))) select.add(new Option(String(value), String(value)));
      select.value = String(value);
    };
    showChoice('settings-archive-hours', this.getArchiveHours());
    showChoice('settings-sleep-minutes', this.getSleepMinutes());
    document.getElementById('settings-peek').checked = this.isPeekEnabled();
    document.getElementById('settings-search-engine').value = this.currentSearchEngine;
    document.getElementById('settings-brightness').value = this.currentBrightness;
    document.getElementById('settings-brightness-value').textContent = `${this.currentBrightness}%`;
    document.getElementById('settings-bookmarks-bar').checked = Boolean(this.bookmarksBarEnabled);
    document.getElementById('settings-favorites').checked = Boolean(this.favoritesEnabled);
    document.getElementById('settings-force-dark').checked = localStorage.getItem('shiira-force-dark-pages') !== 'false';
    document.getElementById('settings-adblock').checked = Boolean(this.adblockEnabled);
    document.getElementById('settings-shield').checked = Boolean(this.shieldEnabled);
    document.getElementById('settings-clear-on-exit').checked = localStorage.getItem('shiira-clear-on-exit') === 'true';
    this.settingsModal.classList.remove('hidden');
    this.settingsModal.querySelector('.settings-nav button.active')?.focus();
    window.shiiraAPI.getAppInfo().then(async info => {
      document.getElementById('settings-version').textContent = `v${info.version}`;
      setStatus('settings-update-status', `Current version: v${info.version}`);
      try {
        const status = await window.shiiraAPI.updates.getStatus();
        if (status.updateDownloaded) this.renderSettingsUpdateStatus({ status: 'update-downloaded', version: status.updateInfo?.version });
        else if (status.updateAvailable) this.renderSettingsUpdateStatus({ status: 'update-available', version: status.updateInfo?.version });
      } catch (error) {
        console.warn('[Settings] Could not load update status:', error);
      }
    }).catch(() => {
      document.getElementById('settings-version').textContent = 'Unavailable';
    });
    void this.loadBrowserSettings();
    void this.loadPrivacySettings();
    void this.loadSearchCredentials();
  },

  hideSettings() { this.settingsModal?.classList.add('hidden'); },

  selectSettingsSection(section) {
    document.querySelectorAll('[data-settings-section]').forEach(button => {
      button.classList.toggle('active', button.dataset.settingsSection === section);
    });
    document.querySelectorAll('[data-settings-page]').forEach(page => {
      page.classList.toggle('hidden', page.dataset.settingsPage !== section);
    });
    if (section === 'permissions') void this.renderSitePermissions();
    if (section === 'extensions') void this.refreshExtensions?.().then(() => this.renderExtensionSettings?.());
  },

  searchSettings() {
    const query = document.getElementById('settings-find').value.trim().toLowerCase();
    const buttons = [...document.querySelectorAll('[data-settings-section]')];
    let firstMatch = null;
    buttons.forEach(button => {
      const page = document.querySelector(`[data-settings-page="${button.dataset.settingsSection}"]`);
      const matches = !query || `${button.textContent} ${page?.textContent || ''}`.toLowerCase().includes(query);
      button.classList.toggle('hidden', !matches);
      if (matches && !firstMatch) firstMatch = button.dataset.settingsSection;
    });
    const empty = !firstMatch;
    document.getElementById('settings-search-empty').classList.toggle('hidden', !empty);
    if (empty) {
      document.querySelectorAll('[data-settings-page]').forEach(page => page.classList.add('hidden'));
    } else if (query) {
      this.selectSettingsSection(firstMatch);
    }
  },

  saveHomepageSetting() {
    const input = document.getElementById('settings-homepage');
    if (!input.value.trim()) {
      localStorage.removeItem('shiira-homepage-url');
      input.value = '';
      setStatus('settings-homepage-status', 'Home and new tabs now open Shiira’s home page.');
      return;
    }
    const url = normalizeHomepage(input.value);
    if (!url) {
      setStatus('settings-homepage-status', 'Enter a valid http or https address.');
      return;
    }
    localStorage.setItem('shiira-homepage-url', url);
    input.value = url;
    setStatus('settings-homepage-status', 'Saved. Home and new tabs now open this page. Restored tabs keep their saved pages.');
  },

  async loadBrowserSettings() {
    try {
      const settings = await window.shiiraAPI.browserSettings.get();
      document.getElementById('settings-ask-download').checked = settings.askWhereToSave;
      document.getElementById('settings-auto-updates').checked = settings.autoCheckUpdates;
      setStatus('settings-download-directory', settings.downloadDirectory || `${settings.defaultDownloadDirectory} (system default)`);
      document.getElementById('settings-reset-download-folder').disabled = !settings.downloadDirectory;
    } catch (error) {
      setStatus('settings-download-status', error?.message || 'Could not load download settings.');
    }
  },

  async loadPrivacySettings() {
    try {
      const settings = await window.shiiraAPI.privacy.getSettings();
      document.getElementById('settings-url-suggestions').checked = settings.enableUrlSuggestions !== false;
    } catch (error) {
      console.warn('[Settings] Could not load privacy settings:', error);
    }
  },

  async clearDataFromSettings() {
    const kind = document.getElementById('settings-clear-kind').value;
    const labels = { cache: 'cached files', cookies: 'cookies', 'cookies-and-cache': 'cookies and cached files', storage: 'site storage' };
    const confirmed = await this.showConfirmation('Clear browsing data', `Clear ${labels[kind]}?`, { danger: true, confirmText: 'Clear' });
    if (!confirmed) return;
    const result = await window.shiiraAPI.privacy.clearBrowsingData(kind);
    setStatus('settings-privacy-status', result?.success ? `Cleared ${labels[kind]}.` : result?.error || 'Could not clear browsing data.');
  },

  async clearHistoryFromSettings() {
    const confirmed = await this.showConfirmation('Clear browsing history', 'Remove all saved browsing history?', { danger: true, confirmText: 'Clear history' });
    if (!confirmed) return;
    this.browsingHistory = [];
    this.saveBrowsingHistory();
    this.renderHistoryList();
    setStatus('settings-privacy-status', 'Browsing history cleared.');
  },

  async renderSitePermissions() {
    const list = document.getElementById('settings-permission-list');
    try {
      const { sitePermissions = {} } = await window.shiiraAPI.privacy.getSettings();
      list.replaceChildren();
      const sites = Object.entries(sitePermissions).sort(([a], [b]) => a.localeCompare(b));
      document.getElementById('settings-clear-permissions').disabled = sites.length === 0;
      if (sites.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No site permissions remembered yet.';
        list.appendChild(empty);
        return;
      }
      for (const [hostname, rules] of sites) {
        const row = document.createElement('div');
        row.className = 'settings-permission-row';
        const details = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = hostname;
        const summary = document.createElement('small');
        summary.textContent = Object.entries(rules).map(([permission, granted]) => `${permission}: ${granted ? 'allowed' : 'blocked'}`).join(' · ');
        details.append(name, summary);
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'settings-action';
        forget.textContent = 'Forget';
        forget.addEventListener('click', async () => {
          const result = await window.shiiraAPI.privacy.clearSitePermissions(hostname);
          setStatus('settings-permission-status', result?.success ? `Forgot ${hostname}.` : 'Could not forget this site.');
          await this.renderSitePermissions();
        });
        row.append(details, forget);
        list.appendChild(row);
      }
    } catch (error) {
      setStatus('settings-permission-status', error?.message || 'Could not load site permissions.');
    }
  },

  async clearAllPermissionsFromSettings() {
    const confirmed = await this.showConfirmation('Forget all site permissions', 'Every site will ask again when it needs access.', { danger: true, confirmText: 'Forget all' });
    if (!confirmed) return;
    const result = await window.shiiraAPI.privacy.clearSitePermissions();
    setStatus('settings-permission-status', result?.success ? 'All remembered site permissions removed.' : 'Could not clear permissions.');
    await this.renderSitePermissions();
  },

  renderSettingsUpdateStatus(data) {
    const download = document.getElementById('settings-download-update');
    const install = document.getElementById('settings-install-update');
    if (!download || !install) return;
    download.classList.add('hidden');
    install.classList.add('hidden');
    switch (data.status) {
      case 'checking-for-update': setStatus('settings-update-status', 'Checking for updates…'); break;
      case 'update-available':
        setStatus('settings-update-status', `Version ${data.version || 'new'} is available.`);
        download.classList.remove('hidden');
        break;
      case 'update-not-available': setStatus('settings-update-status', 'Shiira is up to date.'); break;
      case 'download-progress': setStatus('settings-update-status', `Downloading update: ${Math.round(data.percent || 0)}%`); break;
      case 'update-downloaded':
        setStatus('settings-update-status', `Version ${data.version || 'new'} is ready to install.`);
        install.classList.remove('hidden');
        break;
      case 'update-error': setStatus('settings-update-status', data.error || 'Update check failed.'); break;
    }
  },

  buildWelcomeChoices() {
    const themes = document.getElementById('setup-themes');
    for (const [id, label] of SETUP_THEMES) {
      const option = document.createElement('button');
      option.type = 'button';
      option.dataset.theme = id;
      option.className = 'setup-choice';
      const swatch = document.createElement('span');
      swatch.className = `setup-theme-swatch ${id}-gradient`;
      const title = document.createElement('span');
      title.textContent = label;
      option.append(swatch, title);
      option.addEventListener('click', () => {
        this.selectTheme(id);
        this.updateWelcomeChoices();
      });
      themes.appendChild(option);
    }
    const engines = document.getElementById('setup-search-engines');
    for (const [id, label] of SETUP_SEARCH) {
      const option = document.createElement('button');
      option.type = 'button';
      option.dataset.engine = id;
      option.className = 'setup-choice';
      option.textContent = label;
      option.addEventListener('click', () => {
        this.selectSearchEngine(id);
        this.updateWelcomeChoices();
      });
      engines.appendChild(option);
    }
  },

  updateWelcomeChoices() {
    document.querySelectorAll('#setup-themes [data-theme]').forEach(option => {
      const selected = option.dataset.theme === this.currentTheme;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('#setup-search-engines [data-engine]').forEach(option => {
      const selected = option.dataset.engine === this.currentSearchEngine;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
  },

  showWelcomeSetup() {
    this.hideSettings();
    this.setWelcomeStep(0);
    this.updateWelcomeChoices();
    this.setupOverlay?.classList.remove('hidden');
    document.getElementById('setup-next')?.focus();
  },

  setWelcomeStep(step) {
    this.setupStep = Math.max(0, Math.min(3, step));
    document.querySelectorAll('[data-setup-step]').forEach(panel => {
      panel.classList.toggle('hidden', Number(panel.dataset.setupStep) !== this.setupStep);
    });
    document.querySelectorAll('.setup-progress span').forEach((bar, index) => {
      bar.classList.toggle('active', index <= this.setupStep);
    });
    document.getElementById('setup-back').disabled = this.setupStep === 0;
    document.getElementById('setup-next').textContent = this.setupStep === 3 ? 'Start browsing' : 'Continue';
    document.getElementById('setup-skip').classList.toggle('hidden', this.setupStep === 3);
  },

  finishWelcomeSetup() {
    localStorage.setItem('shiira-welcome-complete', 'true');
    this.setupOverlay?.classList.add('hidden');
  }
};
