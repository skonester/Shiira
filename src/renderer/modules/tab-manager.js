// Tab Manager Module
// Handles tab creation, switching, closing, context menus, and drag & drop.
// Tabs also carry their place in the Arc-style sidebar (see sidebar.js):
//   spaceId (null for favorites), section ('favorites' | 'pinned' | 'today'), parentId (pinned folder),
//   position, itemId (stable across restarts), lastActiveAt, customTitle and pinnedUrl.
// A sleeping tab has no webview; it gets one back the next time it is opened.

import { isInternalUrl, getDomain, escapeHtml } from './utils.js';
import { uid, letterIconUrl } from './spaces-model.js';

const WEBVIEW_PREFERENCES = 'contextIsolation=yes,devTools=no,plugins=yes,backgroundThrottling=no,v8CacheOptions=bypassHeatCheckAndEagerCompile';

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

  // Top-bar drag: the strip's order becomes each section's order (sections themselves stay in place).
  reorderTabsArray() {
    const tabElements = [...this.tabsContainer.querySelectorAll('.tab')];
    const bySection = {};
    tabElements.forEach(tabEl => {
      const tab = this.tabs.find(t => t.id === tabEl.dataset.tabId);
      if (!tab) return;
      const key = `${tab.section}|${tab.parentId || ''}`;
      bySection[key] = (bySection[key] || 0);
      tab.position = bySection[key]++;
    });
    this.placeTabElements?.();
    this.saveSpacesSoon?.();
  },

  // Creates the tab strip / sidebar row for a tab.
  buildTabElement(tabId, { privateMode = false, isHome = false, title, favicon, url = '' }) {
    const tab = document.createElement('div');
    tab.className = privateMode ? 'tab private-tab' : 'tab';
    tab.dataset.tabId = tabId;
    if (isHome) tab.dataset.isHome = 'true';

    // A page that has not loaded yet shows its site's letter instead of the "+" new tab icon.
    const webUrl = /^https?:/i.test(url || '');
    const placeholder = webUrl ? letterIconUrl(url, title) : 'shiira-asset://ui-icons/plus.svg';
    const icon = isHome
      ? '<img class="tab-home-icon" src="shiira-asset://ui-icons/home.svg" alt="Home">'
      : `<img class="tab-favicon ${favicon || webUrl ? '' : 'tab-icon-plus'}" src="${escapeHtml(favicon || placeholder)}" alt="">`;
    tab.innerHTML = `
      ${icon}
      <span class="tab-title">${escapeHtml(title)}</span>
      <button class="tab-close" title="Close tab">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    `;

    // Favicons that fail to load fall back to the site's letter (or a globe) instead of a broken image.
    tab.querySelector('.tab-favicon')?.addEventListener('error', (event) => {
      const img = event.currentTarget;
      if (img.src.startsWith('shiira-asset://') || img.src.startsWith('data:')) return;
      const data = this.tabs.find(t => t.id === tabId);
      const pageUrl = data?.url || data?.pendingUrl || '';
      img.src = /^https?:/i.test(pageUrl) ? letterIconUrl(pageUrl, data?.title) : 'shiira-asset://ui-icons/globe.svg';
    });

    // Top-bar drag handler (the sidebar uses native drag and drop instead, see sidebar.js)
    tab.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.tab-close') || this.layout === 'sidebar') return;
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

    // Middle click closes a tab, like most browsers
    tab.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.closeOrUnloadTab(tabId);
    });

    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showTabContextMenu(e.clientX, e.clientY, tabId);
    });

    tab.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeOrUnloadTab(tabId);
    });

    return tab;
  },

  createTabWebview(tabId, privateMode = false) {
    const webview = document.createElement('webview');
    webview.id = tabId;
    webview.setAttribute('partition', privateMode ? `private:${tabId}` : 'persist:main');
    webview.setAttribute('webpreferences', WEBVIEW_PREFERENCES);

    this.setupWebviewEvents(webview, tabId);
    // The extension toolbar needs the page's WebContents, which exists once the webview attaches.
    webview.addEventListener('did-attach', () => {
      if (tabId === this.activeTabId) this.onActiveTabChanged?.();
    });
    this.browserContent.appendChild(webview);

    // Apply current brightness setting to new webview
    webview.style.filter = `brightness(${this.currentBrightness / 100})`;
    return webview;
  },

  // Gives a sleeping tab its page back. The tab's last address is loaded by switchTab.
  ensureWebview(tab) {
    if (!tab || tab.isHome || tab.webview) return;
    tab.webview = this.createTabWebview(tab.id, tab.privateMode);
    tab.element.classList.remove('tab-suspended');
  },

  // Fills in where a new tab sits in the sidebar.
  placeNewTab(tabData, options) {
    const section = ['favorites', 'pinned', 'today'].includes(options.section) ? options.section : 'today';
    tabData.itemId = options.itemId || uid('i-');
    tabData.section = section;
    tabData.spaceId = section === 'favorites' ? null : (options.spaceId || this.focusedSpaceId || null);
    tabData.parentId = section === 'pinned' ? (options.parentId || null) : null;
    tabData.customTitle = options.customTitle || '';
    tabData.pinnedUrl = section === 'today' ? null : (options.pinnedUrl || tabData.url || null);
    tabData.lastActiveAt = Number.isFinite(options.lastActiveAt) ? options.lastActiveAt : Date.now();
    if (Number.isFinite(options.position)) {
      tabData.position = options.position;
    } else {
      // New today tabs go on top, like Arc; pinned and favorite tabs go at the end.
      const peers = this.tabs.filter(t => t.section === section && (section === 'favorites' || t.spaceId === tabData.spaceId) && (t.parentId || null) === tabData.parentId);
      const positions = peers.map(t => t.position ?? 0);
      tabData.position = section === 'today'
        ? Math.min(0, ...positions) - 1
        : Math.max(-1, ...positions) + 1;
    }
    if (tabData.customTitle) {
      const titleElement = tabData.element.querySelector('.tab-title');
      if (titleElement) titleElement.textContent = tabData.customTitle;
    }
  },

  createTab(url = null, options = {}) {
    const { deferLoad = false, title = null, favicon = null, privateMode = false, background = false } = options;
    const tabId = `tab-${++this.tabCounter}`;

    // Use provided title/favicon for deferred tabs
    const displayTitle = title || (privateMode ? 'Private Tab' : 'New Tab');
    const displayFavicon = favicon || (url ? this.getCachedFavicon(url) : null);

    const tab = this.buildTabElement(tabId, { privateMode, title: displayTitle, favicon: displayFavicon, url: url || '' });
    this.tabsContainer.appendChild(tab);

    // Deferred tabs start asleep (no webview, no page process) until they are opened.
    const webview = deferLoad ? null : this.createTabWebview(tabId, privateMode);
    if (deferLoad) tab.classList.add('tab-suspended');

    // Store tab info
    const tabData = {
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
    };
    this.placeNewTab(tabData, options);
    this.tabs.push(tabData);
    this.placeTabElements?.();

    // Only switch to tab and load URL if not deferred
    if (!deferLoad) {
      if (url) {
        webview.src = url;
      }
      if (!background) this.switchTab(tabId);
    }
    this.saveSpacesSoon?.();

    return tabId;
  },

  createHomeTab(options = {}) {
    const tabId = `tab-${++this.tabCounter}`;
    const tab = this.buildTabElement(tabId, { isHome: true, title: 'Home' });
    this.tabsContainer.appendChild(tab);

    const tabData = {
      id: tabId,
      element: tab,
      webview: null,
      title: 'Home',
      url: 'shiira://home',
      isHome: true,
      navigationHistory: ['shiira://home'],
      navigationIndex: 0
    };
    this.placeNewTab(tabData, { ...options, section: 'today' });
    this.tabs.push(tabData);
    this.placeTabElements?.();
    this.switchTab(tabId);
    return tabId;
  },

  // Arc behaviour: closing a pinned tab or favorite only unloads it; today tabs are closed.
  closeOrUnloadTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.section === 'pinned' || tab.section === 'favorites') {
      this.unloadTab(tabId);
    } else {
      this.closeTab(tabId);
    }
  },

  // The tab to show after `tab` goes away: its neighbour in the same space, or nothing.
  pickNextTab(tab) {
    const order = (this.getVisibleTabOrder?.() || this.tabs).filter(t => !t.element.classList.contains('closing'));
    const index = order.findIndex(t => t.id === tab.id);
    const rest = order.filter(t => t.id !== tab.id);
    if (!rest.length) return null;
    // Prefer the next today tab, then the one above.
    return rest[Math.min(Math.max(index, 0), rest.length - 1)] || rest[0];
  },

  closeTab(tabId, skipAnimation = false) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];
    if (tab.element.classList.contains('closing')) return;

    // Save tab info for reopen (Ctrl+Shift+T) - only if it has a URL
    if (!tab.isHome && !tab.privateMode) {
      let url = tab.pendingUrl || tab.url;
      try {
        if (tab.webview) url = tab.webview.getURL() || url;
      } catch (e) {
        // Ignore errors getting URL
      }
      if (url && url !== 'about:blank') {
        this.closedTabs.unshift({ url, title: tab.title || 'Closed Tab', closedAt: Date.now() });
        // Keep only the most recent closed tabs
        if (this.closedTabs.length > this.maxClosedTabs) {
          this.closedTabs.pop();
        }
      }
    }

    if (tab.audioCheckInterval) {
      clearInterval(tab.audioCheckInterval);
    }

    this.onTabClosing?.(tab);

    // Pick and show the next tab right away so the window never shows a stale page.
    if (tabId === this.activeTabId) {
      const next = this.pickNextTab(tab);
      if (next) {
        this.switchTab(next.id);
      } else {
        this.activeTabId = null;
        this.createHomeTab();
      }
    }

    if (!skipAnimation) {
      tab.element.classList.add('closing');
    }

    const removeTab = () => {
      tab.element.remove();
      if (tab.webview) {
        tab.webview.remove();
      }

      const index = this.tabs.indexOf(tab);
      if (index !== -1) this.tabs.splice(index, 1);
      this.placeTabElements?.();
      this.saveSpacesSoon?.();
    };

    if (skipAnimation) {
      removeTab();
    } else {
      setTimeout(removeTab, 300);
    }
  },

  switchTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Opening a tab from another space (command bar, archive) moves the sidebar to that space.
    if (tab.spaceId && this.focusedSpaceId && tab.spaceId !== this.focusedSpaceId) {
      this.focusSpace?.(tab.spaceId, { activate: false });
    }

    this.tabs.forEach(t => {
      t.element.classList.remove('active');
      if (t.webview) {
        t.webview.classList.remove('active');
      }
    });

    tab.element.classList.add('active');
    this.activeTabId = tabId;
    tab.lastActiveAt = Date.now();
    if (this.activeBySpace && this.focusedSpaceId) this.activeBySpace[this.focusedSpaceId] = tabId;
    this.runPageTurn?.();

    this.updateAdCounter(tab.adsBlocked || 0);

    // Sleeping tabs get a page again; deferred tabs load their saved address.
    this.ensureWebview(tab);
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
        let url = '';
        try {
          url = tab.webview.getURL();
        } catch (e) {
          // No URL yet before the webview attaches; fall back to the address being loaded.
        }
        url = url || tab.url || '';
        if (!url || url === 'about:blank') {
          // Show welcome page in blank mode (particles only)
          this.welcomePage.classList.remove('hidden');
          this.welcomePage.classList.add('blank-tab');
        } else {
          // Hide welcome page completely
          this.welcomePage.classList.add('hidden');
          this.welcomePage.classList.remove('blank-tab');
        }
        this.urlInput.value = url;
        this.updateSecurityIndicator(url);

        // Update bookmark icon state
        if (url && this.updateBookmarkIconState) {
          this.updateBookmarkIconState(url);
        } else if (this.btnBookmark) {
          this.btnBookmark.classList.remove('bookmarked');
        }
        this.updateNavigationButtons();
      }
    }

    this.applySplitLayout?.();
    this.updateSidebarActive?.();
    this.onActiveTabChanged?.();
    this.saveSpacesSoon?.();
  },

  // Tabs in the order the user sees them (current space), for Ctrl+Tab.
  getCycleOrder() {
    return this.getVisibleTabOrder ? this.getVisibleTabOrder() : this.tabs;
  },

  switchToNextTab() {
    const order = this.getCycleOrder();
    if (order.length <= 1) return;
    const currentIndex = order.findIndex(t => t.id === this.activeTabId);
    const nextIndex = (currentIndex + 1) % order.length;
    this.switchTab(order[nextIndex].id);
  },

  switchToPreviousTab() {
    const order = this.getCycleOrder();
    if (order.length <= 1) return;
    const currentIndex = order.findIndex(t => t.id === this.activeTabId);
    const prevIndex = (currentIndex - 1 + order.length) % order.length;
    this.switchTab(order[prevIndex].id);
  },

  showWelcomePage() {
    this.welcomePage.classList.remove('hidden');
    this.welcomePage.classList.remove('blank-tab');
    this.urlInput.value = '';
    this.updateSecurityIndicator('');
    this.btnBack.disabled = true;
    this.btnForward.disabled = true;
  },

  // Tab context menu (built by sidebar.js, so it knows about pinning, spaces and split view)
  showTabContextMenu(x, y, tabId) {
    this.contextMenuTabId = tabId;
    if (this.showTabMenu) {
      this.showTabMenu(x, y, tabId);
      return;
    }
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
    this.hideSidebarMenu?.();
    this.contextMenuTabId = null;
  },

  handleTabContextMenuAction(action, tabId = this.contextMenuTabId) {
    if (!tabId) return;
    const tab = this.tabs.find(t => t.id === tabId);

    switch (action) {
      case 'new-tab-right':
        this.createTab(null, { spaceId: tab?.spaceId || this.focusedSpaceId, position: (tab?.section === 'today' ? tab.position + 0.5 : undefined) });
        break;
      case 'move-to-new-window':
        this.moveTabToNewWindow(tabId);
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
      case 'close-others':
        this.closeOtherTabs(tabId);
        break;
      case 'close-right':
        this.closeTabsToRight(tabId);
        break;
      case 'close':
        this.closeOrUnloadTab(tabId);
        break;
    }
  },

  async moveTabToNewWindow(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.isHome) return;
    let url = tab.pendingUrl || tab.url;
    try {
      if (tab.webview) url = tab.webview.getURL() || url;
    } catch (e) {}
    if (!url) return;
    await window.shiiraAPI.createNewWindow(url);
    this.closeTab(tabId, true);
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
    if (!tab || tab.isHome) return;
    let url = tab.pendingUrl || tab.url;
    try {
      if (tab.webview) url = tab.webview.getURL() || url;
    } catch (e) {}
    if (url) this.createTab(url, { spaceId: tab.spaceId || this.focusedSpaceId, privateMode: tab.privateMode });
  },

  toggleTabMute(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.webview) {
      tab.isMuted = !tab.isMuted;
      tab.webview.setAudioMuted(tab.isMuted);
      this.updateTabAudioIcon(tabId);
    }
  },

  // "Other tabs" means the other today tabs of the same space; pinned tabs and favorites stay.
  closeOtherTabs(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    const spaceId = tab?.spaceId || this.focusedSpaceId;
    const tabsToClose = this.tabs
      .filter(t => t.id !== tabId && t.section === 'today' && t.spaceId === spaceId)
      .map(t => t.id);
    tabsToClose.forEach(id => this.closeTab(id, true));
  },

  closeTabsToRight(tabId) {
    const order = this.getCycleOrder();
    const tabIndex = order.findIndex(t => t.id === tabId);
    if (tabIndex !== -1) {
      const tabsToClose = order.slice(tabIndex + 1).filter(t => t.section === 'today').map(t => t.id);
      tabsToClose.forEach(id => this.closeTab(id, true));
    }
  },

  // Tab UI updates
  updateTabTitle(tabId, title) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.title = title;
    const titleElement = tab.element.querySelector('.tab-title');
    // A name the user gave the tab wins over the page's own title.
    if (tab.customTitle) {
      titleElement.textContent = tab.customTitle;
      tab.element.title = `${tab.customTitle}\n${title}`;
      return;
    }
    tab.element.title = title;

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
      if (tab.section !== 'today') this.saveSpacesSoon?.();
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
