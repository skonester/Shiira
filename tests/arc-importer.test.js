// Ported from Solamar's tests/arc-parse.test.ts (https://github.com/Bambeek/solamar, GPL-3.0-or-later).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ArcFormatError, parseArcSidebar, countNodes, summarizePlan, locateArcSidebar, readArcPlan
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
  assert.deepEqual(doc, { kind: 'tab', url: 'https://docs.example.com/a', title: 'My doc' });
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
  assert.deepEqual(summarizePlan(plan), { spaces: 2, pinned: 3, today: 2, folders: 2, favorites: 2 });
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
