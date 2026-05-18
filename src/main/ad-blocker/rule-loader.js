/**
 * Shiira Browser Ad-Blocker Rule Loader
 * Loads and parses DNR-style rulesets from uBlock Origin Lite format
 */

const fs = require('fs');
const path = require('path');

class RuleLoader {
  constructor() {
    this.rulesets = new Map();
    this.rulesDir = null;
  }

  /**
   * Initialize with the path to the rulesets directory
   * @param {string} rulesDir - Path to directory containing ruleset JSON files
   */
  init(rulesDir) {
    this.rulesDir = rulesDir;
    console.log(`[AdBlocker] Rule loader initialized with path: ${rulesDir}`);
  }

  /**
   * Load all enabled rulesets
   * @param {Array<string>} enabledSets - List of ruleset IDs to enable (e.g., ['easylist', 'easyprivacy'])
   * @returns {Promise<Array>} - Combined array of all rules
   */
  async loadRulesets(enabledSets = ['default']) {
    const allRules = [];
    
    for (const setId of enabledSets) {
      try {
        const rules = await this.loadRuleset(setId);
        allRules.push(...rules);
        console.log(`[AdBlocker] Loaded ruleset '${setId}': ${rules.length} rules`);
      } catch (error) {
        console.warn(`[AdBlocker] Failed to load ruleset '${setId}':`, error.message);
      }
    }

    // Sort rules by priority (higher priority = checked first)
    allRules.sort((a, b) => (b.priority || 1) - (a.priority || 1));
    
    console.log(`[AdBlocker] Total rules loaded: ${allRules.length}`);
    return allRules;
  }

  /**
   * Load a single ruleset by ID
   * @param {string} setId - Ruleset ID (filename without .json)
   * @returns {Promise<Array>} - Array of rules
   */
  async loadRuleset(setId) {
    if (!this.rulesDir) {
      throw new Error('Rule loader not initialized. Call init() first.');
    }

    const filePath = path.join(this.rulesDir, `${setId}.json`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Ruleset file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const rules = JSON.parse(content);
    
    // Validate rules array
    if (!Array.isArray(rules)) {
      throw new Error(`Invalid ruleset format in ${setId}: expected array`);
    }

    // Add source info to each rule for debugging
    return rules.map(rule => ({
      ...rule,
      _source: setId
    }));
  }

  /**
   * Get list of available rulesets
   * @returns {Array<Object>} - Array of { id, name, path }
   */
  getAvailableRulesets() {
    if (!this.rulesDir || !fs.existsSync(this.rulesDir)) {
      return [];
    }

    const files = fs.readdirSync(this.rulesDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        id: f.replace('.json', ''),
        name: this.formatRulesetName(f.replace('.json', '')),
        path: path.join(this.rulesDir, f)
      }));
  }

  /**
   * Format ruleset ID into human-readable name
   */
  formatRulesetName(id) {
    const names = {
      'default': 'Default Rules',
      'easylist': 'EasyList',
      'easyprivacy': 'EasyPrivacy',
      'ublock-filters': 'uBlock Filters',
      'ublock-badware': 'uBlock Badware',
      'ublock-privacy': 'uBlock Privacy',
      'ublock-quick-fixes': 'uBlock Quick Fixes',
      'ublock-unbreak': 'uBlock Unbreak',
      'urlhaus-1': 'URLhaus Malware',
      'plowe-0': 'Peter Lowe\'s Ad List',
      'annoyances-cookies': 'Cookie Notices',
      'annoyances-others': 'Other Annoyances',
      'annoyances-overlays': 'Overlays & Popups',
      'annoyances-social': 'Social Media Widgets'
    };
    return names[id] || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Create optimized rules from the loaded data
   * Pre-compiles patterns for faster matching
   * @param {Array} rules - Raw rules array
   * @returns {Array} - Optimized rules
   */
  optimizeRules(rules) {
    return rules.map(rule => {
      const optimized = { ...rule };
      
      // Pre-compile regex filters
      if (rule.condition?.regexFilter) {
        try {
          optimized._compiledRegex = new RegExp(rule.condition.regexFilter, 'i');
        } catch (e) {
          console.warn(`[AdBlocker] Invalid regex in rule ${rule.id}: ${rule.condition.regexFilter}`);
        }
      }
      
      // Pre-process domain lists to lowercase
      if (rule.condition?.requestDomains) {
        optimized.condition.requestDomains = rule.condition.requestDomains.map(d => d.toLowerCase());
      }
      if (rule.condition?.initiatorDomains) {
        optimized.condition.initiatorDomains = rule.condition.initiatorDomains.map(d => d.toLowerCase());
      }
      if (rule.condition?.excludedRequestDomains) {
        optimized.condition.excludedRequestDomains = rule.condition.excludedRequestDomains.map(d => d.toLowerCase());
      }
      if (rule.condition?.excludedInitiatorDomains) {
        optimized.condition.excludedInitiatorDomains = rule.condition.excludedInitiatorDomains.map(d => d.toLowerCase());
      }
      
      return optimized;
    });
  }

  /**
   * Get statistics about loaded rules
   */
  getRuleStats(rules) {
    const stats = {
      total: rules.length,
      byAction: {},
      bySource: {},
      withUrlFilter: 0,
      withRegexFilter: 0,
      withDomainConditions: 0
    };

    for (const rule of rules) {
      // Count by action
      const action = rule.action?.type || 'unknown';
      stats.byAction[action] = (stats.byAction[action] || 0) + 1;
      
      // Count by source
      const source = rule._source || 'unknown';
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
      
      // Count filter types
      if (rule.condition?.urlFilter) stats.withUrlFilter++;
      if (rule.condition?.regexFilter) stats.withRegexFilter++;
      if (rule.condition?.requestDomains || rule.condition?.initiatorDomains) {
        stats.withDomainConditions++;
      }
    }

    return stats;
  }
}

module.exports = { RuleLoader };
