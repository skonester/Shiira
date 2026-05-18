/**
 * Shiira Browser Ad-Blocker Rule Engine
 * Matches network requests against DNR-style rules
 */

class RuleEngine {
  constructor() {
    this.rules = [];
    this.blockRules = [];
    this.allowRules = [];
    this.redirectRules = [];
    this.enabled = true;
    this.stats = {
      blocked: 0,
      allowed: 0,
      total: 0
    };
  }

  /**
   * Load rules from parsed ruleset
   * @param {Array} rules - Array of DNR-style rules
   */
  loadRules(rules) {
    this.rules = rules;
    
    // Separate rules by action type for faster matching
    this.blockRules = rules.filter(r => r.action?.type === 'block');
    this.allowRules = rules.filter(r => r.action?.type === 'allow');
    this.redirectRules = rules.filter(r => r.action?.type === 'redirect');
    
    console.log(`[AdBlocker] Loaded ${this.rules.length} rules:`);
    console.log(`  - Block rules: ${this.blockRules.length}`);
    console.log(`  - Allow rules: ${this.allowRules.length}`);
    console.log(`  - Redirect rules: ${this.redirectRules.length}`);
  }

  /**
   * Check if a request should be blocked
   * @param {Object} details - Request details
   * @returns {Object} { action: 'block'|'allow'|'redirect', rule?: Object }
   */
  shouldBlock(details) {
    if (!this.enabled) {
      return { action: 'allow' };
    }

    this.stats.total++;
    
    const { url, resourceType, initiator } = details;
    
    // Parse URLs
    let requestUrl, initiatorUrl;
    try {
      requestUrl = new URL(url);
    } catch (e) {
      return { action: 'allow' };
    }
    
    try {
      initiatorUrl = initiator ? new URL(initiator) : null;
    } catch (e) {
      initiatorUrl = null;
    }

    const requestDomain = requestUrl.hostname;
    const initiatorDomain = initiatorUrl?.hostname || '';
    
    // Check domain type (first-party vs third-party)
    const isThirdParty = initiatorDomain && 
      !this.isSameDomain(requestDomain, initiatorDomain);

    // First check allow rules (higher priority)
    for (const rule of this.allowRules) {
      if (this.matchRule(rule, {
        url: requestUrl,
        resourceType,
        requestDomain,
        initiatorDomain,
        isThirdParty
      })) {
        this.stats.allowed++;
        return { action: 'allow', rule };
      }
    }

    // Then check block rules
    for (const rule of this.blockRules) {
      if (this.matchRule(rule, {
        url: requestUrl,
        resourceType,
        requestDomain,
        initiatorDomain,
        isThirdParty
      })) {
        this.stats.blocked++;
        return { action: 'block', rule };
      }
    }

    return { action: 'allow' };
  }

  /**
   * Check if a rule matches the request
   */
  matchRule(rule, details) {
    const { condition } = rule;
    if (!condition) return false;

    const { url, resourceType, requestDomain, initiatorDomain, isThirdParty } = details;

    // Check domainType (firstParty/thirdParty)
    if (condition.domainType) {
      if (condition.domainType === 'thirdParty' && !isThirdParty) return false;
      if (condition.domainType === 'firstParty' && isThirdParty) return false;
    }

    // Check resourceTypes
    if (condition.resourceTypes && condition.resourceTypes.length > 0) {
      const mappedType = this.mapResourceType(resourceType);
      if (!condition.resourceTypes.includes(mappedType)) return false;
    }

    // Check requestDomains (the domain being requested)
    if (condition.requestDomains && condition.requestDomains.length > 0) {
      if (!this.matchesDomainList(requestDomain, condition.requestDomains)) return false;
    }

    // Check excludedRequestDomains
    if (condition.excludedRequestDomains && condition.excludedRequestDomains.length > 0) {
      if (this.matchesDomainList(requestDomain, condition.excludedRequestDomains)) return false;
    }

    // Check initiatorDomains (the page making the request)
    if (condition.initiatorDomains && condition.initiatorDomains.length > 0) {
      if (!initiatorDomain) return false;
      if (!this.matchesDomainList(initiatorDomain, condition.initiatorDomains)) return false;
    }

    // Check excludedInitiatorDomains
    if (condition.excludedInitiatorDomains && condition.excludedInitiatorDomains.length > 0) {
      if (initiatorDomain && this.matchesDomainList(initiatorDomain, condition.excludedInitiatorDomains)) return false;
    }

    // Check urlFilter
    if (condition.urlFilter) {
      if (!this.matchUrlFilter(url.href, condition.urlFilter)) return false;
    }

    // Check regexFilter
    if (condition.regexFilter) {
      try {
        const regex = new RegExp(condition.regexFilter, 'i');
        if (!regex.test(url.href)) return false;
      } catch (e) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match URL against urlFilter pattern
   * Supports: ||domain^, |url, ^separator, *wildcard
   */
  matchUrlFilter(url, filter) {
    let pattern = filter;
    const urlLower = url.toLowerCase();
    
    // || = domain anchor (matches domain or subdomain)
    if (pattern.startsWith('||')) {
      pattern = pattern.slice(2);
      const domainPattern = pattern.split(/[\^\/\*\?]/)[0];
      
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        
        // Check if domain matches
        if (!hostname.endsWith(domainPattern) && hostname !== domainPattern) {
          // Check subdomain
          if (!hostname.endsWith('.' + domainPattern)) {
            return false;
          }
        }
        
        // Continue matching the rest of the pattern
        const restPattern = pattern.slice(domainPattern.length);
        if (restPattern) {
          const urlPath = urlObj.pathname + urlObj.search;
          return this.matchFilterPattern(urlPath, restPattern);
        }
        return true;
      } catch (e) {
        return false;
      }
    }
    
    // | at start = anchor to start
    if (pattern.startsWith('|')) {
      pattern = pattern.slice(1);
      return this.matchFilterPattern(urlLower, pattern, true, false);
    }
    
    // | at end = anchor to end
    if (pattern.endsWith('|')) {
      pattern = pattern.slice(0, -1);
      return this.matchFilterPattern(urlLower, pattern, false, true);
    }
    
    // Regular pattern matching
    return this.matchFilterPattern(urlLower, pattern);
  }

  /**
   * Match a filter pattern with wildcards and separators
   */
  matchFilterPattern(text, pattern, anchorStart = false, anchorEnd = false) {
    // Convert filter pattern to regex
    let regexStr = pattern
      .replace(/[.+?{}()[\]\\]/g, '\\$&')  // Escape regex special chars (except * and ^)
      .replace(/\*/g, '.*')                 // * = any characters
      .replace(/\^/g, '([^a-zA-Z0-9_.%-]|$)'); // ^ = separator character
    
    if (anchorStart) regexStr = '^' + regexStr;
    if (anchorEnd) regexStr = regexStr + '$';
    
    try {
      const regex = new RegExp(regexStr, 'i');
      return regex.test(text);
    } catch (e) {
      return text.includes(pattern.replace(/[\*\^]/g, ''));
    }
  }

  /**
   * Check if a domain matches a list of domains
   */
  matchesDomainList(domain, domainList) {
    const domainLower = domain.toLowerCase();
    
    for (const listDomain of domainList) {
      const listDomainLower = listDomain.toLowerCase();
      
      // Exact match
      if (domainLower === listDomainLower) return true;
      
      // Subdomain match (e.g., "ads.google.com" matches "google.com")
      if (domainLower.endsWith('.' + listDomainLower)) return true;
    }
    
    return false;
  }

  /**
   * Check if two domains are the same (for first-party check)
   */
  isSameDomain(domain1, domain2) {
    // Extract base domain (simplified - could use public suffix list for accuracy)
    const getBaseDomain = (domain) => {
      const parts = domain.toLowerCase().split('.');
      if (parts.length <= 2) return domain.toLowerCase();
      // Handle common TLDs like .co.uk, .com.au
      const commonSlds = ['co', 'com', 'net', 'org', 'gov', 'edu'];
      if (parts.length >= 3 && commonSlds.includes(parts[parts.length - 2])) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    };
    
    return getBaseDomain(domain1) === getBaseDomain(domain2);
  }

  /**
   * Map Electron's resource type to DNR resource type
   */
  mapResourceType(electronType) {
    const mapping = {
      'mainFrame': 'main_frame',
      'subFrame': 'sub_frame',
      'stylesheet': 'stylesheet',
      'script': 'script',
      'image': 'image',
      'font': 'font',
      'object': 'object',
      'xhr': 'xmlhttprequest',
      'ping': 'ping',
      'cspReport': 'csp_report',
      'media': 'media',
      'webSocket': 'websocket',
      'other': 'other'
    };
    return mapping[electronType] || 'other';
  }

  /**
   * Get blocking statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = { blocked: 0, allowed: 0, total: 0 };
  }

  /**
   * Enable/disable the rule engine
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

module.exports = { RuleEngine };
