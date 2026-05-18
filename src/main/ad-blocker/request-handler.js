/**
 * Shiira Browser Ad-Blocker Request Handler
 * Integrates aggressive Ghostery blocking with bundled fallback rules.
 */

const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { RuleLoader } = require('./rule-loader');
const { RuleEngine } = require('./rule-engine');

class RequestHandler {
  constructor() {
    this.ruleLoader = new RuleLoader();
    this.ruleEngine = new RuleEngine();
    this.initialized = false;
    this.enabledRulesets = ['default'];
    this.ghosteryBlocker = null;
    this.ghosteryContexts = [];
    this.ghosteryEnabled = false;
    this.usingLocalNetworkHook = false;
  }

  /**
   * Initialize the ad-blocker.
   * @param {string} rulesDir - Path to directory containing ruleset files.
   * @param {Object} options - Configuration options.
   */
  async init(rulesDir, options = {}) {
    console.log('[AdBlocker] Initializing...');

    if (options.enabledRulesets) {
      this.enabledRulesets = options.enabledRulesets;
    }

    this.ruleLoader.init(rulesDir);

    try {
      const rules = await this.ruleLoader.loadRulesets(this.enabledRulesets);
      const optimizedRules = this.ruleLoader.optimizeRules(rules);
      this.ruleEngine.loadRules(optimizedRules);

      const stats = this.ruleLoader.getRuleStats(optimizedRules);
      console.log('[AdBlocker] Bundled rule statistics:', stats);
    } catch (error) {
      console.error('[AdBlocker] Failed to load bundled rules:', error);
    }

    const ghosteryReady = await this.setupGhosteryBlocker();
    if (!ghosteryReady) {
      this.setupBundledRequestInterception();
    }

    this.initialized = true;
    console.log('[AdBlocker] Initialization complete');
  }

  async setupGhosteryBlocker() {
    if (this.ghosteryBlocker) {
      this.enableGhosteryContexts();
      return true;
    }

    try {
      if (typeof fetch !== 'function') {
        throw new Error('global fetch is unavailable');
      }

      const cachePath = path.join(app.getPath('userData'), 'ghostery-adblock-engine.bin');
      this.ghosteryBlocker = await ElectronBlocker.fromPrebuiltFull(fetch, {
        path: cachePath,
        read: fs.promises.readFile,
        write: fs.promises.writeFile
      });

      this.enableGhosteryContexts();
      console.log('[AdBlocker] Ghostery full engine enabled for ads, tracking, and annoyances');
      return true;
    } catch (error) {
      console.warn('[AdBlocker] Ghostery engine unavailable, falling back to bundled rules:', error.message);
      this.ghosteryBlocker = null;
      this.ghosteryContexts = [];
      this.ghosteryEnabled = false;
      return false;
    }
  }

  enableGhosteryContexts() {
    if (!this.ghosteryBlocker || this.ghosteryEnabled) return;

    const sessions = [
      session.defaultSession,
      session.fromPartition('persist:main')
    ];

    this.ghosteryContexts = sessions.map(activeSession =>
      this.ghosteryBlocker.enableBlockingInSession(activeSession)
    );
    this.ghosteryEnabled = true;
  }

  disableGhosteryContexts() {
    if (!this.ghosteryBlocker || !this.ghosteryEnabled) return;

    for (const activeSession of [session.defaultSession, session.fromPartition('persist:main')]) {
      if (this.ghosteryBlocker.isBlockingEnabled(activeSession)) {
        this.ghosteryBlocker.disableBlockingInSession(activeSession);
      }
    }

    this.ghosteryContexts = [];
    this.ghosteryEnabled = false;
  }

  /**
   * Fallback Electron webRequest hook for bundled DNR-style rules.
   */
  setupBundledRequestInterception() {
    console.log('[RequestHandler] Setting up bundled traffic analyzer hook...');
    this.usingLocalNetworkHook = true;

    const requestHandler = (details, callback) => {
      if (details.url.startsWith('chrome-extension://') ||
          details.url.startsWith('devtools://') ||
          details.url.startsWith('file://')) {
        callback({});
        return;
      }

      const result = this.ruleEngine.shouldBlock({
        url: details.url,
        resourceType: details.resourceType,
        initiator: details.referrer || details.initiatorUrl || details.url
      });

      if (result.action === 'block') {
        if (process.env.SHIIRA_DEBUG === 'true') {
          console.log(`[AdBlocker] Blocked: ${details.url.substring(0, 80)}...`);
        }
        callback({ cancel: true });
      } else {
        callback({});
      }
    };

    session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, requestHandler);
    session.fromPartition('persist:main').webRequest.onBeforeRequest({ urls: ['*://*/*'] }, requestHandler);
    console.log('[AdBlocker] Bundled request interception enabled');
  }

  getStats() {
    return {
      ...this.ruleEngine.getStats(),
      aggressiveEngine: this.ghosteryEnabled ? 'ghostery-full' : 'bundled-rules',
      localNetworkHook: this.usingLocalNetworkHook
    };
  }

  resetStats() {
    this.ruleEngine.resetStats();
  }

  setEnabled(enabled) {
    this.ruleEngine.setEnabled(enabled);
    if (enabled) {
      this.enableGhosteryContexts();
    } else {
      this.disableGhosteryContexts();
    }
    console.log(`[AdBlocker] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  isEnabled() {
    return this.ruleEngine.enabled || this.ghosteryEnabled;
  }

  getAvailableRulesets() {
    return this.ruleLoader.getAvailableRulesets();
  }

  async setEnabledRulesets(rulesetIds) {
    this.enabledRulesets = rulesetIds;

    try {
      const rules = await this.ruleLoader.loadRulesets(this.enabledRulesets);
      const optimizedRules = this.ruleLoader.optimizeRules(rules);
      this.ruleEngine.loadRules(optimizedRules);
      console.log(`[AdBlocker] Bundled rulesets updated: ${rulesetIds.join(', ')}`);
    } catch (error) {
      console.error('[AdBlocker] Failed to update bundled rulesets:', error);
    }
  }

  getEnabledRulesets() {
    return [...this.enabledRulesets];
  }
}

let adBlockerInstance = null;

function getAdBlocker() {
  if (!adBlockerInstance) {
    adBlockerInstance = new RequestHandler();
  }
  return adBlockerInstance;
}

module.exports = {
  RequestHandler,
  getAdBlocker
};
