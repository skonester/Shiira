// Ported from Solamar's tests/arc-parse.test.ts (https://github.com/Bambeek/solamar, GPL-3.0-or-later).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ArcFormatError, parseArcSidebar, parseArcArchive, arcTime, colorToHex, readArcJson,
  countNodes, summarizePlan, locateArcSidebar, resolveArcSource, readArcPlan, readHistory
} = require('../src/main/arc-importer');

const fixturePath = path.join(__dirname, 'fixtures', 'arc-sidebar.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

test('reads spaces in order with emoji, colour and profile', () => {
  const plan = parseArcSidebar(fixture);
  assert.deepEqual(plan.spaces.map((s) => s.title), ['Work', 'Fun']);
  assert.equal(plan.spaces[0].emoji, '💼');
  assert.equal(plan.spaces[0].color, '#3366cc'); // 0-1 components
  assert.equal(plan.spaces[1].color, '#ff8000'); // 0-255 components
  assert.equal(plan.spaces[0].profile, 'default');
  assert.match(plan.spaces[1].profile, /^custom:/);
});

test('keeps pinned folders nested and prefers the user rename', () => {
  const plan = parseArcSidebar(fixture);
  const [doc, research] = plan.spaces[0].pinned;
  assert.deepEqual(doc, { kind: 'tab', url: 'https://docs.example.com/a', title: 'My doc', customTitle: 'My doc', lastActiveAt: arcTime(2) });
  assert.equal(research.kind, 'folder');
  assert.equal(research.title, 'Research');
  assert.equal(research.children[1].children[0].url, 'https://news.example.net/');
  assert.deepEqual(countNodes(plan.spaces[0].pinned), { tabs: 3, folders: 2 });
});

test('maps unpinned to today and skips missing ids', () => {
  const plan = parseArcSidebar(fixture);
  assert.deepEqual(plan.spaces[0].today.map((n) => n.title), ['Shop']);
  assert.deepEqual(plan.spaces[1].pinned, []);
  assert.deepEqual(plan.spaces[1].today.map((n) => n.url), ['https://video.example.com/']);
});

test('reads favorites and summarizes the plan', () => {
  const plan = parseArcSidebar(fixture);
  assert.deepEqual(plan.favorites.map((n) => n.title), ['Mail', 'Calendar']);
  assert.deepEqual(summarizePlan(plan), { spaces: 2, pinned: 3, today: 2, folders: 2, favorites: 2, profiles: 2, archive: 0, historyProfiles: 0 });
});

test('rejects other files and newer versions', () => {
  assert.throws(() => parseArcSidebar({ foo: 1 }), ArcFormatError);
  assert.throws(() => parseArcSidebar({ ...fixture, version: 2 }), /newer/);
});

test('survives cycles in the item tree', () => {
  const doc = JSON.parse(JSON.stringify(fixture));
  const main = doc.sidebar.containers.find((c) => c.items);
  // Make the first folder contain itself.
  for (let i = 1; i < main.items.length; i += 2) {
    const item = main.items[i];
    if (item?.data?.list) {
      item.childrenIds = [...(item.childrenIds || []), item.id];
      break;
    }
  }
  assert.doesNotThrow(() => parseArcSidebar(doc));
});

test('finds the Arc file in the Windows Store package folder', (t) => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-arc-'));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const dir = path.join(local, 'Packages', 'TheBrowserCompany.Arc_ttt1ap7aakyb4', 'LocalCache', 'Local', 'Arc');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'StorableSidebar.json');
  fs.copyFileSync(fixturePath, file);
  assert.equal(locateArcSidebar({ LOCALAPPDATA: local }, 'win32', local), file);
  assert.equal(locateArcSidebar({ LOCALAPPDATA: path.join(local, 'none') }, 'win32', local), null);
  assert.equal(readArcPlan(file).spaces.length, 2);
});

test('reports a clear error for files that are not JSON', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-arc-bad-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'StorableSidebar.json');
  fs.writeFileSync(file, 'not json');
  assert.throws(() => readArcPlan(file), /not valid JSON/);
});

const clone = () => structuredClone(fixture);
const mainOf = (doc) => doc.sidebar.containers.find(c => c.items);
const itemOf = (main, id) => main.items[main.items.indexOf(id) + 1];
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-arc-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('imports YARC’s sanitized real-format fixture with all profiles and split children', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/yarc-arc-sidebar.json'), 'utf8'));
  const out = parseArcSidebar(doc, { now: 1234 });
  assert.deepEqual(out.spaces.map(s => s.title), ['Personal', 'Work']);
  assert.deepEqual(out.profiles.map(p => p.directory), ['Default', 'Profile 1']);
  assert.equal(out.favorites.length, 3);
  assert.equal(out.spaces[0].color, '#55afff');
  assert.equal(out.spaces[0].today.length, 3);
  assert.ok(out.spaces.flatMap(s => s.today).every(tab => tab.lastActiveAt === 1234));
});

test('falls back to newContainerIDs and parentID when child lists are absent', () => {
  const doc = clone();
  const main = mainOf(doc);
  main.spaces[1].containerIDs = [];
  delete itemOf(main, 'D1').childrenIds;
  const out = parseArcSidebar(doc);
  assert.equal(countNodes(out.spaces[0].pinned).tabs, 3);
  assert.equal(out.spaces[0].pinned[1].children[1].children[0].title, 'News');
});

test('merges containers and reads object maps, object arrays and Swift value wrappers', () => {
  const doc = clone();
  const main = mainOf(doc);
  const spaces = [main.spaces[1], main.spaces[3]];
  const items = Object.fromEntries(Array.from({ length: main.items.length / 2 }, (_, n) => [main.items[2 * n], { value: main.items[2 * n + 1] }]));
  doc.sidebar.containers = [{ spaces }, { items, topAppsContainerIDs: main.topAppsContainerIDs }, { spaces: { S1: spaces[0] } }];
  const out = parseArcSidebar(doc);
  assert.deepEqual(out.spaces.map(s => s.title), ['Work', 'Fun']);
  assert.equal(out.favorites.length, 2);
  assert.equal(countNodes(out.spaces[0].pinned).tabs, 3);
});

test('legacy sync mirrors preserve ordered spaces', () => {
  const main = mainOf(clone());
  for (const wrapper of ['sidebarSyncState', 'firebaseSyncState']) {
    const legacy = { spaceModels: main.spaces, items: main.items, container: { value: { topAppsContainerID: 'TOP', orderedSpaceIDs: ['S2', 'S1'] } } };
    const out = parseArcSidebar(wrapper === 'sidebarSyncState' ? { [wrapper]: legacy } : { firebaseSyncState: { syncData: legacy } });
    assert.deepEqual(out.spaces.map(s => s.title), ['Fun', 'Work']);
    assert.equal(out.favorites.length, 2);
  }
});

test('favorites include each profile and skip another machine’s copy of a used profile', () => {
  const doc = clone();
  const main = mainOf(doc);
  const desc = (machine) => ({ custom: { _0: { directoryBasename: 'Profile 1', machineID: machine } } });
  main.spaces[3].profile = desc('local');
  main.topAppsContainerIDs.push(desc('local'), 'WORK-TOP', desc('remote'), 'REMOTE-TOP');
  main.items.push('WORK-TOP', { childrenIds: ['WF'], data: { itemContainer: {} } },
    'WF', { data: { tab: { savedURL: 'https://work.example/', savedTitle: 'Work mail' } } },
    'REMOTE-TOP', { childrenIds: ['RF'], data: { itemContainer: {} } },
    'RF', { data: { tab: { savedURL: 'https://remote.example/' } } });
  const out = parseArcSidebar(doc);
  assert.equal(out.favorites.length, 3);
  assert.equal(out.profiles.find(p => p.directory === 'Profile 1').favorites[0].title, 'Work mail');
  assert.ok(out.warnings.some(w => w.includes('another computer')));
  delete main.topAppsContainerIDs;
  const fallback = parseArcSidebar(doc);
  assert.equal(fallback.favorites.length, 2);
});

test('repairs Windows raw backslashes and BOMs, but rejects broken JSON', () => {
  const raw = String.raw`{"url":"file:///C:\Users\me\a.html","home":"C:\users","ok":"\u0041"}`;
  assert.equal(readArcJson(raw).ok, 'A');
  assert.equal(readArcJson(raw).home, String.raw`C:\users`);
  assert.deepEqual(readArcJson('\uFEFF{"ok":true}'), { ok: true });
  assert.throws(() => readArcJson('{not-json'), ArcFormatError);
});

test('named icons, background themes and extended sRGB survive import', () => {
  const doc = clone();
  mainOf(doc).spaces[1].customInfo = { iconType: { icon: 'planet' }, windowTheme: { background: { gradient: [{ red: 0.2, green: 0.4, blue: 0.6, alpha: 1 }] } } };
  const out = parseArcSidebar(doc);
  assert.equal(out.spaces[0].emoji, '🪐');
  assert.equal(out.spaces[0].color, '#336699');
  assert.equal(colorToHex({ red: -0.2, green: 1.5, blue: 0.5 }), '#00ff80');
  assert.equal(colorToHex({ red: 1, green: 1, blue: 1, alpha: 0 }), undefined);
  assert.equal(arcTime(1640995200000), 1640995200000);
});

test('archive accepts Swift pairs, object maps and object arrays with Cocoa timestamps', () => {
  const entry = { archivedAt: 783000000, source: { space: { _0: 'S2' } }, sidebarItem: { title: 'Saved name', data: { tab: { savedURL: 'https://archived.example/', savedTitle: 'Page title' } } } };
  for (const items of [['id', entry], [entry], { id: entry }]) {
    const [out] = parseArcArchive({ items });
    assert.equal(out.title, 'Saved name');
    assert.equal(out.spaceArcId, 'S2');
    assert.equal(out.archivedAt, arcTime(783000000));
  }
  assert.deepEqual(parseArcArchive({ items: [{ sidebarItem: { data: { tab: { savedURL: 'javascript:alert(1)' } } } }] }), []);
});

test('copied Arc folders resolve from root, User Data, Application Support and MSIX folders', (t) => {
  const parent = tempDir(t);
  const root = path.join(parent, 'Arc');
  fs.mkdirSync(path.join(root, 'User Data'), { recursive: true });
  const file = path.join(root, 'StorableSidebar.json');
  fs.copyFileSync(fixturePath, file);
  for (const candidate of [parent, root, path.join(root, 'User Data'), file]) assert.equal(resolveArcSource(candidate).sidebarFile, file);
  const msix = path.join(parent, 'package');
  fs.mkdirSync(path.join(msix, 'LocalCache', 'Local', 'Arc'), { recursive: true });
  fs.copyFileSync(file, path.join(msix, 'LocalCache', 'Local', 'Arc', 'StorableSidebar.json'));
  assert.equal(readArcPlan(msix).spaces.length, 2);
  assert.throws(() => resolveArcSource(tempDir(t)), /No StorableSidebar/);
});

test('reads cached PNG icons, archive and window preferences without changing source files', (t) => {
  const root = tempDir(t);
  fs.copyFileSync(fixturePath, path.join(root, 'StorableSidebar.json'));
  fs.writeFileSync(path.join(root, 'StorableWindows.json'), JSON.stringify({ lastFocusedSpaceID: 'S2', sidebarViewPreferences: { sidebarWidth: 999 } }));
  fs.writeFileSync(path.join(root, 'StorableArchiveItems.json'), JSON.stringify({ items: [{ archivedAt: 123, source: { space: { _0: 'S1' } }, sidebarItem: { data: { tab: { savedURL: 'https://archive.example/' } } } }] }));
  const { createHash } = require('node:crypto');
  fs.mkdirSync(path.join(root, 'SidebarItemsFaviconCache'));
  const iconFile = path.join(root, 'SidebarItemsFaviconCache', createHash('md5').update('T1').digest('hex'));
  fs.writeFileSync(iconFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=', 'base64'));
  const before = fs.readFileSync(path.join(root, 'StorableSidebar.json'));
  const out = readArcPlan(root);
  assert.match(out.spaces[0].pinned[0].favicon, /^data:image\/png;base64,/);
  assert.equal(out.focusedSpaceId, 'S2');
  assert.equal(out.sidebarWidth, 420);
  assert.equal(out.archive.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, 'StorableSidebar.json')), before);
  fs.writeFileSync(path.join(root, 'StorableArchiveItems.json'), 'broken');
  assert.ok(readArcPlan(root).warnings.some(w => w.includes('StorableArchiveItems')));
});

test('history reads a copy including live WAL, filters hidden/internal URLs, and leaves Arc untouched', (t) => {
  const { DatabaseSync } = require('node:sqlite');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-arc-wal-'));
  fs.copyFileSync(fixturePath, path.join(root, 'StorableSidebar.json'));
  const profile = path.join(root, 'User Data', 'Default');
  fs.mkdirSync(profile, { recursive: true });
  const file = path.join(profile, 'History');
  const db = new DatabaseSync(file);
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER, hidden INTEGER)');
  const add = db.prepare('INSERT INTO urls VALUES (?, ?, ?, ?)');
  const timestamp = Date.UTC(2026, 10, 1);
  add.run('https://history.example/', 'A visit', (timestamp + 11644473600000) * 1000, 0);
  add.run('arc://settings', 'Internal', (timestamp + 11644473600000) * 1000, 0);
  add.run('https://hidden.example/', 'Hidden', (timestamp + 11644473600000) * 1000, 1);
  const before = [file, file + '-wal'].map(f => fs.readFileSync(f));
  assert.equal(readHistory(profile).length, 1);
  assert.equal(readArcPlan(root).history.length, 0); // Preview does not open the database.
  const out = readArcPlan(root, { includeHistory: true });
  assert.deepEqual(out.history, [{ url: 'https://history.example/', title: 'A visit', timestamp }]);
  assert.deepEqual([file, file + '-wal'].map(f => fs.readFileSync(f)), before);
  assert.equal(readHistory(profile).length, 1);
});

test('unreadable history is a warning, and unsafe profile dirs never leave User Data', (t) => {
  const root = tempDir(t);
  const doc = clone();
  mainOf(doc).spaces[3].profile = { custom: { _0: { directoryBasename: '../../outside' } } };
  fs.writeFileSync(path.join(root, 'StorableSidebar.json'), JSON.stringify(doc));
  fs.mkdirSync(path.join(root, 'User Data/Default'), { recursive: true });
  fs.writeFileSync(path.join(root, 'User Data/Default/History'), 'invalid sqlite');
  const out = readArcPlan(root, { includeHistory: true });
  assert.equal(out.historyProfiles.length, 1);
  assert.equal(out.history.length, 0);
  assert.ok(out.warnings.some(w => w.includes('Quit Arc')));
});
