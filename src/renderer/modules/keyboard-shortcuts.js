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
        this.createTab();
        break;
      case 'close-tab':
        if (this.activeTabId) this.closeTab(this.activeTabId);
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
      case 'toggle-bookmarks-bar':
        this.toggleBookmarksBar();
        break;
      case 'tab-expose':
        this.showTabExpose();
        break;
      case 'close-popups':
        this.closeAllPopups();
        break;
    }
  },

  setupDocumentKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Skip shortcuts when typing in input fields (except for specific combos)
      const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                             document.activeElement?.tagName === 'TEXTAREA';
      
      // Ctrl+T: New tab
      if (e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault();
        this.createTab();
        return;
      }
      
      // Ctrl+W: Close tab
      if (e.ctrlKey && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        if (this.activeTabId) this.closeTab(this.activeTabId);
        return;
      }
      
      // Ctrl+Shift+T: Reopen closed tab
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        this.reopenClosedTab();
        return;
      }
      // Ctrl+Tab: Next tab
      if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToNextTab();
        return;
      }
      
      // Ctrl+Shift+Tab: Previous tab
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToPreviousTab();
        return;
      }
      
      // Ctrl+L: Focus URL bar (works even in input if it's not the URL bar)
      if (e.ctrlKey && !e.shiftKey && e.key === 'l') {
        e.preventDefault();
        this.urlInput.focus();
        this.urlInput.select();
        return;
      }
      
      // Ctrl+Shift+R: Hard reload (bypass cache)
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        this.hardReload();
        return;
      }
      
      // Ctrl+R or F5: Reload (only when not in input)
      if ((e.ctrlKey && !e.shiftKey && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        this.reload();
        return;
      }
      
      // Alt+Left: Go back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        this.goBack();
        return;
      }
      
      // Alt+Right: Go forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        this.goForward();
        return;
      }
      
      // Ctrl+H: History
      if (e.ctrlKey && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        this.showHistoryPanel();
        return;
      }
      
      // Escape: Close panels
      if (e.key === 'Escape') {
        this.closeAllPopups();
        return;
      }
      
      // Ctrl+Shift+B: Toggle bookmarks bar
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        this.toggleBookmarksBar();
        return;
      }

      // Ctrl+Shift+E: Tab Expose
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        this.showTabExpose();
        return;
      }

      // Ctrl + Plus / Ctrl + =: Zoom In
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.zoomIn();
        return;
      }

      // Ctrl + Minus: Zoom Out
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        this.zoomOut();
        return;
      }

      // Ctrl + 0: Zoom Reset
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        this.zoomReset();
        return;
      }
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
