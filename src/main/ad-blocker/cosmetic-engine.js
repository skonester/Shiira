/**
 * Cosmetic Engine - Manages CSS selectors for hiding ad elements
 * Similar to uBlock Origin Lite's cosmetic filtering approach
 */

const fs = require('fs');
const path = require('path');

class CosmeticEngine {
  constructor() {
    // Generic selectors - applied to all sites
    this.genericSelectors = new Set();
    
    // Site-specific selectors - Map<hostname, Set<selector>>
    this.specificSelectors = new Map();
    
    // Site-specific extra CSS rules (raw CSS) - Map<hostname, Array<string>>
    this.extraRules = new Map();
    
    // Exception domains - don't apply generic selectors to these
    this.exceptionDomains = new Set();
    
    // Stats
    this.stats = {
      genericCount: 0,
      specificCount: 0,
      exceptionsCount: 0,
      extraRulesCount: 0
    };
  }

  /**
   * Load cosmetic rules from JSON file
   * @param {string} filterListPath - Path to the filter list JSON file
   */
  loadFilterList(filterListPath) {
    try {
      const data = fs.readFileSync(filterListPath, 'utf8');
      const filterList = JSON.parse(data);
      
      // Load generic selectors (apply to all sites)
      if (filterList.generic && Array.isArray(filterList.generic)) {
        for (const selector of filterList.generic) {
          if (this.isValidSelector(selector)) {
            this.genericSelectors.add(selector);
          }
        }
      }
      
      // Load site-specific selectors
      if (filterList.specific && typeof filterList.specific === 'object') {
        for (const [domain, selectors] of Object.entries(filterList.specific)) {
          // Handle extra rules (raw CSS strings)
          if (domain.endsWith(':extraRules')) {
            const baseDomain = domain.replace(':extraRules', '');
            if (!this.extraRules.has(baseDomain)) {
              this.extraRules.set(baseDomain, []);
            }
            if (Array.isArray(selectors)) {
              this.extraRules.get(baseDomain).push(...selectors);
            }
            continue;
          }
          
          if (!this.specificSelectors.has(domain)) {
            this.specificSelectors.set(domain, new Set());
          }
          const domainSelectors = this.specificSelectors.get(domain);
          
          if (Array.isArray(selectors)) {
            for (const selector of selectors) {
              if (this.isValidSelector(selector)) {
                domainSelectors.add(selector);
              }
            }
          }
        }
      }
      
      // Load exception domains (don't apply generic selectors)
      if (filterList.exceptions && Array.isArray(filterList.exceptions)) {
        for (const domain of filterList.exceptions) {
          this.exceptionDomains.add(domain.toLowerCase());
        }
      }
      
      this.updateStats();
      console.log(`[Cosmetic Engine] Loaded filter list: ${filterListPath}`);
      console.log(`[Cosmetic Engine] Generic: ${this.stats.genericCount}, Specific domains: ${this.stats.specificCount}, Exceptions: ${this.stats.exceptionsCount}, Extra rules: ${this.stats.extraRulesCount}`);
      
      return true;
    } catch (error) {
      console.error(`[Cosmetic Engine] Error loading filter list: ${error.message}`);
      return false;
    }
  }

  /**
   * Basic selector validation
   * @param {string} selector - CSS selector to validate
   * @returns {boolean}
   */
  isValidSelector(selector) {
    if (!selector || typeof selector !== 'string') {
      return false;
    }
    
    // Trim and check for empty
    const trimmed = selector.trim();
    if (trimmed.length === 0) {
      return false;
    }
    
    // Basic validation - selector should start with valid characters
    // This is a simplified check - real CSS validation is complex
    const validStart = /^[.#\[\w*:]/;
    return validStart.test(trimmed);
  }

  /**
   * Extract hostname from URL
   * @param {string} url - URL to parse
   * @returns {string} hostname
   */
  getHostname(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * Check if domain matches (including subdomains)
   * @param {string} hostname - Page hostname
   * @param {string} domain - Domain to match
   * @returns {boolean}
   */
  domainMatches(hostname, domain) {
    if (hostname === domain) {
      return true;
    }
    // Check if hostname is a subdomain of domain
    return hostname.endsWith('.' + domain);
  }

  /**
   * Check if hostname is in exception list
   * @param {string} hostname - Hostname to check
   * @returns {boolean}
   */
  isExceptionDomain(hostname) {
    for (const exceptionDomain of this.exceptionDomains) {
      if (this.domainMatches(hostname, exceptionDomain)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get CSS selectors applicable to a URL
   * @param {string} url - Page URL
   * @returns {Object} { css: string, selectorCount: number }
   */
  getSelectorsForUrl(url) {
    const hostname = this.getHostname(url);
    if (!hostname) {
      return { css: '', selectorCount: 0 };
    }

    const selectors = new Set();
    const extraCSSRules = [];

    // Add generic selectors (unless domain is in exceptions)
    if (!this.isExceptionDomain(hostname)) {
      for (const selector of this.genericSelectors) {
        selectors.add(selector);
      }
    }

    // Add site-specific selectors
    for (const [domain, domainSelectors] of this.specificSelectors) {
      if (this.domainMatches(hostname, domain)) {
        for (const selector of domainSelectors) {
          selectors.add(selector);
        }
      }
    }
    
    // Add site-specific extra CSS rules (raw CSS)
    for (const [domain, rules] of this.extraRules) {
      if (this.domainMatches(hostname, domain)) {
        extraCSSRules.push(...rules);
      }
    }

    if (selectors.size === 0 && extraCSSRules.length === 0) {
      return { css: '', selectorCount: 0 };
    }

    // Generate CSS to hide matched elements
    const selectorArray = Array.from(selectors);
    let css = this.generateHideCSS(selectorArray);
    
    // Append extra CSS rules
    if (extraCSSRules.length > 0) {
      css += '\n\n/* Extra Rules */\n' + extraCSSRules.join('\n');
    }
    
    return {
      css,
      selectorCount: selectors.size + extraCSSRules.length
    };
  }

  /**
   * Generate CSS to hide elements
   * @param {string[]} selectors - Array of CSS selectors
   * @returns {string} CSS string
   */
  generateHideCSS(selectors) {
    if (selectors.length === 0) {
      return '';
    }

    // Split into chunks to avoid CSS limits
    // Some browsers have limits on selector list length
    const chunkSize = 100;
    const cssRules = [];

    for (let i = 0; i < selectors.length; i += chunkSize) {
      const chunk = selectors.slice(i, i + chunkSize);
      const selectorList = chunk.join(',\n');
      cssRules.push(`${selectorList} { display: none !important; }`);
    }

    return cssRules.join('\n\n');
  }

  /**
   * Update statistics
   */
  updateStats() {
    this.stats.genericCount = this.genericSelectors.size;
    this.stats.specificCount = this.specificSelectors.size;
    this.stats.exceptionsCount = this.exceptionDomains.size;
    this.stats.extraRulesCount = Array.from(this.extraRules.values()).reduce((sum, arr) => sum + arr.length, 0);
  }

  /**
   * Get engine statistics
   * @returns {Object}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Clear all loaded rules
   */
  clear() {
    this.genericSelectors.clear();
    this.specificSelectors.clear();
    this.extraRules.clear();
    this.exceptionDomains.clear();
    this.updateStats();
  }
}

module.exports = { CosmeticEngine };
