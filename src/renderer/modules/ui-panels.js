// UI Panels Module
// Handles About, Chrome Import panels and main menu

export const UIPanelsMixin = {
  // Main menu
  toggleMainMenu() {
    if (this.mainMenu.classList.contains('hidden')) {
      this.showMainMenu();
    } else {
      this.hideMainMenu();
    }
  },

  showMainMenu() {
    this.mainMenu.classList.remove('hidden');
    this.updateAdBlockerStats();
  },

  hideMainMenu(instant = false) {
    if (instant || !this.mainMenu) {
      this.mainMenu?.classList.add('hidden');
      this.mainMenu?.classList.remove('closing');
      return;
    }
    
    // Add closing class for reverse animation
    this.mainMenu.classList.add('closing');
    
    // Wait for animation to complete before hiding
    setTimeout(() => {
      this.mainMenu?.classList.add('hidden');
      this.mainMenu?.classList.remove('closing');
    }, 280); // Total animation time including delays
  },

  handleMainMenuAction(action) {
    const panelActions = ['history', 'password-anvil', 'ai-assistant', 'themes', 'import-chrome', 'about', 'shiira-palettes', 'tab-expose', 'private-tab'];
    const toggleActions = ['favorites', 'adblock', 'bookmarks-bar']; // Actions that don't close the menu
    const isOpeningPanel = panelActions.includes(action);
    const isToggleAction = toggleActions.includes(action);
    
    switch (action) {
      case 'new-tab':
        this.createTab();
        break;
      case 'bookmarks-bar':
        this.toggleBookmarksBar();
        break;
      case 'history':
        this.hideMainMenu(true); // Instant hide
        this.showHistoryPanel();
        break;
      case 'private-tab':
        this.hideMainMenu(true); // Instant hide
        this.createTab(null, { privateMode: true, title: 'Private Tab' });
        break;
      case 'password-anvil':
        this.hideMainMenu(true); // Instant hide
        this.showPasswordAnvil();
        break;
      case 'themes':
        this.hideMainMenu(true); // Instant hide
        this.showThemesModal();
        break;
      case 'shiira-palettes':
        this.hideMainMenu(true); // Instant hide
        this.showShiiraDrawer();
        break;
      case 'tab-expose':
        this.hideMainMenu(true); // Instant hide
        this.showTabExpose();
        break;
      case 'ai-assistant':
        this.hideMainMenu(true); // Instant hide
        this.showAISettingsPanel();
        break;
      case 'import-chrome':
        this.hideMainMenu(true); // Instant hide
        this.showChromeImportPanel();
        this.renderChromeImportPanel();
        break;
      case 'devtools':
        this.hideMainMenu(true); // Instant hide
        this.openDevTools();
        break;
      case 'about':
        this.hideMainMenu(true); // Instant hide
        this.showAboutPanel();
        break;
      case 'favorites':
        this.toggleFavoritesEnabled();
        break;
      case 'adblock':
        this.toggleAdBlocker();
        break;
    }
  },

  openDevTools() {
    // Open DevTools for the main window (docked) via IPC to main process
    // This opens the same DevTools as Ctrl+Shift+I
    window.shiiraAPI.openDevTools();
  },

  // Chrome Import panel
  showChromeImportPanel() {
    this.chromeImportPanel?.classList.remove('hidden');
  },

  hideChromeImportPanel() {
    this.chromeImportPanel?.classList.add('hidden');
  },

  async renderChromeImportPanel() {
    if (!this.chromeImportContent) return;
    this.chromeImportContent.innerHTML = '<div class="loading">Loading...</div>';
    // TODO: Implement Chrome import
  },

  // About panel
  async showAboutPanel() {
    if (this.aboutPanel) {
      this.aboutPanel.classList.remove('hidden');
      const appInfo = await window.shiiraAPI.getAppInfo();
      if (this.aboutVersion) {
        this.aboutVersion.textContent = `v${appInfo.version}`;
      }
    }
  },

  hideAboutPanel() {
    this.aboutPanel?.classList.add('hidden');
  },

  // Updates
  initUpdateListener() {
    window.shiiraAPI.updates.onUpdateStatus((data) => {
      this.handleUpdateStatus(data);
    });
  },

  handleUpdateStatus(data) {
    if (!this.updateStatusElement) return;
    
    switch (data.status) {
      case 'checking-for-update':
        this.updateStatusElement.innerHTML = '<span class="update-checking">Checking for updates...</span>';
        this.updateStatusElement.className = 'about-update-status checking';
        break;
      case 'update-available':
        this.updateStatusElement.innerHTML = `
          <span>Version ${data.version} is available!</span>
          <button id="download-update-btn" class="about-update-download-btn">Download Update</button>
        `;
        this.updateStatusElement.className = 'about-update-status available';
        document.getElementById('download-update-btn')?.addEventListener('click', async () => {
          await window.shiiraAPI.updates.downloadUpdate();
        });
        break;
      case 'update-not-available':
        this.updateStatusElement.innerHTML = '<span class="update-current">You are running the latest version.</span>';
        this.updateStatusElement.className = 'about-update-status success';
        break;
      case 'download-progress':
        this.updateStatusElement.innerHTML = `<span class="update-downloading">Downloading update: ${(data.percent || 0).toFixed(1)}%</span>`;
        this.updateStatusElement.className = 'about-update-status downloading';
        break;
      case 'update-downloaded':
        this.updateStatusElement.innerHTML = `
          <span>Update ${data.version} ready to install!</span>
          <button id="install-update-btn" class="about-update-install-btn">Restart & Install</button>
        `;
        this.updateStatusElement.className = 'about-update-status ready';
        document.getElementById('install-update-btn')?.addEventListener('click', () => {
          window.shiiraAPI.updates.installUpdate();
        });
        break;
      case 'update-error':
        this.updateStatusElement.innerHTML = `
          <span>Update check failed</span>
          <button id="copy-error-btn" class="about-update-copy-btn">Copy Error</button>
        `;
        this.updateStatusElement.className = 'about-update-status error';
        this.lastUpdateError = data.error || 'Unknown error';
        document.getElementById('copy-error-btn')?.addEventListener('click', async () => {
          await navigator.clipboard.writeText(this.lastUpdateError);
          const btn = document.getElementById('copy-error-btn');
          if (btn) {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy Error'; }, 2000);
          }
        });
        break;
    }
  },

  async checkForUpdates() {
    await window.shiiraAPI.updates.checkForUpdates();
  },

  // Close all popups
  closeAllPopups() {
    this.hideMainMenu();
    this.hideTabContextMenu();
    this.hideWebviewContextMenu();
    this.hideHistoryPanel();
    this.hideAboutPanel();
    this.hideFavoritesPanel();
    this.hideFavoritesDialog();
    this.hidePasswordAnvilPanel();
    this.hidePasswordModal();
    this.hideChromeImportPanel();
    this.hideAISettingsPanel();
    this.hideSuggestions();
    this.hideShiiraDrawer?.();
    this.hideTabExpose?.();
  }
};
