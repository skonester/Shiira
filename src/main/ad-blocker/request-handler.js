/**
 * Shiira Browser Ad-Blocker Request Handler
 * Integrates aggressive Ghostery blocking with bundled fallback rules.
 */

const { app, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { isYouTubeUrl, isYouTubeShortsUrl, isYouTubePlaybackRequest } = require('../../shared/youtube');

function isYouTubeShortsRequest(details) {
  // A navigation belongs to its destination. Subresources belong to the tab's
  // current page, since referrers can still name the previous SPA watch page.
  if (details.resourceType === 'mainFrame') return isYouTubeShortsUrl(details.url);
  const contents = details.webContents;
  const pageUrl = contents && !contents.isDestroyed()
    ? contents.getURL() : details.referrer || details.initiatorUrl;
  return isYouTubeShortsUrl(pageUrl);
}

/**
 * Wraps a scriptlet so it runs only once per document. The block also keeps its helper declarations
 * (such as `JSONPath`) out of the page's global scope, so two scriptlets can never collide.
 */
function runOncePerDocument(code) {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) hash = ((hash * 33) ^ code.charCodeAt(i)) >>> 0;
  const flag = `__shiiraScriptlet_${hash.toString(36)}_${code.length.toString(36)}`;
  return `if (!window[${JSON.stringify(flag)}]) {\n` +
    `Object.defineProperty(window, ${JSON.stringify(flag)}, { value: true });\n` +
    `${code}\n}`;
}
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

      const filterRequest = this.ghosteryBlocker.onBeforeRequest;
      this.ghosteryBlocker.onBeforeRequest = (details, callback) => {
        if (isYouTubeShortsRequest(details) || isYouTubePlaybackRequest(details)) return callback({});
        return filterRequest(details, callback);
      };
      const filterResponse = this.ghosteryBlocker.onHeadersReceived;
      this.ghosteryBlocker.onHeadersReceived = (details, callback) => {
        if (isYouTubeShortsRequest(details)) return callback({});
        return filterResponse(details, callback);
      };

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

    // Only the session web pages use. Ghostery registers its IPC handlers globally, so enabling it on a
    // second session throws ("second handler") and used to leave it half-enabled on Shiira's own UI session,
    // injecting YouTube scriptlets repeatedly while network blocking fell back to the bundled rules.
    this.ghosteryContexts = [
      this.ghosteryBlocker.enableBlockingInSession(session.fromPartition('persist:main'))
    ];
    this.routeGhosteryCosmeticsToFrames();
    this.ghosteryEnabled = true;
  }

  // Ghostery's preload asks for cosmetic filters when a page loads and again as the page changes, and the
  // library runs every scriptlet it gets back each time. On YouTube the update calls return the same
  // scriptlets again, so they ran twice in the same page: "Identifier 'JSONPath' has already been declared"
  // and functions wrapped twice ("Maximum call stack size exceeded"), which broke parts of the page.
  // Here each scriptlet runs at most once per document, in the frame that asked for it.
  routeGhosteryCosmeticsToFrames() {
    const channel = '@ghostery/adblocker/inject-cosmetic-filters';
    const blocker = this.ghosteryBlocker;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, url, msg) => {
      const frame = event.senderFrame;
      if (!frame || frame.isDestroyed?.()) return undefined;
      // Litube-style playback owns YouTube. Scriptlets that wrap JSON/fetch or
      // mutate its player can break browsing and race our stream pipeline.
      // Trust the requesting frame's URL, never a page-supplied URL argument.
      if (isYouTubeUrl(frame.url) || isYouTubeUrl(event.sender.mainFrame?.url)) return undefined;
      const isMainFrame = frame === event.sender.mainFrame;
      const frameEvent = {
        frameId: event.frameId,
        processId: event.processId,
        senderFrame: frame,
        sender: {
          executeJavaScript: (code) => frame.executeJavaScript(runOncePerDocument(code), true).catch(() => {}),
          insertCSS: isMainFrame
            ? (css, options) => event.sender.insertCSS(css, options)
            // WebFrameMain has no insertCSS: add the rules as a <style> element in that frame.
            : (css) => frame.executeJavaScript(
              `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(s); })();`,
              true
            ).catch(() => {})
        }
      };
      return blocker.onInjectCosmeticFilters(frameEvent, url, msg);
    });
  }

  disableGhosteryContexts() {
    if (!this.ghosteryBlocker || !this.ghosteryEnabled) return;

    for (const activeSession of [session.fromPartition('persist:main')]) {
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

      if (isYouTubeShortsRequest(details) || isYouTubePlaybackRequest(details)) {
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
