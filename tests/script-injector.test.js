const test = require('node:test');
const assert = require('node:assert/strict');

const { ScriptInjector } = require('../src/main/ad-blocker/script-injector');

test('script injector does not inject YouTube ad-blocker code by default', () => {
  const injector = new ScriptInjector();
  injector.init();

  const youtubeScript = injector.getScriptForUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  assert.equal(youtubeScript, null);
  assert.equal(injector.getStats().sitesCovered, 0);
});
