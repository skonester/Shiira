// Shiira Browser - Bookmarks Module
// Manages bookmarks bar, folders, context menus, and bookmark editing

/**
 * Bookmarks Mixin
 * Adds bookmarks bar functionality to ShiiraBrowser
 */
export const BookmarksMixin = {
  /**
   * Initialize bookmarks bar
   */
  async initBookmarksBar() {
    // Load saved state from backend
    try {
      const data = await window.shiiraAPI.bookmarks.get();
      this.bookmarksBarEnabled = data.barEnabled;
      this.bookmarksData = data.bookmarks;
    } catch (e) {
      console.error('[Bookmarks] Failed to load bookmarks:', e);
      // Fall back to localStorage
      const saved = localStorage.getItem('shiira-bookmarks-bar-enabled');
      this.bookmarksBarEnabled = saved === 'true';
    }
    
    // Update UI
    this.updateBookmarksBarUI();
    this.renderBookmarksBar();
    
    // Initialize scroll functionality
    this.initBookmarksBarScroll();
  },

  /**
   * Initialize bookmarks bar horizontal scrolling
   */
  initBookmarksBarScroll() {
    const container = this.bookmarksContainer;
    const scrollLeft = document.getElementById('bookmarks-scroll-left');
    const scrollRight = document.getElementById('bookmarks-scroll-right');
    
    if (!container || !scrollLeft || !scrollRight) return;
    
    // Function to update arrow visibility based on scroll position
    const updateScrollArrows = () => {
      const hasOverflow = container.scrollWidth > container.clientWidth;
      const isAtStart = container.scrollLeft <= 1;
      const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 1;
      
      // Show right arrow if there's overflow and not at the end
      if (hasOverflow && !isAtEnd) {
        scrollRight.classList.remove('hidden');
      } else {
        scrollRight.classList.add('hidden');
      }
      
      // Show left arrow if scrolled away from start
      if (hasOverflow && !isAtStart) {
        scrollLeft.classList.remove('hidden');
      } else {
        scrollLeft.classList.add('hidden');
      }
    };
    
    // Update on scroll
    container.addEventListener('scroll', updateScrollArrows);
    
    // Update on resize
    const resizeObserver = new ResizeObserver(updateScrollArrows);
    resizeObserver.observe(container);
    
    // Arrow click handlers
    scrollLeft.addEventListener('click', () => {
      container.scrollBy({ left: -200, behavior: 'smooth' });
    });
    
    scrollRight.addEventListener('click', () => {
      container.scrollBy({ left: 200, behavior: 'smooth' });
    });
    
    // Mouse wheel horizontal scrolling
    this.bookmarksBar.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // Vertical scroll - convert to horizontal with increased sensitivity
        e.preventDefault();
        container.scrollBy({ left: e.deltaY * 2, behavior: 'auto' });
      }
    }, { passive: false });
    
    // Initial check
    setTimeout(updateScrollArrows, 100);
  },

  /**
   * Update bookmarks bar UI with animation
   */
  updateBookmarksBarUI() {
    if (this.bookmarksBarEnabled) {
      // Show: remove hidden, then trigger reflow for animation
      this.bookmarksBar.classList.remove('hidden');
      this.bookmarksBarToggle.classList.add('active');
      document.body.classList.add('bookmarks-bar-open');
    } else {
      // Hide: add hidden class (CSS transition handles animation)
      this.bookmarksBar.classList.add('hidden');
      this.bookmarksBarToggle.classList.remove('active');
      document.body.classList.remove('bookmarks-bar-open');
    }
  },

  /**
   * Helper to determine which element the dragged item should be inserted after
   */
  getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.bookmark-item:not(.dragging), .bookmark-folder:not(.dragging)')];
    
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

  /**
   * Toggle bookmarks bar visibility
   */
  async toggleBookmarksBar() {
    this.bookmarksBarEnabled = !this.bookmarksBarEnabled;
    this.updateBookmarksBarUI();
    
    // Save to backend
    try {
      await window.shiiraAPI.bookmarks.setBarEnabled(this.bookmarksBarEnabled);
    } catch (e) {
      console.error('[Bookmarks] Failed to save bar state:', e);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('shiira-bookmarks-bar-enabled', this.bookmarksBarEnabled.toString());
  },

  /**
   * Render bookmarks bar content
   */
  renderBookmarksBar() {
    if (!this.bookmarksContainer) return;
    
    this.bookmarksContainer.innerHTML = '';
    
    // Add right-click handler on the container for empty space
    this.bookmarksContainer.oncontextmenu = (e) => {
      // Only show bar context menu if right-clicking on empty space (not on an item)
      if (e.target === this.bookmarksContainer || e.target.classList.contains('bookmark-placeholder')) {
        e.preventDefault();
        this.showBookmarksBarContextMenu(e);
      }
    };
    
    // Add drag-and-drop handlers for reordering in bookmarks bar
    this.bookmarksContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingItem = document.querySelector('.dragging');
      if (!draggingItem) return;
      
      const afterElement = this.getDragAfterElement(this.bookmarksContainer, e.clientX);
      if (afterElement == null) {
        this.bookmarksContainer.appendChild(draggingItem);
      } else {
        this.bookmarksContainer.insertBefore(draggingItem, afterElement);
      }
    });
    
    this.bookmarksContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggingItem = document.querySelector('.dragging');
      if (!draggingItem) return;
      
      // Get the new order of items
      const items = Array.from(this.bookmarksContainer.children);
      const draggedId = draggingItem.dataset.bookmarkId || draggingItem.dataset.folderId;
      const newIndex = items.indexOf(draggingItem);
      
      if (draggedId && newIndex >= 0) {
        try {
          // Move to bookmarks bar (null folder) at new position
          await window.shiiraAPI.bookmarks.move(draggedId, null, newIndex);
          // Reload bookmarks
          const data = await window.shiiraAPI.bookmarks.get();
          this.bookmarksData = data.bookmarks;
          this.renderBookmarksBar();
        } catch (err) {
          console.error('[Bookmarks] Failed to reorder bookmark:', err);
        }
      }
    });
    
    const items = this.bookmarksData.bar || [];
    
    if (items.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'bookmark-placeholder';
      placeholder.textContent = 'No bookmarks yet';
      this.bookmarksContainer.appendChild(placeholder);
      // Trigger scroll arrow update after render
      setTimeout(() => this.bookmarksContainer.dispatchEvent(new Event('scroll')), 50);
      return;
    }
    
    items.forEach(item => {
      if (item.type === 'bookmark') {
        const el = this.createBookmarkElement(item);
        this.bookmarksContainer.appendChild(el);
      } else if (item.type === 'folder-ref') {
        const folder = this.bookmarksData.folders[item.id];
        if (folder) {
          const el = this.createFolderElement(folder);
          this.bookmarksContainer.appendChild(el);
        }
      }
    });
    
    // Trigger scroll arrow update after render
    setTimeout(() => this.bookmarksContainer.dispatchEvent(new Event('scroll')), 50);
  },

  /**
   * Create a bookmark element for the bar
   */
  createBookmarkElement(bookmark) {
    const el = document.createElement('button');
    el.className = 'bookmark-item';
    el.title = bookmark.title || bookmark.url;
    el.dataset.bookmarkId = bookmark.id;
    el.draggable = true;
    
    // Check if this is an icon-only bookmark (no title)
    const hasTitle = bookmark.title && bookmark.title.trim().length > 0;
    if (!hasTitle) {
      el.classList.add('icon-only');
    }
    
    const icon = document.createElement('img');
    icon.className = 'bookmark-item-icon';
    if (bookmark.icon) {
      icon.src = bookmark.icon;
    } else {
      icon.src = 'shiira-asset://ui-icons/globe.svg';
      icon.classList.add('default-icon');
    }
    icon.width = 16;
    icon.height = 16;
    icon.onerror = () => {
      icon.src = 'shiira-asset://ui-icons/globe.svg';
      icon.classList.add('default-icon');
    };
    
    el.appendChild(icon);
    
    // Only add title element if there's a title
    if (hasTitle) {
      const title = document.createElement('span');
      title.className = 'bookmark-item-title';
      title.textContent = bookmark.title;
      el.appendChild(title);
    }
    
    // Drag events
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', bookmark.id);
      e.dataTransfer.setData('application/x-bookmark-id', bookmark.id);
      el.classList.add('dragging');
    });
    
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.bookmark-folder.drag-over').forEach(f => f.classList.remove('drag-over'));
    });
    
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    el.addEventListener('click', () => {
      this.navigate(bookmark.url);
    });
    
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showBookmarkContextMenu(e, bookmark);
    });
    
    return el;
  },

  /**
   * Create a folder element for the bar
   */
  createFolderElement(folder) {
    const el = document.createElement('div');
    el.className = 'bookmark-folder';
    el.dataset.folderId = folder.id;
    el.draggable = true;
    
    const icon = document.createElement('img');
    icon.className = 'bookmark-folder-icon';
    icon.src = 'shiira-asset://ui-icons/folder.svg';
    icon.width = 16;
    icon.height = 16;
    
    const title = document.createElement('span');
    title.className = 'bookmark-item-title';
    title.textContent = folder.name;
    
    const arrow = document.createElement('img');
    arrow.className = 'bookmark-folder-arrow';
    arrow.src = 'shiira-asset://ui-icons/chevron-down.svg';
    arrow.width = 10;
    arrow.height = 10;
    
    el.appendChild(icon);
    el.appendChild(title);
    el.appendChild(arrow);
    
    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'folder-dropdown';
    
    if (folder.children && folder.children.length > 0) {
      folder.children.forEach(child => {
        if (child.type === 'bookmark') {
          const item = this.createDropdownItem(child);
          dropdown.appendChild(item);
        }
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'folder-dropdown-item empty-folder-msg';
      empty.textContent = 'Empty folder';
      dropdown.appendChild(empty);
    }
    
    el.appendChild(dropdown);
    
    // Helper to close dropdown with animation
    const closeDropdown = (d) => {
      if (d.classList.contains('visible') && !d.classList.contains('closing')) {
        d.classList.add('closing');
        setTimeout(() => {
          d.classList.remove('visible', 'closing');
        }, 250);
      }
    };
    
    // Toggle dropdown on click
    el.addEventListener('click', (e) => {
      // Don't toggle if we're dragging
      if (el.classList.contains('drag-over')) return;
      
      e.stopPropagation();
      
      // Close other dropdowns with animation
      document.querySelectorAll('.folder-dropdown.visible').forEach(d => {
        if (d !== dropdown) closeDropdown(d);
      });
      
      // Toggle this dropdown
      if (dropdown.classList.contains('visible')) {
        closeDropdown(dropdown);
      } else {
        dropdown.classList.remove('closing');
        dropdown.classList.add('visible');
      }
    });
    
    // Drag and drop events for receiving bookmarks
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over');
    });
    
    el.addEventListener('dragleave', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
    });
    
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      
      const bookmarkId = e.dataTransfer.getData('application/x-bookmark-id');
      // Don't allow dropping a folder into itself
      if (bookmarkId && bookmarkId !== folder.id) {
        try {
          await window.shiiraAPI.bookmarks.move(bookmarkId, folder.id);
          // Reload bookmarks
          const data = await window.shiiraAPI.bookmarks.get();
          this.bookmarksData = data.bookmarks;
          this.renderBookmarksBar();
        } catch (err) {
          console.error('[Bookmarks] Failed to move bookmark:', err);
        }
      }
    });
    
    // Right-click for folder context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showFolderContextMenu(e, folder);
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      closeDropdown(dropdown);
    });
    
    // Drag events for reordering folders
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', folder.id);
      e.dataTransfer.setData('application/x-bookmark-id', folder.id);
      el.classList.add('dragging');
      // Close dropdown when starting to drag
      closeDropdown(dropdown);
    });
    
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });
    
    return el;
  },

  /**
   * Create a dropdown item for folder contents
   */
  createDropdownItem(bookmark) {
    const item = document.createElement('a');
    item.className = 'folder-dropdown-item';
    item.href = '#';
    item.title = bookmark.title || bookmark.url;
    
    // Check if this is an icon-only bookmark
    const hasTitle = bookmark.title && bookmark.title.trim().length > 0;
    if (!hasTitle) {
      item.classList.add('icon-only');
    }
    
    const icon = document.createElement('img');
    icon.className = 'folder-dropdown-item-icon';
    if (bookmark.icon) {
      icon.src = bookmark.icon;
    } else {
      icon.src = 'shiira-asset://ui-icons/globe.svg';
      icon.classList.add('default-icon');
    }
    icon.width = 16;
    icon.height = 16;
    icon.onerror = () => {
      icon.src = 'shiira-asset://ui-icons/globe.svg';
      icon.classList.add('default-icon');
    };
    
    item.appendChild(icon);
    
    // Only add title if there is one, otherwise show domain in dropdown for clarity
    const title = document.createElement('span');
    title.className = 'folder-dropdown-item-title';
    title.textContent = hasTitle ? bookmark.title : this.extractDomain(bookmark.url);
    if (!hasTitle) {
      title.classList.add('url-fallback');
    }
    item.appendChild(title);
    
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.navigate(bookmark.url);
      // Close dropdown
      item.closest('.folder-dropdown').classList.remove('visible');
    });
    
    // Right-click context menu (same as bookmarks bar items)
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showBookmarkContextMenu(e, bookmark);
    });
    
    return item;
  },

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  },

  /**
   * Toggle bookmark popup
   */
  async toggleBookmarkPopup() {
    if (this.bookmarkPopup.classList.contains('hidden')) {
      await this.showBookmarkPopup();
    } else {
      this.hideBookmarkPopup();
    }
  },

  /**
   * Show bookmark popup for current page
   */
  async showBookmarkPopup() {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || activeTab.isHome) {
      return; // Can't bookmark home page
    }
    
    // The webview is stored on the tab object directly
    const webview = activeTab.webview;
    if (!webview) {
      return;
    }
    
    const url = webview.getURL();
    const title = webview.getTitle() || this.extractDomain(url);
    
    // Check if already bookmarked
    const existing = await window.shiiraAPI.bookmarks.findByUrl(url);
    
    // Populate form
    this.bookmarkUrlInput.value = url;
    this.bookmarkNameInput.value = existing ? existing.bookmark.title : title;
    
    // Populate folder dropdown
    await this.populateFolderDropdown(existing ? existing.folderId : null);
    
    // Show/hide remove button based on whether it's already bookmarked
    if (existing) {
      this.editingBookmark = existing.bookmark;
      this.bookmarkRemoveBtn.classList.remove('hidden');
      this.bookmarkPopup.querySelector('.bookmark-popup-title').textContent = 'Edit Bookmark';
    } else {
      this.editingBookmark = null;
      this.bookmarkRemoveBtn.classList.add('hidden');
      this.bookmarkPopup.querySelector('.bookmark-popup-title').textContent = 'Add Bookmark';
    }
    
    // Reset new folder field
    this.bookmarkNewFolderField.classList.add('hidden');
    this.bookmarkNewFolderName.value = '';
    
    this.bookmarkPopup.classList.remove('hidden');
    if (this.bookmarkPopupOverlay) this.bookmarkPopupOverlay.classList.remove('hidden');
    this.bookmarkNameInput.focus();
    this.bookmarkNameInput.select();
  },

  /**
   * Hide bookmark popup
   */
  hideBookmarkPopup() {
    this.bookmarkPopup.classList.add('hidden');
    if (this.bookmarkPopupOverlay) this.bookmarkPopupOverlay.classList.add('hidden');
    this.editingBookmark = null;
  },

  /**
   * Populate folder dropdown
   */
  async populateFolderDropdown(selectedFolderId = null) {
    const folders = await window.shiiraAPI.bookmarks.getFolders();
    
    this.bookmarkFolderSelect.innerHTML = '';
    
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id || '';
      option.textContent = folder.name;
      if (folder.id === selectedFolderId) {
        option.selected = true;
      }
      this.bookmarkFolderSelect.appendChild(option);
    });
  },

  /**
   * Toggle new folder field
   */
  toggleNewFolderField() {
    const isHidden = this.bookmarkNewFolderField.classList.contains('hidden');
    if (isHidden) {
      this.bookmarkNewFolderField.classList.remove('hidden');
      this.bookmarkNewFolderName.focus();
      this.bookmarkNewFolderBtn.textContent = 'Cancel New Folder';
    } else {
      this.bookmarkNewFolderField.classList.add('hidden');
      this.bookmarkNewFolderName.value = '';
      this.bookmarkNewFolderBtn.textContent = 'New Folder';
    }
  },

  /**
   * Save bookmark
   */
  async saveBookmark() {
    const url = this.bookmarkUrlInput.value;
    const title = this.bookmarkNameInput.value.trim();
    let folderId = this.bookmarkFolderSelect.value || null;
    
    // Create new folder if specified
    const newFolderName = this.bookmarkNewFolderName.value.trim();
    if (newFolderName && !this.bookmarkNewFolderField.classList.contains('hidden')) {
      try {
        const result = await window.shiiraAPI.bookmarks.createFolder({ name: newFolderName });
        if (result.success) {
          folderId = result.folder.id;
        }
      } catch (e) {
        console.error('[Bookmarks] Failed to create folder:', e);
      }
    }
    
    // Get favicon from current tab
    let icon = null;
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab) {
      const tabElement = document.querySelector(`.tab[data-tab-id="${activeTab.id}"]`);
      if (tabElement) {
        const favicon = tabElement.querySelector('.tab-favicon');
        if (favicon && favicon.src && !favicon.src.includes('plus.svg')) {
          icon = favicon.src;
        }
      }
    }
    
    try {
      if (this.editingBookmark) {
        // Update existing bookmark
        await window.shiiraAPI.bookmarks.update(this.editingBookmark.id, { title, icon });
        // If folder changed, move it
        // (simplified - would need more logic for proper folder tracking)
      } else {
        // Add new bookmark
        await window.shiiraAPI.bookmarks.add({ url, title, icon, folderId });
      }
      
      // Reload bookmarks data
      const data = await window.shiiraAPI.bookmarks.get();
      this.bookmarksData = data.bookmarks;
      this.renderBookmarksBar();
      
      // Update bookmark icon state
      this.updateBookmarkIconState(url);
      
      this.hideBookmarkPopup();
    } catch (e) {
      console.error('[Bookmarks] Failed to save bookmark:', e);
    }
  },

  /**
   * Remove current bookmark
   */
  async removeCurrentBookmark() {
    if (!this.editingBookmark) return;
    
    try {
      await window.shiiraAPI.bookmarks.remove(this.editingBookmark.id);
      
      // Reload bookmarks data
      const data = await window.shiiraAPI.bookmarks.get();
      this.bookmarksData = data.bookmarks;
      this.renderBookmarksBar();
      
      // Update bookmark icon state
      this.updateBookmarkIconState(this.bookmarkUrlInput.value);
      
      this.hideBookmarkPopup();
    } catch (e) {
      console.error('[Bookmarks] Failed to remove bookmark:', e);
    }
  },

  /**
   * Update bookmark icon state based on current URL
   */
  async updateBookmarkIconState(url) {
    if (!this.btnBookmark) return;
    
    try {
      const isBookmarked = await window.shiiraAPI.bookmarks.isBookmarked(url);
      if (isBookmarked) {
        this.btnBookmark.classList.add('bookmarked');
        this.btnBookmark.title = 'Edit bookmark';
      } else {
        this.btnBookmark.classList.remove('bookmarked');
        this.btnBookmark.title = 'Bookmark this page';
      }
    } catch (e) {
      // Silently fail
    }
  },

  /**
   * Show context menu for bookmark
   */
  showBookmarkContextMenu(e, bookmark) {
    e.preventDefault();
    e.stopPropagation();
    
    // Hide other context menus
    this.hideBookmarksBarContextMenu();
    this.hideFolderContextMenu();
    
    this.contextMenuBookmark = bookmark;
    
    // Position the menu
    const menu = this.bookmarkContextMenu;
    
    // Clear any ongoing animations before showing
    menu.classList.remove('hidden', 'closing');
    menu.style.animation = 'none';
    // Force reflow to reset animation
    void menu.offsetWidth;
    menu.style.animation = '';
    
    // Calculate position
    let x = e.clientX;
    let y = e.clientY;
    
    // Ensure menu doesn't go off screen
    const menuRect = menu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    if (x + menuRect.width > windowWidth) {
      x = windowWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > windowHeight) {
      y = windowHeight - menuRect.height - 10;
    }
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  },

  /**
   * Hide bookmark context menu
   */
  hideBookmarkContextMenu() {
    if (!this.bookmarkContextMenu) return;
    
    if (!this.bookmarkContextMenu.classList.contains('hidden')) {
      this.bookmarkContextMenu.classList.add('closing');
      setTimeout(() => {
        this.bookmarkContextMenu.classList.add('hidden');
        this.bookmarkContextMenu.classList.remove('closing');
        this.contextMenuBookmark = null;
      }, 280);
    }
  },

  /**
   * Show context menu for bookmarks bar (empty space)
   */
  showBookmarksBarContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Hide other context menus
    this.hideBookmarkContextMenu();
    this.hideFolderContextMenu();
    
    // Position the menu
    const menu = this.bookmarksBarContextMenu;
    
    // Clear any ongoing animations before showing
    menu.classList.remove('hidden', 'closing');
    menu.style.animation = 'none';
    // Force reflow to reset animation
    void menu.offsetWidth;
    menu.style.animation = '';
    
    // Calculate position
    let x = e.clientX;
    let y = e.clientY;
    
    // Ensure menu doesn't go off screen
    const menuRect = menu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    if (x + menuRect.width > windowWidth) {
      x = windowWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > windowHeight) {
      y = windowHeight - menuRect.height - 10;
    }
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  },

  /**
   * Hide bookmarks bar context menu
   */
  hideBookmarksBarContextMenu() {
    if (!this.bookmarksBarContextMenu) return;
    
    if (!this.bookmarksBarContextMenu.classList.contains('hidden')) {
      this.bookmarksBarContextMenu.classList.add('closing');
      setTimeout(() => {
        this.bookmarksBarContextMenu.classList.add('hidden');
        this.bookmarksBarContextMenu.classList.remove('closing');
      }, 280);
    }
  },

  /**
   * Handle bookmarks bar context menu actions
   */
  async handleBookmarksBarContextAction(action) {
    switch (action) {
      case 'bar-add-folder':
        this.showAddFolderDialog();
        break;
        
      case 'bar-import':
        this.showImportBookmarksDialog();
        break;
        
      case 'bar-hide':
        this.toggleBookmarksBar();
        break;
    }
    
    this.hideBookmarksBarContextMenu();
  },

  /**
   * Show add folder modal
   */
  showAddFolderDialog() {
    // Clear and show modal
    if (this.addFolderName) this.addFolderName.value = '';
    if (this.addFolderOverlay) this.addFolderOverlay.classList.remove('hidden');
    if (this.addFolderModal) this.addFolderModal.classList.remove('hidden');
    
    // Focus the input
    setTimeout(() => {
      if (this.addFolderName) this.addFolderName.focus();
    }, 100);
  },

  /**
   * Hide add folder modal
   */
  hideAddFolderModal() {
    if (this.addFolderOverlay) this.addFolderOverlay.classList.add('hidden');
    if (this.addFolderModal) this.addFolderModal.classList.add('hidden');
    if (this.addFolderName) this.addFolderName.value = '';
  },

  /**
   * Save new folder from modal
   */
  async saveNewFolder() {
    const folderName = this.addFolderName?.value?.trim();
    if (!folderName) {
      this.addFolderName?.focus();
      return;
    }
    
    try {
      await window.shiiraAPI.bookmarks.createFolder({ name: folderName });
      
      // Reload bookmarks data
      const data = await window.shiiraAPI.bookmarks.get();
      this.bookmarksData = data.bookmarks;
      this.renderBookmarksBar();
      
      this.hideAddFolderModal();
    } catch (e) {
      console.error('[Bookmarks] Failed to create folder:', e);
      this.showModal('Error', 'Failed to create folder.');
    }
  },

  /**
   * Show import bookmarks dialog
   */
  showImportBookmarksDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const htmlContent = await file.text();
        const result = await window.shiiraAPI.bookmarks.import(htmlContent);
        
        // Reload bookmarks data
        const data = await window.shiiraAPI.bookmarks.get();
        this.bookmarksData = data.bookmarks;
        this.renderBookmarksBar();
        
        const importedCount = result.imported?.bookmarks || 0;
        const foldersCount = result.imported?.folders || 0;
        this.showModal('Import Complete', `Successfully imported ${importedCount} bookmarks and ${foldersCount} folders.`);
      } catch (e) {
        console.error('[Bookmarks] Failed to import bookmarks:', e);
        this.showModal('Error', 'Failed to import bookmarks. Please ensure the file is a valid HTML bookmarks export.');
      }
    };
    
    input.click();
  },

  /**
   * Show context menu for folder
   */
  showFolderContextMenu(e, folder) {
    e.preventDefault();
    e.stopPropagation();
    
    // Hide other context menus
    this.hideBookmarkContextMenu();
    this.hideBookmarksBarContextMenu();
    
    this.contextMenuFolder = folder;
    
    // Position the menu
    const menu = this.folderContextMenu;
    
    // Clear any ongoing animations before showing
    menu.classList.remove('hidden', 'closing');
    menu.style.animation = 'none';
    // Force reflow to reset animation
    void menu.offsetWidth;
    menu.style.animation = '';
    
    // Calculate position
    let x = e.clientX;
    let y = e.clientY;
    
    // Ensure menu doesn't go off screen
    const menuRect = menu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    if (x + menuRect.width > windowWidth) {
      x = windowWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > windowHeight) {
      y = windowHeight - menuRect.height - 10;
    }
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  },

  /**
   * Hide folder context menu
   */
  hideFolderContextMenu() {
    if (!this.folderContextMenu) return;
    
    if (!this.folderContextMenu.classList.contains('hidden')) {
      this.folderContextMenu.classList.add('closing');
      setTimeout(() => {
        this.folderContextMenu.classList.add('hidden');
        this.folderContextMenu.classList.remove('closing');
        this.contextMenuFolder = null;
      }, 280);
    }
  },

  /**
   * Handle folder context menu actions
   */
  async handleFolderContextAction(action) {
    const folder = this.contextMenuFolder;
    if (!folder) {
      this.hideFolderContextMenu();
      return;
    }
    
    switch (action) {
      case 'folder-open-all':
        this.openAllFolderBookmarks(folder);
        break;
        
      case 'folder-rename':
        this.showRenameFolderDialog(folder);
        break;
        
      case 'folder-delete':
        await this.deleteFolder(folder);
        break;
    }
    
    this.hideFolderContextMenu();
  },

  /**
   * Open all bookmarks in a folder as new tabs
   */
  openAllFolderBookmarks(folder) {
    if (folder.children && folder.children.length > 0) {
      folder.children.forEach(child => {
        if (child.type === 'bookmark') {
          this.createTab(child.url);
        }
      });
    }
  },

  /**
   * Show rename folder dialog
   */
  async showRenameFolderDialog(folder) {
    const newName = await this.showPrompt(
      'Rename Folder',
      'Enter new folder name:',
      folder.name,
      { placeholder: 'Folder name' }
    );
    
    if (newName && newName !== folder.name) {
      try {
        await window.shiiraAPI.bookmarks.update(folder.id, { name: newName });
        
        // Reload bookmarks data
        const data = await window.shiiraAPI.bookmarks.get();
        this.bookmarksData = data.bookmarks;
        this.renderBookmarksBar();
      } catch (e) {
        console.error('[Bookmarks] Failed to rename folder:', e);
        this.showNotification('Error', 'Failed to rename folder.', 'error');
      }
    }
  },

  /**
   * Delete a folder
   */
  async deleteFolder(folder) {
    const childCount = folder.children ? folder.children.length : 0;
    const confirmMsg = childCount > 0 
      ? `Delete folder "${folder.name}" and its ${childCount} bookmark(s)?`
      : `Delete folder "${folder.name}"?`;
      
    const confirmed = await this.showConfirmation('Delete Folder', confirmMsg, {
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true
    });
    
    if (confirmed) {
      try {
        await window.shiiraAPI.bookmarks.remove(folder.id);
        
        // Reload bookmarks data
        const data = await window.shiiraAPI.bookmarks.get();
        this.bookmarksData = data.bookmarks;
        this.renderBookmarksBar();
      } catch (e) {
        console.error('[Bookmarks] Failed to delete folder:', e);
        this.showModal('Error', 'Failed to delete folder.');
      }
    }
  },

  /**
   * Handle bookmark context menu actions
   */
  async handleBookmarkContextAction(action) {
    const bookmark = this.contextMenuBookmark;
    if (!bookmark) {
      this.hideBookmarkContextMenu();
      return;
    }
    
    switch (action) {
      case 'bookmark-open':
        this.navigate(bookmark.url);
        break;
        
      case 'bookmark-open-new-tab':
        this.createTab(bookmark.url);
        break;
        
      case 'bookmark-edit':
        this.showBookmarkEditModal(bookmark);
        break;
        
      case 'bookmark-move':
        // TODO: Implement move to folder dialog
        this.showModal('Move to Folder', 'This feature is coming soon!');
        break;
        
      case 'bookmark-delete':
        await this.removeBookmark(bookmark.id);
        break;
    }
    
    this.hideBookmarkContextMenu();
  },

  /**
   * Show bookmark edit modal
   */
  showBookmarkEditModal(bookmark) {
    this.editingBookmark = bookmark;
    this.editingBookmarkNewIcon = null;
    
    // Populate fields
    if (this.bookmarkEditTitle) this.bookmarkEditTitle.value = bookmark.title || '';
    if (this.bookmarkEditUrl) this.bookmarkEditUrl.value = bookmark.url || '';
    
    // Set icon preview
    if (this.bookmarkEditIconPreview) {
      this.bookmarkEditIconPreview.innerHTML = '';
      if (bookmark.icon) {
        const img = document.createElement('img');
        img.src = bookmark.icon;
        img.alt = 'Bookmark icon';
        img.onerror = () => {
          img.src = '../assets/ui-icons/globe.svg';
        };
        this.bookmarkEditIconPreview.appendChild(img);
      } else {
        const img = document.createElement('img');
        img.src = '../assets/ui-icons/globe.svg';
        img.alt = 'Default icon';
        this.bookmarkEditIconPreview.appendChild(img);
      }
    }
    
    // Show modal
    if (this.bookmarkEditOverlay) this.bookmarkEditOverlay.classList.remove('hidden');
    if (this.bookmarkEditModal) this.bookmarkEditModal.classList.remove('hidden');
    
    // Focus title field
    if (this.bookmarkEditTitle) this.bookmarkEditTitle.focus();
  },

  /**
   * Hide bookmark edit modal
   */
  hideBookmarkEditModal() {
    if (this.bookmarkEditOverlay) this.bookmarkEditOverlay.classList.add('hidden');
    if (this.bookmarkEditModal) this.bookmarkEditModal.classList.add('hidden');
    this.editingBookmark = null;
    this.editingBookmarkNewIcon = null;
    
    // Clear file input
    if (this.bookmarkEditIconInput) this.bookmarkEditIconInput.value = '';
  },

  /**
   * Handle bookmark icon upload
   */
  handleBookmarkIconUpload(file) {
    if (!file) return;
    
    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/x-icon', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this.showModal('Invalid File', 'Please upload a PNG, JPG, SVG, ICO, or WebP image.');
      return;
    }
    
    // Read file as base64
    const reader = new FileReader();
    reader.onload = (e) => {
      this.editingBookmarkNewIcon = {
        data: e.target.result,
        mimeType: file.type
      };
      
      // Update preview
      if (this.bookmarkEditIconPreview) {
        this.bookmarkEditIconPreview.innerHTML = '';
        const img = document.createElement('img');
        img.src = e.target.result;
        img.alt = 'New icon';
        this.bookmarkEditIconPreview.appendChild(img);
      }
    };
    reader.readAsDataURL(file);
  },

  /**
   * Reset bookmark icon to favicon
   */
  async resetBookmarkIcon() {
    if (!this.editingBookmark) return;
    
    this.editingBookmarkNewIcon = { reset: true };
    
    // Try to get favicon from URL
    try {
      const url = this.bookmarkEditUrl?.value || this.editingBookmark.url;
      const urlObj = new URL(url);
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
      
      if (this.bookmarkEditIconPreview) {
        this.bookmarkEditIconPreview.innerHTML = '';
        const img = document.createElement('img');
        img.src = faviconUrl;
        img.alt = 'Favicon';
        img.onerror = () => {
          img.src = '../assets/ui-icons/globe.svg';
        };
        this.bookmarkEditIconPreview.appendChild(img);
      }
    } catch (e) {
      // Use default globe icon
      if (this.bookmarkEditIconPreview) {
        this.bookmarkEditIconPreview.innerHTML = '';
        const img = document.createElement('img');
        img.src = '../assets/ui-icons/globe.svg';
        img.alt = 'Default icon';
        this.bookmarkEditIconPreview.appendChild(img);
      }
    }
  },

  /**
   * Save edited bookmark
   */
  async saveEditedBookmark() {
    if (!this.editingBookmark) return;
    
    const updates = {};
    
    // Get updated title (allow empty string for icon-only bookmarks)
    const newTitle = this.bookmarkEditTitle?.value?.trim() ?? '';
    if (newTitle !== this.editingBookmark.title) {
      updates.title = newTitle;
    }
    
    // Get updated URL
    const newUrl = this.bookmarkEditUrl?.value?.trim();
    if (newUrl && newUrl !== this.editingBookmark.url) {
      updates.url = newUrl;
    }
    
    // Handle icon changes
    if (this.editingBookmarkNewIcon) {
      if (this.editingBookmarkNewIcon.reset) {
        // Reset to favicon
        try {
          const url = newUrl || this.editingBookmark.url;
          const urlObj = new URL(url);
          updates.icon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
        } catch (e) {
          updates.icon = null;
        }
        
        // Delete custom icon if exists
        await window.shiiraAPI.bookmarks.deleteIcon(this.editingBookmark.id);
      } else if (this.editingBookmarkNewIcon.data) {
        // Save new custom icon
        const iconPath = await window.shiiraAPI.bookmarks.saveIcon(
          this.editingBookmark.id,
          this.editingBookmarkNewIcon.data,
          this.editingBookmarkNewIcon.mimeType
        );
        if (iconPath) {
          updates.icon = iconPath;
        }
      }
    }
    
    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      try {
        await window.shiiraAPI.bookmarks.update(this.editingBookmark.id, updates);
        
        // Reload bookmarks data
        const data = await window.shiiraAPI.bookmarks.get();
        this.bookmarksData = data.bookmarks;
        this.renderBookmarksBar();
      } catch (e) {
        console.error('[Bookmarks] Failed to update bookmark:', e);
        this.showModal('Error', 'Failed to save bookmark changes.');
        return;
      }
    }
    
    this.hideBookmarkEditModal();
  },

  /**
   * Remove a bookmark by ID
   */
  async removeBookmark(bookmarkId) {
    try {
      await window.shiiraAPI.bookmarks.remove(bookmarkId);
      
      // Reload bookmarks data
      const data = await window.shiiraAPI.bookmarks.get();
      this.bookmarksData = data.bookmarks;
      this.renderBookmarksBar();
      
      // Update bookmark icon if we're on that page
      const activeTab = this.tabs.find(t => t.id === this.activeTabId);
      if (activeTab && activeTab.webview) {
        try {
          const url = activeTab.webview.getURL();
          this.updateBookmarkIconState(url);
        } catch (e) {
          // Ignore
        }
      }
    } catch (e) {
      console.error('[Bookmarks] Failed to remove bookmark:', e);
    }
  }
};
