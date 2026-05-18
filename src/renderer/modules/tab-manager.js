// Tab Manager Module
// Handles tab creation, switching, closing, context menus, and drag & drop

import { isInternalUrl, getDomain, escapeHtml } from './utils.js';

export const TabManagerMixin = {
  initTabManager() {
    this.tabs = [];
    this.activeTabId = null;
    this.tabCounter = 0;
    this.closedTabs = []; // Track closed tabs for Ctrl+Shift+T reopen
    this.maxClosedTabs = 10; // Maximum number of closed tabs to remember
    
    // Drag state
    this.draggedTab = null;
    this.isDragging = false;
    this.dragStartX = 0;
  },

  setupDragHandlers() {
    this.handleMouseMove = (e) => {
      if (!this.draggedTab) return;
      
      const deltaX = Math.abs(e.clientX - this.dragStartX);
      if (deltaX > 5) {
        this.isDragging = true;
        this.draggedTab.classList.add('dragging');
      }
      
      if (this.isDragging) {
        const afterElement = this.getDragAfterElement(this.tabsContainer, e.clientX);
        if (afterElement) {
          this.tabsContainer.insertBefore(this.draggedTab, afterElement);
        } else {
          const newTabBtn = this.tabsContainer.querySelector('#btn-new-tab');
          if (newTabBtn) {
            this.tabsContainer.insertBefore(this.draggedTab, newTabBtn);
          } else {
            this.tabsContainer.appendChild(this.draggedTab);
          }
        }
      }
    };
    
    this.handleMouseUp = () => {
      if (this.draggedTab) {
        this.draggedTab.classList.remove('dragging');
        if (this.isDragging) {
          this.reorderTabsArray();
        }
        this.draggedTab = null;
      }
      
      setTimeout(() => {
        this.isDragging = false;
      }, 10);
      
      document.removeEventListener('mousemove', this.handleMouseMove);
      document.removeEventListener('mouseup', this.handleMouseUp);
    };
  },

  getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.tab:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  },

  reorderTabsArray() {
    const tabElements = [...this.tabsContainer.querySelectorAll('.tab')];
    const newOrder = [];
    
    tabElements.forEach(tabEl => {
      const tabId = tabEl.dataset.tabId;
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) newOrder.push(tab);
    });
    
    this.tabs = newOrder;
  },

  createTab(url = null, options = {}) {
    const { deferLoad = false, title = null, favicon = null, privateMode = false } = options;
    const tabId = `tab-${++this.tabCounter}`;
    
    const tab = document.createElement('div');
    tab.className = privateMode ? 'tab private-tab' : 'tab';
    tab.dataset.tabId = tabId;
    
    // Use provided title/favicon for deferred tabs
    const displayTitle = title || (privateMode ? 'Private Tab' : 'New Tab');
    const displayFavicon = favicon || (url ? this.getCachedFavicon(url) : null);
    
    tab.innerHTML = `
      <img class="tab-favicon ${displayFavicon ? '' : 'tab-icon-plus'}" src="${displayFavicon || 'shiira-asset://ui-icons/plus.svg'}" alt="">
      <span class="tab-title">${escapeHtml(displayTitle)}</span>
      <button class="tab-close" title="Close tab">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `;
    
    // Drag handler
    tab.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.tab-close')) return;
      this.draggedTab = tab;
      this.isDragging = false;
      this.dragStartX = e.clientX;
      document.addEventListener('mousemove', this.handleMouseMove);
      document.addEventListener('mouseup', this.handleMouseUp);
    });
    
    // Click handler
    tab.addEventListener('click', (e) => {
      if (this.isDragging) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!e.target.closest('.tab-close')) {
        this.switchTab(tabId);
      }
    });
    
    // Context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showTabContextMenu(e.clientX, e.clientY, tabId);
    });
    
    // Close button
    tab.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });
    
    this.tabsContainer.appendChild(tab);
    
    // Create webview
    const webview = document.createElement('webview');
    webview.id = tabId;
    webview.setAttribute('partition', privateMode ? `private:${tabId}` : 'persist:main');
    webview.setAttribute('webpreferences', 'contextIsolation=yes,plugins=yes,backgroundThrottling=no,v8CacheOptions=bypassHeatCheckAndEagerCompile');
    
    this.setupWebviewEvents(webview, tabId);
    
    this.browserContent.appendChild(webview);
    
    // Apply current brightness setting to new webview
    webview.style.filter = `brightness(${this.currentBrightness / 100})`;
    
    // Store tab info
    this.tabs.push({
      id: tabId,
      element: tab,
      webview: webview,
      title: displayTitle,
      url: url || '',
      favicon: displayFavicon,
      pendingUrl: deferLoad ? url : null, // URL to load when tab becomes active
      navigationHistory: url ? [url] : [],
      navigationIndex: url ? 0 : -1,
      isPlayingAudio: false,
      isMuted: false,
      adsBlocked: 0,
      privateMode
    });
    
    // Only switch to tab and load URL if not deferred
    if (!deferLoad) {
      this.switchTab(tabId);
      
      if (url) {
        webview.src = url;
      }
    }
    
    return tabId;
  },

  createHomeTab() {
    const tabId = `tab-${++this.tabCounter}`;
    
    const tab = document.createElement('div');
    tab.className = 'tab active';
    tab.dataset.tabId = tabId;
    tab.dataset.isHome = 'true';
    tab.innerHTML = `
      <img class="tab-home-icon" src="shiira-asset://ui-icons/home.svg" alt="Home">
      <span class="tab-title">Home</span>
      <button class="tab-close" title="Close tab">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `;
    
    // Drag handler
    tab.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.tab-close')) return;
      this.draggedTab = tab;
      this.isDragging = false;
      this.dragStartX = e.clientX;
      document.addEventListener('mousemove', this.handleMouseMove);
      document.addEventListener('mouseup', this.handleMouseUp);
    });
    
    tab.addEventListener('click', (e) => {
      if (this.isDragging) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!e.target.closest('.tab-close')) {
        this.switchTab(tabId);
      }
    });
    
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showTabContextMenu(e.clientX, e.clientY, tabId);
    });
    
    tab.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });
    
    this.tabsContainer.appendChild(tab);
    
    this.tabs.push({
      id: tabId,
      element: tab,
      webview: null,
      title: 'Home',
      url: 'shiira://home',
      isHome: true,
      navigationHistory: ['shiira://home'],
      navigationIndex: 0
    });
    
    this.activeTabId = tabId;
    this.showWelcomePage();
  },

  closeTab(tabId, skipAnimation = false) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = this.tabs[tabIndex];
    
    // Save tab info for reopen (Ctrl+Shift+T) - only if it has a URL
    if (tab.webview && !tab.isHome) {
      try {
        const url = tab.webview.getURL();
        const title = tab.element.querySelector('.tab-title')?.textContent || 'Closed Tab';
        if (url && url !== 'about:blank') {
          this.closedTabs.unshift({ url, title, closedAt: Date.now() });
          // Keep only the most recent closed tabs
          if (this.closedTabs.length > this.maxClosedTabs) {
            this.closedTabs.pop();
          }
        }
      } catch (e) {
        // Ignore errors getting URL
      }
    }
    
    if (tab.audioCheckInterval) {
      clearInterval(tab.audioCheckInterval);
    }
    
    if (!skipAnimation) {
      tab.element.classList.add('closing');
    }
    
    const removeTab = () => {
      tab.element.remove();
      if (tab.webview) {
        tab.webview.remove();
      }
      
      this.tabs.splice(tabIndex, 1);
      
      if (tabId === this.activeTabId) {
        if (this.tabs.length > 0) {
          const newActiveIndex = Math.min(tabIndex, this.tabs.length - 1);
          this.switchTab(this.tabs[newActiveIndex].id);
        } else {
          this.activeTabId = null;
          this.createHomeTab();
        }
      }
    };
    
    if (skipAnimation) {
      removeTab();
    } else {
      setTimeout(removeTab, 300);
    }
  },

  switchTab(tabId) {
    this.tabs.forEach(tab => {
      tab.element.classList.remove('active');
      if (tab.webview) {
        tab.webview.classList.remove('active');
      }
    });
    
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.element.classList.add('active');
      this.activeTabId = tabId;
      this.runPageTurn?.();
      
      this.updateAdCounter(tab.adsBlocked || 0);
      
      // Check if this tab has a pending URL to load (deferred loading)
      if (tab.pendingUrl && tab.webview) {
        console.log('[Tab] Loading deferred tab:', tab.pendingUrl);
        tab.webview.src = tab.pendingUrl;
        tab.pendingUrl = null; // Clear pending URL after loading
      }
      
      if (tab.isHome) {
        this.showWelcomePage();
        // Disable bookmark button on home tab
        if (this.btnBookmark) {
          this.btnBookmark.classList.add('disabled');
          this.btnBookmark.classList.remove('bookmarked');
        }
      } else {
        // Enable bookmark button on regular tabs
        if (this.btnBookmark) {
          this.btnBookmark.classList.remove('disabled');
        }
        if (tab.webview) {
          tab.webview.classList.add('active');
          try {
            const url = tab.webview.getURL();
            // Check if tab is blank (no URL or about:blank)
            if (!url || url === 'about:blank') {
              // Show welcome page in blank mode (particles only)
              this.welcomePage.classList.remove('hidden');
              this.welcomePage.classList.add('blank-tab');
            } else {
              // Hide welcome page completely
              this.welcomePage.classList.add('hidden');
              this.welcomePage.classList.remove('blank-tab');
            }
            this.urlInput.value = url || '';
            this.updateSecurityIndicator(url);
            
            // Update bookmark icon state
            if (this.updateBookmarkIconState) {
              this.updateBookmarkIconState(url);
            }
          } catch (e) {
            // No URL yet, show blank background
            this.welcomePage.classList.remove('hidden');
            this.welcomePage.classList.add('blank-tab');
            this.urlInput.value = '';
            
            // Clear bookmark icon state
            if (this.btnBookmark) {
              this.btnBookmark.classList.remove('bookmarked');
            }
          }
          this.updateNavigationButtons();
        }
      }
    }
  },

  switchToNextTab() {
    if (this.tabs.length <= 1) return;
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    const nextIndex = (currentIndex + 1) % this.tabs.length;
    this.switchTab(this.tabs[nextIndex].id);
  },

  switchToPreviousTab() {
    if (this.tabs.length <= 1) return;
    const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
    const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    this.switchTab(this.tabs[prevIndex].id);
  },

  showWelcomePage() {
    this.welcomePage.classList.remove('hidden');
    this.welcomePage.classList.remove('blank-tab');
    this.urlInput.value = '';
    this.updateSecurityIndicator('');
    this.btnBack.disabled = true;
    this.btnForward.disabled = true;
  },

  // Tab context menu
  showTabContextMenu(x, y, tabId) {
    this.contextMenuTabId = tabId;
    this.tabContextMenu.style.left = x + 'px';
    this.tabContextMenu.style.top = y + 'px';
    this.tabContextMenu.classList.remove('hidden');
    
    this.tabContextMenu.querySelectorAll('.context-menu-item').forEach(item => {
      item.onclick = () => {
        const action = item.dataset.action;
        this.handleTabContextMenuAction(action);
        this.hideTabContextMenu();
      };
    });
  },

  hideTabContextMenu() {
    this.tabContextMenu.classList.add('hidden');
    this.contextMenuTabId = null;
  },

  handleTabContextMenuAction(action) {
    const tabId = this.contextMenuTabId;
    if (!tabId) return;
    
    switch (action) {
      case 'new-tab-right':
        this.createTab();
        break;
      case 'reload':
        this.reloadTab(tabId);
        break;
      case 'duplicate':
        this.duplicateTab(tabId);
        break;
      case 'mute':
        this.toggleTabMute(tabId);
        break;
      case 'close-other':
        this.closeOtherTabs(tabId);
        break;
      case 'close-right':
        this.closeTabsToRight(tabId);
        break;
      case 'close':
        this.closeTab(tabId);
        break;
    }
  },

  reloadTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.webview) {
      tab.webview.reload();
    }
  },

  reopenClosedTab() {
    if (this.closedTabs.length === 0) return false;
    
    const closedTab = this.closedTabs.shift(); // Get and remove the most recent
    this.createTab(closedTab.url);
    return true;
  },

  duplicateTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.webview) {
      const url = tab.webview.getURL();
      this.createTab(url);
    }
  },

  toggleTabMute(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.webview) {
      tab.isMuted = !tab.isMuted;
      tab.webview.setAudioMuted(tab.isMuted);
      this.updateTabAudioIcon(tabId);
    }
  },

  closeOtherTabs(tabId) {
    const tabsToClose = this.tabs.filter(t => t.id !== tabId).map(t => t.id);
    tabsToClose.forEach(id => this.closeTab(id, true));
  },

  closeTabsToRight(tabId) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex !== -1) {
      const tabsToClose = this.tabs.slice(tabIndex + 1).map(t => t.id);
      tabsToClose.forEach(id => this.closeTab(id, true));
    }
  },

  // Tab UI updates
  updateTabTitle(tabId, title) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    tab.title = title;
    const titleElement = tab.element.querySelector('.tab-title');
    
    // Check if this site has a custom logo
    let logoPath = null;
    let contentText = title;
    let url = tab.url;
    
    // Try to get URL from webview if not stored in tab
    if (!url && tab.webview) {
      try {
        url = tab.webview.getURL();
      } catch (e) {}
    }
    
    if (url) {
      try {
        const domain = new URL(url).hostname;
        logoPath = this.siteLogos ? this.siteLogos[domain] : null;
        
        // If we have a logo, parse out the content description
        if (logoPath) {
          // Remove site name suffix (e.g., " - YouTube", " - Google", " - Twitch")
          contentText = title
            .replace(/ - YouTube$/i, '')
            .replace(/ - Google$/i, '')
            .replace(/ - Twitch$/i, '')
            .replace(/^YouTube$/i, '') // Just "YouTube" with no content
            .replace(/^Google$/i, '') // Just "Google" with no content
            .replace(/^Twitch$/i, ''); // Just "Twitch" with no content
        }
      } catch (e) {
        // Invalid URL, use plain title
      }
    }
    
    // Build the title HTML
    if (logoPath && contentText.trim()) {
      // Show logo + content text - use DOM methods for security
      titleElement.innerHTML = ''; // Clear existing content
      const img = document.createElement('img');
      img.className = 'tab-title-logo';
      img.src = logoPath; // logoPath comes from internal siteLogos object
      img.alt = '';
      const span = document.createElement('span');
      span.className = 'tab-title-text';
      span.textContent = contentText; // textContent auto-escapes
      titleElement.appendChild(img);
      titleElement.appendChild(span);
    } else if (logoPath) {
      // Just logo, no content - use DOM methods for security
      titleElement.innerHTML = ''; // Clear existing content
      const img = document.createElement('img');
      img.className = 'tab-title-logo';
      img.src = logoPath; // logoPath comes from internal siteLogos object
      img.alt = '';
      titleElement.appendChild(img);
    } else {
      // Plain text
      titleElement.textContent = title;
    }
  },

  updateTabFavicon(tabId, faviconUrl) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && !tab.isHome) {
      tab.favicon = faviconUrl;
      const iconElement = tab.element.querySelector('.tab-favicon');
      if (iconElement) {
        iconElement.src = faviconUrl;
        iconElement.classList.remove('tab-icon-plus');
      }
      
      // Cache favicon
      try {
        const domain = getDomain(tab.url || tab.webview?.getURL());
        if (domain) {
          this.faviconCache.set(domain, { url: faviconUrl, timestamp: Date.now() });
          this.saveFaviconCache();
        }
      } catch (e) {}
      
      // Update history
      if (tab.url) {
        this.updateHistoryFavicon(tab.url, faviconUrl);
      }
    }
  },

  updateTabLoading(tabId, isLoading) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.element.classList.toggle('loading', isLoading);
    }
  },

  updateTabAudioIcon(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    let audioIcon = tab.element.querySelector('.tab-audio-icon');
    
    if (tab.isPlayingAudio || tab.isMuted) {
      if (!audioIcon) {
        audioIcon = document.createElement('span');
        audioIcon.className = 'tab-audio-icon';
        // Insert before the close button for better positioning
        const closeBtn = tab.element.querySelector('.tab-close');
        if (closeBtn) {
          closeBtn.before(audioIcon);
        } else {
          tab.element.appendChild(audioIcon);
        }
        // Add click handler to toggle mute
        audioIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleTabMute(tabId);
        });
      }
      
      if (tab.isMuted) {
        audioIcon.className = 'tab-audio-icon muted';
        audioIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="currentColor"/></svg>';
        audioIcon.title = 'Unmute tab';
      } else {
        audioIcon.className = 'tab-audio-icon playing';
        audioIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/></svg>';
        audioIcon.title = 'Mute tab';
      }
    } else if (audioIcon) {
      audioIcon.remove();
    }
  }
};
