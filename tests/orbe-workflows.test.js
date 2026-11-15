const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.join(__dirname, '../src/renderer/modules', name + '.js')).href);
const { BoostsService, sanitizeBoost, originOf } = require('../src/main/boosts-service');

test('clean links retain functional parameters, fragments and nontracking site-specific si', async () => {
  const { cleanUrl, mdLink } = await load('page-tools-model');
  assert.equal(cleanUrl('https://example.com/?q=a&utm_source=test&fbclid=1&si=keep#part'), 'https://example.com/?q=a&si=keep#part');
  assert.equal(cleanUrl('https://youtu.be/abc?si=tracking&t=30'), 'https://youtu.be/abc?t=30');
  assert.equal(cleanUrl('https://example.com/?signature=a%20b'), 'https://example.com/?signature=a%20b');
  assert.equal(cleanUrl('file:///C:/test'), 'file:///C:/test');
  assert.equal(mdLink('Title [test]', 'https://example.com/a(b)'), '[Title \\[test\\]](https://example.com/a%28b%29)');
});

test('Space export round-trips ordered pinned trees through the import reader', async () => {
  const { spaceBookmarksHtml } = await load('page-tools-model');
  const { bookmarkPlan } = await load('browser-import');
  const tabs = [{ spaceId: 's', section: 'pinned', position: 1, parentId: null, title: 'Root & page', pinnedUrl: 'https://root.example/?a=1&b=2' },
    { spaceId: 's', section: 'pinned', position: 0, parentId: 'f', title: 'Nested', url: 'https://nested.example/' },
    { spaceId: 's', section: 'today', url: 'https://today.example/' }, { spaceId: 's', section: 'pinned', privateMode: true, url: 'https://private.example/' }];
  const html = spaceBookmarksHtml({ id: 's', title: 'Work <test>' }, tabs, [{ id: 'f', spaceId: 's', parentId: null, position: 0, title: 'Research' }]);
  assert.ok(!html.includes('private.example') && !html.includes('today.example'));
  const parsed = require('../src/main/import-bookmarks').parse(html);
  assert.equal(parsed.bookmarks, 2);
  assert.equal(parsed.nodes[0].name, 'Research');
  assert.equal(parsed.nodes[1].title, 'Root & page');
  const plan = bookmarkPlan(parsed.nodes, 'new');
  assert.equal(plan.tabs[0].parentId, plan.folders[0].id);
  assert.equal(plan.tabs[1].parentId, null);
});

test('MRU snapshot order puts the current tab first and excludes closing tabs', async () => {
  const { recentTabs } = await load('page-tools-model');
  const tabs = [{ id: 'old', lastActiveAt: 1 }, { id: 'recent', lastActiveAt: 10 }, { id: 'current', lastActiveAt: 8 }, { id: 'closed', lastActiveAt: 20, element: { classList: { contains: () => true } } }];
  assert.deepEqual(recentTabs(tabs, 'current'), ['current', 'recent', 'old']);
});

test('tab maintenance protects edited forms, PiP, calls and keep-alive hosts', async () => {
  const { shouldSleep, shouldArchive } = await load('spaces-model');
  const { keepAliveSite } = await load('tab-lifecycle');
  const now = 100000000;
  const tab = { id: 't', section: 'today', url: 'https://example.com/', webview: {}, lastActiveAt: 1 };
  assert.equal(shouldSleep(tab, { now, minutes: 30 }), true);
  for (const patch of [{ hasUserInput: true }, { isPictureInPicture: true }, { hasMediaPermission: true }, { url: 'https://docs.google.com/document/d/1' }]) {
    assert.equal(shouldSleep({ ...tab, ...patch }, { now, minutes: 30 }), false);
    assert.equal(shouldArchive({ ...tab, ...patch }, { now, hours: 12 }), false);
  }
  assert.equal(keepAliveSite('https://mail.google.com.evil.example/mail'), false);
  assert.equal(keepAliveSite('https://example.com/?url=https://mail.google.com/mail'), false);
});

test('two to four split panes cover the available space without overlaps in every layout', async () => {
  const { splitRects } = await load('split-layout');
  for (const count of [2, 3, 4]) for (const layout of ['columns', 'rows', 'grid']) {
    const rects = splitRects(count, layout, .35);
    assert.equal(rects.length, count);
    assert.ok(Math.abs(rects.reduce((sum, r) => sum + r.width * r.height, 0) - 1) < 1e-10);
    for (const [i, r] of rects.entries()) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1.00001 && r.y + r.height <= 1.00001);
      for (const other of rects.slice(i + 1)) assert.ok(r.x + r.width <= other.x + 1e-10 || other.x + other.width <= r.x + 1e-10 || r.y + r.height <= other.y + 1e-10 || other.y + other.height <= r.y + 1e-10);
    }
  }
  assert.deepEqual(splitRects(5), []);
});

test('Boosts reject selector injection and whole-page zaps, persist atomically and isolate origins', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-boost-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = new BoostsService(path.join(dir, 'boosts.json'));
  service.set('https://example.com', { css: 'p { color: red; }', zaps: ['#ad', 'body', '*', 'div} body {', '@import "x"', '#ad', ':is(body)', 'html > body'] });
  assert.deepEqual(service.get('https://example.com').zaps, ['#ad']);
  assert.equal(service.get('http://example.com').css, '');
  const loaded = new BoostsService(service.file);
  loaded.load();
  assert.deepEqual(loaded.get('https://example.com'), service.get('https://example.com'));
  assert.throws(() => loaded.set('file:///secret', {}));
  assert.equal(originOf('https://example.com:444/path'), 'https://example.com:444');
  assert.equal(sanitizeBoost({ css: 'a'.repeat(60000) }).css.length, 50000);
  loaded.set('https://example.com', {});
  assert.equal(Object.keys(loaded.values).length, 0);
});

test('developer mode recognizes only local HTTP hosts', async () => {
  const { isLocalDevelopment } = await load('page-tools');
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]:8080/']) assert.equal(isLocalDevelopment(url), true);
  for (const url of ['https://localhost.evil.example/', 'https://example.com/?host=localhost', 'file:///localhost']) assert.equal(isLocalDevelopment(url), false);
});

test('automatic PiP only closes the PiP it opened and respects split visibility and site opt-out', async t => {
  const { PageToolsMixin } = await load('page-tools');
  const previousStorage = global.localStorage;
  const stored = new Map();
  global.localStorage = { getItem: key => stored.get(key) ?? null };
  t.after(() => { global.localStorage = previousStorage; });
  const calls = [];
  const previousWindow = global.window;
  global.window = { shiiraAPI: { pageTools: { mediaControl: async (_id, action) => { calls.push(action); return true; } } } };
  t.after(() => { global.window = previousWindow; });
  const tab = { id: 'video', isPlayingAudio: true, url: 'https://video.example/', webview: { getWebContentsId: () => 42 } };
  const b = { ...PageToolsMixin, tabs: [tab], activeTabId: 'other' };
  b.handleMediaTabChange('video', 'other');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tab.autoPictureInPicture, true);
  b.activeTabId = 'video';
  b.handleMediaTabChange('other', 'video');
  assert.equal(tab.autoPictureInPicture, false);
  assert.equal(calls.at(-1), 'exit-auto-pip');
  calls.length = 0;
  b.splitPair = ['video', 'other'];
  b.handleMediaTabChange('video', 'other');
  assert.equal(calls.length, 0);
  stored.clear();
  tab.webview.getWebContentsId = () => { throw new Error('Webview is not attached'); };
  assert.doesNotThrow(() => b.handleMediaTabChange('video', 'other'));
  tab.autoPictureInPicture = true;
  assert.doesNotThrow(() => b.handleMediaTabChange('other', 'video'));
  b.splitPair = null;
  stored.set('shiira-auto-pip-off:https://video.example', 'true');
  b.handleMediaTabChange('video', 'other');
  assert.equal(calls.length, 0);
});
