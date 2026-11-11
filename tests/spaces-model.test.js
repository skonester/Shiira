const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseArcSidebar } = require('../src/main/arc-importer');

const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/modules/spaces-model.js')).href);

const tab = (id, section, extra = {}) => ({ id, section, spaceId: section === 'favorites' ? null : 's1', parentId: null, position: 0, ...extra });

test('visible order is favorites, pinned depth-first, then today', async () => {
  const { visibleOrder } = await load();
  const tabs = [
    tab('today-b', 'today', { position: 1 }),
    tab('today-a', 'today', { position: 0 }),
    tab('fav', 'favorites'),
    tab('pin-in-folder', 'pinned', { parentId: 'f1', position: 0 }),
    tab('pin-top', 'pinned', { position: 0 }),
    tab('other-space', 'today', { spaceId: 's2' })
  ];
  const folders = [{ id: 'f1', spaceId: 's1', parentId: null, position: 1 }];
  assert.deepEqual(visibleOrder(tabs, folders, 's1').map((t) => t.id), ['fav', 'pin-top', 'pin-in-folder', 'today-a', 'today-b']);
});

test('insertAt moves an item and renumbers its siblings', async () => {
  const { siblings, insertAt } = await load();
  const tabs = [tab('a', 'today', { position: 0 }), tab('b', 'today', { position: 1 }), tab('c', 'today', { position: 2 })];
  const list = siblings(tabs, [], { section: 'today', spaceId: 's1' });
  insertAt(list, { kind: 'tab', id: 'c', ref: tabs[2] }, 0);
  assert.deepEqual([...tabs].sort((x, y) => x.position - y.position).map((t) => t.id), ['c', 'a', 'b']);
  insertAt(siblings(tabs, [], { section: 'today', spaceId: 's1' }), { kind: 'tab', id: 'c', ref: tabs[2] }, Infinity);
  assert.deepEqual([...tabs].sort((x, y) => x.position - y.position).map((t) => t.id), ['a', 'b', 'c']);
});

test('a folder cannot be dropped into itself or its children', async () => {
  const { isInsideFolder, folderTree } = await load();
  const folders = [
    { id: 'f1', parentId: null },
    { id: 'f2', parentId: 'f1' },
    { id: 'f3', parentId: 'f2' },
    { id: 'f4', parentId: null }
  ];
  assert.equal(isInsideFolder(folders, 'f3', 'f1'), true);
  assert.equal(isInsideFolder(folders, 'f1', 'f1'), true);
  assert.equal(isInsideFolder(folders, 'f4', 'f1'), false);
  assert.deepEqual(folderTree(folders, 'f2').sort(), ['f2', 'f3']);
});

test('archive and sleep rules protect what you are using', async () => {
  const { shouldArchive, shouldSleep } = await load();
  const now = 100 * 60 * 60 * 1000;
  const old = now - 13 * 60 * 60 * 1000;
  assert.equal(shouldArchive(tab('t', 'today', { lastActiveAt: old }), { now, hours: 12 }), true);
  assert.equal(shouldArchive(tab('t', 'today', { lastActiveAt: old }), { now, hours: 0 }), false);
  assert.equal(shouldArchive(tab('t', 'pinned', { lastActiveAt: old }), { now, hours: 12 }), false);
  assert.equal(shouldArchive(tab('t', 'today', { lastActiveAt: old }), { now, hours: 12, activeIds: ['t'] }), false);
  assert.equal(shouldArchive(tab('t', 'today', { lastActiveAt: old, isPlayingAudio: true }), { now, hours: 12 }), false);
  assert.equal(shouldArchive(tab('t', 'today', { lastActiveAt: old, privateMode: true }), { now, hours: 12 }), false);

  const idle = now - 31 * 60 * 1000;
  assert.equal(shouldSleep(tab('t', 'pinned', { lastActiveAt: idle, webview: {} }), { now, minutes: 30 }), true);
  assert.equal(shouldSleep(tab('t', 'pinned', { lastActiveAt: idle, webview: null }), { now, minutes: 30 }), false);
  assert.equal(shouldSleep(tab('t', 'pinned', { lastActiveAt: now, webview: {} }), { now, minutes: 30 }), false);
});

test('an Arc plan becomes spaces, nested pinned folders and favorites', async () => {
  const { planFromArc } = await load();
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'arc-sidebar.json'), 'utf-8'));
  const plan = parseArcSidebar(fixture);
  let n = 0;
  const makeId = (prefix) => `${prefix}${++n}`;
  const result = planFromArc(plan, {
    existingSpaces: [{ id: 'space-personal', title: 'Work', position: 0 }],
    existingFavoriteUrls: ['https://mail.example.com/'],
    includeToday: true,
    makeId
  });
  assert.deepEqual(result.spaces.map((s) => s.title), ['Work (Arc)', 'Fun']);
  assert.deepEqual(result.spaces.map((s) => s.position), [1, 2]);
  assert.equal(result.spaces[0].icon, '💼');
  assert.equal(result.spaces[0].color, '#3366cc');
  const work = result.spaces[0].id;
  assert.equal(result.folders.filter((f) => f.spaceId === work).length, 2);
  const nested = result.folders.find((f) => f.parentId);
  assert.ok(result.folders.some((f) => f.id === nested.parentId));
  assert.equal(result.tabs.filter((t) => t.section === 'pinned').length, 3);
  assert.equal(result.tabs.filter((t) => t.section === 'today').length, 2);
  // Mail is already a favorite, so only Calendar comes over.
  assert.deepEqual(result.tabs.filter((t) => t.section === 'favorites').map((t) => t.title), ['Calendar']);
  const withoutToday = planFromArc(plan, { includeToday: false, makeId });
  assert.equal(withoutToday.tabs.filter((t) => t.section === 'today').length, 0);
});

test('letter icons and shades are stable', async () => {
  const { letterIcon, shade, hostOf } = await load();
  assert.deepEqual(letterIcon('https://www.github.com/x'), letterIcon('https://github.com/y'));
  assert.equal(letterIcon('https://mail.google.com').letter, 'G');
  assert.equal(shade('#000000', 0.5), '#808080');
  assert.equal(shade('#ffffff', -1), '#000000');
  assert.equal(hostOf('not a url'), '');
});

test('Arc migration keeps custom titles, file URLs, icons, archive space links and unique names', async () => {
  const { planFromArc } = await load();
  let n = 0;
  const result = planFromArc({
    spaces: [{ id: 'old', title: 'Work', pinned: [{ kind: 'tab', url: 'file:///C:/docs/index.html', title: 'My docs', customTitle: 'My docs', favicon: 'data:image/png;base64,icon', lastActiveAt: 50 }], today: [] }],
    favorites: [], focusedSpaceId: 'old', archive: [{ url: 'https://archived.example/', title: 'Archived', spaceArcId: 'old', archivedAt: 100 }]
  }, { existingSpaces: [{ title: 'Work' }, { title: 'Work (Arc)' }], makeId: prefix => `${prefix}${++n}` });
  assert.equal(result.spaces[0].title, 'Work (Arc 2)');
  assert.equal(result.tabs[0].customTitle, 'My docs');
  assert.equal(result.tabs[0].pinnedUrl, 'file:///C:/docs/index.html');
  assert.equal(result.tabs[0].lastActiveAt, 50);
  assert.equal(result.tabs[0].favicon, 'data:image/png;base64,icon');
  assert.equal(result.archive[0].spaceId, result.spaces[0].id);
  assert.equal(result.focusedSpaceId, result.spaces[0].id);
});

test('history merge deduplicates repeat imports and keeps newest visits within the limit', async () => {
  const { mergeImportedHistory } = await load();
  const visit = (url, timestamp) => ({ url, timestamp });
  const incoming = [visit('https://one.example/', 1), visit('https://two.example/', 2), visit('https://three.example/', 3)];
  const once = mergeImportedHistory([], incoming);
  assert.deepEqual(mergeImportedHistory(once, incoming), once);
  assert.deepEqual(mergeImportedHistory(once, [visit('javascript:x', 4)], 2).map(v => v.timestamp), [2, 3]);
});
