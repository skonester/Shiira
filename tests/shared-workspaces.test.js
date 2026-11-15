const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ProfilesService, partitionFor } = require('../src/main/profiles-service');
const { WorkspaceService, cleanBlocks, cleanItem, plain, safeLink, fileName } = require('../src/main/workspace-service');
const SpacesService = require('../src/main/spaces-service');
const { SidebarSync } = require('../src/main/sidebar-sync');
function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-shared-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const load = name => import(pathToFileURL(path.join(__dirname, '../src/renderer/modules', name + '.js')).href);
const sample = () => ({ spaces: [{ id: 'one', title: 'One', color: '#112233' }], folders: [], items: [{ id: 'pin', section: 'pinned', spaceId: 'one', url: 'https://example.com', customTitle: '', position: 0 }], archive: [] });

test('browser profiles preserve the legacy partition and persist distinct safe identities', t => {
  const dir = root(t), profiles = new ProfilesService(); profiles.initialize(path.join(dir, 'profiles.json'));
  const a = profiles.create('Work'), b = profiles.create('Personal');
  profiles.rename(a.id, 'Work renamed'); assert.equal(profiles.list().find(p=>p.id===a.id).name, 'Work renamed');
  assert.equal(partitionFor('default'), 'persist:main'); assert.notEqual(a.partition, b.partition);
  for (const invalid of ['../main', 'persist:main', 'p-..', '__proto__']) assert.equal(partitionFor(invalid), null);
  const restored = new ProfilesService(); restored.initialize(profiles.file);
  assert.deepEqual(restored.list(), profiles.list()); assert.equal(restored.has(a.id), true);
  const saved = fs.readFileSync(profiles.file); profiles.file = path.join(dir, 'missing', 'profiles.json');
  assert.throws(() => profiles.create('Failure')); assert.equal(profiles.list().length, 3);
  assert.deepEqual(fs.readFileSync(restored.file), saved);
});

test('sidebar saves merge independent additions and per-field edits without reviving deletions', async t => {
  const dir = root(t), store = new SpacesService(); store.initialize(path.join(dir, 'spaces.json')); store.save(sample());
  const sync = new SidebarSync(store), before = sync.load();
  const first = structuredClone(before), second = structuredClone(before);
  first.spaces[0].title = 'Renamed'; first.items[0].customTitle = 'Pinned name';
  second.spaces[0].color = '#abcdef'; second.items.push({ id: 'new', section: 'pinned', spaceId: 'one', url: 'https://new.example' });
  assert.equal((await sync.save(first, 0)).success, true);
  const merged = (await sync.save(second, 0)).doc;
  assert.equal(merged.spaces[0].title, 'Renamed'); assert.equal(merged.spaces[0].color, '#abcdef');
  assert.equal(merged.items.length, 2); assert.equal(merged.items[0].customTitle, 'Pinned name');
  const deleted = structuredClone(merged); deleted.items = deleted.items.filter(i => i.id !== 'pin');
  await sync.save(deleted, merged.revision);
  const stale = structuredClone(merged); stale.items[0].title = 'Late navigation';
  assert.equal((await sync.save(stale, merged.revision)).doc.items.some(i => i.id === 'pin'), false);
});

test('two first-run windows share the same base before any sidebar file exists', async t => {
  const store = new SpacesService(); store.initialize(path.join(root(t), 'spaces.json')); const sync = new SidebarSync(store);
  const first = sync.load(), second = sync.load(); first.spaces[0].title = 'Renamed immediately';
  await sync.save(first, 0); const result = await sync.save(second, 0);
  assert.equal(result.doc.spaces[0].title, 'Renamed immediately');
});

test('a delayed profile catalog cannot fall back to Default cookies', async () => {
  const { ProfilesMixin } = await load('profiles'); const id = 'p-' + 'a'.repeat(32);
  const browser = { ...ProfilesMixin, profiles: [{ id: 'default', partition: 'persist:main' }] };
  assert.equal(browser.partitionForProfile(id), 'persist:shiira-' + id);
  assert.throws(() => browser.partitionForProfile('../main'));
  browser.spaces = [{id:'changed',profileId:'default'}, {id:'matching',profileId:id}]; browser.focusedSpaceId = 'changed';
  assert.equal(browser.spaceForProfile(id, 'changed').id, 'matching', 'reopened and archived tabs keep their original identity after a Space changes profiles');
  assert.equal(browser.spaceForProfile('missing'), undefined);
});

test('stale sidebar revisions and failed disk writes cannot replace the current snapshot', async t => {
  const dir = root(t), store = new SpacesService(); store.initialize(path.join(dir, 'spaces.json')); store.save(sample());
  const sync = new SidebarSync(store); sync.load();
  for (let n = 0; n < 35; n++) { const d = sync.load(); d.spaces[0].title = `Version ${n}`; await sync.save(d, d.revision); }
  assert.equal((await sync.save(sample(), 0)).conflict, true);
  const before = sync.load(); store.filePath = path.join(dir, 'missing', 'spaces.json');
  const next = structuredClone(before); next.spaces[0].title = 'Unsaved';
  assert.equal((await sync.save(next, before.revision)).success, false); assert.deepEqual(sync.load(), before);
});

test('concurrent folder moves cannot leave cross-Space parents or cycles in a shared sidebar', () => {
  const input = sample(); input.spaces.push({ id: 'two' }); input.folders = [
    { id: 'a', spaceId: 'one', parentId: 'b' }, { id: 'b', spaceId: 'one', parentId: 'a' }, { id: 'c', spaceId: 'two', parentId: 'a' }
  ];
  const clean = SpacesService.sanitize(input);
  assert.equal(clean.folders[2].parentId, null);
  for (const folder of clean.folders) {
    const seen = new Set(); let it = folder;
    while (it) { assert.equal(seen.has(it.id), false); seen.add(it.id); it = clean.folders.find(f => f.id === it.parentId); }
  }
});

test('notes keep only safe bounded blocks, literal text and non-active links', () => {
  const blocks = cleanBlocks([{ t: 'script', runs: [{ s: 'bad' }] }, { t: 'h1', runs: [{ s: '<img src=x onerror=bad>\u0000', b: true, a: 'javascript:bad' }] },
    { t: 'todo', done: true, runs: [{ s: 'Done', a: 'https://example.com' }] }]);
  assert.equal(blocks.length, 2); assert.equal(blocks[0].runs[0].s, '<img src=x onerror=bad>'); assert.equal(blocks[0].runs[0].a, undefined);
  assert.match(plain(blocks), /\[x\] Done/); assert.equal(safeLink('file:///secret'), ''); assert.equal(safeLink('mailto:friend@example.com'), 'mailto:friend@example.com');
  assert.equal(cleanBlocks([{ t: 'p', runs: [{ s: 'x'.repeat(210000) }] }])[0].runs[0].s.length, 200000);
  for (const name of ['../../', 'CON', 'nul.txt']) assert.equal(/[<>:"/\\|?*]/.test(fileName(name)), false);
});

test('Easel models bound coordinates, signed arrows, image names and drawing complexity', () => {
  assert.equal(cleanItem({ id: 'arrow', type: 'arrow', x: Infinity, y: -1e20, w: -12, h: 5 }).w, -12);
  assert.equal(cleanItem({ id: 'shape', type: 'rect', x: Infinity, y: -1e20, w: -12, h: 5 }).w, 1);
  assert.equal(cleanItem({ id: 'image', type: 'image', img: '../secret.png' }), null);
  assert.equal(cleanItem({ id: 'drawing', type: 'pen', pts: Array(40002).fill(0) }), null);
});

test('documents persist separately by profile, reject stale saves and guard deletion and paths', t => {
  const service = new WorkspaceService(root(t), id => ['default', 'work'].includes(id));
  const note = service.create('note', 'work', 'Research'); const other = service.create('easel', 'default', 'Board');
  assert.equal(service.list('work').length, 1); assert.equal(service.list('default')[0].id, other.id);
  const result = service.save({ ...note, blocks: [{ t: 'p', runs: [{ s: 'Saved locally' }] }] });
  assert.equal(result.success, true); assert.equal(service.save({ ...note, title: 'Stale' }).conflict, true);
  assert.throws(() => service.remove(note.id, note.revision)); assert.throws(() => service.read('../outside'));
  assert.throws(() => service.image(other.id, '../outside.png'));
  const restored = new WorkspaceService(service.root, id => ['default', 'work'].includes(id));
  assert.equal(plain(restored.read(note.id).blocks), 'Saved locally');
  assert.throws(() => restored.create('note', 'missing'));
  service.remove(note.id, result.doc.revision); assert.equal(service.list('work').length, 0);
});

test('closing a document waits for edits made while its previous save was in flight', async t => {
  const { WorkspaceMixin } = await load('workspace');
  const previousWindow = global.window; t.after(() => { global.window = previousWindow; });
  let finishFirst; const sent = [];
  global.window = { shiiraAPI: { workspace: { save: doc => {
    sent.push(structuredClone(doc));
    return sent.length === 1 ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve({ success: true, doc: { ...doc, revision: doc.revision + 1 } });
  } } } };
  const browser = { ...WorkspaceMixin, workspaceDoc: { id: 'one', title: 'First', revision: 1 }, workspaceDirty: true, workspaceEditVersion: 1, workspaceStatus() {}, refreshWorkspaceList: async () => {} };
  const flushing = browser.flushWorkspace(); browser.workspaceDoc.title = 'Latest'; browser.workspaceEditVersion++;
  finishFirst({ success: true, doc: { revision: 2 } });
  assert.equal(await flushing, true); assert.equal(sent.length, 2); assert.equal(sent[1].revision, 2); assert.equal(sent[1].title, 'Latest'); assert.equal(browser.workspaceDirty, false);
});

test('two flush callers share the complete save operation, including its asynchronous list refresh', async t => {
  const { WorkspaceMixin } = await load('workspace');
  const previousWindow = global.window; t.after(() => { global.window = previousWindow; });
  let release; const refreshing = new Promise(resolve => { release = resolve; }); let saves = 0;
  global.window = { shiiraAPI: { workspace: { save: async doc => { saves++; return { success: true, doc: { ...doc, revision: 2 } }; } } } };
  const browser = { ...WorkspaceMixin, workspaceDoc: { id: 'one', revision: 1 }, workspaceDirty: true, workspaceEditVersion: 1, workspaceStatus() {}, refreshWorkspaceList: () => refreshing };
  const first = browser.flushWorkspace(), second = browser.flushWorkspace();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(saves, 1);
  release(); assert.equal(await first, true); assert.equal(await second, true);
});

test('a delayed acknowledgement of our own note save cannot flag fresh edits as a conflict', async () => {
  const { WorkspaceMixin } = await load('workspace');
  const browser = { ...WorkspaceMixin, workspacePanel: { classList: { contains: () => false } }, workspaceProfile: 'work', workspaceDoc: { id: 'one', revision: 2 },
    workspaceDirty: true, workspaceConflict: false, refreshWorkspaceList: async () => {}, workspaceStatus() { throw new Error('Unexpected conflict'); } };
  await browser.workspaceRemoteChanged({ id: 'one', profileId: 'work', revision: 2 });
  assert.equal(browser.workspaceConflict, false);
});

test('a document read cannot overwrite text entered while the read was in flight', async t => {
  const { WorkspaceMixin } = await load('workspace'); const previousWindow = global.window; t.after(() => { global.window = previousWindow; });
  let finish; global.window = { shiiraAPI: { workspace: { read: () => new Promise(resolve => { finish = resolve; }) } } };
  const browser = { ...WorkspaceMixin, workspaceDoc: { id: 'before' }, workspaceProfile: 'work', workspaceEditVersion: 1,
    flushWorkspace: async () => true, showWorkspaceDocument() { throw new Error('Pending read overwrote the editor'); } };
  const reading = browser.openWorkspaceDocument('next'); await new Promise(resolve => setImmediate(resolve));
  browser.workspaceEditVersion++; browser.workspaceDoc.text = 'New input';
  finish({ id: 'next', profileId: 'work' }); await reading; assert.equal(browser.workspaceDoc.text, 'New input');
});
