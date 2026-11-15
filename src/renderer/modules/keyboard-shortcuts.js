// Keyboard Shortcuts Module
// Handles all keyboard shortcuts both from document and IPC

export const KeyboardShortcutsMixin = {
  initKeyboardShortcuts() {
    // Listen for keyboard shortcuts from main process
    // These are intercepted at the Electron level and work even when webview has focus
    window.shiiraAPI.onKeyboardShortcut((shortcut) => {
      console.log('[Keyboard] Shortcut received:', shortcut);
      this.handleKeyboardShortcut(shortcut);
    });
    
    // Also handle document-level shortcuts for when webview doesn't have focus
    this.setupDocumentKeyboardShortcuts();
  },

  handleKeyboardShortcut(shortcut) {
    switch (shortcut) {
      case 'new-tab':
        this.handleNewTabShortcut ? this.handleNewTabShortcut() : this.createTab();
        break;
      case 'close-tab':
        if (this.activeTabId) this.closeOrUnloadTab(this.activeTabId);
        break;
      case 'toggle-sidebar':
        this.toggleSidebar?.();
        break;
      case 'pin-tab':
        this.togglePin?.();
        break;
      case 'split-view':
        this.toggleSplitView?.();
        break;
      case 'archive':
        this.showArchivePanel?.();
        break;
      case 'copy-url':
        this.copyTabUrl?.();
        break;
      case 'copy-markdown':
        this.copyTabUrl?.(this.activeTabId, { markdown: true });
        break;
      case 'capture-area':
        this.startAreaCapture?.();
        break;
      case 'page-devtools':
        this.togglePageDevTools?.();
        break;
      case 'next-recent-tab':
        this.stepTabSwitcher?.(1);
        break;
      case 'previous-recent-tab':
        this.stepTabSwitcher?.(-1);
        break;
      case 'commit-tab-switcher':
        this.commitTabSwitcher?.();
        break;
      case 'private-tab':
        this.createTab(null, { privateMode: true, title: 'Private Tab' });
        break;
      case 'next-space':
        this.focusAdjacentSpace?.(1);
        break;
      case 'prev-space':
        this.focusAdjacentSpace?.(-1);
        break;
      case 'reopen-tab':
        this.reopenClosedTab();
        break;
      case 'next-tab':
        this.switchToNextTab();
        break;
      case 'prev-tab':
        this.switchToPreviousTab();
        break;
      case 'focus-url':
        this.urlInput.focus();
        this.urlInput.select();
        break;
      case 'hard-reload':
        this.hardReload();
        break;
      case 'reload':
        this.reload();
        break;
      case 'go-back':
        this.goBack();
        break;
      case 'go-forward':
        this.goForward();
        break;
      case 'show-history':
        this.showHistoryPanel();
        break;
      case 'show-settings':
        this.showSettings();
        break;
      case 'toggle-bookmarks-bar':
        this.toggleBookmarksBar();
        break;
      case 'tab-expose':
        this.showTabExpose();
        break;
      case 'zoom-in': this.zoomIn(); break;
      case 'zoom-out': this.zoomOut(); break;
      case 'zoom-reset': this.zoomReset(); break;
      case 'show-boosts': this.showBoosts?.(); break;
      case 'import-bookmarks': this.showBrowserImport?.(); break;
      case 'little-window': void this.openLittleWindow?.(); break;
      case 'promote-little':
        if (this.isLittle) void this.promoteLittleWindow?.();
        else this.peekToTab?.();
        break;
      case 'close-popups':
        if (this.tabSwitcher) this.cancelTabSwitcher();
        else if (this.isCommandBarOpen?.() && this.commandSiteSearch) this.setCommandSiteSearch(null);
        else this.closeAllPopups();
        break;
      default:
        if (/^space-[1-9]$/.test(shortcut)) this.focusSpaceByIndex?.(Number(shortcut.slice(6)) - 1);
        break;
    }
  },

  setupDocumentKeyboardShortcuts() {
    // Physical browser shortcuts are handled once in Electron, using the saved map.
    // Keep local Settings search and synthetic Escape available to the DOM.
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f' &&
          this.settingsModal && !this.settingsModal.classList.contains('hidden')) {
        event.preventDefault();
        document.getElementById('settings-find')?.focus();
      }
      if (event.key === 'Escape') this.handleKeyboardShortcut('close-popups');
    });
  },

  zoomIn() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab || !tab.webview) return;
    
    let currentFactor = tab.zoomFactor || 1.0;
    let newFactor = Math.min(3.0, currentFactor + 0.1); // Max 300%
    tab.zoomFactor = newFactor;
    
    try {
      tab.webview.setZoomFactor(newFactor);
      this.updateStatus(`Zoom: ${Math.round(newFactor * 100)}%`);
      setTimeout(() => {
        if (this.statusText && this.statusText.textContent.startsWith('Zoom:')) {
          this.updateStatus('Ready');
        }
      }, 1500);
    } catch (e) {
      console.error('Failed to set zoom factor:', e);
    }
  },

  zoomOut() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab || !tab.webview) return;
    
    let currentFactor = tab.zoomFactor || 1.0;
    let newFactor = Math.max(0.5, currentFactor - 0.1); // Min 50%
    tab.zoomFactor = newFactor;
    
    try {
      tab.webview.setZoomFactor(newFactor);
      this.updateStatus(`Zoom: ${Math.round(newFactor * 100)}%`);
      setTimeout(() => {
        if (this.statusText && this.statusText.textContent.startsWith('Zoom:')) {
          this.updateStatus('Ready');
        }
      }, 1500);
    } catch (e) {
      console.error('Failed to set zoom factor:', e);
    }
  },

  zoomReset() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab || !tab.webview) return;
    
    tab.zoomFactor = 1.0;
    try {
      tab.webview.setZoomFactor(1.0);
      this.updateStatus('Zoom: 100%');
      setTimeout(() => {
        if (this.statusText && this.statusText.textContent.startsWith('Zoom:')) {
          this.updateStatus('Ready');
        }
      }, 1500);
    } catch (e) {
      console.error('Failed to set zoom factor:', e);
    }
  }
};
