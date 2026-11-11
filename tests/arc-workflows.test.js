const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { sanitize } = require('../src/main/spaces-service');
const load = name => import(pathToFileURL(path.join(__dirname, `../src/renderer/modules/${name}.js`)).href);

test('Tab to Search matches site names, prefixes and domains and encodes queries', async () => {
  const { matchSiteSearch, siteSearchUrl } = await load('site-search');
  for (const name of ['you', 'YouTube', 'https://www.youtube.com/']) assert.equal(matchSiteSearch(name).name, 'YouTube');
  assert.equal(matchSiteSearch('google m').name, 'Google Maps');
  assert.equal(matchSiteSearch('x').keyword, 'x.com');
  for (const name of ['', 'y', 'youtube cats', 'youtube.com/results']) assert.equal(matchSiteSearch(name), undefined);
  assert.equal(siteSearchUrl(matchSiteSearch('github'), ' foo & bar/日本 '), 'https://github.com/search?q=foo%20%26%20bar%2F%E6%97%A5%E6%9C%AC');
});

function commandState(mixin, query) {
  return { ...mixin, commandInput: { value: query }, commandSuggestions: [], tabs: [], spaces: [], archive: [],
    processUrl: q => `https://search.example/?q=${encodeURIComponent(q)}`, getCommandActions: () => [],
    currentTabUrl: tab => tab.url, focusedSpaceId: 's1' };
}

test('command bar prioritizes matching open tabs and discovers archived tabs and site searches', async () => {
  const { CommandBarMixin } = await load('command-bar');
  const browser = commandState(CommandBarMixin, 'github');
  browser.tabs = [{ id: 'open', title: 'GitHub', url: 'https://github.com/' }];
  browser.archive = [{ title: 'GitHub issue', url: 'https://github.com/test/issues/1' }];
  const items = browser.buildCommandItems();
  assert.equal(items[0].type, 'tab');
  assert.ok(items.some(item => item.type === 'archive'));
  assert.ok(items.some(item => item.type === 'site' && item.hint === 'Tab'));
});

test('site search stays scoped, suppresses web suggestions, and keeps its encoded destination', async () => {
  const { CommandBarMixin } = await load('command-bar');
  const { matchSiteSearch } = await load('site-search');
  const browser = commandState(CommandBarMixin, 'browser & tabs');
  browser.commandSiteSearch = matchSiteSearch('github');
  browser.commandSuggestions = ['unrelated web result'];
  const items = browser.buildCommandItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://github.com/search?q=browser%20%26%20tabs');
  browser.fetchCommandSuggestions();
  assert.deepEqual(browser.commandSuggestions, []);
});

test('Shift+Enter splits with a page; from Home it opens a regular tab', async () => {
  const { CommandBarMixin } = await load('command-bar');
  const browser = commandState(CommandBarMixin, '');
  const created = [];
  const split = [];
  browser.activeTabId = 'active';
  browser.tabs = [{ id: 'active' }];
  browser.createTab = (url, opts) => { created.push({ url, opts }); return 'new'; };
  browser.openSplitView = id => split.push(id);
  browser.openFromCommandBar('https://example.com/', { split: true });
  assert.equal(created[0].opts.background, true);
  assert.deepEqual(split, ['new']);
  browser.tabs[0].isHome = true;
  browser.openFromCommandBar('https://example.com/', { split: true });
  assert.equal(created[1].opts.background, false);
  assert.equal(split.length, 1);
});

test('Tab enters site search, Backspace leaves it, and Escape is handled without closing the bar', async () => {
  const { CommandBarMixin } = await load('command-bar');
  const { KeyboardShortcutsMixin } = await load('keyboard-shortcuts');
  const listeners = {};
  const elements = Object.fromEntries(['command-bar', 'command-bar-input', 'command-bar-results', 'command-site-search'].map(id => [id, {
    classList: { toggle() {} }, addEventListener: (name, fn) => { listeners[`${id}:${name}`] = fn; }, focus() {}, value: ''
  }]));
  const original = global.document;
  global.document = { getElementById: id => elements[id] };
  try {
    let closed = false;
    const browser = { ...CommandBarMixin, ...KeyboardShortcutsMixin, renderCommandResults() {}, isCommandBarOpen: () => true, closeAllPopups: () => { closed = true; } };
    browser.initCommandBar();
    browser.commandInput.value = 'youtube';
    const key = key => listeners['command-bar-input:keydown']({ key, preventDefault() {}, stopPropagation() {} });
    key('Tab');
    assert.equal(browser.commandSiteSearch.name, 'YouTube');
    assert.equal(browser.commandInput.value, '');
    key('Backspace');
    assert.equal(browser.commandSiteSearch, null);
    browser.commandInput.value = 'github';
    key('Tab');
    browser.handleKeyboardShortcut('close-popups');
    assert.equal(browser.commandSiteSearch, null);
    assert.equal(closed, false);
  } finally { global.document = original; }
});

test('pinned link routing peeks across hosts and respects modified clicks and downloads', async () => {
  const { linkRoute } = await load('link-routing');
  const defaults = { href: 'https://other.example/', currentUrl: 'https://docs.example/', pinned: true, peekEnabled: true };
  assert.equal(linkRoute(defaults), 'peek');
  assert.equal(linkRoute({ ...defaults, href: 'https://www.docs.example/next' }), null);
  assert.equal(linkRoute({ ...defaults, pinned: false }), null);
  assert.equal(linkRoute({ ...defaults, pinned: false, shiftKey: true }), 'peek');
  assert.equal(linkRoute({ ...defaults, ctrlKey: true }), 'tab');
  assert.equal(linkRoute({ ...defaults, button: 1, type: 'auxclick' }), 'tab');
  assert.equal(linkRoute({ ...defaults, peekEnabled: false }), null);
  assert.equal(linkRoute({ ...defaults, download: true }), null);
  assert.equal(linkRoute({ ...defaults, button: 2 }), null);
  assert.equal(linkRoute({ ...defaults, href: 'javascript:alert(1)' }), null);
});

test('injected routing updates on pin/settings changes without installing duplicate listeners', async () => {
  const { linkRoutingScript } = await load('link-routing');
  const listeners = {};
  const logs = [];
  const context = vm.createContext({ window: {}, URL, location: { href: 'https://docs.example/' },
    document: { addEventListener: (name, fn) => { assert.equal(listeners[name], undefined); listeners[name] = fn; } },
    console: { log: msg => logs.push(msg) } });
  vm.runInContext(linkRoutingScript({ pinned: false, peekEnabled: true }), context);
  vm.runInContext(linkRoutingScript({ pinned: true, peekEnabled: true }), context);
  const anchor = { href: 'https://other.example/', matches: () => true, getAttribute: () => '', hasAttribute: () => false };
  let prevented = false;
  listeners.click({ type: 'click', button: 0, composedPath: () => [anchor], preventDefault: () => { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
  assert.equal(logs[0], '[SHIIRA_PEEK_LINK] https://other.example/');
});

test('private links and Peek promotion preserve private browsing', async () => {
  const { WebviewEventsMixin } = await load('webview-events');
  const { SplitPeekMixin } = await load('split-peek');
  const created = [];
  const browser = { ...WebviewEventsMixin, ...SplitPeekMixin, tabs: [{ id: 'private', privateMode: true, spaceId: 'work' }], activeTabId: 'private',
    createTab: (url, options) => created.push({ url, options }) };
  browser.openLinkInTabOnce('https://example.com/', 'private');
  assert.equal(created[0].options.privateMode, true);
  browser.peekSource = { privateMode: true, spaceId: 'work' };
  browser.peekCurrentUrl = () => 'https://peek.example/';
  browser.closePeek = () => { browser.peekSource = null; };
  browser.peekToTab();
  assert.equal(created[1].options.privateMode, true);
});

test('imported cached PNGs persist while unsafe data icons are discarded', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=';
  const item = (id, favicon) => ({ id, spaceId: 's1', section: 'pinned', url: 'https://example.com/', pinnedUrl: 'https://example.com/', customTitle: 'Custom', favicon });
  const doc = sanitize({ spaces: [{ id: 's1' }], items: [item('png', png), item('svg', 'data:image/svg+xml,<svg/>'), item('big', png + 'a'.repeat(22000))] });
  assert.equal(doc.items[0].favicon, png);
  assert.equal(doc.items[0].customTitle, 'Custom');
  assert.equal(doc.items[1].favicon, null);
  assert.equal(doc.items[2].favicon, null);
});
