// Webview Events Module
// Handles webview event setup and content script injection coordination

import { isInternalUrl, getDomain } from './utils.js';

export const WebviewEventsMixin = {
  setupWebviewEvents(webview, tabId) {
    const self = this;
    
    // Close bookmark context menus when webview receives focus (user clicked inside)
    webview.addEventListener('focus', () => {
      if (self.hideAllContextMenus) {
        self.hideAllContextMenus();
      }
    });
    
    webview.addEventListener('did-start-loading', () => {
      self.updateStatus('Loading...');
      self.updateTabLoading(tabId, true);
    });
    
    webview.addEventListener('did-stop-loading', () => {
      self.updateStatus('Ready');
      self.updateTabLoading(tabId, false);
      if (tabId === self.activeTabId) {
        self.updateNavigationButtons();
      }
    });
    
    webview.addEventListener('page-title-updated', (e) => {
      self.updateTabTitle(tabId, e.title);
    });
    
    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        self.updateTabFavicon(tabId, e.favicons[0]);
      }
    });
    
    webview.addEventListener('did-navigate', (e) => {
      const tab = self.tabs.find(t => t.id === tabId);
      
      // Close any open context menus when navigating
      if (self.hideAllContextMenus) {
        self.hideAllContextMenus();
      }
      
      // Store URL on the tab object for other methods to use
      if (tab) {
        tab.url = e.url;
        self.recordTabNavigation?.(tab, e.url);
      }
      
      if (tabId === self.activeTabId) {
        self.urlInput.value = e.url;
        self.updateSecurityIndicator(e.url);
        self.updateNavigationButtons();
        
        // Update bookmark icon state
        if (self.updateBookmarkIconState) {
          self.updateBookmarkIconState(e.url);
        }
        
        // Hide welcome page when navigating
        if (e.url && e.url !== 'about:blank') {
          self.welcomePage.classList.add('hidden');
          self.welcomePage.classList.remove('blank-tab');
        }
      }
      
      if (tab && !tab.privateMode && !isInternalUrl(e.url)) {
        const title = tab ? tab.title : 'New Tab';
        const favicon = tab ? tab.favicon : null;
        self.addToHistory(e.url, title, favicon);
      }
      
      // Inject scripts
      console.log('[Webview] did-navigate event for:', e.url);
      self.injectCosmeticCSS(webview, e.url);
      self.injectAdBlockScript(webview, e.url);
      self.injectPasswordAutofill(webview, e.url);
      self.injectLinkRouting(webview, e.url);
      self.injectForcedDarkMode?.(webview, e.url);
    });
    
    webview.addEventListener('dom-ready', () => {
      try {
        const url = webview.getURL();
        if (url) {
          console.log('[Webview] dom-ready event for:', url);
          self.injectAdBlockScript(webview, url);
          self.injectCosmeticCSS(webview, url);
          self.injectPasswordAutofill(webview, url);
          self.injectLinkRouting(webview, url);
          self.injectForcedDarkMode?.(webview, url);
          if (tabId === self.activeTabId) {
            self.updateNavigationButtons();
          }
        }
      } catch (e) {
        console.error('[Webview] Error in dom-ready:', e);
      }
    });
    
    webview.addEventListener('did-navigate-in-page', (e) => {
      const tab = self.tabs.find(t => t.id === tabId);
      if (tabId === self.activeTabId && e.isMainFrame) {
        self.recordTabNavigation?.(tab, e.url);
        self.urlInput.value = e.url;
        self.updateSecurityIndicator(e.url);
        self.updateNavigationButtons();
        
        // Update bookmark icon state
        if (self.updateBookmarkIconState) {
          self.updateBookmarkIconState(e.url);
        }
      }
      
      if (e.isMainFrame && tab && !tab.privateMode && !isInternalUrl(e.url)) {
        const title = tab ? tab.title : 'New Tab';
        const favicon = tab ? tab.favicon : null;
        self.addToHistory(e.url, title, favicon);
        self.injectCosmeticCSS(webview, e.url);
        self.injectAdBlockScript(webview, e.url);
        self.injectLinkRouting(webview, e.url);
        self.injectForcedDarkMode?.(webview, e.url);
      }
    });
    
    webview.addEventListener('new-window', (e) => {
      console.log('[Webview] New window event:', e.url, e.disposition);
      e.preventDefault?.();
      
      if (e.url && e.url !== 'about:blank') {
        self.openLinkInTabOnce(e.url);
      }
    });
    
    webview.addEventListener('context-menu', (e) => {
      self.showWebviewContextMenu(e, webview);
    });
    
    webview.addEventListener('focus', () => {
      self.closeAllPopups();
    });
    
    // Crash and error handling
    webview.addEventListener('crashed', (e) => {
      console.error('[Webview] Page crashed:', { killed: e.killed, tabId });
      const tab = self.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.element.classList.add('tab-crashed');
        self.setStatus('Page crashed - please reload', 5000);
      }
    });
    
    webview.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) { // -3 is ERR_ABORTED (user navigation)
        console.error('[Webview] Failed to load:', { 
          url: e.validatedURL, 
          errorCode: e.errorCode, 
          errorDescription: e.errorDescription,
          tabId 
        });
      }
    });
    
    webview.addEventListener('plugin-crashed', (e) => {
      console.error('[Webview] Plugin crashed:', { name: e.name, version: e.version, tabId });
    });
    
    webview.addEventListener('unresponsive', () => {
      console.warn('[Webview] Page became unresponsive:', tabId);
    });
    
    webview.addEventListener('responsive', () => {
      console.log('[Webview] Page became responsive again:', tabId);
    });
    
    // Console message handling for ad blocking and passwords
    webview.addEventListener('console-message', (e) => {
      if (e.message && e.message.startsWith('[SHIIRA_OPEN_LINK] ')) {
        const url = e.message.slice('[SHIIRA_OPEN_LINK] '.length).trim();
        if (url && url !== 'about:blank') {
          self.openLinkInTabOnce(url);
        }
        return;
      }

      if (e.message && e.message.startsWith('[SHIIRA_AD_BLOCKED]')) {
        const count = parseInt(e.message.split(' ')[1], 10);
        const tab = self.tabs.find(t => t.id === tabId);
        if (tab && !isNaN(count)) {
          tab.adsBlocked = count;
          if (tabId === self.activeTabId) {
            self.updateAdCounter(count);
          }
        }
      }
    });
    
    // Audio state checking
    const checkAudioState = async () => {
      const tab = self.tabs.find(t => t.id === tabId);
      if (!tab || !tab.webview) return;
      
      try {
        const webContentsId = webview.getWebContentsId ? webview.getWebContentsId() : null;
        if (webContentsId) {
          const isAudible = await window.shiiraAPI.isWebContentsAudible(webContentsId);
          if (isAudible !== tab.isPlayingAudio) {
            tab.isPlayingAudio = isAudible;
            self.updateTabAudioIcon(tabId);
          }
        }
      } catch (e) {}
    };
    
    webview.addEventListener('dom-ready', () => {
      const interval = setInterval(checkAudioState, 500);
      const tab = self.tabs.find(t => t.id === tabId);
      if (tab) tab.audioCheckInterval = interval;
      checkAudioState();
    }, { once: true });
  },

  openLinkInTabOnce(url) {
    if (!url || url === 'about:blank') return;

    const now = Date.now();
    if (!this._recentlyOpenedLinks) {
      this._recentlyOpenedLinks = new Map();
    }

    for (const [key, time] of this._recentlyOpenedLinks) {
      if (now - time > 1500) {
        this._recentlyOpenedLinks.delete(key);
      }
    }

    const previous = this._recentlyOpenedLinks.get(url);
    if (previous && now - previous < 1000) {
      return;
    }

    this._recentlyOpenedLinks.set(url, now);
    this.createTab(url);
  },

  injectLinkRouting(webview, url) {
    if (!webview || !url || isInternalUrl(url) || url === 'about:blank') return;

    const script = `
      (() => {
        if (window.__shiiraLinkRoutingInstalled) return;
        window.__shiiraLinkRoutingInstalled = true;

        const shouldOpenInTab = (event, anchor) => {
          if (!anchor || !anchor.href) return false;
          const href = anchor.href;
          if (!/^https?:\\/\\//i.test(href)) return false;
          const target = (anchor.getAttribute('target') || '').toLowerCase();
          const rel = (anchor.getAttribute('rel') || '').toLowerCase();
          return event.type === 'auxclick' ||
            event.button === 1 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            target === '_blank' ||
            target === 'blank' ||
            rel.includes('external');
        };

        const route = event => {
          const anchor = event.target?.closest?.('a[href]');
          if (!shouldOpenInTab(event, anchor)) return;
          event.preventDefault();
          event.stopPropagation();
          console.log('[SHIIRA_OPEN_LINK] ' + anchor.href);
        };

        document.addEventListener('click', route, true);
        document.addEventListener('auxclick', route, true);
      })();
    `;

    webview.executeJavaScript(script, true).catch(error => {
      console.warn('[Webview] Failed to inject link routing:', error);
    });
  }
};
