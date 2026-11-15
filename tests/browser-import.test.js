const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bm = require('../src/main/import-bookmarks');
const browsers = require('../src/main/import-browsers');
const { runImportTask, installBrowserImports } = require('../src/main/browser-import-service');
const { mozlz4, bplist } = require('./fixtures/bookmarks/formats.cjs');
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-import-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const chrome = children => JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children } } });
const link = (name = 'Example') => ({ type: 'url', name, url: 'https://example.com/?q=one&x=two' });

test('Orbe HTML readers preserve Chrome, Firefox and Safari folder nesting and order', () => {
  for (const browser of ['chrome', 'firefox', 'safari']) {
    const data = bm.read(path.join(__dirname, 'fixtures/bookmarks', browser + '.html'));
    assert.equal(data.error, undefined, browser);
    assert.ok(data.bookmarks >= 3);
    assert.ok(data.folders >= 1);
    assert.ok(data.nodes.some(n => n.type === 'folder'));
  }
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bar</H3><DL><DT><H3>Work &amp; Play</H3><DL><DT><A ADD_DATE='1' HREF='https://example.com/?a=1&amp;b=2'>A &#x1f680;</A></DL><DT><A HREF=https://second.example>Second</A></DL></DL>`;
  const data = bm.parse(html);
  assert.equal(data.bookmarks, 2);
  assert.equal(data.nodes[0].name, 'Work & Play');
  assert.equal(data.nodes[0].children[0].title, 'A 🚀');
  assert.equal(data.nodes[0].children[0].url, 'https://example.com/?a=1&b=2');
  assert.equal(data.nodes[1].title, 'Second');
});

test('bookmark parsing filters executable and credential URLs and caps hostile nesting/items', () => {
  const bad = ['javascript:alert(1)', 'data:text/html,test', 'file:///secret', 'place:sort=8', 'https://user:pass@example.com/'];
  const parsed = bm.parse('<DL>' + bad.map(url => `<A HREF="${url}">bad</A>`).join('') + '<A HREF="https://safe.example/">Safe</A></DL>');
  assert.equal(parsed.bookmarks, 1);
  assert.equal(parsed.dropped, 5);
  const deep = bm.parse('<DL>' + '<H3>Folder</H3><DL>'.repeat(1000) + '<A HREF="https://safe.example/">Safe</A>' + '</DL>'.repeat(1001));
  assert.equal(deep.bookmarks, 1);
  assert.ok(deep.folders <= bm.MAX_DEPTH);
  const many = bm.parse('<DL>' + '<A HREF="https://safe.example/">Safe</A>'.repeat(4000) + '</DL>');
  assert.equal(many.bookmarks, bm.MAX_BOOKMARKS);
  assert.equal(many.truncated, true);
});

test('worker detects Chromium profiles and rejects unlisted profile IDs without touching sources', async t => {
  const home = temp(t);
  const local = path.join(home, 'AppData/Local');
  const file = path.join(local, 'Microsoft/Edge/User Data/Default/Bookmarks');
  const data = chrome([link(), { type: 'folder', name: 'Nested', children: [link('Nested page')] }]);
  write(file, data);
  write(path.join(local, 'Microsoft/Edge/User Data/Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' } } } }));
  const config = { home, local, roaming: path.join(home, 'AppData/Roaming'), platform: 'win32' };
  const detected = await runImportTask({ task: 'detect', config });
  assert.deepEqual(detected.map(b => b.id), ['edge']);
  assert.equal(detected[0].profiles[0].name, 'Personal');
  const read = await runImportTask({ task: 'browser', browserId: 'edge', profileId: 'Default', config });
  assert.equal(read.bookmarks, 2);
  assert.equal(read.nodes[1].name, 'Nested');
  assert.equal(fs.readFileSync(file, 'utf8'), data);
  assert.equal((await runImportTask({ task: 'browser', browserId: 'edge', profileId: '../../../', config })).error, 'missing');
});

test('Firefox reads a live WAL copy through bundled SQLite, preserving every source byte', async t => {
  const dir = temp(t);
  const file = path.join(dir, 'places.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, parent INTEGER, position INTEGER, guid TEXT, title TEXT, fk INTEGER);
    INSERT INTO moz_places VALUES (1, 'https://firefox.example/');
    INSERT INTO moz_bookmarks VALUES (1, 2, 0, 0, 'toolbar_____', 'Bar', NULL), (2, 2, 1, 0, 'folder', 'Work', NULL), (3, 1, 2, 0, 'link', 'Page', 1);`);
  try {
    const before = [file, file + '-wal', file + '-shm'].map(f => fs.readFileSync(f));
    const result = await browsers.readFirefoxSqlite(dir);
    assert.equal(result.source, 'sqlite');
    assert.equal(result.bookmarks, 1);
    assert.equal(result.nodes[0].children[0].url, 'https://firefox.example/');
    [file, file + '-wal', file + '-shm'].forEach((f, i) => assert.deepEqual(fs.readFileSync(f), before[i]));
  } finally { db.close(); }
});

test('Firefox backup and Safari binary plist readers handle their native formats', async t => {
  const dir = temp(t);
  const ff = { type: 'text/x-moz-place-container', children: [{ root: 'toolbarFolder', type: 'text/x-moz-place-container', children: [{ type: 'text/x-moz-place', title: 'Backup page', uri: 'https://backup.example/' }] }] };
  write(path.join(dir, 'bookmarkbackups/bookmarks-2026-11-14_1_test.jsonlz4'), mozlz4(ff));
  const backup = browsers.readFirefoxBackup(dir);
  assert.equal(backup.bookmarks, 1);
  assert.equal(backup.date, '2026-11-14');
  assert.throws(() => browsers.mozlz4(Buffer.alloc(12)));
  assert.throws(() => browsers.lz4Block(Buffer.from([0, 0, 0]), 4));
  const safari = { Children: [{ Title: 'BookmarksBar', WebBookmarkType: 'WebBookmarkTypeList', Children: [{ WebBookmarkType: 'WebBookmarkTypeLeaf', URLString: 'https://safari.example/', URIDictionary: { title: 'Safari 🚀' } }] }] };
  const plist = path.join(dir, 'Bookmarks.plist');
  fs.writeFileSync(plist, bplist(safari));
  const result = browsers.readSafari(plist);
  assert.equal(result.bookmarks, 1);
  assert.equal(result.nodes[0].title, 'Safari 🚀');
  assert.throws(() => browsers.bplist(Buffer.alloc(40)));
});

test('import previews are bound to their UI window and cannot read renderer-supplied paths', async t => {
  const dir = temp(t), handlers = {};
  const file = path.join(dir, 'bookmarks.html');
  fs.writeFileSync(file, '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><A HREF="https://example.com/">Test</A></DL>');
  installBrowserImports({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, isTrusted: e => e.trusted,
    BrowserWindow: { fromWebContents: () => ({}) }, dialog: { showOpenDialog: async () => ({ filePaths: [file] }) }, bookmarksService: { importTree: () => ({ success: true, imported: { bookmarks: 1 } }) } });
  const owner = { trusted: true, sender: { id: 1, once() {} } };
  const other = { trusted: true, sender: { id: 2, once() {} } };
  assert.ok((await handlers['browser-import-preview']({ trusted: false }, {})).error);
  const preview = await handlers['browser-import-preview'](owner, { kind: 'file', file: 'C:/not-allowed.html' });
  assert.equal(preview.bookmarks, 1);
  assert.ok(preview.token);
  assert.ok((await handlers['browser-import-apply'](other, preview.token, 'bar')).error);
  assert.equal((await handlers['browser-import-apply'](owner, preview.token, 'bar')).success, true);
  assert.ok((await handlers['browser-import-apply'](owner, preview.token, 'bar')).error);
  const expired = await handlers['browser-import-preview'](owner, { kind: 'file' });
  const later = Date.now() + 16 * 60000;
  t.mock.method(Date, 'now', () => later);
  assert.ok((await handlers['browser-import-apply'](owner, expired.token, 'bar')).error);
});

test('bookmarks bar imports batch one atomic save, deduplicate per folder and roll back failed saves', t => {
  const vm = require('node:vm');
  const Module = require('node:module');
  const file = require.resolve('../src/main/bookmarks-service');
  const localRequire = Module.createRequire(file);
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, exports: mod.exports, Buffer, URL, Date, structuredClone,
    console: { error() {} }, require: name => name === 'electron' ? { app: { isPackaged: true } } : localRequire(name) });
  const service = new mod.exports();
  service.configPath = path.join(temp(t), 'bookmarks.json');
  const nodes = [{ type: 'folder', name: 'Work', children: [{ type: 'tab', title: 'A', url: 'https://example.com/' }] }];
  const result = service.importTree(nodes, 'Chrome');
  assert.equal(result.success, true);
  assert.equal(result.imported.bookmarks, 1);
  assert.equal(fs.existsSync(service.configPath), true);
  assert.equal(fs.existsSync(service.configPath + '.tmp'), false);
  assert.equal(service.importTree(nodes, 'Chrome').imported.skipped, 1);
  const saved = JSON.stringify(service.bookmarks);
  service.configPath = path.join(service.configPath, 'missing', 'bookmarks.json');
  const failed = service.importTree([{ type: 'tab', title: 'B', url: 'https://second.example/' }], 'Second');
  assert.equal(failed.success, false);
  assert.equal(JSON.stringify(service.bookmarks), saved);
});
