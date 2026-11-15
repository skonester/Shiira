/**
 * Text Context Menu Module
 * Provides themed context menus for text inputs with standard editing operations
 */

const TextContextMenuMixin = {
  /**
   * Initialize text context menu functionality
   */
  initTextContextMenu() {
    // Get context menu element
    this.textContextMenu = document.getElementById('text-context-menu');
    
    if (!this.textContextMenu) {
      console.warn('[TextContextMenu] Context menu element not found');
      return;
    }
    
    // Track current target input
    this.textContextTarget = null;
    
    // One delegated handler covers existing fields and dynamically added dialogs.
    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      if (!target) return;
      if (target.closest('webview') || target.tagName === 'WEBVIEW') return;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isInput) {
        e.preventDefault();
        e.stopPropagation();
        this.showTextContextMenu(e, target);
      }
    });

    // Set up context menu item click handlers
    this.textContextMenu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent click from reaching modal overlay
        if (item.classList.contains('disabled')) return;
        const action = item.dataset.action;
        this.handleTextContextAction(action).catch(error => console.error('[TextContextMenu] Action failed:', error));
      });
    });
    
    // Global click listener to close context menu when clicking outside
    document.addEventListener('click', (e) => {
      if (this.textContextMenu && 
          !this.textContextMenu.classList.contains('hidden') &&
          !this.textContextMenu.contains(e.target)) {
        this.hideTextContextMenu();
      }
    });
    
    // Prevent context menu events from propagating to overlays/modals
    this.textContextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    this.textContextMenu.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Keep the input's focus and selection while choosing an action.
      e.stopPropagation();
    });
    this.textContextMenu.addEventListener('mouseup', (e) => {
      e.stopPropagation();
    });

    this.contextMenuOverlay?.addEventListener('mousedown', (e) => {
      if (e.target !== this.contextMenuOverlay) return;
      e.preventDefault();
      this.hideAllContextMenus();
    });
    
    console.log('[TextContextMenu] Initialized');
  },

  /**
   * Show text context menu at cursor position
   */
  showTextContextMenu(e, inputElement) {
    this.hideAllContextMenus();
    clearTimeout(this.textContextMenuHideTimer);
    this.textContextMenuHideTimer = null;
    this.textContextTarget = inputElement;
    
    // Update menu items based on input state
    this.updateTextContextMenuState(inputElement);
    
    // Position the menu
    const menu = this.textContextMenu;
    menu.classList.remove('hidden', 'closing');
    
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
    
    // Show overlay
    if (this.contextMenuOverlay) {
      this.contextMenuOverlay.classList.remove('hidden');
    }
  },

  /**
   * Update context menu item states based on input
   */
  updateTextContextMenuState(inputElement) {
    const hasSelection = inputElement.selectionStart !== inputElement.selectionEnd;
    const hasText = inputElement.value.length > 0;
    const canPaste = true; // We'll always enable paste, clipboard API will handle it
    
    // Get menu items
    const cutItem = this.textContextMenu.querySelector('[data-action="cut"]');
    const copyItem = this.textContextMenu.querySelector('[data-action="copy"]');
    const pasteItem = this.textContextMenu.querySelector('[data-action="paste"]');
    const deleteItem = this.textContextMenu.querySelector('[data-action="delete"]');
    const selectAllItem = this.textContextMenu.querySelector('[data-action="select-all"]');
    
    // Update disabled states
    if (cutItem) cutItem.classList.toggle('disabled', !hasSelection);
    if (copyItem) copyItem.classList.toggle('disabled', !hasSelection);
    if (deleteItem) deleteItem.classList.toggle('disabled', !hasSelection);
    if (selectAllItem) selectAllItem.classList.toggle('disabled', !hasText);
  },

  /**
   * Hide text context menu with animation
   */
  hideTextContextMenu() {
    if (!this.textContextMenu || this.textContextMenu.classList.contains('hidden')) return;

    this.contextMenuOverlay?.classList.add('hidden');
    
    // Set flag to prevent modal from closing immediately after context menu action
    this.textContextMenuRecentlyUsed = true;
    setTimeout(() => {
      this.textContextMenuRecentlyUsed = false;
    }, 300);
    
    this.textContextMenu.classList.add('closing');
    
    clearTimeout(this.textContextMenuHideTimer);
    this.textContextMenuHideTimer = setTimeout(() => {
      this.textContextMenu.classList.add('hidden');
      this.textContextMenu.classList.remove('closing');
      this.textContextMenuHideTimer = null;
    }, 150);
    
    this.textContextTarget = null;
  },

  /**
   * Hide all context menus (extend existing functionality)
   */
  hideAllContextMenus() {
    this.hideTextContextMenu();
    if (this.hideWebviewContextMenu) this.hideWebviewContextMenu();
    if (this.hideBookmarkContextMenu) this.hideBookmarkContextMenu();
    if (this.hideBookmarksBarContextMenu) this.hideBookmarksBarContextMenu();
    if (this.hideFolderContextMenu) this.hideFolderContextMenu();
    
    // Hide overlay
    if (this.contextMenuOverlay) {
      this.contextMenuOverlay.classList.add('hidden');
    }
  },

  /**
   * Handle text context menu actions
   */
  async handleTextContextAction(action) {
    const input = this.textContextTarget;
    if (!input) {
      this.hideTextContextMenu();
      return;
    }

    // Release the overlay before waiting on the OS clipboard. A delayed or
    // rejected request must not block clicks or close a newly opened menu.
    this.hideAllContextMenus();
    
    // Focus the input to ensure operations work
    input.focus();
    
    switch (action) {
      case 'undo':
        document.execCommand('undo');
        break;
        
      case 'redo':
        document.execCommand('redo');
        break;
        
      case 'cut':
        if (input.selectionStart !== input.selectionEnd) {
          const selectedText = input.value.substring(input.selectionStart, input.selectionEnd);
          await window.shiiraAPI.clipboard.writeText(selectedText);
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = input.value.substring(0, start) + input.value.substring(end);
          input.setSelectionRange(start, start);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        break;
        
      case 'copy':
        if (input.selectionStart !== input.selectionEnd) {
          const selectedText = input.value.substring(input.selectionStart, input.selectionEnd);
          await window.shiiraAPI.clipboard.writeText(selectedText);
        }
        break;
        
      case 'paste':
        try {
          const text = await window.shiiraAPI.clipboard.readText();
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = input.value.substring(0, start) + text + input.value.substring(end);
          input.setSelectionRange(start + text.length, start + text.length);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        } catch (err) {
          console.error('[TextContextMenu] Paste failed:', err);
        }
        break;
        
      case 'delete':
        if (input.selectionStart !== input.selectionEnd) {
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = input.value.substring(0, start) + input.value.substring(end);
          input.setSelectionRange(start, start);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        break;
        
      case 'select-all':
        input.select();
        break;
    }
  }
};

export default TextContextMenuMixin;
