const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canon } = require('../src/main/shortcut-keys');
const { ShortcutsService, inputAccel } = require('../src/main/shortcuts-service');
function service(t, platform = 'win32') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-shortcuts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new ShortcutsService(platform);
  s.initialize(path.join(dir, 'shortcuts.json'));
  return s;
}
const input = (key, fields = {}) => ({ type: 'keyDown', key, control: true, ...fields });

test('Orbe accelerator normalization accepts aliases and rejects malformed combinations', () => {
  assert.equal(canon('command+shift+t'), 'Shift+Cmd+T');
  assert.equal(canon('control+alt+enter'), 'Ctrl+Alt+Return');
  assert.equal(canon('Ctrl+Ctrl+T'), null);
  assert.equal(canon('Ctrl++'), null);
  assert.equal(inputAccel(input('@', { shift: true, code: 'Digit2' })), 'Ctrl+Shift+2');
  assert.equal(inputAccel(input('|', { shift: true, code: 'Backslash' })), 'Ctrl+Shift+\\');
});
test('saved shortcuts replace defaults and preserve alternative reload bindings on reset', t => {
  const s = service(t);
  assert.equal(s.resolve(input('t')), 'new-tab');
  assert.equal(s.assign('new-tab', 'Ctrl+Alt+U').success, true);
  assert.equal(s.resolve(input('t')), null);
  assert.equal(s.resolve(input('u', { alt: true })), 'new-tab');
  const reloaded = new ShortcutsService('win32');
  reloaded.initialize(s.file);
  assert.deepEqual(reloaded.keys('new-tab'), ['Ctrl+Alt+U']);
  s.assign('reload', null);
  assert.equal(s.resolve(input('r')), null);
  assert.equal(s.resolve(input('F5', { control: false })), null);
  assert.equal(s.reset('reload').success, true);
  assert.equal(s.resolve(input('F5', { control: false })), 'reload');
});
test('conflicts require explicit reassignment, including resetting a stolen default', t => {
  const s = service(t);
  assert.equal(s.assign('new-tab', 'Ctrl+L').conflict, 'focus-url');
  assert.equal(s.resolve(input('t')), 'new-tab');
  assert.equal(s.assign('new-tab', 'Ctrl+L', { force: true }).success, true);
  assert.deepEqual(s.keys('focus-url'), []);
  assert.equal(s.reset('focus-url').conflict, 'new-tab');
  assert.equal(s.reset('focus-url', { force: true }).success, true);
  assert.equal(s.resolve(input('l')), 'focus-url');
  assert.deepEqual(s.keys('new-tab'), []);
});
test('reserved shortcuts and plain typing cannot be assigned on either platform', t => {
  for (const platform of ['win32', 'darwin']) {
    const s = service(t, platform);
    for (const key of ['A', 'Shift+A', 'Escape', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+1']) assert.ok(s.assign('new-tab', key).error, `${platform}: ${key}`);
    for (const key of platform === 'darwin' ? ['Cmd+C', 'Cmd+Q', 'Cmd+Tab'] : ['Ctrl+C', 'Alt+F4', 'Alt+Tab']) assert.ok(s.assign('new-tab', key).error);
    assert.equal(s.resolve(input('Tab')), 'next-recent-tab');
  }
});
test('failed shortcut saves preserve effective bindings and invalid saved maps fall back safely', t => {
  const s = service(t);
  s.file = path.join(s.file, 'missing');
  assert.ok(s.assign('new-tab', 'Ctrl+Alt+U').error);
  assert.equal(s.resolve(input('t')), 'new-tab');
  const dir = path.dirname(path.dirname(s.file));
  const file = path.join(dir, 'invalid.json');
  fs.writeFileSync(file, JSON.stringify({ 'new-tab': 'Ctrl+L' }));
  const loaded = new ShortcutsService('win32');
  loaded.initialize(file);
  assert.equal(loaded.resolve(input('t')), 'new-tab');
});
test('recording belongs to its owner, accepts shifted digits, and expires or cancels', t => {
  const s = service(t);
  s.record(1, 'capture-area', 47);
  assert.equal(s.capture(2, input('x')), null);
  assert.equal(s.capture(1, input('Shift')).waiting, true);
  const captured = s.capture(1, input('@', { shift: true, code: 'Digit2' }));
  assert.equal(captured.accel, 'Ctrl+Shift+2');
  assert.equal(captured.recordId, 47);
  assert.equal(s.capture(1, input('x')), null);
  s.record(1, 'new-tab');
  assert.equal(s.capture(1, input('Escape')).canceled, true);
  s.record(1, 'new-tab');
  s.recording.get(1).expires = 1;
  assert.equal(s.capture(1, input('t')).canceled, true);
});

test('default shortcuts leave OS and editing keys available on every platform', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const s = new ShortcutsService(platform);
    for (const c of s.list().commands) for (const accel of c.accels) assert.equal(s.reserved(accel), false, `${platform}: ${c.id} ${accel}`);
    if (platform === 'darwin') {
      assert.equal(s.resolve(input('h', { control: false, meta: true })), null);
      assert.equal(s.resolve(input('y', { control: false, meta: true })), 'show-history');
      assert.equal(s.reserved(canon('Cmd+Shift+Z')), true);
    }
  }
});
