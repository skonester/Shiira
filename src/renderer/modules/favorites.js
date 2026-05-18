// Shiira Browser - Favorites Module
// Manages bookmark/favorites functionality

import { escapeHtml, getDomain } from './utils.js';

/**
 * Favorites Mixin
 * Adds bookmarks/favorites functionality to ShiiraBrowser
 */
export const FavoritesMixin = {
  /**
   * Initialize favorites system
   */
  async initFavorites() {
    try {
      const data = await window.shiiraAPI.favorites.get();
      this.favoritesEnabled = data.enabled || false;
      // Filter out null values and limit to max 10
      this.favorites = (data.favorites || []).filter(f => f !== null).slice(0, 10);
      this.updateFavoritesUI();
    } catch (e) {
      console.error('Failed to load favorites settings:', e);
    }
  },

  /**
   * Update favorites UI state
   */
  updateFavoritesUI() {
    // Show/hide favorites button with animation
    if (this.favoritesEnabled) {
      this.btnFavorites.classList.remove('hidden', 'closing');
      // Trigger reflow for animation
      void this.btnFavorites.offsetWidth;
      this.btnFavorites.classList.add('visible');
    } else {
      this.btnFavorites.classList.remove('visible');
      this.btnFavorites.classList.add('closing');
      // Wait for animation to complete before hiding
      setTimeout(() => {
        if (!this.favoritesEnabled) {
          this.btnFavorites.classList.remove('closing');
          this.btnFavorites.classList.add('hidden');
        }
      }, 300);
    }
    
    // Update toggle in main menu to show active state
    if (this.favoritesToggle) {
      if (this.favoritesEnabled) {
        this.favoritesToggle.classList.add('active');
      } else {
        this.favoritesToggle.classList.remove('active');
      }
    }
  },

  /**
   * Toggle favorites feature on/off
   */
  async toggleFavoritesEnabled() {
    this.favoritesEnabled = !this.favoritesEnabled;
    this.updateFavoritesUI();
    
    await window.shiiraAPI.favorites.setEnabled(this.favoritesEnabled);
  },

  /**
   * Toggle favorites panel visibility
   */
  toggleFavoritesPanel() {
    if (this.favoritesPanel.classList.contains('hidden')) {
      this.showFavoritesPanel();
    } else {
      this.hideFavoritesPanel();
    }
  },

  /**
   * Show favorites panel
   */
  showFavoritesPanel() {
    this.favoritesPanel.classList.remove('hidden');
    this.renderFavoritesSlots();
  },

  /**
   * Hide favorites panel
   */
  hideFavoritesPanel() {
    this.favoritesPanel.classList.add('hidden');
  },

  /**
   * Get the number of visible slots (filled slots + 1 empty, max 10)
   */
  getVisibleSlotCount() {
    const filledCount = this.favorites.filter(f => f !== null).length;
    // Show filled slots + 1 empty slot, max 10
    return Math.min(filledCount + 1, 10);
  },

  /**
   * Render favorites slots
   */
  renderFavoritesSlots() {
    const visibleCount = this.getVisibleSlotCount();
    
    let html = '';
    
    for (let index = 0; index < visibleCount; index++) {
      const favorite = this.favorites[index];
      if (favorite) {
        const faviconSrc = favorite.favicon || 'shiira-asset://ui-icons/globe.svg';
        
        html += `
          <div class="favorite-slot filled" data-index="${index}">
            <img class="favorite-bg" src="${escapeHtml(faviconSrc)}" 
                 onerror="this.src='shiira-asset://ui-icons/globe.svg'">
            <div class="favorite-actions">
              <button class="favorite-action-btn edit" data-index="${index}" title="Edit">
                <img src="shiira-asset://ui-icons/customize.svg" alt="Edit">
              </button>
              <button class="favorite-action-btn delete" data-index="${index}" title="Remove">
                <img src="shiira-asset://ui-icons/delete.svg" alt="Delete">
              </button>
            </div>
          </div>`;
      } else {
        html += `
          <div class="favorite-slot empty" data-index="${index}">
            <div class="favorite-add">
              <svg width="24" height="24" viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2"/>
              </svg>
            </div>
          </div>`;
      }
    }
    
    this.favoritesSlots.innerHTML = html;
    
    // Add click handlers for filled slots
    this.favoritesSlots.querySelectorAll('.favorite-slot.filled').forEach(slot => {
      slot.addEventListener('click', (e) => {
        if (!e.target.closest('.favorite-action-btn')) {
          const index = parseInt(slot.dataset.index);
          const favorite = this.favorites[index];
          if (favorite && favorite.url) {
            console.log('[Favorites] Opening URL:', favorite.url);
            this.openFavoriteUrl(favorite.url);
            this.hideFavoritesPanel();
          }
        }
      });
    });
    
    this.favoritesSlots.querySelectorAll('.favorite-slot.empty').forEach(slot => {
      slot.addEventListener('click', () => {
        const index = parseInt(slot.dataset.index);
        this.showFavoritesDialog(index);
      });
    });
    
    this.favoritesSlots.querySelectorAll('.favorite-action-btn.edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        this.showFavoritesDialog(index, this.favorites[index]);
      });
    });
    
    this.favoritesSlots.querySelectorAll('.favorite-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        this.removeFavorite(index);
      });
    });
  },

  /**
   * Show favorites edit dialog
   * @param {number} slotIndex - Index of slot being edited
   * @param {object} existingFavorite - Existing favorite data (for edit)
   */
  showFavoritesDialog(slotIndex, existingFavorite) {
    this.editingFavoriteSlot = slotIndex;
    this.favoritesDialogTitle.textContent = existingFavorite ? 'Edit Favorite' : 'Add Favorite';
    this.favoriteUrlInput.value = existingFavorite ? existingFavorite.url : '';
    this.favoritesEditDialog.classList.remove('hidden');
    this.favoriteUrlInput.focus();
  },

  /**
   * Hide favorites dialog
   */
  hideFavoritesDialog() {
    this.favoritesEditDialog.classList.add('hidden');
    this.editingFavoriteSlot = null;
  },

  /**
   * Save favorite from dialog
   */
  async saveFavorite() {
    const url = this.favoriteUrlInput.value.trim();
    if (!url) return;
    
    // Process URL
    let finalUrl = url;
    if (!url.match(/^https?:\/\//i)) {
      finalUrl = 'https://' + url;
    }
    
    // Get domain for name
    const domain = getDomain(finalUrl);
    
    // Use the API to save the favorite
    const result = await window.shiiraAPI.favorites.set(this.editingFavoriteSlot, finalUrl, domain);
    
    if (result.success) {
      // Update local array
      while (this.favorites.length <= this.editingFavoriteSlot) {
        this.favorites.push(null);
      }
      this.favorites[this.editingFavoriteSlot] = result.favorite;
    }
    
    this.hideFavoritesDialog();
    this.renderFavoritesSlots();
  },

  /**
   * Remove a favorite
   * @param {number} slotIndex - Index of favorite to remove
   */
  async removeFavorite(slotIndex) {
    // Use the API to remove the favorite
    await window.shiiraAPI.favorites.remove(slotIndex);
    
    // Refresh favorites from server
    const data = await window.shiiraAPI.favorites.get();
    this.favorites = (data.favorites || []).filter(f => f !== null);
    
    this.renderFavoritesSlots();
  },

  /**
   * Open a favorite URL in a new tab
   * @param {string} url - The URL to open
   */
  openFavoriteUrl(url) {
    console.log('[Favorites] openFavoriteUrl called with:', url);
    
    // Create a new tab first without URL
    const tabId = this.createTab();
    
    // Get the tab and webview
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.webview) {
      console.log('[Favorites] Found webview, setting src directly');
      
      // Set about:blank first to initialize the webview, then navigate
      tab.webview.src = 'about:blank';
      
      // Wait for the webview to be ready, then load the actual URL
      tab.webview.addEventListener('dom-ready', () => {
        console.log('[Favorites] dom-ready fired, now loading:', url);
        tab.webview.src = url;
        tab.url = url;
        this.urlInput.value = url;
      }, { once: true });
    }
  }
};

export default FavoritesMixin;
