const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SpacesService = require('../src/main/spaces-service');
const { sanitize } = require('../src/main/spaces-service');

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-spaces-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'spaces.json');
}

const doc = {
  version: 1,
  focusedSpaceId: 's-work',
  spaces: [
    { id: 's-home', title: 'Home', icon: '🏠', color: '#7C6CF2', position: 0 },
    { id: 's-work', title: 'Work', icon: '💼', color: '#3b82f6', position: 1 }
  ],
  folders: [{ id: 'f-1', spaceId: 's-work', parentId: null, title: 'Docs', collapsed: true, position: 0 }],
  items: [
    { id: 'i-1', spaceId: 's-work', section: 'pinned', parentId: 'f-1', url: 'https://docs.example.com/', pinnedUrl: 'https://docs.example.com/', title: 'Docs', position: 0 },
    { id: 'i-2', spaceId: null, section: 'favorites', parentId: null, url: 'https://mail.example.com/', title: 'Mail', position: 0 }
  ],
  archive: [{ url: 'https://old.example.com/', title: 'Old', spaceId: 's-home', archivedAt: 1000 }],
  activeBySpace: { 's-work': 'i-1' }
};

test('saves and loads the sidebar document', (t) => {
  const file = tempFile(t);
  const service = new SpacesService();
  service.initialize(file);
  assert.equal(service.load(), null);
  assert.deepEqual(service.save(doc), { success: true });
  const loaded = service.load();
  assert.equal(loaded.focusedSpaceId, 's-work');
  assert.equal(loaded.spaces[0].color, '#7c6cf2');
  assert.equal(loaded.folders[0].collapsed, true);
  assert.equal(loaded.items[0].parentId, 'f-1');
  assert.equal(loaded.items[1].spaceId, null);
  assert.deepEqual(loaded.activeBySpace, { 's-work': 'i-1' });
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('drops unsafe and orphaned entries', () => {
  const clean = sanitize({
    ...doc,
    spaces: [...doc.spaces, { id: 'bad id!', title: 'x' }, { id: 's-home', title: 'duplicate' }],
    folders: [
      ...doc.folders,
      { id: 'f-orphan', spaceId: 's-gone', title: 'Gone' },
      { id: 'f-2', spaceId: 's-work', parentId: 'f-missing', title: 'Lost parent' }
    ],
    items: [
      ...doc.items,
      { id: 'i-js', spaceId: 's-work', section: 'pinned', url: 'javascript:alert(1)' },
      { id: 'i-today', spaceId: 's-work', section: 'today', url: 'https://today.example.com/' },
      { id: 'i-nospace', spaceId: 's-gone', section: 'pinned', url: 'https://x.example.com/' },
      { id: 'i-fav', spaceId: null, section: 'favorites', url: 'https://ok.example.com/', favicon: 'data:image/png;base64,AAAA' }
    ]
  });
  assert.deepEqual(clean.spaces.map((s) => s.id), ['s-home', 's-work']);
  assert.deepEqual(clean.folders.map((f) => f.id), ['f-1', 'f-2']);
  assert.equal(clean.folders[1].parentId, null);
  assert.deepEqual(clean.items.map((i) => i.id), ['i-1', 'i-2', 'i-fav']);
  assert.equal(clean.items[2].favicon, null);
});

test('refuses to save a document without spaces and keeps the old file', (t) => {
  const file = tempFile(t);
  const service = new SpacesService();
  service.initialize(file);
  service.save(doc);
  const result = service.save({ spaces: [] });
  assert.equal(result.success, false);
  assert.equal(service.load().spaces.length, 2);
});

test('a corrupt file loads as nothing instead of throwing', (t) => {
  const file = tempFile(t);
  fs.writeFileSync(file, '{ not json');
  const service = new SpacesService();
  service.initialize(file);
  assert.equal(service.load(), null);
});
