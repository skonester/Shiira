/**
 * Cosmetic Injector - Handles CSS injection into webviews
 * Works with Electron's webview insertCSS API
 */

const path = require('path');
const { CosmeticEngine } = require('./cosmetic-engine');

class CosmeticInjector {
  constructor() {
    this.engine = new CosmeticEngine();
    this.enabled = true;
    this.filterListsDir = null;
    this.injectedCSS = new Map(); // Map<webviewId, cssKey>
    
    // Stats tracking
    this.stats = {
      totalInjections: 0,
      selectorsApplied: 0
    };
  }

  /**
   * Initialize the cosmetic injector
   * @param {string} filterListsDir - Directory containing filter lists
   * @param {string[]} filterLists - Array of filter list names to load
   */
  init(filterListsDir, filterLists = ['cosmetic-default']) {
    this.filterListsDir = filterListsDir;
    
    // Load each filter list
    for (const listName of filterLists) {
      const listPath = path.join(filterListsDir, `${listName}.json`);
      this.engine.loadFilterList(listPath);
    }

    console.log('[Cosmetic Injector] Initialized');
    return this.engine.getStats();
  }

  /**
   * Get CSS to inject for a specific URL
   * @param {string} url - The page URL
   * @returns {Object} { css: string, selectorCount: number }
   */
  getCSSForUrl(url) {
    if (!this.enabled) {
      return { css: '', selectorCount: 0 };
    }

    return this.engine.getSelectorsForUrl(url);
  }

  /**
   * Enable or disable cosmetic filtering
   * @param {boolean} enabled 
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[Cosmetic Injector] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Check if cosmetic filtering is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Track an injection
   * @param {number} selectorCount - Number of selectors applied
   */
  trackInjection(selectorCount) {
    this.stats.totalInjections++;
    this.stats.selectorsApplied += selectorCount;
  }

  /**
   * Get injection statistics
   * @returns {Object}
   */
  getStats() {
    return {
      enabled: this.enabled,
      engine: this.engine.getStats(),
      injections: { ...this.stats }
    };
  }

  /**
   * Reload filter lists
   */
  reload() {
    this.engine.clear();
    this.stats = {
      totalInjections: 0,
      selectorsApplied: 0
    };
    
    if (this.filterListsDir) {
      this.engine.loadFilterList(
        path.join(this.filterListsDir, 'cosmetic-default.json')
      );
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get the cosmetic injector singleton
 * @returns {CosmeticInjector}
 */
function getCosmeticInjector() {
  if (!instance) {
    instance = new CosmeticInjector();
  }
  return instance;
}

module.exports = { CosmeticInjector, getCosmeticInjector };
