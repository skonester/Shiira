const test = require('node:test');
const assert = require('node:assert/strict');
const { configureBrowserRuntime, chromiumUserAgent, isSitePopup } = require('../src/main/browser-compatibility');

test('browser identity preserves the real platform and Chromium version without app/runtime products', () => {
  for (const platform of ['Windows NT 10.0; Win64; x64', 'X11; Linux x86_64', 'Macintosh; Intel Mac OS X 10_15_7']) {
    const ua = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Shiira/0.4.0 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36`;
    const result = chromiumUserAgent(ua);
    assert.ok(result.includes(platform));
    assert.ok(result.includes('Chrome/156.0.8078.75'));
    assert.doesNotMatch(result, /Shiira|Electron/);
    assert.equal(chromiumUserAgent(result), result);
  }
});

test('normal browser startup suppresses the automation indicator while retaining other Blink settings', () => {
  const switches = new Map([['disable-blink-features', 'OtherFeature, AutomationControlled']]);
  const app = { userAgentFallback: 'Mozilla/5.0 Chrome/156.0.0.0 Electron/45.2.1 Shiira/0.4.0',
    commandLine: { getSwitchValue: key => switches.get(key) || '', appendSwitch: (key, value) => switches.set(key, value) } };
  configureBrowserRuntime(app);
  configureBrowserRuntime(app);
  assert.equal(switches.get('disable-blink-features'), 'OtherFeature,AutomationControlled');
  assert.equal(app.userAgentFallback, 'Mozilla/5.0 Chrome/156.0.0.0');
});

test('provider, named, blank and requested popup windows retain their native window flow', () => {
  for (const details of [
    { url: 'https://accounts.google.com/' },
    { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' },
    { url: 'https://github.com/login/oauth/authorize' },
    { url: 'https://example.com/authorize?state=fixture' },
    { url: 'https://example.com/callback', frameName: 'sign-in' },
    { url: 'about:blank' },
    { url: 'https://example.com/', features: 'popup=yes' },
    { url: 'https://example.com/', features: 'width=500,height=600' },
    { url: 'https://example.com/', disposition: 'new-window' }
  ]) assert.equal(isSitePopup(details), true, JSON.stringify(details));
  for (const details of [
    { url: 'https://example.com/', frameName: '_blank', disposition: 'foreground-tab' },
    { url: 'https://example.com/', features: 'popup=no' },
    { url: 'https://accounts.google.com.evil.example/' },
    { url: 'https://example.com/?next=https://accounts.google.com/' },
    { url: 'https://accounts.google.com@evil.example/' },
    { url: 'javascript:alert(1)', features: 'popup' },
    { url: 'file:///secret', frameName: 'sign-in' },
    { url: 'data:text/html,fixture', disposition: 'new-window' },
    { url: 'invalid' }
  ]) assert.equal(isSitePopup(details), false, JSON.stringify(details));
});
