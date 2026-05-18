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
        self.injectForcedDarkMode?.(webview, e.url);
      }
    });
    
    webview.addEventListener('new-window', (e) => {
      console.log('[Webview] New window event:', e.url, e.disposition);
      
      // Check if this is likely an OAuth popup based on URL patterns
      const isOAuthPopup = 
        e.url.includes('oauth') ||
        e.url.includes('accounts.google.com') ||
        e.url.includes('login.microsoftonline.com') ||
        e.url.includes('facebook.com/login') ||
        e.url.includes('github.com/login') ||
        e.url.includes('/auth');
      
      if (isOAuthPopup) {
        console.log('[Webview] OAuth popup detected - window handled by main process');
        // OAuth popups will be handled by setWindowOpenHandler in main.js
      } else {
        console.log('[Webview] Regular link - opening in new tab');
        self.createTab(e.url);
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
  }
};
