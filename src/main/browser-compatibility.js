const path = require('node:path');

function withoutAutomationIndicator(features = '') {
  return [...new Set([...features.split(',').map(value => value.trim()).filter(Boolean), 'AutomationControlled'])].join(',');
}

function chromiumUserAgent(value) {
  // Keep Chromium's real platform and engine version. Electron/app product
  // tokens cause sites to treat this full browser as an embedded app.
  return value.replace(/\s+(?:Electron|Shiira|shiira-browser)\/[^\s]+/gi, '').trim();
}

function configureBrowserRuntime(app) {
  // Must run before app.ready and before any page or popup is created.
  app.commandLine.appendSwitch('disable-blink-features',
    withoutAutomationIndicator(app.commandLine.getSwitchValue('disable-blink-features')));
  app.userAgentFallback = chromiumUserAgent(app.userAgentFallback);
}

function isSitePopup({ url = '', frameName = '', features = '', disposition = '' } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.href !== 'about:blank' && !['http:', 'https:'].includes(parsed.protocol)) return false;
  // Many SDKs first open a named blank window, then navigate it after a
  // request. Canceling it makes window.open return null to the login code.
  if (parsed.href === 'about:blank' || disposition === 'new-window') return true;
  if (frameName && !['_blank', '_self', '_parent', '_top'].includes(frameName.toLowerCase())) return true;
  if (features.split(',').some(feature => {
    const [key, value] = feature.trim().toLowerCase().split('=');
    return (key === 'popup' && !['no', 'false', '0'].includes(value)) ||
      ['width', 'height', 'left', 'top'].includes(key);
  })) return true;
  const host = parsed.hostname;
  return host === 'accounts.google.com' || host === 'login.live.com' ||
    host === 'login.microsoftonline.com' || host.endsWith('.login.microsoftonline.com') ||
    host === 'appleid.apple.com' ||
    /\/(?:oauth2?|authorize|signin|sign-in|login)(?:[\/_-]|$)/i.test(parsed.pathname);
}

function sitePopupResponse(contents, owner) {
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      parent: owner, frame: true, show: true, autoHideMenuBar: true,
      width: 560, height: 760, minWidth: 360, minHeight: 320,
      title: 'Shiira', backgroundColor: '#ffffff',
      webPreferences: {
        // Use the actual opener's profile, including background/private tabs.
        session: contents.session,
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
        webviewTag: false, webSecurity: true, allowRunningInsecureContent: false,
        preload: path.join(__dirname, '../preload/site-popup.js'),
        disableBlinkFeatures: withoutAutomationIndicator(contents.getLastWebPreferences().disableBlinkFeatures)
      }
    }
  };
}

module.exports = { configureBrowserRuntime, chromiumUserAgent, withoutAutomationIndicator, isSitePopup, sitePopupResponse };
