// Real site popups in the browser's webviews, using only local providers and
// disposable cookies/profiles. SHIIRA_AUTH_LIVE=1 also checks Google's initial
// form and Scira's redirect to it. No account information is entered; these
// checks do not verify Google's acceptance of an account login.
const { app, BrowserWindow, webContents } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const appRoot = process.env.SHIIRA_SMOKE_APP_ROOT ? path.resolve(process.env.SHIIRA_SMOKE_APP_ROOT) : path.resolve(__dirname, '..');
const loadApp = file => require(path.join(appRoot, file));
if (process.env.SHIIRA_SMOKE_APP_ROOT) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.dirname(appRoot) });
  app.getAppPath = () => appRoot;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-auth-'));
const artifacts = path.resolve(__dirname, '../tmp/auth-smoke');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', root);
app.setPath('sessionData', root);
fs.writeFileSync(path.join(root, 'browser-settings.json'), JSON.stringify({ autoCheckUpdates: false }));
Object.assign(loadApp('node_modules/keytar'), { getPassword: async () => null, setPassword: async () => {}, deletePassword: async () => true });
loadApp('src/main/password-service').prototype.initializeEncryption = async function () { this.encryptionKey = randomBytes(32); };
app.on('browser-window-created', (_event, win) => { win.setSkipTaskbar(true); win.on('show', () => win.hide()); });
// Even a debugging/automation launch must keep the human browser's identity.
app.commandLine.appendSwitch('enable-automation');
const requests = [];
const servers = [0, 1].map(() => http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  requests.push({ url: req.url, method: req.method, body, cookie: req.headers.cookie || '', userAgent: req.headers['user-agent'] });
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Fixture provider</title><h1>Sign-in fixture</h1><script>
    window.messages = [];
    addEventListener('message', event => messages.push({data:event.data,origin:event.origin}));
    window.finishAuth = (origin, marker) => {
      document.cookie = 'signed_in=' + marker + '; Max-Age=3600; Path=/';
      window.opener.postMessage({signedIn:marker}, origin);
      window.close();
    };
  </script>`);
}));
let phase = 'startup', finished = false;
const coverage = {};
const deadline = setTimeout(() => finish(new Error(`Authentication smoke timed out during ${phase}`)), 55000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  servers.forEach(server => server.close());
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success: !error, phase,
    error: error?.stack, temporaryProfile: root, packaged: app.isPackaged,
    electron: process.versions.electron, chromium: process.versions.chrome,
    realProviderLoginVerified: false, ...coverage }, null, 2));
  // Release guests after the current IPC/microtask stack returns. Destroying
  // live remote pages from inside their completion callback can stall teardown.
  setImmediate(() => {
    app.removeAllListeners('window-all-closed');
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    app.exit(error ? 1 : 0);
    process.exit(error ? 1 : 0);
  });
}
process.on('unhandledRejection', finish);
process.on('uncaughtException', finish);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(50); }
  throw new Error(message);
}
const run = (win, code) => win.webContents.executeJavaScript(`(async () => { const b=window.ShiiraBrowser; ${code} })()`, true);
async function pageOf(win, id) {
  let page;
  await until(async () => {
    const wcId = await run(win, `return b.tabs.find(t=>t.id===${JSON.stringify(id)})?.webview?.getWebContentsId();`).catch(() => null);
    page = wcId && webContents.fromId(wcId);
    return page && !page.isLoading() && /^https?:/.test(page.getURL());
  }, 'The source tab did not load');
  return page;
}
async function openPopup(source, code) {
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The page did not create a native popup')), 5000);
    source.once('did-create-window', popup => { clearTimeout(timer); resolve(popup); });
  });
  const result = await source.executeJavaScript(code, true);
  const popup = await opened;
  await until(async () => !popup.isDestroyed() && !popup.webContents.isLoading() &&
    await popup.webContents.executeJavaScript('document.readyState === "complete"').catch(() => false), 'Popup did not load');
  assert.equal(popup.webContents.session, source.session, 'Popup uses the actual opener session');
  return { popup, result };
}
async function closePopup(popup) {
  popup.close();
  await until(() => popup.isDestroyed(), 'A site popup did not close');
}
loadApp('src/main/main');
app.whenReady().then(async () => {
  try {
    await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
    const base = `http://127.0.0.1:${servers[0].address().port}`;
    const provider = `http://127.0.0.1:${servers[1].address().port}`;
    let win;
    await until(async () => {
      win = BrowserWindow.getAllWindows().find(w => w.webContents.getLastWebPreferences().webviewTag);
      return win && await run(win, 'return b?.spacesLoaded;').catch(() => false);
    }, 'Browser UI did not become ready');
    await run(win, 'b.finishWelcomeSetup(); b.closeAllPopups();');
    const normalId = await run(win, `return b.createTab(${JSON.stringify(base + '/opener')});`);
    const normal = await pageOf(win, normalId);
    phase = 'browser identity';
    const identity = await normal.executeJavaScript('({ua:navigator.userAgent,webdriver:navigator.webdriver,platform:navigator.platform,brands:navigator.userAgentData?.brands})');
    assert.doesNotMatch(identity.ua, /Electron|Shiira/);
    assert.ok(identity.ua.includes(`Chrome/${process.versions.chrome}`));
    assert.equal(identity.webdriver, false);
    const request = requests.find(r => r.url === '/opener');
    assert.equal(request.userAgent, identity.ua, 'HTTP and navigator use the same user agent');
    coverage.identity = identity;

    phase = 'cross-origin message and window.close';
    await normal.executeJavaScript("document.cookie='identity=default; Max-Age=3600; Path=/'");
    const { popup, result } = await openPopup(normal, `(() => {
      const child=window.open(${JSON.stringify(provider + '/oauth/authorize')},'fixture-login','popup,width=500,height=600,nodeIntegration=yes,contextIsolation=no,webviewTag=yes');
      window.loginChild=child; return child !== null;
    })()`);
    assert.equal(result, true, 'window.open returns the real child WindowProxy');
    const popupIdentity = await popup.webContents.executeJavaScript('({opener:!!window.opener,ua:navigator.userAgent,webdriver:navigator.webdriver,node:typeof require,bridge:typeof shiiraAPI,cookie:document.cookie})');
    assert.equal(popupIdentity.opener, true);
    assert.equal(popupIdentity.ua, identity.ua);
    assert.equal(popupIdentity.webdriver, false);
    assert.equal(popupIdentity.node, 'undefined');
    assert.equal(popupIdentity.bridge, 'undefined');
    assert.match(popupIdentity.cookie, /identity=default/);
    const prefs = popup.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.webviewTag, false);
    assert.equal(prefs.webSecurity, true);
    assert.ok(popup.getTitle().includes(provider), 'The native window shows its real address');
    const nested = await openPopup(popup.webContents,
      `window.open(${JSON.stringify(provider + '/oauth/nested')},'nested-login','popup') !== null`);
    assert.equal(await nested.popup.webContents.executeJavaScript('!!window.opener'), true);
    await closePopup(nested.popup);
    coverage.nestedPopups = true;
    await popup.webContents.executeJavaScript(`finishAuth(${JSON.stringify(base)},'fixture-default')`, true);
    await until(() => normal.executeJavaScript("messages.some(m=>m.data.signedIn==='fixture-default')"), 'Popup could not notify its cross-origin opener');
    await until(() => popup.isDestroyed(), 'window.close did not close the login popup');
    assert.equal(await normal.executeJavaScript('loginChild.closed'), true);
    assert.match(await normal.executeJavaScript('document.cookie'), /signed_in=fixture-default/);
    coverage.nativePopup = coverage.crossOriginPostMessage = coverage.scriptClose = true;

    phase = 'blank window then redirect';
    const blank = await openPopup(normal, `(() => { const child=window.open('about:blank','blank-login');
      if (child) child.location=${JSON.stringify(provider + '/oauth/blank')}; return child !== null; })()`);
    assert.equal(blank.result, true);
    await until(() => blank.popup.webContents.getURL() === provider + '/oauth/blank', 'Blank login window could not navigate');
    assert.equal(await blank.popup.webContents.executeJavaScript('!!window.opener'), true);
    await closePopup(blank.popup);
    coverage.blankWindowRedirect = true;

    phase = 'explicit noopener';
    const isolated = await openPopup(normal,
      `window.open(${JSON.stringify(provider + '/oauth/noopener')},'_blank','popup,noopener') !== null`);
    assert.equal(isolated.result, false, 'Explicit noopener still returns null');
    assert.equal(await isolated.popup.webContents.executeJavaScript('window.opener === null'), true);
    await closePopup(isolated.popup);
    coverage.noopenerRespected = true;

    phase = 'form POST into named window';
    const post = await openPopup(normal, `(() => { const form=document.createElement('form');
      form.method='POST'; form.action=${JSON.stringify(provider + '/oauth/post')}; form.target='form-login';
      const state=document.createElement('input'); state.name='state'; state.value='original-fixture-state';
      form.append(state); document.body.append(form); form.submit(); form.remove(); })()`);
    const posted = requests.find(r => r.url === '/oauth/post');
    assert.equal(posted.method, 'POST');
    assert.equal(posted.body, 'state=original-fixture-state');
    assert.equal(await post.popup.webContents.executeJavaScript('!!window.opener'), true);
    await closePopup(post.popup);
    coverage.formPostPreserved = true;

    phase = 'profile and private isolation';
    const created = await run(win, "return window.shiiraAPI.profiles.create('Auth fixture');");
    assert.ok(created.profile, created.error);
    const space = await run(win, `return b.createSpace({title:'Auth fixture',profileId:${JSON.stringify(created.profile.id)}}).id;`);
    for (const [name, options] of [['work', { spaceId: space, background: true }], ['private', { privateMode: true, background: true }]]) {
      const id = await run(win, `return b.createTab(${JSON.stringify(base + '/' + name)},${JSON.stringify(options)});`);
      const source = await pageOf(win, id);
      assert.notEqual(source.session, normal.session);
      assert.equal(await source.executeJavaScript("document.cookie.includes('signed_in=fixture-default')"), false);
      await source.executeJavaScript(`document.cookie='identity=${name}; Path=/'`);
      await run(win, `b.switchTab(${JSON.stringify(normalId)});`);
      const child = await openPopup(source, `window.open(${JSON.stringify(provider + '/oauth/' + name)},'profile-login','popup') !== null`);
      assert.match(await child.popup.webContents.executeJavaScript('document.cookie'), new RegExp(`identity=${name}`));
      if (name === 'private') assert.equal(child.popup.webContents.session.getStoragePath(), null);
      await closePopup(child.popup);
    }
    coverage.profileIsolation = coverage.privateIsolation = true;

    phase = 'ordinary target blank link';
    const count = BrowserWindow.getAllWindows().length;
    await normal.executeJavaScript(`window.open(${JSON.stringify(base + '/ordinary-link')},'_blank');`, true);
    await until(() => run(win, `return b.tabs.some(t=>t.url===${JSON.stringify(base + '/ordinary-link')});`), 'A regular link did not open as a tab');
    assert.equal(BrowserWindow.getAllWindows().length, count);
    assert.equal(await run(win, "return Boolean(document.getElementById('oauth-webview'));"), false);
    coverage.regularLinksRemainTabs = true;

    phase = 'opener cleanup';
    const closingId = await run(win, `return b.createTab(${JSON.stringify(base + '/closing-opener')});`);
    const closingPage = await pageOf(win, closingId);
    const closing = await openPopup(closingPage,
      `window.open(${JSON.stringify(provider + '/oauth/closing')},'closing-login','popup') !== null`);
    await run(win, `b.closeTab(${JSON.stringify(closingId)},true);`);
    await until(() => closing.popup.isDestroyed(), 'Closing the source tab left its login window open');
    coverage.openerCleanup = true;

    if (process.env.SHIIRA_AUTH_LIVE === '1') {
      phase = 'Google initial sign-in form';
      const id = await run(win, "return b.createTab('https://accounts.google.com/ServiceLogin?service=mail');");
      const google = await pageOf(win, id);
      coverage.googleInitialForm = await google.executeJavaScript(`({url:location.href,title:document.title,
        emailField:Boolean(document.querySelector('#identifierId,input[name=identifier],input[type=email]')),webdriver:navigator.webdriver,
        text:document.body.innerText.slice(0,1200)})`);
      await until(() => google.executeJavaScript("Boolean(document.querySelector('#identifierId,input[name=identifier],input[type=email]'))"), 'Google did not display an email field');
      coverage.googleInitialForm = await google.executeJavaScript(`({url:location.href,title:document.title,
        emailField:Boolean(document.querySelector('#identifierId,input[name=identifier],input[type=email]')),webdriver:navigator.webdriver})`);

      phase = 'Scira redirect to Google initial form';
      await google.loadURL('https://scira.ai/sign-in');
      const googleButton = "[...document.querySelectorAll('button')].find(e=>/^Continue with Google$/i.test(e.innerText.trim()))";
      await until(() => google.executeJavaScript(`Boolean(${googleButton})`), 'Scira did not display its Google sign-in button');
      // Scira server-renders this button before its client click handler is
      // hydrated. Give the live site a turn to finish attaching handlers.
      await delay(1000);
      await google.executeJavaScript(`${googleButton}.click()`, true);
      await until(async () => {
        coverage.sciraGoogleInitialForm = await google.executeJavaScript(`({origin:location.origin,path:location.pathname,
          emailField:Boolean(document.querySelector('#identifierId,input[name=identifier],input[type=email]')),
          browserRejected:document.body.innerText.includes('This browser or app may not be secure')})`).catch(() => ({}));
        return coverage.sciraGoogleInitialForm.origin === 'https://accounts.google.com' && coverage.sciraGoogleInitialForm.emailField;
      },
      'Scira did not redirect to the Google email form (no account login was attempted)');
      coverage.sciraGoogleInitialForm = await google.executeJavaScript(`(async () => ({
        origin:location.origin,path:location.pathname,title:document.title,
        emailField:Boolean(document.querySelector('#identifierId,input[name=identifier],input[type=email]')),
        userAgent:navigator.userAgent,brands:navigator.userAgentData?.brands,
        entropy:await navigator.userAgentData?.getHighEntropyValues(['fullVersionList','platformVersion']),
        webdriver:navigator.webdriver,sameTab:true
      }))()`);
      assert.equal(coverage.sciraGoogleInitialForm.webdriver, false);
      const engine = coverage.sciraGoogleInitialForm.entropy?.fullVersionList.find(brand => brand.brand === 'Chromium');
      assert.equal(engine?.version, process.versions.chrome, 'Native client hints retain the actual full engine version');
    }
    phase = 'complete';
    finish();
  } catch (error) { finish(error); }
}).catch(finish);
