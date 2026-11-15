const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { routeText, routeMatches, LinkRoutingSettings, urlsFromArgs, webUrl } = require('../src/main/link-routing-settings');

test('Orbe-style site rules normalize hosts and preserve path case and segment boundaries', () => {
  assert.equal(routeText('https://www.GitHub.com/MyOrg/'), 'github.com/MyOrg');
  assert.equal(routeMatches('github.com/MyOrg', 'https://gist.github.com/MyOrg/repo?x=1#part'), true);
  for (const url of ['https://evil.github.com.attacker.test/MyOrg', 'https://attacker.test/?github.com/MyOrg', 'https://github.com/MyOrganization', 'https://github.com/myorg']) assert.equal(routeMatches('github.com/MyOrg', url), false, url);
  assert.equal(routeMatches('example.com', 'https://example.com./'), true);
  assert.equal(routeText('*.example.com/path'), 'example.com/path');
  assert.equal(routeText('example.com/a/../work'), 'example.com/work');
});
test('ports, localhost and IPv6 route by parsed authority without credential or protocol tricks', () => {
  assert.equal(routeText('localhost:3000/work'), 'localhost:3000/work');
  assert.equal(routeMatches('localhost:3000/work', 'http://localhost:3000/work/item'), true);
  assert.equal(routeMatches('localhost:3000', 'http://localhost:3001/'), false);
  assert.equal(routeMatches('example.com:443', 'https://example.com/'), true);
  assert.equal(routeMatches('example.com:443', 'http://example.com/'), false);
  assert.equal(routeText('[::1]:8080/work'), '[::1]:8080/work');
  assert.equal(routeMatches('[::1]:8080/work', 'http://[::1]:8080/work/test'), true);
  for (const input of ['example.com@attacker.test', 'https://user:secret@example.com', 'javascript:alert(1)', 'file:///tmp', 'example.com:65536', 'example.com?x=1', 'example.com\\evil', ' ']) assert.equal(routeText(input), '', input);
});
test('routing order, fallback, persistence and failed saves keep destinations predictable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-route-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = new LinkRoutingSettings(path.join(dir, 'routing.json'));
  const spaces = [{ id: 'work' }];
  assert.equal(service.set({ defaultDestination: 'little', rules: [{ match: 'github.com/MyOrg', to: 'space:work' }, { match: 'github.com', to: 'main' }] }, spaces).success, true);
  assert.equal(service.destination('https://github.com/MyOrg/repo', spaces).to, 'space:work');
  assert.equal(service.destination('https://github.com/OtherOrg', spaces).to, 'main');
  assert.equal(service.destination('https://example.com/', spaces).to, 'little');
  assert.equal(service.destination('https://github.com/MyOrg/repo', []).to, 'main');
  assert.ok(service.set({ defaultDestination: 'main', rules: [{ match: 'x.com', to: 'space:missing' }] }, spaces).error);
  assert.ok(service.set({ defaultDestination: 'main', rules: [{ match: 'x.com', to: 'main' }, { match: 'https://x.com/', to: 'little' }] }, spaces).error);
  const loaded = new LinkRoutingSettings(service.file);
  loaded.load();
  assert.equal(loaded.destination('https://github.com/MyOrg/repo', spaces).to, 'space:work');
  service.file = path.join(dir, 'missing/file.json');
  assert.ok(service.set({ defaultDestination: 'main', rules: [] }, spaces).error);
  assert.equal(service.values.defaultDestination, 'little');
});
test('OS argument extraction accepts bounded web links and rejects internal or credential URLs', () => {
  assert.deepEqual(urlsFromArgs(['Shiira.exe', '--url=https://ignored.example', 'https://example.com/', 'file:///test', 'javascript:alert(1)', 'https://user:pass@example.com']), ['https://example.com/']);
  assert.equal(urlsFromArgs(Array(25).fill('https://example.com/')).length, 20);
  assert.equal(webUrl('https://example.com/\n'), null);
});
test('Little window search stays on websites and rejects privileged/internal schemes', async () => {
  const { littleAddress } = await import(pathToFileURL(path.join(__dirname, '../src/renderer/modules/external-links.js')).href);
  assert.equal(littleAddress('localhost:3000/work'), 'http://localhost:3000/work');
  assert.equal(littleAddress('example.com'), 'https://example.com/');
  assert.equal(littleAddress('hello & world', 'duckduckgo'), 'https://duckduckgo.com/?q=hello+%26+world');
  assert.equal(littleAddress('shiira://search?engine=brave&q=browser+tips'), 'https://search.brave.com/search?q=browser+tips');
  for (const url of ['file:///secret', 'shiira://home', 'javascript:alert(1)', 'https://u:p@example.com/']) assert.equal(littleAddress(url), null);
});

test('external delivery waits for its destination, accepts only its acknowledgement and cleans up', async t => {
  const { EventEmitter } = require('node:events');
  const { ExternalLinksService } = require('../src/main/external-links-service');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-route-delivery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = new EventEmitter(); app.getPath = () => dir;
  const ipc = new EventEmitter(), handlers = {};
  ipc.handle = (name, fn) => { handlers[name] = fn; };
  const sent = [];
  const sender = new EventEmitter(); sender.id = 10; sender.send = (name, value) => sent.push({ name, value });
  const main = new EventEmitter(); main.id = 1; main.webContents = sender;
  main.isDestroyed = () => false; main.isMinimized = () => false; main.show = () => {}; main.focus = () => {};
  let ensured = 0;
  const service = new ExternalLinksService({ app, ipcMain: ipc, isTrusted: e => e.trusted,
    BrowserWindow: { fromWebContents: wc => wc === sender ? main : null },
    getSpaces: () => [{ id: 'work' }], ensureMain: () => { ensured++; return main; } });
  service.start();
  const delivery = service.openMain('https://example.com/', 'work');
  assert.equal(sent.length, 0);
  ipc.emit('startup-ready', { trusted: true, sender });
  assert.equal(sent[0].name, 'external-link-open');
  assert.equal(sent[0].value.spaceId, 'work');
  ipc.emit('external-link-opened', { trusted: true, sender: { id: 11 } }, sent[0].value.requestId, { success: true });
  assert.equal(service.deliveries.size, 1);
  ipc.emit('external-link-opened', { trusted: true, sender }, sent[0].value.requestId, { success: true });
  assert.equal((await delivery).success, true);
  assert.equal(service.deliveries.size, 0);
  assert.equal(main.listenerCount('closed'), 0);
  const count = ensured;
  assert.ok((await service.openMain('file:///secret')).error);
  assert.ok((await service.openMain('https://example.com/', 'missing')).error);
  assert.equal(ensured, count);
  assert.ok((await handlers['external-links-save']({ trusted: false }, { defaultDestination: 'little', rules: [] })).error);
  const closed = service.openMain('https://second.example/');
  main.emit('closed');
  assert.ok((await closed).error);
  sender.emit('did-start-navigation', {}, 'file:///renderer/index.html', false, true);
  const beforeReload = sent.length;
  const queued = service.openMain('https://after-reload.example/');
  assert.equal(sent.length, beforeReload, 'reload clears readiness until the new renderer subscribes');
  ipc.emit('startup-ready', { trusted: true, sender });
  const latest = sent.at(-1).value;
  ipc.emit('external-link-opened', { trusted: true, sender }, latest.requestId, { success: true });
  assert.equal((await queued).success, true);
  const staleSpace = service.openMain('https://fallback.example/', 'missing', null, true);
  assert.equal(sent.at(-1).value.spaceId, null);
  assert.equal(sent.at(-1).value.fallbackToCurrent, true);
  ipc.emit('external-link-opened', { trusted: true, sender }, sent.at(-1).value.requestId, { success: true });
  assert.equal((await staleSpace).success, true);
});
