const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const youtube = require('../src/shared/youtube');
const source = fs.readFileSync(path.join(__dirname, '../src/preload/youtube-player.js'), 'utf8');

class Element extends EventEmitter {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.isConnected = true;
    this.currentTime = 0;
    this.paused = true;
    this.plays = 0;
    this.frameCallbacks = new Map();
  }
  addEventListener(type, listener) { this.on(type, listener); }
  removeEventListener(type, listener) { this.off(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) {
    for (const child of children) {
      child.remove();
      this.children.push(child);
      child.parentNode = this;
      child.isConnected = true;
    }
  }
  appendChild(child) { this.append(child); }
  attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
  querySelectorAll() { return this.children.filter(child => child.tagName === 'VIDEO'); }
  querySelector() { return this.querySelectorAll()[0] || null; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
    this.isConnected = false;
  }
  pause() { this.paused = true; this.emit('pause'); }
  requestVideoFrameCallback(callback) { const id = ++this.frameId || (this.frameId = 1); this.frameCallbacks.set(id, callback); return id; }
  cancelVideoFrameCallback(id) { this.frameCallbacks.delete(id); }
  emitFrame() {
    const callbacks = [...this.frameCallbacks.values()];
    this.frameCallbacks.clear();
    callbacks.forEach(callback => callback(0, { width: 640, height: 360, presentedFrames: 1 }));
  }
  async play() {
    this.plays++; this.paused = false; this.emit('play'); this.emit('playing');
    if (!this.manualFrames) this.emitFrame();
  }
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
}

async function playerPage(context, availableAt = 0, { resolveFails = false, mediaFails = false, manualFrames = false, mediaResponse,
  mediaRequest, resolveRequest, loadRequest, unload, languages } = {}) {
  const container = new Element('div');
  const native = new Element('video');
  container.appendChild(native);
  let activeContainer = container;
  let mutationCallback;
  const document = new Element('document');
  document.head = new Element('head');
  document.querySelector = () => activeContainer;
  document.createElement = tag => new Element(tag);
  const window = new Element('window');
  window.location = { href: 'https://www.youtube.com/watch?v=jNQXAC9IVRw&t=9' };
  window.localStorage = { getItem: () => null, setItem() {} };
  window.navigator = { languages };
  const resolves = [];
  const messages = [];
  const events = [];
  const players = [];
  class Player extends EventEmitter {
    constructor() { super(); this.configurations = []; this.loads = []; this.unloads = 0; players.push(this); }
    addEventListener(type, listener) { this.on(type, listener); }
    configure(value) { this.configurations.push(value); }
    async attach(video) { this.video = video; video.manualFrames = manualFrames; }
    async load(uri, position) {
      this.loads.push({ uri, position });
      this.video.currentTime = position || 0;
      if (mediaFails) throw new Error('Refused media');
      if (loadRequest) await loadRequest(this);
    }
    async unload() { this.unloads++; this.video.currentTime = 0; if (!this.video.paused) this.video.pause(); if (unload) await unload(); }
    async destroy() { this.destroyed = true; }
  }
  let mediaPlugin;
  class ShakaError extends Error {
    static Severity = { CRITICAL: 2, RECOVERABLE: 1 };
    static Category = { NETWORK: 1, PLAYER: 7 };
    static Code = { HTTP_ERROR: 1002, BAD_HTTP_STATUS: 1001, OPERATION_ABORTED: 7001, LOAD_INTERRUPTED: 7000 };
    constructor(severity, category, code, ...data) { super('Media failure'); Object.assign(this, { severity, category, code, data }); }
  }
  const shaka = { Player, polyfill: { installAll() {} }, util: { Error: ShakaError,
    AbortableOperation: class { constructor(promise, abort) { this.promise = promise; this.abort = abort; } } },
    net: { NetworkingEngine: { registerScheme: (_scheme, plugin) => { mediaPlugin = plugin; }, PluginPriority: { APPLICATION: 1 } } } };
  const ipcRenderer = { send: (channel, payload) => { messages.push(channel); events.push({ channel, payload }); }, invoke: async (channel, options) => {
    if (channel === 'youtube:media') return mediaRequest ? mediaRequest(options) : mediaResponse || { error: 'YouTube media HTTP 403' };
    assert.equal(channel, 'youtube:resolve');
    resolves.push(options);
    if (resolveRequest) await resolveRequest(options);
    if (resolveFails) return { error: 'Stream unavailable' };
    return { source: { client: 'VISIONOS', uri: 'shiira-youtube://manifest/test',
      mimeType: 'application/dash+xml', availableAt } };
  } };
  const sandbox = { module: { exports: {} }, require: () => youtube, Date, URL,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, queueMicrotask,
    MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} disconnect() {} } };
  vm.runInNewContext(source, sandbox);
  sandbox.module.exports.installPlayer({ ipcRenderer, shaka, window, document });
  await flush();
  context.after(() => window.emit('pagehide'));
  return { player: players[0], video: players[0].video, resolves, messages, events, native, container, window, document, mediaPlugin,
    mutate: async () => { mutationCallback(); await flush(); },
    replaceContainer: next => { container.isConnected = false; activeContainer = next; } };
}

test('the loaded player waits through announced media readiness without reconnecting', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { player, video, resolves } = await playerPage(context, 16000);
  video.currentTime = 12;
  video.emit('waiting');
  context.mock.timers.tick(34000);
  await flush();
  assert.equal(player.unloads, 0, 'the ordinary ten-second watchdog must allow the media hold');
  assert.equal(resolves.length, 1);
  video.currentTime = 13;
  video.emit('playing');
  context.mock.timers.tick(1000);
  await flush();
  assert.equal(player.unloads, 0, 'resuming the same stream clears the stall timer');
});

test('recoverable Shaka events keep the current source loaded', async (context) => {
  const { player, resolves } = await playerPage(context);
  player.emit('error', { detail: { severity: 1 } });
  await flush();
  assert.equal(player.unloads, 0);
  assert.equal(resolves.length, 1);
});

test('rapid seek cancellations reject immediately as OPERATION_ABORTED and ignore late IPC successes or errors', async context => {
  const pending = [];
  const page = await playerPage(context, 0, { mediaRequest: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  for (const settle of ['success', 'http', 'rejection']) {
    const operation = page.mediaPlugin('shiira-youtube://media/test', {
      headers: { Range: 'bytes=0-99' }, attempt: 1, retryParameters: { maxAttempts: 2 }
    });
    let result;
    const completed = operation.promise.then(value => { result = value; }, error => { result = error; });
    await operation.abort();
    await operation.abort();
    await flush();
    assert.equal(result?.code, 7001, 'abort settles locally before the old backend request completes');
    if (settle === 'success') pending.at(-1).resolve({ data: new Uint8Array([1]), headers: {} });
    if (settle === 'http') pending.at(-1).resolve({ error: 'YouTube media HTTP 403' });
    if (settle === 'rejection') pending.at(-1).reject(new Error('Departed frame'));
    await completed;
    assert.equal(result.code, 7001);
  }
  assert.equal(page.messages.filter(channel => channel === 'youtube:cancel-media').length, 3, 'each old range is cancelled once');
  assert.equal(page.player.unloads, 0);
  assert.equal(page.resolves.length, 1);
});

test('handled Shaka resets and seek cancellation errors do not consume the source refresh', async context => {
  const page = await playerPage(context);
  for (const detail of [
    { severity: 2, code: 7001, category: 7 },
    { severity: 2, code: 3015, category: 3, handled: true }
  ]) {
    page.player.emit('error', { detail });
    await flush();
  }
  assert.equal(page.player.unloads, 0);
  assert.equal(page.resolves.length, 1);
  assert.equal(page.events.filter(event => event.channel === 'youtube:error').length, 0);
});

test('a seek before the first playing event is retained through genuine source recovery', async context => {
  const page = await playerPage(context, 0, { loadRequest: player => { if (player.loads.length === 1) throw new Error('Refused source'); } });
  // The first load has already failed, so test the initial-seek path before
  // playback starts by holding source resolution for a new player.
  let complete;
  const waiting = await playerPage(context, 0, { resolveRequest: () => new Promise(resolve => { complete = resolve; }) });
  waiting.video.currentTime = 42;
  waiting.video.emit('seeking');
  complete();
  await flush();
  assert.equal(waiting.player.loads[0].position, 42);
  assert.equal(page.native.plays, 0);
});

test('seek and pause choices during a fresh resolution win over the pre-unload snapshot', async context => {
  let complete;
  const page = await playerPage(context, 0, { resolveRequest: options => options.fresh ? new Promise(resolve => { complete = resolve; }) : undefined });
  page.video.currentTime = 18;
  page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
  await flush();
  page.video.currentTime = 42;
  page.video.emit('seeking');
  page.video.pause();
  complete();
  await flush();
  assert.equal(page.player.loads[1].position, 42);
  assert.equal(page.video.currentTime, 42);
  assert.equal(page.video.paused, true);
  assert.equal(page.resolves.length, 2);
});

test('a real HTTP failure during seeking still gets one bounded source refresh', async context => {
  const page = await playerPage(context);
  page.video.currentTime = 42;
  page.video.emit('seeking');
  page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
  await flush();
  assert.equal(page.player.loads[1].position, 42);
  page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
  await flush();
  assert.equal(page.resolves.length, 2);
  assert.equal(page.container.children.find(child => child.id === 'shiira-youtube-player').getAttribute('data-failed'), '');
});

test('recovery uses the current playback position after a completed seek', async context => {
  const page = await playerPage(context);
  page.video.currentTime = 42;
  page.video.emit('seeking');
  page.video.emit('seeked');
  page.video.currentTime = 75;
  page.video.emit('timeupdate');
  page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
  await flush();
  assert.equal(page.player.loads[1].position, 75);
  assert.equal(page.video.currentTime, 75);
  assert.equal(page.video.paused, false);
});

test('play and pause choices made while recovery unloads override the earlier snapshot', async context => {
  for (const paused of [true, false]) {
    let finishUnload;
    const page = await playerPage(context, 0, { unload: () => new Promise(resolve => { finishUnload = resolve; }) });
    if (!paused) page.video.pause();
    page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
    await flush();
    await page.video.play();
    if (paused) page.video.pause();
    finishUnload();
    await flush();
    assert.equal(page.video.paused, paused);
    assert.equal(page.player.unloads, 1);
    assert.equal(page.resolves.length, 2);
  }
});

test('recovery resumes playback after the internal unload pause', async context => {
  const page = await playerPage(context);
  page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
  await flush();
  assert.equal(page.video.paused, false);
  assert.equal(page.player.unloads, 1);
});

test('only a decoded frame from Shiira’s own video confirms playback', async context => {
  const page = await playerPage(context, 0, { manualFrames: true });
  assert.equal(page.messages.includes('youtube:playing'), false, 'play/playing events alone cannot confirm the replacement player');
  page.video.emitFrame();
  assert.deepEqual(JSON.parse(JSON.stringify(page.events.find(event => event.channel === 'youtube:playing').payload)), {
    uri: 'shiira-youtube://manifest/test', width: 640, height: 360, frames: 1
  });
  page.video.emit('playing');
  page.video.emitFrame();
  assert.equal(page.messages.filter(channel => channel === 'youtube:playing').length, 1);
});

test('an old frame dispatched during recovery cannot confirm the previous source', async context => {
  let finishUnload;
  const page = await playerPage(context, 0, { manualFrames: true, unload: () => new Promise(resolve => { finishUnload = resolve; }) });
  const callback = [...page.video.frameCallbacks.values()][0];
  page.player.emit('error', { detail: { severity: 2, code: 1001, category: 1 } });
  callback(0, { width: 640, height: 360, presentedFrames: 1 });
  assert.equal(page.messages.includes('youtube:playing'), false);
  finishUnload();
  await flush();
});

test('an invalid frame is not promoted and a later decoded frame can still confirm playback', async context => {
  const page = await playerPage(context, 0, { manualFrames: true });
  const callback = [...page.video.frameCallbacks.values()][0];
  page.video.frameCallbacks.clear();
  callback(0, { width: 0, height: 360, presentedFrames: 0 });
  assert.equal(page.messages.includes('youtube:playing'), false);
  page.video.emitFrame();
  assert.equal(page.messages.filter(channel => channel === 'youtube:playing').length, 1);
});

test('buffering and a delayed first frame never override the request layer by unloading the player', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const page = await playerPage(context);
  page.video.emit('waiting');
  context.mock.timers.tick(120000);
  await flush();
  assert.equal(page.player.unloads, 0);
  assert.equal(page.resolves.length, 1);
  assert.equal(page.messages.includes('youtube:release'), false);
});

test('the media adapter permits same-source Shaka retries before reporting a terminal refusal', async context => {
  const { mediaPlugin, player, resolves, messages } = await playerPage(context);
  for (const attempt of [0, 1]) {
    const operation = mediaPlugin('shiira-youtube://media/test', {
      headers: { Range: 'bytes=0-99' }, attempt, retryParameters: { maxAttempts: 2 }
    });
    await assert.rejects(operation.promise, error => error.severity === (attempt === 0 ? 1 : 2) &&
      error.code === 1001 && error.data[1] === 403);
    await operation.abort();
  }
  assert.equal(player.unloads, 0);
  assert.equal(resolves.length, 1);
  assert.equal(messages.filter(channel => channel === 'youtube:cancel-media').length, 2);
});

test('successful media lets Shaka measure transfer time rather than falsely reporting a zero-time cache read', async context => {
  const page = await playerPage(context, 0, { mediaResponse: { data: new Uint8Array([1, 2, 3]), headers: {} } });
  const response = await page.mediaPlugin('shiira-youtube://media/test', { headers: {} }).promise;
  assert.equal(Object.hasOwn(response, 'timeMs'), false);
  assert.equal(response.fromCache, false);
  assert.deepEqual([...new Uint8Array(response.data)], [1, 2, 3]);
});

test('terminal recovery preserves the position and pause choice captured before unload', async (context) => {
  for (const position of [0, 42]) {
    const { player, video, resolves } = await playerPage(context);
    video.currentTime = position;
    video.pause();
    player.emit('error', { detail: { severity: 2 } });
    await flush();
    assert.equal(player.unloads, 1);
    assert.equal(resolves.length, 2);
    assert.equal(resolves[1].fresh, true);
    assert.equal(player.loads[1].position, position);
    assert.equal(video.paused, true);
  }
});

test('ad-related player DOM removal preserves the stream, decoder and buffered position', async context => {
  const page = await playerPage(context);
  page.video.currentTime = 42;
  const overlay = page.container.children.find(child => child.id === 'shiira-youtube-player');
  overlay.remove();
  page.video.pause();
  await page.mutate();
  assert.equal(overlay.parentNode, page.container);
  assert.equal(page.player.destroyed, undefined);
  assert.equal(page.player.unloads, 0);
  assert.equal(page.video.currentTime, 42);
  assert.equal(page.video.paused, false);
  assert.equal(page.resolves.length, 1);
  assert.equal(page.messages.includes('youtube:release'), false);
  page.replaceContainer(null);
  await page.mutate();
  const replacement = new Element('div');
  page.replaceContainer(replacement);
  await page.mutate();
  assert.equal(overlay.parentNode, replacement);
  assert.equal(page.resolves.length, 1, 'replacing the native container cannot re-extract the video');
  assert.equal(page.video.currentTime, 42);
});

test('a user-paused video stays paused when YouTube rebuilds the surrounding player', async context => {
  const page = await playerPage(context);
  page.video.pause();
  const overlay = page.container.children.find(child => child.id === 'shiira-youtube-player');
  overlay.remove();
  await page.mutate();
  assert.equal(page.video.paused, true);
  assert.equal(page.resolves.length, 1);
});

test('temporarily detaching the whole native container resumes the same loaded video', async context => {
  const page = await playerPage(context);
  const overlay = page.container.children.find(child => child.id === 'shiira-youtube-player');
  overlay.isConnected = false;
  page.replaceContainer(null);
  page.video.pause();
  await page.mutate();
  overlay.isConnected = true;
  page.replaceContainer(page.container);
  await page.mutate();
  assert.equal(page.video.paused, false);
  assert.equal(page.resolves.length, 1);
  assert.equal(page.player.unloads, 0);
});

test('stream resolution and terminal media failures keep native advertising paused until explicitly selected', async context => {
  for (const options of [{ resolveFails: true }, { mediaFails: true }]) {
    const page = await playerPage(context, 0, options);
    await flush();
    const overlay = page.container.children.find(child => child.id === 'shiira-youtube-player');
    assert.ok(overlay);
    assert.equal(overlay.getAttribute('data-failed'), '');
    assert.equal(page.native.plays, 0);
    const ad = new Element('video');
    ad.paused = false;
    page.document.emit('play', { target: ad });
    assert.equal(ad.paused, true);
    const tools = overlay.shadow.children.find(child => child.className === 'tools');
    const nativeButton = tools.children.find(child => child.textContent === 'Use YouTube player');
    nativeButton.emit('click');
    assert.equal(page.native.plays, 1, 'native playback requires the user choosing its button');
  }
});

test('audio and subtitle preferences follow browser languages with a main-track fallback', async context => {
  const page = await playerPage(context, 0, { languages: ['en-US', 'fr-CA', 'en-US'] });
  const config = page.player.configurations[0];
  assert.deepEqual(JSON.parse(JSON.stringify(config.preferredAudio)), [
    { language: 'en-US' }, { language: 'fr-CA' }, { role: 'main' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(config.preferredText)), [{ language: 'en-US' }, { language: 'fr-CA' }]);
  const fallback = await playerPage(context);
  assert.equal(fallback.player.configurations[0].preferredAudio[0].language, 'en');
});

test('the latest seek during an in-flight Shaka load survives its startup seek and completes without reloading', async context => {
  let loaded;
  const page = await playerPage(context, 0, { loadRequest: () => new Promise(resolve => { loaded = resolve; }) });
  page.video.currentTime = 42;
  page.video.emit('seeking');
  page.video.currentTime = 73;
  page.video.emit('seeking');
  // Shaka can deliver its original startup seek after the user's newer choice.
  page.video.currentTime = 9;
  page.video.emit('seeking');
  loaded();
  await flush();
  assert.equal(page.video.currentTime, 73);
  assert.equal(page.player.loads.length, 1);
  assert.equal(page.player.unloads, 0);
  assert.equal(page.resolves.length, 1);
});

test('unload-generated seeking cannot erase the position selected before recovery', async context => {
  let page;
  page = await playerPage(context, 0, { unload: () => page.video.emit('seeking') });
  page.video.currentTime = 42;
  page.player.emit('error', { detail: { severity: 2, code: 1001 } });
  await flush();
  assert.equal(page.player.loads[1].position, 42);
  assert.equal(page.video.currentTime, 42);
});

test('rapid seeks and paused seek completion retain the same stream and clear buffering status', async context => {
  const page = await playerPage(context);
  const overlay = page.container.children.find(child => child.id === 'shiira-youtube-player');
  const status = overlay.shadow.children.find(child => child.className === 'status');
  for (const position of [22, 0, 41, 7, 85]) {
    page.video.currentTime = position;
    page.video.emit('seeking');
    page.video.emit('waiting');
    page.video.pause();
    page.video.emit('seeked');
    assert.equal(status.hidden, true);
    assert.equal(page.video.paused, true);
    assert.equal(page.video.currentTime, position);
  }
  assert.equal(page.player.unloads, 0);
  assert.equal(page.player.loads.length, 1);
  assert.equal(page.resolves.length, 1);
});
