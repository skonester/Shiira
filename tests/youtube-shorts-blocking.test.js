const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function filtering() {
  const filename = path.resolve(__dirname, '../src/main/ad-blocker/request-handler.js');
  const localRequire = createRequire(filename);
  const defaultSession = { webRequest: { onBeforeRequest(_filter, handler) { this.handler = handler; } } };
  const browserSession = { webRequest: { onBeforeRequest(_filter, handler) { this.handler = handler; } } };
  const channels = new Map();
  const blocker = {
    onBeforeRequest: (_details, callback) => callback({ cancel: true }),
    onHeadersReceived: (_details, callback) => callback({ responseHeaders: { 'content-security-policy': ["script-src 'none'"] } }),
    enableBlockingInSession: () => ({}),
    onInjectCosmeticFilters: () => { throw new Error('Shorts must not receive cosmetics'); }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, process, fetch: () => {},
    require(name) {
      if (name === 'electron') return {
        app: { getPath: () => '/fixture' },
        session: { defaultSession, fromPartition: () => browserSession },
        ipcMain: { removeHandler: channel => channels.delete(channel), handle: (channel, handler) => channels.set(channel, handler) }
      };
      if (name === '@ghostery/adblocker-electron') return { ElectronBlocker: { fromPrebuiltFull: async () => blocker } };
      return localRequire(name);
    }
  });
  return { handler: new module.exports.RequestHandler(), blocker, defaultSession, browserSession, channels };
}

function result(hook, details) {
  let value;
  hook(details, response => { value = response; });
  return JSON.parse(JSON.stringify(value));
}

const shorts = 'https://www.youtube.com/shorts/jNQXAC9IVRw';
const watch = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const ad = 'https://ads.example/advertising.js';

test('Ghostery bypasses Shorts network and CSP filtering using the current page after SPA navigation', async () => {
  const { handler, blocker, channels } = filtering();
  assert.equal(await handler.setupGhosteryBlocker(), true);
  let current = shorts;
  const contents = { isDestroyed: () => false, getURL: () => current, mainFrame: { url: shorts } };
  const request = { url: ad, resourceType: 'script', referrer: watch, webContents: contents };
  assert.deepEqual(result(blocker.onBeforeRequest, request), {});
  assert.deepEqual(result(blocker.onHeadersReceived, { ...request, resourceType: 'subFrame' }), {});
  const frame = contents.mainFrame;
  assert.equal(channels.get('@ghostery/adblocker/inject-cosmetic-filters')({ senderFrame: frame, sender: contents }, ad), undefined);
  current = watch;
  assert.deepEqual(result(blocker.onBeforeRequest, { ...request, referrer: shorts }), { cancel: true });
  assert.ok(result(blocker.onHeadersReceived, { ...request, referrer: shorts, resourceType: 'subFrame' }).responseHeaders);
  assert.deepEqual(result(blocker.onHeadersReceived, { ...request, resourceType: 'mainFrame', url: shorts }), {});
  current = shorts;
  assert.ok(result(blocker.onHeadersReceived, { ...request, resourceType: 'mainFrame', url: watch }).responseHeaders);
  assert.deepEqual(result(blocker.onBeforeRequest, { url: ad, resourceType: 'script', referrer: shorts }), {});
  assert.deepEqual(result(blocker.onBeforeRequest, { url: ad, resourceType: 'script', referrer: 'https://youtube.com.evil.test/shorts/test' }), { cancel: true });
});

test('bundled fallback rules also exempt Shorts and resume blocking on regular watch pages', () => {
  const { handler, defaultSession, browserSession } = filtering();
  handler.ruleEngine.shouldBlock = () => ({ action: 'block' });
  handler.setupBundledRequestInterception();
  for (const target of [defaultSession, browserSession]) {
    let current = shorts;
    const request = { url: ad, resourceType: 'script', referrer: watch,
      webContents: { isDestroyed: () => false, getURL: () => current } };
    assert.deepEqual(result(target.webRequest.handler, request), {});
    current = watch;
    assert.deepEqual(result(target.webRequest.handler, { ...request, referrer: shorts }), { cancel: true });
  }
});
