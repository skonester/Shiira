const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { installMediaController } = require('../src/preload/media-controller');
const load = name => import(pathToFileURL(path.join(__dirname, '../src/renderer/modules', name + '.js')).href);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));

test('media IPC validates the owning UI and runs only allowed controls in the preload world', async () => {
  const { installPageTools } = require('../src/main/page-tools-service');
  const handlers = {}, calls = [];
  const owner = {};
  const page = { isDestroyed: () => false, getType: () => 'webview', hostWebContents: owner,
    executeJavaScriptInIsolatedWorld: async (...args) => { calls.push(args); return true; } };
  installPageTools({ ipcMain: { handle: (name, handler) => { handlers[name] = handler; } }, isTrusted: e => e.trusted,
    webContents: { fromId: id => id === 42 ? page : null } });
  const control = handlers['page-media-control'];
  assert.equal(await control({ trusted: false, sender: owner }, 42, 'toggle'), false);
  assert.equal(await control({ trusted: true, sender: {} }, 42, 'toggle'), false);
  assert.equal(await control({ trusted: true, sender: owner }, 42, 'injected()'), false);
  assert.equal(await control({ trusted: true, sender: owner }, 42, 'seek', NaN), false);
  assert.equal(calls.length, 0);
  assert.equal(await control({ trusted: true, sender: owner }, 42, 'seek', 30), true);
  assert.equal(calls[0][0], 999); assert.equal(calls[0][2], true);
  assert.match(calls[0][1][0].code, /__shiiraMediaControl/);
});

test('private media controls reach a closed-root video, release it on fallback and preserve manual PiP', async () => {
  class Media extends EventTarget {
    constructor() { super(); Object.assign(this, { paused: false, ended: false, muted: false, currentTime: 12, duration: 120, currentSrc: 'fixture', readyState: 4, videoWidth: 320 }); this.root = {}; }
    getRootNode() { return this.root; }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
    async requestPictureInPicture() { document.pictureInPictureElement = {}; this.root.pictureInPictureElement = this; this.dispatchEvent(new Event('enterpictureinpicture')); }
  }
  const native = new Media(), custom = new Media();
  const document = new EventTarget();
  document.querySelectorAll = () => [native];
  document.pictureInPictureEnabled = true;
  let exits = 0;
  document.exitPictureInPicture = async () => { exits++; document.pictureInPictureElement = null; custom.root.pictureInPictureElement = null; custom.dispatchEvent(new Event('leavepictureinpicture')); };
  const reports = [];
  const controller = installMediaController({ document, HTMLMediaElement: Media, send: (...args) => reports.push(args) });
  const release = controller.register(custom);
  await controller.control('pause');
  assert.equal(custom.paused, true);
  assert.equal(native.paused, false);
  assert.equal(reports.at(-1)[1].paused, true);
  await controller.control('toggle');
  await controller.control('seek', 40);
  await controller.control('mute');
  assert.equal(custom.currentTime, 40);
  assert.equal(custom.muted, true);
  await custom.requestPictureInPicture();
  await controller.control('exit-auto-pip');
  assert.equal(exits, 0, 'manual PiP stays open');
  await document.exitPictureInPicture();
  assert.equal(await controller.control('auto-pip'), true);
  await controller.control('exit-auto-pip');
  assert.equal(exits, 2);
  release();
  await controller.control('pause');
  assert.equal(native.paused, true, 'fallback returns controls to the native video');
});

test('returning during an outstanding auto-PiP request closes only that request', async () => {
  const pending = deferred();
  const document = new EventTarget();
  const video = new EventTarget();
  Object.assign(video, { paused: false, readyState: 4, videoWidth: 320, getRootNode: () => document });
  let exits = 0;
  document.querySelectorAll = () => [video]; document.pictureInPictureEnabled = true;
  video.requestPictureInPicture = async () => { await pending.promise; document.pictureInPictureElement = video; };
  document.exitPictureInPicture = async () => { exits++; document.pictureInPictureElement = null; };
  const controller = installMediaController({ document, HTMLMediaElement: EventTarget, send() {} });
  const entering = controller.control('auto-pip');
  await controller.control('exit-auto-pip'); pending.resolve();
  assert.equal(await entering, false);
  assert.equal(exits, 1);
});

test('seek completion reports immediately and native events cannot throttle the registered player', () => {
  const document = new EventTarget(), native = new EventTarget(), custom = new EventTarget();
  document.querySelectorAll = () => [native];
  Object.assign(custom, { paused: true, currentTime: 42, duration: 120 });
  Object.assign(native, { paused: false, currentTime: 0, duration: 10 });
  let now = 5000;
  const reports = [];
  const controller = installMediaController({ document, HTMLMediaElement: EventTarget,
    now: () => now, send: (_channel, state) => reports.push(state) });
  const release = controller.register(custom);
  // Simulate the document's capture listener seeing the native video.
  const nativeEvent = new Event('timeupdate');
  Object.defineProperty(nativeEvent, 'target', { value: native });
  document.dispatchEvent(nativeEvent);
  custom.dispatchEvent(new Event('timeupdate'));
  assert.equal(reports.length, 1, 'native progress does not consume the custom progress interval');
  now += 20;
  custom.currentTime = 75;
  custom.dispatchEvent(new Event('seeking'));
  custom.dispatchEvent(new Event('seeked'));
  assert.equal(reports.length, 3, 'seek completion bypasses periodic progress throttling');
  assert.equal(reports.at(-1).time, 75);
  assert.equal(reports.at(-1).paused, true);
  release();
  const count = reports.length;
  custom.dispatchEvent(new Event('seeked'));
  assert.equal(reports.length, count, 'release removes the custom seek bindings');
});

test('leaving Settings while recording starts cannot arm hidden or stale shortcut capture', async t => {
  const { ShortcutSettingsMixin } = await load('shortcut-settings');
  const oldWindow = global.window, oldDocument = global.document;
  t.after(() => { global.window = oldWindow; global.document = oldDocument; });
  const pending = deferred(); let canceled = 0, recordId;
  global.window = { shiiraAPI: { shortcuts: { record: (_id, version) => { recordId = version; return pending.promise; }, cancelRecord: async () => { canceled++; } } } };
  global.document = { getElementById: () => ({ classList: { add() {}, remove() {} } }) };
  const browser = { ...ShortcutSettingsMixin, renderShortcutSettings() {} };
  const starting = browser.startShortcutRecording('new-tab');
  await tick();
  await browser.cancelShortcutRecording(false);
  pending.resolve({ success: true }); await starting;
  assert.equal(canceled, 1);
  assert.equal(browser.recordingCommand, null);
  assert.equal(browser.shortcutRecordTimer, undefined);
  browser.receiveRecordedShortcut({ id: 'new-tab', recordId, accel: 'Ctrl+Alt+U' });
  assert.equal(browser.pendingShortcut, undefined);
});

test('routing loads share one pending request and saves wait for a usable draft', async t => {
  const { ExternalLinksMixin } = await load('external-links');
  const oldWindow = global.window, oldDocument = global.document;
  t.after(() => { global.window = oldWindow; global.document = oldDocument; });
  const pending = deferred(); let gets = 0, saves = 0;
  global.document = { getElementById: () => ({}), querySelectorAll: () => [] };
  global.window = { shiiraAPI: { externalLinks: { get: () => { gets++; return pending.promise; }, save: () => { saves++; } } } };
  const browser = { ...ExternalLinksMixin, renderRoutingSettings() {} };
  const first = browser.loadRoutingSettings(); const second = browser.loadRoutingSettings();
  assert.equal(first, second);
  await browser.saveRoutingSettings();
  assert.equal(saves, 0);
  await tick(); assert.equal(gets, 1);
  pending.resolve({ defaultDestination: 'main', rules: [], spaces: [] }); await first;
  assert.equal(browser.routingBusy, false);
  assert.equal(browser.routingDraft.defaultDestination, 'main');
});

test('a failed Space import rolls back tabs, folders and sidebar batching before rendering', async () => {
  const { BrowserImportMixin } = await load('browser-import');
  let creations = 0, removed = 0, renders = 0;
  const browser = { ...BrowserImportMixin, tabs: [], sidebarFolders: [], spaces: [{ id: 'existing' }], focusedSpaceId: 'existing',
    createTab(url) { if (++creations === 2) throw new Error('Injected tab failure'); this.tabs.push({ id: 'created', url, element: { remove() { removed++; } } }); return 'created'; },
    placeTabElements() { assert.equal(this.sidebarBatch, false); renders++; }, renderSpaceChrome() {} };
  const data = { nodes: [{ type: 'tab', url: 'https://one.example/', title: 'One' }, { type: 'tab', url: 'https://two.example/', title: 'Two' }] };
  await assert.rejects(browser.importBookmarksIntoSpace(data, { name: 'Import', newSpace: true }), /Injected tab failure/);
  assert.equal(browser.tabs.length, 0); assert.equal(browser.sidebarFolders.length, 0);
  assert.equal(browser.spaces.length, 1); assert.equal(browser.focusedSpaceId, 'existing');
  assert.equal(removed, 1); assert.equal(renders, 1); assert.equal(browser.sidebarBatch, false);
});
