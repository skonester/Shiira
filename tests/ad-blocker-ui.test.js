const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('live block updates reach the store and both badges; delayed reads cannot undo blocks or resets', async context => {
  const { AdBlockerMixin } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/modules/ad-blocker.js')).href);
  let receive, status, snapshot, unsubscribed = 0, onUnload;
  const original = global.window;
  context.after(() => { global.window = original; });
  global.window = {
    addEventListener: (name, callback) => { if (name === 'unload') onUnload = callback; },
    shiiraAPI: { adBlocker: {
      onStatsUpdated: callback => { receive = callback; return () => { unsubscribed++; }; },
      getStatus: () => new Promise(resolve => { status = resolve; }),
      getStats: () => new Promise(resolve => { snapshot = resolve; })
    } }
  };
  const classes = new Set(['hidden']);
  const browser = Object.assign({
    adblockStats: {}, adCounterValue: {},
    adCounter: { style: {}, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } }
  }, AdBlockerMixin);
  const init = browser.initAdBlocker();
  receive({ blocked: 1, revision: 1 });
  status({ enabled: true, stats: { blocked: 0, revision: 0 } });
  await init;
  assert.equal(browser.adblockBlockedCount, 1);
  assert.equal(browser.adblockStats.textContent, '1 requests blocked');
  assert.equal(browser.adCounterValue.textContent, 1);
  assert.equal(classes.has('hidden'), false);
  const update = browser.updateAdBlockerStats();
  receive({ blocked: 2, revision: 2 });
  receive({ blocked: 0, revision: 3 });
  snapshot({ blocked: 1, revision: 1 });
  await update;
  assert.equal(browser.adblockBlockedCount, 0);
  assert.equal(browser.adblockStats.textContent, '0 requests blocked');
  assert.equal(classes.has('hidden'), true);
  onUnload();
  assert.equal(unsubscribed, 1);
});
