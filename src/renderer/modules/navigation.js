// Navigation Module
// Handles URL processing, back/forward, reload, and security indicators

import { isInternalUrl, getDomain } from './utils.js';

export const NavigationMixin = {
  navigate(input) {
    const url = this.processUrl(input);
    
    if (this.activeTabId) {
      const tab = this.tabs.find(t => t.id === this.activeTabId);
      if (tab) {
        if (tab.isHome) {
          this.createWebviewForHomeTab(tab, url);
        } else if (tab.webview) {
          tab.webview.src = url;
        }
        this.runPageTurn?.();
      }
    } else {
      this.createTab(url);
    }
  },

  createWebviewForHomeTab(tab, url) {
    const webview = document.createElement('webview');
    webview.id = tab.id;
    webview.setAttribute('partition', 'persist:main');
    webview.setAttribute('webpreferences', 'contextIsolation=yes,devTools=no,backgroundThrottling=no,v8CacheOptions=bypassHeatCheckAndEagerCompile');
    
    this.setupWebviewEvents(webview, tab.id);
    
    this.browserContent.appendChild(webview);
    
    // Apply current brightness setting to new webview
    webview.style.filter = `brightness(${this.currentBrightness / 100})`;
    
    tab.webview = webview;
    tab.isHome = false;
    tab.element.dataset.isHome = 'false';
    tab.navigationHistory = [];
    tab.navigationIndex = -1;
    
    const iconElement = tab.element.querySelector('.tab-home-icon, .tab-favicon');
    if (iconElement) {
      iconElement.classList.remove('tab-home-icon');
      iconElement.classList.add('tab-favicon');
      iconElement.src = '';
    }
    
    this.welcomePage.classList.add('hidden');
    webview.classList.add('active');
    
    webview.src = url;
    tab.url = url;
    this.recordTabNavigation(tab, url);
    this.urlInput.value = url;
    this.updateSecurityIndicator(url);
  },

  processUrl(input) {
    input = input.trim();
    
    if (input.match(/^(https?|shiira):\/\//i)) {
      return input;
    }
    
    if (input.match(/^[\w-]+\.[\w-]+/)) {
      return 'https://' + input;
    }
    
    return this.buildSearchUrl ? this.buildSearchUrl(input) : `https://search.brave.com/search?q=${encodeURIComponent(input)}&source=web`;
  },

  goBack() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (tab && tab.webview) {
      try {
        if (tab.webview.canGoBack()) {
          tab.webview.goBack();
          return;
        }
      } catch (e) {}

      if (this.canUseLocalBackHistory(tab)) {
        tab.navigationIndex -= 1;
        tab.webview.src = tab.navigationHistory[tab.navigationIndex];
      }
    }
  },

  goForward() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (tab && tab.webview) {
      try {
        if (tab.webview.canGoForward()) {
          tab.webview.goForward();
          return;
        }
      } catch (e) {}

      if (this.canUseLocalForwardHistory(tab)) {
        tab.navigationIndex += 1;
        tab.webview.src = tab.navigationHistory[tab.navigationIndex];
      }
    }
  },

  reload() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (tab && tab.webview) {
      tab.webview.reload();
    }
  },

  hardReload() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (tab && tab.webview) {
      // reloadIgnoringCache() bypasses the cache for a fresh reload
      tab.webview.reloadIgnoringCache();
    }
  },

  goHome() {
    if (!this.activeTabId) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (tab) {
      if (tab.webview) {
        tab.webview.classList.remove('active');
      }
      tab.isHome = true;
      tab.element.dataset.isHome = 'true';
      
      const iconElement = tab.element.querySelector('.tab-favicon, .tab-home-icon');
      if (iconElement) {
        iconElement.classList.remove('tab-favicon');
        iconElement.classList.add('tab-home-icon');
        iconElement.src = 'shiira-asset://ui-icons/home.svg';
      }
      
      tab.element.querySelector('.tab-title').textContent = 'Home';
      this.showWelcomePage();
    }
  },

  updateNavigationButtons() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (tab && tab.webview) {
      let canGoBack = this.canUseLocalBackHistory(tab);
      let canGoForward = this.canUseLocalForwardHistory(tab);

      try {
        // These methods require dom-ready to have fired.
        canGoBack = canGoBack || tab.webview.canGoBack();
        canGoForward = canGoForward || tab.webview.canGoForward();
      } catch (e) {
        // Local history still lets restored or manually navigated tabs move.
      }

      this.btnBack.disabled = !canGoBack;
      this.btnForward.disabled = !canGoForward;
    } else {
      this.btnBack.disabled = true;
      this.btnForward.disabled = true;
    }
  },

  recordTabNavigation(tab, url) {
    if (!tab || !url || url === 'about:blank') return;

    if (!Array.isArray(tab.navigationHistory)) {
      tab.navigationHistory = [];
      tab.navigationIndex = -1;
    }

    const currentIndex = Number.isInteger(tab.navigationIndex) ? tab.navigationIndex : -1;
    const currentUrl = tab.navigationHistory[currentIndex];
    const previousUrl = tab.navigationHistory[currentIndex - 1];
    const nextUrl = tab.navigationHistory[currentIndex + 1];

    if (url === currentUrl) {
      return;
    }

    if (url === previousUrl) {
      tab.navigationIndex = currentIndex - 1;
      return;
    }

    if (url === nextUrl) {
      tab.navigationIndex = currentIndex + 1;
      return;
    }

    tab.navigationHistory = tab.navigationHistory.slice(0, currentIndex + 1);
    tab.navigationHistory.push(url);
    tab.navigationIndex = tab.navigationHistory.length - 1;
  },

  canUseLocalBackHistory(tab) {
    return Array.isArray(tab?.navigationHistory) && tab.navigationIndex > 0;
  },

  canUseLocalForwardHistory(tab) {
    return Array.isArray(tab?.navigationHistory) &&
      tab.navigationIndex >= 0 &&
      tab.navigationIndex < tab.navigationHistory.length - 1;
  },

  updateSecurityIndicator(url) {
    if (!this.securityIndicator) return;
    
    if (!url || url.startsWith('shiira://')) {
      this.securityIndicator.className = 'security-indicator';
      this.securityIndicator.innerHTML = '';
    } else if (url.startsWith('https://')) {
      this.securityIndicator.className = 'security-indicator secure';
      this.securityIndicator.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="currentColor"/></svg>';
    } else {
      this.securityIndicator.className = 'security-indicator insecure';
      this.securityIndicator.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z" fill="currentColor"/></svg>';
    }
  },

  updateStatus(text) {
    if (this.statusText) {
      this.statusText.textContent = text;
    }
  },

  // Webview context menu
  showWebviewContextMenu(e, webview) {
    this.contextMenuWebview = webview;
    this.contextMenuParams = e.params;

    const hasSelection = Boolean(e.params.selectionText && e.params.selectionText.length > 0);
    const hasLink = Boolean(e.params.linkURL && e.params.linkURL.length > 0);
    const hasImage = Boolean((e.params.hasImageContents || e.params.mediaType === 'image') && e.params.srcURL);
    const isEditable = Boolean(e.params.isEditable);

    this.webviewContextMenu.style.left = e.params.x + 'px';
    this.webviewContextMenu.style.top = e.params.y + 'px';
    this.webviewContextMenu.classList.remove('hidden');
    this.contextMenuOverlay.classList.remove('hidden');

    this.webviewContextMenu.querySelectorAll('.context-menu-item').forEach(item => {
      const action = item.dataset.action;
      if (action === 'copy' || action === 'search') {
        item.style.display = hasSelection ? 'flex' : 'none';
      } else if (action === 'cut' || action === 'paste' || action === 'undo' || action === 'redo') {
        item.style.display = isEditable ? 'flex' : 'none';
      } else if (action === 'open-link' || action === 'open-link-new-tab' || action === 'copy-link' || action === 'save-link') {
        item.style.display = hasLink ? 'flex' : 'none';
      } else if (action === 'save-image' || action === 'copy-image' || action === 'copy-image-address' || action === 'open-image-new-tab') {
        item.style.display = hasImage ? 'flex' : 'none';
      }

      item.onclick = async () => {
        await this.handleWebviewContextMenuAction(action);
        this.hideWebviewContextMenu();
      };
    });

    this.webviewContextMenu.querySelectorAll('.context-menu-separator').forEach(separator => {
      separator.style.display = 'block';
    });

    const linkSeparator = this.webviewContextMenu.querySelector('#ctx-link-separator');
    if (linkSeparator) linkSeparator.style.display = hasLink ? 'block' : 'none';

    const imageSeparator = this.webviewContextMenu.querySelector('#ctx-image-separator');
    if (imageSeparator) imageSeparator.style.display = hasImage ? 'block' : 'none';
  },

  hideWebviewContextMenu() {
    this.webviewContextMenu.classList.add('hidden');
    this.contextMenuOverlay.classList.add('hidden');
    this.contextMenuWebview = null;
    this.contextMenuParams = null;
  },

  async getContextImageSource(webview, srcURL) {
    if (!srcURL || !srcURL.startsWith('blob:')) {
      return srcURL;
    }

    try {
      return await webview.executeJavaScript(`
        (async () => {
          const response = await fetch(${JSON.stringify(srcURL)});
          const blob = await response.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Unable to read image blob'));
            reader.readAsDataURL(blob);
          });
        })();
      `, true);
    } catch (error) {
      console.error('[ContextMenu] Failed to resolve blob image:', error);
      return srcURL;
    }
  },

  async handleWebviewContextMenuAction(action) {
    const webview = this.contextMenuWebview;
    const params = this.contextMenuParams;
    if (!webview || !params) return;
    
    switch (action) {
      case 'back':
        webview.goBack();
        break;
      case 'forward':
        webview.goForward();
        break;
      case 'reload':
        webview.reload();
        break;
      case 'undo':
        webview.undo?.();
        break;
      case 'redo':
        webview.redo?.();
        break;
      case 'cut':
        webview.cut?.();
        break;
      case 'copy':
        webview.copy();
        break;
      case 'paste':
        webview.paste?.();
        break;
      case 'select-all':
        webview.selectAll?.();
        break;
      case 'search':
        if (params.selectionText) {
          this.createTab(this.buildSearchUrl ? this.buildSearchUrl(params.selectionText) : `https://search.brave.com/search?q=${encodeURIComponent(params.selectionText)}&source=web`);
        }
        break;
      case 'open-link':
        if (params.linkURL) {
          webview.src = params.linkURL;
        }
        break;
      case 'open-link-new-tab':
        if (params.linkURL) {
          this.createTab(params.linkURL);
        }
        break;
      case 'copy-link':
        if (params.linkURL) {
          navigator.clipboard.writeText(params.linkURL);
        }
        break;
      case 'save-link':
        if (params.linkURL) {
          await window.shiiraAPI.downloadFile(params.linkURL, { title: 'Save Link As' });
        }
        break;
      case 'open-image-new-tab':
        if (params.srcURL) {
          this.createTab(params.srcURL);
        }
        break;
      case 'save-image':
        if (params.srcURL) {
          const imageSource = await this.getContextImageSource(webview, params.srcURL);
          await window.shiiraAPI.downloadFile(imageSource, { title: 'Save Image As' });
        }
        break;
      case 'copy-image':
        if (params.srcURL) {
          const imageSource = await this.getContextImageSource(webview, params.srcURL);
          await window.shiiraAPI.copyImage(imageSource);
        }
        break;
      case 'copy-image-address':
        if (params.srcURL) {
          navigator.clipboard.writeText(params.srcURL);
        }
        break;
      case 'save-page':
        try {
          const url = webview.getURL?.();
          if (url) await window.shiiraAPI.downloadFile(url, { title: 'Save Page As' });
        } catch (e) {}
        break;
      case 'view-source':
        try {
          const url = webview.getURL?.();
          if (url && !url.startsWith('view-source:')) this.createTab(`view-source:${url}`);
        } catch (e) {}
        break;
    }
  }
};
