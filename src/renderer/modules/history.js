// Shiira Browser - History Module
// Manages browsing history storage and UI

import { escapeHtml } from './utils.js';

/**
 * History Manager Mixin
 * Adds history functionality to ShiiraBrowser
 */
export const HistoryMixin = {
  /**
   * Load browsing history from storage
   */
  loadBrowsingHistory() {
    try {
      const saved = localStorage.getItem('shiira-history');
      if (saved) {
        this.browsingHistory = JSON.parse(saved);
        console.log('Loaded', this.browsingHistory.length, 'history entries');
      }
    } catch (e) {
      console.error('Failed to load history:', e);
      this.browsingHistory = [];
    }
  },

  /**
   * Save browsing history to storage
   */
  saveBrowsingHistory() {
    try {
      // Keep only last 1000 entries
      if (this.browsingHistory.length > 1000) {
        this.browsingHistory = this.browsingHistory.slice(-1000);
      }
      localStorage.setItem('shiira-history', JSON.stringify(this.browsingHistory));
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  },

  /**
   * Add entry to browsing history
   * @param {string} url - URL visited
   * @param {string} title - Page title
   * @param {string} favicon - Favicon URL
   */
  addToHistory(url, title, favicon) {
    // Don't add duplicates of the last entry
    if (this.browsingHistory.length > 0) {
      const last = this.browsingHistory[this.browsingHistory.length - 1];
      if (last.url === url) {
        // Update title and favicon if they changed
        if (title && title !== 'New Tab') last.title = title;
        if (favicon) last.favicon = favicon;
        this.saveBrowsingHistory();
        return;
      }
    }
    
    console.log('Adding to history:', url, title);
    
    this.browsingHistory.push({
      url,
      title: title || url,
      favicon: favicon || null,
      timestamp: Date.now()
    });
    
    console.log('History now has', this.browsingHistory.length, 'entries');
    this.saveBrowsingHistory();
  },

  /**
   * Show history panel
   */
  showHistoryPanel() {
    this.historyPanel.classList.remove('hidden');
    this.historySearch.value = '';
    this.renderHistoryList();
    this.historySearch.focus();
  },

  /**
   * Hide history panel
   */
  hideHistoryPanel() {
    this.historyPanel.classList.add('hidden');
  },

  /**
   * Filter history based on search input
   */
  filterHistory() {
    this.renderHistoryList(this.historySearch.value.toLowerCase());
  },

  /**
   * Render history list
   * @param {string} filter - Search filter
   */
  renderHistoryList(filter = '') {
    // Reverse to show newest first
    let items = [...this.browsingHistory].reverse();
    
    if (filter) {
      items = items.filter(item => 
        item.url.toLowerCase().includes(filter) || 
        (item.title && item.title.toLowerCase().includes(filter))
      );
    }
    
    // Group by date
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    items.forEach(item => {
      const date = new Date(item.timestamp);
      let groupKey;
      
      if (date.toDateString() === today) {
        groupKey = 'Today';
      } else if (date.toDateString() === yesterday) {
        groupKey = 'Yesterday';
      } else {
        groupKey = date.toLocaleDateString(undefined, { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(item);
    });
    
    // Render
    let html = '';
    
    for (const [date, dateItems] of Object.entries(groups)) {
      html += `<div class="history-date-group">
        <div class="history-date-header">${date}</div>`;
      
      dateItems.forEach(item => {
        const time = new Date(item.timestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        });
        
        // Try to get favicon from item, then from cache, then use default
        let faviconSrc = item.favicon;
        if (!faviconSrc && this.getCachedFavicon) {
          faviconSrc = this.getCachedFavicon(item.url);
        }
        if (!faviconSrc) {
          faviconSrc = 'shiira-asset://ui-icons/globe.svg';
        }
        
        html += `
          <div class="history-item" data-url="${escapeHtml(item.url)}">
            <img class="history-favicon" src="${escapeHtml(faviconSrc)}" 
                 onerror="this.src='shiira-asset://ui-icons/globe.svg'">
            <div class="history-item-content">
              <div class="history-title">${escapeHtml(item.title || item.url)}</div>
              <div class="history-url">${escapeHtml(item.url)}</div>
            </div>
            <div class="history-time">${time}</div>
            <button class="history-delete" data-url="${escapeHtml(item.url)}" title="Remove from history">
              <img src="shiira-asset://ui-icons/delete.svg" alt="Delete">
            </button>
          </div>`;
      });
      
      html += '</div>';
    }
    
    if (html === '') {
      html = '<div class="history-empty">No history found</div>';
    }
    
    this.historyList.innerHTML = html;
    
    // Add click handlers
    this.historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.history-delete')) {
          const url = item.dataset.url;
          this.createTab(url);
          this.hideHistoryPanel();
        }
      });
    });
    
    this.historyList.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        this.removeFromHistory(url);
      });
    });
  },

  /**
   * Remove entry from history
   * @param {string} url - URL to remove
   */
  removeFromHistory(url) {
    this.browsingHistory = this.browsingHistory.filter(item => item.url !== url);
    this.saveBrowsingHistory();
    this.filterHistory();
  },

  /**
   * Update favicon in history for a URL
   * @param {string} url - URL to update
   * @param {string} faviconUrl - New favicon URL
   */
  updateHistoryFavicon(url, faviconUrl) {
    const entries = this.browsingHistory.filter(item => item.url === url);
    entries.forEach(entry => {
      entry.favicon = faviconUrl;
    });
    if (entries.length > 0) {
      this.saveBrowsingHistory();
    }
  },

  /**
   * Clear all history
   */
  async clearHistory() {
    const confirmed = await this.showConfirmation(
      'Clear All History',
      'Are you sure you want to clear all browsing history?\n\nThis action cannot be undone!',
      { danger: true, confirmText: 'Clear All' }
    );
    
    if (confirmed) {
      this.browsingHistory = [];
      this.saveBrowsingHistory();
      this.renderHistoryList();
      await this.showSuccess('Browsing history has been cleared.');
    }
  }
};

export default HistoryMixin;
