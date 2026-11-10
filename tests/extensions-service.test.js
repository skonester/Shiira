const test = require('node:test');
const assert = require('node:assert/strict');
const { describePermissions } = require('../src/main/extensions-service');

test('broad host access is described as all websites', () => {
  assert.deepEqual(
    describePermissions({ host_permissions: ['<all_urls>'], permissions: ['tabs', 'storage'] }),
    ['Read and change everything on all websites', 'See your open tabs and their addresses']
  );
});

test('specific sites are named, with a count for the rest', () => {
  const [line] = describePermissions({
    content_scripts: [{ matches: ['https://*.github.com/*', 'https://example.com/*'] }],
    host_permissions: ['https://a.test/*', 'https://b.test/*']
  });
  assert.equal(line, 'Read and change your data on a.test, b.test, github.com and 1 more sites');
});

test('no special access gives an empty list', () => {
  assert.deepEqual(describePermissions({ permissions: ['storage', 'alarms'] }), []);
  assert.deepEqual(describePermissions(undefined), []);
});
