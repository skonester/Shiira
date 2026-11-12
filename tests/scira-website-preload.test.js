const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/preload/scira-search.js'), 'utf8');

function visit(href, { frame = false, blockedStorage = false } = {}) {
  const values = new Map([
    ['scira-selected-group', '"web"'],
    ['scira-delegate-enabled-groups', '["web","github"]'],
    ['scira-multi-agent-enabled', 'true'],
    ['unrelated-preference', 'keep']
  ]);
  const window = { location: { href } };
  window.top = frame ? {} : window;
  const localStorage = { setItem(key, value) { if (blockedStorage) throw new Error('Storage denied'); values.set(key, value); } };
  vm.runInNewContext(source, { window, localStorage, URL });
  return values;
}

test('explicit Scira website searches initialize active sources before page scripts run', () => {
  for (const group of ['web', 'reddit', 'x']) {
    const values = visit(`https://scira.ai/?q=avgn&group=${group}`);
    assert.equal(values.get('scira-selected-group'), JSON.stringify(group));
    assert.equal(values.get('scira-delegate-enabled-groups'), JSON.stringify([group]));
    assert.equal(values.get('scira-multi-agent-enabled'), 'false');
    assert.equal(values.get('unrelated-preference'), 'keep');
  }
  assert.equal(visit('https://scira.ai/?query=avgn&group=reddit').get('scira-delegate-enabled-groups'), '["reddit"]');
});

test('Scira source initialization leaves other origins, ordinary pages and unsupported groups alone', () => {
  for (const href of [
    'https://example.com/?q=avgn&group=reddit',
    'https://scira.ai.example.com/?q=avgn&group=reddit',
    'http://scira.ai/?q=avgn&group=reddit',
    'https://scira.ai:444/?q=avgn&group=reddit',
    'https://scira.ai/search/existing?q=avgn&group=reddit',
    'https://scira.ai/?group=reddit',
    'https://scira.ai/?q=%20&group=reddit',
    'https://scira.ai/?q=avgn',
    'https://scira.ai/?q=avgn&group=unknown',
    'about:blank'
  ]) assert.equal(visit(href).get('scira-delegate-enabled-groups'), '["web","github"]', href);
  assert.equal(visit('https://scira.ai/?q=avgn&group=reddit', { frame: true }).get('scira-delegate-enabled-groups'), '["web","github"]');
});

test('denied website storage does not break page startup', () => {
  assert.doesNotThrow(() => visit('https://scira.ai/?q=avgn&group=reddit', { blockedStorage: true }));
});
