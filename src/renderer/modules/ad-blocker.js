// Shiira Browser - Ad Blocker Module
// Handles ad blocking, cosmetic filtering, and script injection

import { isInternalUrl, formatCount } from './utils.js';

/**
 * Ad Blocker Mixin
 * Adds ad blocking functionality to ShiiraBrowser
 */
export const AdBlockerMixin = {
  /**
   * Initialize ad blocker
   */
  async initAdBlocker() {
    try {
      // Use the correct API - adBlocker.getStatus()
      const status = await window.shiiraAPI.adBlocker.getStatus();
      this.adblockEnabled = status.enabled !== false; // Default to true
      this.adblockBlockedCount = 0;
      this.updateAdBlockerUI();
      await this.updateAdBlockerStats();
    } catch (e) {
      // If API fails, default to enabled and update UI
      console.error('Failed to initialize ad blocker:', e);
      this.adblockEnabled = true;
      this.adblockBlockedCount = 0;
      this.updateAdBlockerUI();
    }
  },

  /**
   * Update ad blocker UI state
   */
  updateAdBlockerUI() {
    if (this.adblockToggle) {
      if (this.adblockEnabled) {
        this.adblockToggle.classList.add('active');
      } else {
        this.adblockToggle.classList.remove('active');
      }
    }
  },

  /**
   * Update ad blocker statistics display
   */
  async updateAdBlockerStats() {
    try {
      const stats = await window.shiiraAPI.adBlocker.getStats();
      if (this.adblockStats) {
        this.adblockStats.textContent = `${formatCount(stats.blocked || 0)} ads blocked`;
      }
    } catch (e) {
      console.error('Failed to get ad block stats:', e);
    }
  },

  /**
   * Format block count for display
   * @param {number} count - Number to format
   * @returns {string} Formatted count
   */
  formatBlockCount(count) {
    return formatCount(count);
  },

  /**
   * Toggle ad blocker on/off
   */
  async toggleAdBlocker() {
    this.adblockEnabled = !this.adblockEnabled;
    this.updateAdBlockerUI();
    
    // Use the correct API
    await window.shiiraAPI.adBlocker.setEnabled(this.adblockEnabled);
    
    // Reload current tab if needed
    if (this.activeTabId) {
      const tab = this.tabs.find(t => t.id === this.activeTabId);
      if (tab && tab.webview) {
        tab.webview.reload();
      }
    }
  },

  /**
   * Inject cosmetic CSS to hide ad elements
   * @param {HTMLWebViewElement} webview - The webview element
   * @param {string} url - The URL of the page
   */
  async injectCosmeticCSS(webview, url) {
    if (!this.adblockEnabled) {
      return;
    }
    
    if (isInternalUrl(url)) {
      return;
    }
    
    try {
      const result = await window.shiiraAPI.cosmeticFilter.getCSS(url);
      
      if (result && result.css && result.selectorCount > 0) {
        await webview.insertCSS(result.css);
        console.log(`[Cosmetic] Injected ${result.selectorCount} selectors for ${new URL(url).hostname}`);
      }
    } catch (e) {
      console.error('[Cosmetic] Failed to inject CSS:', e);
    }
  },

  /**
   * Inject ad-blocking script for specific sites (YouTube, etc.)
   * @param {HTMLWebViewElement} webview - The webview element
   * @param {string} url - The URL of the page
   */
  async injectAdBlockScript(webview, url) {
    if (!this.adblockEnabled) {
      return;
    }
    
    if (isInternalUrl(url)) {
      return;
    }
    
    try {
      const result = await window.shiiraAPI.scriptInjector.getScript(url);
      
      if (result && result.script) {
        await webview.executeJavaScript(result.script, true);
        console.log(`[Script] Injected script for ${result.site}`);
      }
    } catch (e) {
      // Script injection can fail if page is still loading, which is fine
      if (!e.message?.includes('Script failed to execute')) {
        console.error('[Script] Failed to inject:', e.message);
      }
    }
  },

  /**
   * Update ad counter display for current tab
   * @param {number} count - Number of ads blocked
   */
  updateAdCounter(count) {
    if (this.adCounterValue) {
      this.adCounterValue.textContent = count;
    }
    if (this.adCounter) {
      this.adCounter.style.display = count > 0 ? 'flex' : 'none';
    }
  }
};

export default AdBlockerMixin;
