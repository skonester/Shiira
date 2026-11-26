const { app, BrowserWindow, ipcMain, session, protocol, nativeImage, Menu, dialog, clipboard, ClipboardItem, shell, net, webContents } = require('electron');
app.setName('Shiira');
const { configureBrowserRuntime, isSitePopup, sitePopupResponse, withoutAutomationIndicator } = require('./browser-compatibility');
configureBrowserRuntime(app);
const { createStartupSplash } = require('./startup');
const { installYouTubePlayback } = require('./youtube-playback');
const log = require('electron-log');

// Packaged builds include this sandboxed bundle; source launches rebuild it so
// Electron's restricted preload never needs Node or arbitrary module loading.
if (!app.isPackaged) require('../../build/preloads').buildPreloads();
installYouTubePlayback({ app, BrowserWindow, ipcMain, session, dialog, isTrusted: isBrowserChromeSender,
  onDiagnostic: details => log.info('[YouTube]', details) });

// Try to import components for Castlabs Electron (Widevine DRM support)
let components = null;
try {
  components = require('electron').components;
} catch (e) {
  // Standard Electron doesn't have components
}

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const si = require('systeminformation');
const mime = require('mime-types');

// Disable default Electron menu to prevent Ctrl+R from reloading the whole window
// Our renderer handles all keyboard shortcuts
Menu.setApplicationMenu(null);
const ChromeImporter = require('./chrome-importer');
const autoUpdaterService = require('./auto-updater');
const FavoritesService = require('./favorites-service');
const PasswordService = require('./password-service');
const BookmarksService = require('./bookmarks-service');
const PrivacyService = require('./privacy-service');
const BrowserSettings = require('./browser-settings');
const DnsShield = require('./dns-shield');
const VaultService = require('./vault-service');
const SpacesService = require('./spaces-service');
const ExtensionsService = require('./extensions-service');
const arcImporter = require('./arc-importer');
const { SearchService } = require('./search-service');
const searchService = new SearchService({
  keychain: require('keytar'),
  // Use Chromium's proxy/certificate/network behavior, outside webpage sessions
  // and their filtering hooks. API authentication never depends on website cookies.
  fetchImpl: (url, options) => session.fromPartition('search-api').fetch(url, { ...options, credentials: 'omit' })
});
const { getAdBlocker, getCosmeticInjector, getScriptInjector } = require('./ad-blocker');

// Initialize Chrome Importer
const chromeImporter = new ChromeImporter();

// Initialize Favorites Service
const favoritesService = new FavoritesService();

// Initialize Password Service
const passwordService = new PasswordService();

// Initialize Bookmarks Service
const bookmarksService = new BookmarksService();
require('./browser-import-service').installBrowserImports({ ipcMain, dialog, BrowserWindow, bookmarksService, isTrusted: isBrowserChromeSender });

// Initialize Privacy Service
const privacyService = new PrivacyService();
const browserSettings = new BrowserSettings();
const spacesService = new SpacesService();
const sidebarSync = new (require('./sidebar-sync').SidebarSync)(spacesService);
const profilesService = new (require('./profiles-service').ProfilesService)();
require('./workspace-service').installWorkspaces({ app, ipcMain, BrowserWindow, webContents, dialog, nativeImage,
  isTrusted: isBrowserChromeSender, hasProfile: id => profilesService.has(id) });
let configurePageSession = () => {};
const permissionSessions = new WeakSet();
const extensionsService = new ExtensionsService();
const { ShortcutsService, installShortcuts } = require('./shortcuts-service');
const shortcutsService = new ShortcutsService();
installShortcuts({ service: shortcutsService, ipcMain, BrowserWindow, isTrusted: isBrowserChromeSender });
// Arc sidebar files the user found or picked; the renderer may only read these.
const allowedArcFiles = new Set();
require('./boosts-service').installBoosts({ app, ipcMain, webContents: require('electron').webContents, isTrusted: isBrowserChromeSender });
const mediaCaptureGrants = new WeakSet();
const activeDownloadPages = new WeakMap();
require('./page-tools-service').installPageTools({ ipcMain, webContents: require('electron').webContents, dialog, clipboard, ClipboardItem, nativeImage, BrowserWindow,
  isTrusted: isBrowserChromeSender, isBusy: page => mediaCaptureGrants.has(page) || (activeDownloadPages.get(page) || 0) > 0 });

// Initialize Shield (encrypted DNS / DNS-over-HTTPS)
const dnsShield = new DnsShield();

// Vault (Safe Folder) is created once PasswordService's encryption key is ready - see app.whenReady()
let vaultService = null;

// Initialize Ad Blocker (network blocking)
const adBlocker = getAdBlocker();
adBlocker.on('stats-updated', (stats) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('adblock-stats-updated', stats);
  }
});

// Initialize Cosmetic Injector (element hiding)
const cosmeticInjector = getCosmeticInjector();

// Initialize Script Injector (YouTube ad blocking)
const scriptInjector = getScriptInjector();

let darkReaderScriptCache = null;
const pendingDownloads = new WeakMap();
const activeDownloadPaths = new Set();
const browserHeaderSessions = new WeakSet();
let hardwareAccelerationProfile = {
  avx2: false,
  vulkanLikely: false,
  renderer: 'default',
  controllers: []
};

configureHardwareAcceleration();

// Set Windows app user model ID for proper taskbar identification
// Using a unique ID based on version to bypass icon cache
if (process.platform === 'win32') {
    const version = require('../../package.json').version.replace(/[^a-zA-Z0-9]/g, '');
  app.setAppUserModelId(`Shiira.Shiira.Browser.${version}`);
  }

// Helper to get asset path (works in both dev and production)
function getAssetPath(...paths) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', ...paths);
  }
  return path.join(__dirname, '../../assets', ...paths);
}

function getDarkReaderScript() {
  if (!darkReaderScriptCache) {
    const darkReaderPath = require.resolve('darkreader/darkreader.js');
    darkReaderScriptCache = fs.readFileSync(darkReaderPath, 'utf8');
  }
  return darkReaderScriptCache;
}

function preconnectBrowserSession(sessionInstance) {
  if (typeof sessionInstance.preconnect !== 'function') return;

  [
    'https://api.duckduckgo.com',
    'https://en.wikipedia.org',
    'https://www.reddit.com',
    'https://styles.redditmedia.com',
    'https://preview.redd.it',
    'https://i.redd.it',
    'https://v.redd.it'
  ].forEach((url) => {
    try {
      sessionInstance.preconnect({ url, numSockets: 4 });
    } catch (error) {
      if (!app.isPackaged) {
        console.warn('[Network] Preconnect failed:', url, error.message);
      }
    }
  });
}

function installBrowserHeaderOverrides(sessionInstance) {
  if (!SHIIRA_CONFIG.userAgent || !sessionInstance?.webRequest) return;
  if (browserHeaderSessions.has(sessionInstance)) return;
  browserHeaderSessions.add(sessionInstance);

  sessionInstance.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      // The session supplies the browser UA. Let Chromium generate matching
      // client hints and language headers instead of claiming a fixed OS/brand.
      let requestHeaders = details.requestHeaders;

      if (dnsShield.isEnabled()) {
        requestHeaders = dnsShield.getPrivacyHeaders(details, requestHeaders);
      }

      callback({ requestHeaders });
    }
  );
}

function configureHardwareAcceleration() {
  const enabledFeatures = [
    'BackForwardCache',
    'ParallelDownloading',
    'LazyFrameLoading',
    'LazyImageLoading',
    'Prerender2',
    'SpeculationRulesPrerenderProxy',
    'ServiceWorkerBypassFetchHandler',
    'SharedArrayBuffer'
  ];

  // Let Chromium select the supported graphics/decoder backend on each OS.
  // Forcing ANGLE/Vulkan and bypassing its driver blocklist can corrupt the
  // already-rendered home surface as well as video decode/compositing.
  app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
  app.commandLine.appendSwitch('enable-quic');
  app.commandLine.appendSwitch('enable-parallel-downloading');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('max-active-webgl-contexts', '32');
  app.commandLine.appendSwitch('disk-cache-size', '536870912');
  app.commandLine.appendSwitch('media-cache-size', '268435456');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
}

async function detectHardwareAccelerationProfile() {
  try {
    const [cpuFlags, graphics] = await Promise.all([
      si.cpuFlags().catch(() => ''),
      si.graphics().catch(() => ({ controllers: [] }))
    ]);

    const normalizedFlags = String(cpuFlags).toLowerCase();
    const controllers = Array.isArray(graphics.controllers) ? graphics.controllers : [];
    const rendererNames = controllers
      .map(controller => [controller.vendor, controller.model].filter(Boolean).join(' '))
      .filter(Boolean);

    const vulkanLikely = controllers.some(controller => {
      const text = `${controller.vendor || ''} ${controller.model || ''}`.toLowerCase();
      return /nvidia|geforce|rtx|gtx|quadro|amd|radeon|intel|arc|iris|uhd|xe/.test(text);
    });

    hardwareAccelerationProfile = {
      avx2: normalizedFlags.split(/\s+/).includes('avx2'),
      vulkanLikely,
      renderer: 'default',
      controllers: rendererNames
    };

    console.log('[Hardware] Acceleration profile:', hardwareAccelerationProfile);
  } catch (error) {
    console.warn('[Hardware] Capability detection failed:', error.message);
  }
}

// Keep a global reference of the window object
let mainWindow = null;

// Track all open browser windows for session management
const browserWindows = new Set();
const sitePopupOwners = new WeakMap();
let externalLinks = null;
externalLinks = new (require('./external-links-service').ExternalLinksService)({ app, ipcMain, BrowserWindow, isTrusted: isBrowserChromeSender,
  getSpaces: () => spacesService.load()?.spaces || [],
  getIcon: () => getAssetPath('shiira-logo.ico'), installWebviewPreload, extensionsService,
  handleInput: handleKeyboardShortcut, log,
  ensureMain: () => {
    const current = [...browserWindows].find(win => !win.isDestroyed());
    if (current) return current;
    createWindow();
    return mainWindow;
  } });

// Session file path for tab persistence
function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'session.dat'); // Changed to .dat to indicate encrypted
}

// Encrypt session data using AES-256-GCM
function encryptSession(data) {
  try {
    const key = crypto.pbkdf2Sync(
      app.getName() + app.getVersion(), // Derive key from app name+version
      'session-salt-v1', // Salt
      100000, // Iterations
      32, // Key length
      'sha256'
    );
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return iv.toString('hex') + ':' + encrypted + ':' + authTag;
  } catch (e) {
    console.error('[Session] Failed to encrypt:', e);
    return null;
  }
}

// Decrypt session data
function decryptSession(encryptedData) {
  try {
    const key = crypto.pbkdf2Sync(
      app.getName() + app.getVersion(),
      'session-salt-v1',
      100000,
      32,
      'sha256'
    );
    
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (e) {
    console.error('[Session] Failed to decrypt:', e);
    return null;
  }
}

// Save session data (encrypted)
function saveSession(sessionData) {
  try {
    const encrypted = encryptSession(sessionData);
    if (encrypted) {
      fs.writeFileSync(getSessionFilePath(), encrypted, 'utf8');
      console.log('[Session] Saved', sessionData.tabs?.length || 0, 'tabs (encrypted)');
    }
  } catch (e) {
    console.error('[Session] Failed to save:', e);
  }
}

// Load session data (decrypt)
function loadSession() {
  try {
    const sessionPath = getSessionFilePath();
    if (fs.existsSync(sessionPath)) {
      const encryptedData = fs.readFileSync(sessionPath, 'utf8');
      const data = decryptSession(encryptedData);
      if (data) {
        console.log('[Session] Loaded', data.tabs?.length || 0, 'tabs (decrypted)');
        return data;
      }
    }
    
    // Try legacy unencrypted session.json for migration
    const legacyPath = path.join(app.getPath('userData'), 'session.json');
    if (fs.existsSync(legacyPath)) {
      console.log('[Session] Migrating from legacy unencrypted session');
      const data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      // Delete legacy file after successful read
      fs.unlinkSync(legacyPath);
      return data;
    }
  } catch (e) {
    console.error('[Session] Failed to load:', e);
  }
  return null;
}

// Clear session (called after successful restore)
function clearSession() {
  try {
    const sessionPath = getSessionFilePath();
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
      console.log('[Session] Cleared');
    }
  } catch (e) {
    console.error('[Session] Failed to clear:', e);
  }
}

// Handle keyboard shortcuts globally
function handleKeyboardShortcut(event, input, targetWindow) {
  const captured = shortcutsService.capture(targetWindow.webContents.id, input);
  if (captured) {
    event.preventDefault();
    if (!captured.waiting) targetWindow.webContents.send('shortcuts-recorded', captured);
    return;
  }
  if (input.type === 'keyUp' && input.key === 'Control') {
    targetWindow.webContents.send('keyboard-shortcut', 'commit-tab-switcher');
    return;
  }
  if (input.type !== 'keyDown' || input.isComposing) return;
  const shortcut = shortcutsService.resolve(input);
  if (!shortcut) return;
  event.preventDefault();
  if (externalLinks?.handleShortcut(targetWindow, shortcut)) return;
  targetWindow.webContents.send('keyboard-shortcut', shortcut);
}

function browsingWindow(contents) {
  return sitePopupOwners.get(contents) || BrowserWindow.fromWebContents(contents.hostWebContents || contents);
}

function routeWindowOpen(contents, details = {}) {
  const { url } = details;

  if (!url) {
    return { action: 'deny' };
  }

  const parentWindow = browsingWindow(contents);
  if (!parentWindow || parentWindow.isDestroyed()) {
    return { action: 'deny' };
  }

  const page = contents.getType() === 'webview' || sitePopupOwners.has(contents);
  if (page && isSitePopup(details)) {
    // Electron must create the original window: recreating its URL in a
    // webview loses the WindowProxy, opener, referrer and form POST body.
    return sitePopupResponse(contents, parentWindow);
  }

  if (externalLinks?.isLittle(parentWindow)) {
    void externalLinks.openMain(url);
    return { action: 'deny' };
  }

  console.log('[WebContents] Link routed to Shiira tab');
  parentWindow.webContents.send('open-url-in-new-tab', url);
  return { action: 'deny' };
}

function downloadFolder() {
  const chosen = browserSettings.get().downloadDirectory;
  try {
    if (chosen && fs.statSync(chosen).isDirectory()) return chosen;
  } catch {}
  return app.getPath('downloads');
}

function installDownloadPrompt(sessionInstance) {
  if (pendingDownloads.has(sessionInstance)) return;

  const pendingUrls = new Map();
  pendingDownloads.set(sessionInstance, pendingUrls);

  sessionInstance.on('will-download', async (event, item, page) => {
    if (page) {
      activeDownloadPages.set(page, (activeDownloadPages.get(page) || 0) + 1);
      item.once('done', () => activeDownloadPages.set(page, Math.max(0, (activeDownloadPages.get(page) || 1) - 1)));
    }
    const url = item.getURL();
    const metadata = pendingUrls.get(url) || {};
    pendingUrls.delete(url);

    const folder = downloadFolder();
    const defaultPath = path.join(folder, path.basename(item.getFilename()));
    const shouldPrompt = metadata.prompt === true ||
      (metadata.prompt !== false && browserSettings.get().askWhereToSave);

    try {
      if (shouldPrompt) {
        item.pause();

        const ownerWindow = metadata.windowId
          ? BrowserWindow.fromId(metadata.windowId)
          : BrowserWindow.getFocusedWindow();

        const result = await dialog.showSaveDialog(ownerWindow || undefined, {
          title: metadata.title || 'Save File',
          defaultPath
        });

        if (result.canceled || !result.filePath) {
          item.cancel();
          return;
        }

        item.setSavePath(result.filePath);
        item.resume();
      } else {
        const candidate = BrowserSettings.nextAvailablePath(folder, item.getFilename(), activeDownloadPaths);
        item.setSavePath(candidate);
        activeDownloadPaths.add(candidate);
        item.once('done', () => activeDownloadPaths.delete(candidate));
      }
    } catch (error) {
      console.error('[Download] Could not choose save path:', error);
      item.cancel();
    }
  });
}

function queueDownload(sessionInstance, url, metadata = {}) {
  installDownloadPrompt(sessionInstance);
  const pendingUrls = pendingDownloads.get(sessionInstance);
  pendingUrls.set(url, metadata);
  sessionInstance.downloadURL(url);
}

// Listen for all new webContents (including webviews) and add keyboard shortcut handling
app.on('web-contents-created', (event, contents) => {
  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler((details) => routeWindowOpen(contents, details));
  }

  contents.on('did-create-window', popup => {
    const owner = browsingWindow(contents);
    if (!owner || owner.isDestroyed()) { popup.destroy(); return; }
    const popupContents = popup.webContents;
    sitePopupOwners.set(popupContents, owner);
    configurePageSession(popup.webContents.session);
    popup.setMenu(null);
    // The native title is controlled by browser code so the current address
    // remains visible even when the identity provider changes its page title.
    const updateTitle = () => {
      if (!popup.isDestroyed()) popup.setTitle(`${popup.webContents.getURL() || 'about:blank'} — Shiira`);
    };
    popup.on('page-title-updated', event => { event.preventDefault(); updateTitle(); });
    popup.webContents.on('did-navigate', updateTitle);
    popup.webContents.on('did-navigate-in-page', updateTitle);
    popup.once('closed', () => sitePopupOwners.delete(popupContents));
  });
  
  // Only handle webview webContents
  if (contents.getType() === 'webview') {
    configurePageSession(contents.session);
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) mediaCaptureGrants.delete(contents); });
    const webviewSession = contents.session;
    if (webviewSession && SHIIRA_CONFIG.userAgent) {
      webviewSession.setUserAgent(SHIIRA_CONFIG.userAgent);
      installBrowserHeaderOverrides(webviewSession);
      installDownloadPrompt(webviewSession);
      preconnectBrowserSession(webviewSession);
    }

    contents.on('before-input-event', (event, input) => {
      // Find the parent BrowserWindow to send the shortcut to
      const owner = BrowserWindow.fromWebContents(contents.hostWebContents || contents);
      if (owner && !owner.isDestroyed()) {
        handleKeyboardShortcut(event, input, owner);
      }
    });
  }
});

// Shiira Browser Configuration
const SHIIRA_CONFIG = {
  name: 'Shiira',
  version: require('../../package.json').version,
  company: 'Shiira Project',
  homepage: 'shiira://home',
  userAgent: null // Will be set dynamically
};

function createWindow(startupSplash) {
  // Load icon - use absolute path and verify it exists
  const iconPath = getAssetPath('shiira-logo.ico');
  console.log('[Icon] Icon path:', iconPath);
  console.log('[Icon] Icon exists:', fs.existsSync(iconPath));
  
  const icon = nativeImage.createFromPath(iconPath);
  console.log('[Icon] Icon isEmpty:', icon.isEmpty());
  console.log('[Icon] Icon size:', icon.getSize());
  
  // Create the browser window with lightweight settings
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    title: SHIIRA_CONFIG.name,
    icon: icon,
    frame: false, // Custom titlebar for lightweight feel
    show: false,
    backgroundColor: '#020308',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
      backgroundThrottling: false,
      v8CacheOptions: 'bypassHeatCheckAndEagerCompile',
      preload: path.join(__dirname, '../preload/preload.js'),
      webviewTag: true // Enable webview for browser tabs
    }
  });

  if (startupSplash) {
    startupSplash.attachTo(mainWindow);
  } else {
    const window = mainWindow;
    window.once('ready-to-show', () => {
      window.maximize();
      window.show();
    });
  }

  installWebviewPreload(mainWindow);
  
  // Explicitly set the icon for Windows taskbar
  if (process.platform === 'win32') {
    mainWindow.setIcon(icon);
    console.log('[Icon] Set window icon for Windows');
    
    // Set icon again after window is shown (taskbar timing issue)
    mainWindow.once('show', () => {
      mainWindow.setIcon(icon);
      console.log('[Icon] Re-set icon on show event');
    });
    
    // Also set on focus to catch any missed updates
    mainWindow.once('focus', () => {
      mainWindow.setIcon(icon);
      console.log('[Icon] Re-set icon on focus event');
    });
  }

  // Same Chromium identity for normal pages, profile sessions and popups.
  SHIIRA_CONFIG.userAgent = app.userAgentFallback;
  session.defaultSession.setUserAgent(SHIIRA_CONFIG.userAgent);

  // Runtime cache for temporary permissions (cleared on restart)

  // Set up permission request handler for security
  // This controls access to sensitive device capabilities
  const setupPermissionHandlers = (sessionInstance, sessionName) => {
    if (permissionSessions.has(sessionInstance)) return;
    permissionSessions.add(sessionInstance);
    const runtimePermissions = new Map();
    const disk = sessionInstance.getStoragePath();
    const shared = sessionInstance === session.defaultSession || sessionInstance === session.fromPartition('persist:main');
    const permissionSite = host => shared ? host : `[${disk ? path.basename(disk) : 'private'}] ${host}`;
    sessionInstance.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      if (permission === 'media' || permission === 'display-capture') {
        const respond = callback;
        callback = granted => { if (granted) mediaCaptureGrants.add(webContents); respond(granted); };
      }
      const url = webContents.getURL();
      
      // Get hostname from URL
      let hostname = url;
      try {
        hostname = new URL(url).hostname;
      } catch (e) {}
      
      // For media permissions, determine what's being requested
      let specificPermission = permission;
      if (permission === 'media' && details) {
        const requestsVideo = details.mediaTypes && details.mediaTypes.includes('video');
        const requestsAudio = details.mediaTypes && details.mediaTypes.includes('audio');
        
        if (requestsVideo && requestsAudio) {
          specificPermission = 'media'; // Both camera and microphone
        } else if (requestsVideo) {
          specificPermission = 'camera'; // Camera only
        } else if (requestsAudio) {
          specificPermission = 'microphone'; // Microphone only
        }
        
        console.log(`[Permissions:${sessionName}] Media request details: video=${requestsVideo}, audio=${requestsAudio} -> '${specificPermission}'`);
      }
      
      // Define which permissions require user consent via UI
      const userConsentPermissions = ['media', 'camera', 'microphone', 'geolocation'];
      
      // Auto-deny clipboard access (security risk)
      if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
        callback(false);
        return;
      }
      
      // Auto-deny other sensitive permissions for now
      const autoDenyPermissions = ['notifications', 'midiSysex', 'openExternal'];
      if (autoDenyPermissions.includes(permission)) {
        callback(false);
        return;
      }
      
      // Allow fullscreen and pointerLock (needed for gaming, video players)
      if (permission === 'fullscreen' || permission === 'pointerLock') {
        callback(true);
        return;
      }
      
      // Allow DRM-related permissions (needed for Netflix, Disney+, etc.)
      if (permission === 'protectedMediaId' || permission === 'mediaKeySystem') {
        console.log(`[Permissions:${sessionName}] ✓ AUTO-ALLOW DRM permission '${permission}' for ${hostname}`);
        callback(true);
        return;
      }
      
      // Check if permission was previously granted/denied (saved or runtime)
      const savedPermission = disk ? privacyService.getPermissionForSite(permissionSite(hostname), specificPermission) : null;
      const runtimePermission = runtimePermissions.get(`${hostname}:${specificPermission}`);
      const existingPermission = savedPermission ?? runtimePermission;
      
      if (existingPermission !== null && existingPermission !== undefined) {
        callback(existingPermission);
        return;
      }
      
      // For media/geolocation, show UI dialog and ask user
      if (userConsentPermissions.includes(specificPermission)) {
        console.log(`[Permissions] 🔒 Requesting '${specificPermission}' permission from ${hostname}`);
        
        // Find the window that owns this webContents
        const window = browsingWindow(webContents);
        if (window && !window.isDestroyed()) {
          try {
            // Send permission request to renderer and wait for response
            const response = await new Promise((resolve) => {
              const requestId = crypto.randomUUID();
              
              // Set up one-time listener for response
              const channel = `permission-response-${requestId}`;
              const answer = (event, granted, remember) => {
                if (event.sender !== window.webContents || !isBrowserChromeSender(event)) return;
                clearTimeout(timer); ipcMain.removeListener(channel, answer);
                resolve({ granted: granted === true, remember: remember === true });
              };
              ipcMain.on(channel, answer);
              
              // Send request to renderer
              window.webContents.send('permission-request', {
                requestId,
                permission: specificPermission,
                hostname,
                url
              });
              
              // Timeout after 60 seconds
              const timer = setTimeout(() => { ipcMain.removeListener(channel, answer); resolve({ granted: false, remember: false }); }, 60000);
            });
            
            // Save permission if user chose to remember
            if (response.remember && disk) {
              privacyService.setPermissionForSite(permissionSite(hostname), specificPermission, response.granted);
              console.log(`[Permissions] 💾 Saved: ${hostname} - ${specificPermission} = ${response.granted ? '✓ ALLOW' : '❌ DENY'}`);
            } else {
              // Store in runtime cache for this session
              const cacheKey = `${hostname}:${specificPermission}`;
              runtimePermissions.set(cacheKey, response.granted);
              console.log(`[Permissions] ⏱️  Session: ${hostname} - ${specificPermission} = ${response.granted ? '✓ ALLOW' : '❌ DENY'}`);
            }
            callback(response.granted);
            return;
          } catch (err) {
            console.error(`[Permissions:${sessionName}] Error showing permission dialog:`, err);
            callback(false);
            return;
          }
        }
        
        // Fallback: deny if window not found
        console.log(`[Permissions:${sessionName}] ❌ DENIED '${permission}' from ${url} (no window)`);
        callback(false);
        return;
      }
      
      // Allow non-sensitive permissions
      callback(true);
    });
    
    // Set permission check handler for persistent permissions
    sessionInstance.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      // Get hostname from origin
      let hostname = requestingOrigin;
      try {
        hostname = new URL(requestingOrigin).hostname;
      } catch (e) {}
      
      // For media permissions, check handler doesn't always provide details
      // So we need to check all possible media-related permissions
      if (permission === 'media') {
        // Check both saved and runtime permissions
        const micPermission = (disk ? privacyService.getPermissionForSite(permissionSite(hostname), 'microphone') : null) ?? runtimePermissions.get(`${hostname}:microphone`);
        const camPermission = (disk ? privacyService.getPermissionForSite(permissionSite(hostname), 'camera') : null) ?? runtimePermissions.get(`${hostname}:camera`);
        const mediaPermission = (disk ? privacyService.getPermissionForSite(permissionSite(hostname), 'media') : null) ?? runtimePermissions.get(`${hostname}:media`);
        
        // If any media permission was granted, return true
        if (micPermission === true || camPermission === true || mediaPermission === true) {
          return true;
        }
        
        // If any was explicitly denied, return false
        if (micPermission === false || camPermission === false || mediaPermission === false) {
          return false;
        }
      } else {
        // For non-media permissions, check saved and runtime
        const savedPermission = disk ? privacyService.getPermissionForSite(permissionSite(hostname), permission) : null;
        const runtimePermission = runtimePermissions.get(`${hostname}:${permission}`);
        const finalPermission = savedPermission ?? runtimePermission;
        
        if (finalPermission !== null && finalPermission !== undefined) {
          return finalPermission;
        }
      }
      
      // Auto-allow non-sensitive permissions
      if (permission === 'fullscreen' || permission === 'pointerLock') {
        return true;
      }
      
      // Auto-allow DRM permissions (needed for streaming services)
      if (permission === 'protectedMediaId' || permission === 'mediaKeySystem') {
        return true;
      }
      
      // Deny if not previously granted
      return false;
    });
    
    console.log(`[Permissions:${sessionName}] Permission handlers installed`);
  };
  
  // Apply to default session
  setupPermissionHandlers(session.defaultSession, 'default');
  installBrowserHeaderOverrides(session.defaultSession);
  installDownloadPrompt(session.defaultSession);
  
  // Apply to persist:main partition (used by webviews)
  const webviewSession = session.fromPartition('persist:main');
  webviewSession.setUserAgent(SHIIRA_CONFIG.userAgent);
  setupPermissionHandlers(webviewSession, 'persist:main');
  installBrowserHeaderOverrides(webviewSession);
  installDownloadPrompt(webviewSession);
  preconnectBrowserSession(session.defaultSession);
  preconnectBrowserSession(webviewSession);
  configurePageSession = activeSession => {
    setupPermissionHandlers(activeSession, 'profile');
    activeSession.setUserAgent(SHIIRA_CONFIG.userAgent);
    installBrowserHeaderOverrides(activeSession); installDownloadPrompt(activeSession);
    adBlocker.attachPageSession(activeSession);
  };

  // Load the browser UI
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Handle keyboard shortcuts globally (for main window, not webviews)
  // Webviews are handled separately via app.on('web-contents-created')
  mainWindow.webContents.on('before-input-event', (event, input) => {
    handleKeyboardShortcut(event, input, mainWindow);
  });

  // Track this window
  browserWindows.add(mainWindow);
  extensionsService.watchWindow(mainWindow);
  console.log('[Session] Window opened. Total windows:', browserWindows.size);

  mainWindow.on('closed', () => {
    browserWindows.delete(mainWindow);
    console.log('[Session] Window closed. Remaining windows:', browserWindows.size);
    mainWindow = null;
  });

  // Handle maximize/restore for custom titlebar
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized');
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-restored');
  });
}

function installWebviewPreload(window) {
  window.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = path.join(__dirname, '../preload/webview.bundle.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.disableBlinkFeatures = withoutAutomationIndicator(webPreferences.disableBlinkFeatures);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  const startupSplash = createStartupSplash({ app, BrowserWindow, ipcMain });
  browserSettings.initialize(path.join(app.getPath('userData'), 'browser-settings.json'));
  spacesService.initialize(path.join(app.getPath('userData'), 'spaces.json'));
  profilesService.initialize(path.join(app.getPath('userData'), 'profiles.json'));
  shortcutsService.initialize(path.join(app.getPath('userData'), 'shortcuts.json'));
  // Install/update Widevine without holding offline browser startup on a download.
  if (components) {
    components.whenReady().then(() => {
      console.log('[Widevine] Components ready:', components.status());
    }).catch((error) => {
      console.warn('[Widevine] Components unavailable:', error.message);
    });
  }

  // Set app icon for Windows taskbar/dock
  if (process.platform === 'win32') {
    const iconPath = getAssetPath('shiira-logo.ico');
    if (fs.existsSync(iconPath)) {
      const icon = nativeImage.createFromPath(iconPath);
      app.setAppUserModelId('com.Shiira.shiira');
      // Note: Electron doesn't support app.setIcon(), icon is set per-window
    }
  }

  // Register custom protocol for assets
  protocol.registerFileProtocol('shiira-asset', (request, callback) => {
    const url = request.url.replace('shiira-asset://', '');
    const filePath = getAssetPath(url);
    callback({ path: filePath });
  });

  // Chrome extensions must be ready before the first tab's webview attaches.
  extensionsService.initialize({
    getWindow: () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && browserWindows.has(focused)) return focused;
      return mainWindow && !mainWindow.isDestroyed() ? mainWindow : [...browserWindows][0] || null;
    }
  });

  // The splash covers startup while the browser restores its initial tab.
  createWindow(startupSplash);
  for (const profile of profilesService.list()) if (profile.id !== 'default') {
    configurePageSession(session.fromPartition(profile.partition));
    extensionsService.ensureProfile(profile.id, profile.partition);
  }
  externalLinks.start();

  // Start slow tasks without blocking the first window.
  detectHardwareAccelerationProfile().catch((error) => {
    console.warn('[Hardware] Capability detection failed:', error.message);
  });

  // Initialize services in the background; do not block first launch on keytar/DB setup.
  favoritesService.initialize();
  bookmarksService.initialize();
  privacyService.initialize();

  // Restore the Shield (encrypted DNS) toggle from the last session.
  if (privacyService.getSettings().shieldEnabled) {
    dnsShield.enable();
  }

  passwordService.initialize().then(() => {
    // Vault (Safe Folder) reuses the same OS-keychain-backed key as the password manager.
    vaultService = new VaultService(passwordService.encryptionKey, app.getPath('userData'));
  }).catch((error) => {
    console.error('[Password Service] Failed to initialize:', error.message);
  });

  // Initialize ad-blocker with bundled filter lists
  const rulesDir = app.isPackaged
    ? path.join(process.resourcesPath, 'filter-lists')
    : path.join(__dirname, '../../filter-lists');

  // Create filter-lists directory if it doesn't exist
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
    console.log('[AdBlocker] Created filter-lists directory:', rulesDir);
  }

  // Initialize network request blocking with the default, non-aggressive ruleset.
  adBlocker.init(rulesDir, { enabledRulesets: ['default'] }).catch(err => {
    console.error('[AdBlocker] Initialization failed:', err);
  });

  // Initialize cosmetic filtering (element hiding)
  try {
    const cosmeticStats = cosmeticInjector.init(rulesDir);
    console.log('[Cosmetic Injector] Ready with', cosmeticStats.genericCount, 'generic selectors');
  } catch (err) {
    console.error('[Cosmetic Injector] Initialization failed:', err);
  }

  // Initialize script injection (disabled by default to avoid anti-adblock and player breakage)
  try {
    const scriptStats = scriptInjector.init(rulesDir);
    console.log('[Script Injector] Ready with', scriptStats.sitesCovered, 'site scripts (YouTube, etc.)');
  } catch (err) {
    console.error('[Script Injector] Initialization failed:', err);
  }

  // Initialize auto-updater after window is created
  if (app.isPackaged) {
    autoUpdaterService.initialize(mainWindow);
    // Check for updates 3 seconds after app starts
    if (browserSettings.get().autoCheckUpdates) {
      setTimeout(() => {
        autoUpdaterService.checkForUpdates().catch(err => {
          console.log('Auto-update check failed:', err.message);
        });
      }, 3000);
    }
  } else {
    // In dev mode, register stub handlers to avoid IPC errors
    ipcMain.handle('check-for-updates', () => {
      console.log('[Dev] Update check skipped in dev mode');
      return { success: false, error: 'Updates disabled in dev mode' };
    });
    ipcMain.handle('download-update', () => ({ success: false, error: 'Updates disabled in dev mode' }));
    ipcMain.handle('install-update', () => ({ success: false, error: 'Updates disabled in dev mode' }));
    ipcMain.handle('get-update-status', () => ({ updateAvailable: false, updateDownloaded: false }));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers for window controls
ipcMain.handle('window-minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.minimize();
});

ipcMain.handle('window-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window?.isMaximized()) {
    window.restore();
  } else {
    window?.maximize();
  }
});

ipcMain.handle('window-close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
});

ipcMain.handle('window-is-maximized', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window?.isMaximized() ?? false;
});

// Session management IPC handlers
ipcMain.handle('session-save', (event, sessionData) => {
  if (externalLinks.isLittleSender(event)) return false;
  saveSession(sessionData);
  return true;
});

ipcMain.handle('session-load', event => {
  if (externalLinks.isLittleSender(event)) return null;
  return loadSession();
});

ipcMain.handle('session-clear', event => {
  if (externalLinks.isLittleSender(event)) return false;
  clearSession();
  return true;
});

ipcMain.handle('get-window-count', () => {
  return browserWindows.size;
});

// IPC Handler for getting app info
ipcMain.handle('get-app-info', () => {
  return {
    name: SHIIRA_CONFIG.name,
    version: SHIIRA_CONFIG.version,
    company: SHIIRA_CONFIG.company,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    hardwareAcceleration: hardwareAccelerationProfile
  };
});

// IPC Handler for getting asset path
ipcMain.handle('get-asset-path', (event, relativePath) => {
  return getAssetPath(relativePath);
});

// IPC Handler for creating new window
ipcMain.handle('create-new-window', (event, url) => {
  const newWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    title: SHIIRA_CONFIG.name,
    icon: path.join(__dirname, '../../assets/shiira-logo.ico'),
    frame: false,
    show: false,
    backgroundColor: '#020308',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
      backgroundThrottling: false,
      v8CacheOptions: 'bypassHeatCheckAndEagerCompile',
      preload: path.join(__dirname, '../preload/preload.js'),
      webviewTag: true
    }
  });

  installWebviewPreload(newWindow);
  newWindow.webContents.on('before-input-event', (event, input) => handleKeyboardShortcut(event, input, newWindow));
  newWindow.once('ready-to-show', () => newWindow.show());
  
  session.defaultSession.setUserAgent(SHIIRA_CONFIG.userAgent);
  
  newWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // Track this window
  browserWindows.add(newWindow);
  extensionsService.watchWindow(newWindow);
  console.log('[Session] New window opened. Total windows:', browserWindows.size);
  
  newWindow.on('closed', () => {
    browserWindows.delete(newWindow);
    console.log('[Session] Window closed. Remaining windows:', browserWindows.size);
  });
  
  // If URL is provided, send it to the new window once it's ready
  if (url) {
    void externalLinks.openInWindow(newWindow, url);
  }
  
  return newWindow.id;
});

// Future: Ad-blocker will be implemented here
// Ad-blocker IPC Handlers
ipcMain.handle('adblock-get-status', () => {
  return {
    enabled: adBlocker.isEnabled(),
    stats: adBlocker.getStats(),
    enabledRulesets: adBlocker.getEnabledRulesets(),
    availableRulesets: adBlocker.getAvailableRulesets()
  };
});

ipcMain.handle('adblock-set-enabled', (event, enabled) => {
  adBlocker.setEnabled(enabled);
  return { success: true, enabled };
});

ipcMain.handle('adblock-get-stats', () => {
  return adBlocker.getStats();
});

ipcMain.handle('adblock-reset-stats', () => {
  adBlocker.resetStats();
  return { success: true };
});

ipcMain.handle('adblock-get-rulesets', () => {
  return {
    available: adBlocker.getAvailableRulesets(),
    enabled: adBlocker.getEnabledRulesets()
  };
});

ipcMain.handle('adblock-set-rulesets', async (event, rulesetIds) => {
  try {
    await adBlocker.setEnabledRulesets(rulesetIds);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Cosmetic Filter IPC Handlers
ipcMain.handle('cosmetic-get-status', () => {
  return cosmeticInjector.getStats();
});

ipcMain.handle('cosmetic-set-enabled', (event, enabled) => {
  cosmeticInjector.setEnabled(enabled);
  return { success: true, enabled };
});

ipcMain.handle('cosmetic-get-css', (event, url) => {
  return cosmeticInjector.getCSSForUrl(url);
});

ipcMain.handle('dark-reader-get-script', () => {
  try {
    return { success: true, script: getDarkReaderScript() };
  } catch (error) {
    console.error('[Dark Mode] Failed to load Dark Reader:', error);
    return { success: false, error: error.message };
  }
});

// Script Injection IPC Handlers (YouTube ad blocking)
ipcMain.handle('script-get-status', () => {
  return scriptInjector.getStats();
});

ipcMain.handle('script-set-enabled', (event, enabled) => {
  scriptInjector.setEnabled(enabled);
  return { success: true, enabled };
});

ipcMain.handle('script-get-for-url', (event, url) => {
  const script = scriptInjector.getScriptForUrl(url);
  if (script) {
    scriptInjector.trackInjection();
  }
  return { script, hasScript: !!script };
});

// Tab audio state handler
ipcMain.handle('is-webcontents-audible', (event, webContentsId) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (wc) {
      return wc.isCurrentlyAudible();
    }
  } catch (e) {
    // WebContents may not exist
  }
  return false;
});

// Chrome Import IPC Handlers
ipcMain.handle('chrome-get-profiles', () => {
  return chromeImporter.getProfiles();
});

ipcMain.handle('chrome-get-import-summary', (event, profileId) => {
  return chromeImporter.getImportSummary(profileId);
});

ipcMain.handle('chrome-import-bookmarks', (event, profileId) => {
  return chromeImporter.importBookmarks(profileId);
});

ipcMain.handle('chrome-import-history', (event, profileId, limit) => {
  return chromeImporter.importHistory(profileId, limit);
});

ipcMain.handle('chrome-get-saved-logins', (event, profileId) => {
  return chromeImporter.getSavedLoginSites(profileId);
});

// Privacy Service IPC Handlers
ipcMain.handle('privacy-get-settings', () => {
  return privacyService.getSettings();
});

ipcMain.handle('privacy-set-setting', (event, key, value) => {
  return privacyService.setSetting(key, value);
});

ipcMain.handle('privacy-clear-browsing-data', async (event, kind = 'cache') => {
  const targets = [session.defaultSession, ...profilesService.list().map(p => session.fromPartition(p.partition))];
  try {
    await Promise.all(targets.map(async (targetSession) => {
      if (kind === 'cache' || kind === 'cookies-and-cache') {
        await targetSession.clearCache();
      }

      if (kind === 'cookies' || kind === 'cookies-and-cache') {
        const cookies = await targetSession.cookies.get({});
        await Promise.all(cookies.map(cookie => {
          const protocol = cookie.secure ? 'https://' : 'http://';
          const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
          return targetSession.cookies.remove(`${protocol}${host}${cookie.path}`, cookie.name);
        }));
      }

      if (kind === 'storage') {
        await targetSession.clearStorageData();
      }
    }));

    return { success: true };
  } catch (error) {
    console.error('[Privacy] Failed to clear browsing data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('privacy-get-site-permissions', (event, hostname) => {
  return privacyService.getSitePermissions(hostname);
});

ipcMain.handle('privacy-clear-site-permissions', (event, hostname) => {
  return privacyService.clearSitePermissions(hostname);
});

ipcMain.handle('browser-settings-get', () => ({
  ...browserSettings.get(),
  defaultDownloadDirectory: app.getPath('downloads')
}));
ipcMain.handle('browser-settings-set', (event, key, value) => browserSettings.setBoolean(key, value));
ipcMain.handle('downloads-choose-directory', async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(ownerWindow || undefined, {
    title: 'Choose download folder',
    defaultPath: downloadFolder(),
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return browserSettings.setDownloadDirectory(result.filePaths[0]);
});
ipcMain.handle('downloads-reset-directory', () => browserSettings.setDownloadDirectory(null));
ipcMain.handle('downloads-open-directory', async () => {
  const directory = downloadFolder();
  const error = await shell.openPath(directory);
  return error ? { success: false, error } : { success: true };
});

// Spaces, pinned tabs, favorites and archive (Arc-style sidebar)
ipcMain.handle('profiles-list', event => isBrowserChromeSender(event) ? profilesService.list() : []);
ipcMain.handle('profiles-rename', (event, id, name) => {
  if (!isBrowserChromeSender(event) || externalLinks.isLittleSender(event)) return { error: 'Unavailable.' };
  try {
    const profiles = profilesService.rename(id, name);
    for (const win of browserWindows) if (!win.isDestroyed()) win.webContents.send('profiles-changed', profiles);
    return { profiles };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('profiles-create', (event, name) => {
  if (!isBrowserChromeSender(event) || externalLinks.isLittleSender(event)) return { error: 'Unavailable.' };
  try {
    const profile = profilesService.create(name);
    configurePageSession(session.fromPartition(profile.partition));
    extensionsService.ensureProfile(profile.id, profile.partition);
    for (const win of browserWindows) if (!win.isDestroyed()) win.webContents.send('profiles-changed', profilesService.list());
    return { profile, profiles: profilesService.list() };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('spaces-load', event => isBrowserChromeSender(event) ? sidebarSync.load() : null);
ipcMain.handle('spaces-save', async (event, doc, revision) => {
  if (!isBrowserChromeSender(event) || externalLinks.isLittleSender(event)) return { success: false, error: 'This window cannot save Spaces.' };
  if ([...(Array.isArray(doc?.spaces) ? doc.spaces : []), ...(Array.isArray(doc?.items) ? doc.items : [])].some(row => !profilesService.has(row?.profileId || 'default'))) return { success: false, error: 'A selected browser profile is unavailable.' };
  const result = await sidebarSync.save(doc, revision);
  if (result.success) for (const win of browserWindows) if (!win.isDestroyed() && win.webContents !== event.sender) win.webContents.send('spaces-changed', result.doc);
  return result;
});

// Arc import: Arc's files are only read. The renderer can only read a file the user found or picked here.
function arcPreview(filePath) {
  try {
    const plan = arcImporter.readArcPlan(filePath);
    const source = arcImporter.resolveArcSource(filePath).sidebarFile;
    allowedArcFiles.add(source);
    return { found: true, path: source, summary: arcImporter.summarizePlan(plan) };
  } catch (error) {
    return { found: true, path: filePath, error: error.message };
  }
}

ipcMain.handle('arc-locate', () => {
  const filePath = arcImporter.locateArcSidebar();
  return filePath ? arcPreview(filePath) : { found: false };
});
ipcMain.handle('arc-choose-file', async (event) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const detected = arcImporter.locateArcSidebar();
  const buttons = [...(detected ? ['Use Detected Arc Data'] : []), 'Choose Arc Folder…', 'Choose Sidebar File…', 'Cancel'];
  const choice = await dialog.showMessageBox(ownerWindow || undefined, {
    type: 'question', title: 'Import from Arc', message: 'Where is your Arc data?',
    detail: `${detected ? `Found ${detected}\n\n` : ''}Choose the Arc folder to include its archive, cached icons and browsing history, or choose StorableSidebar.json alone. A folder copied from another computer works too. Quit Arc first for the most complete result.`,
    buttons, defaultId: 0, cancelId: buttons.length - 1
  });
  if (choice.response === buttons.length - 1) return { canceled: true };
  if (detected && choice.response === 0) return arcPreview(detected);
  const folder = choice.response === (detected ? 1 : 0);
  const result = await dialog.showOpenDialog(ownerWindow || undefined, {
    title: folder ? 'Choose the Arc data folder' : 'Choose Arc’s StorableSidebar.json',
    ...(folder ? {} : { filters: [{ name: 'Arc sidebar', extensions: ['json'] }] }),
    properties: [folder ? 'openDirectory' : 'openFile', 'showHiddenFiles']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return arcPreview(result.filePaths[0]);
});
ipcMain.handle('arc-read', (event, filePath, options = {}) => {
  if (!allowedArcFiles.has(filePath)) return { success: false, error: 'Choose the Arc sidebar file first.' };
  try {
    return { success: true, plan: arcImporter.readArcPlan(filePath, { includeHistory: options?.includeHistory === true }) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Shield (Encrypted DNS) IPC Handlers
ipcMain.handle('shield-get-status', () => {
  return dnsShield.getStatus();
});

ipcMain.handle('shield-set-enabled', (event, enabled) => {
  if (enabled) {
    dnsShield.enable();
  } else {
    dnsShield.disable();
  }
  privacyService.setSetting('shieldEnabled', enabled);
  return { success: true, enabled: dnsShield.isEnabled() };
});

ipcMain.handle('download-url', (event, url, options = {}) => {
  if (!url) {
    return { success: false, error: 'No URL provided' };
  }

  try {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);

    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
      if (!match) {
        return { success: false, error: 'Invalid data URL' };
      }

      const mimeType = match[1] || 'application/octet-stream';
      const isBase64 = Boolean(match[2]);
      const data = isBase64 ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
      const extension = mime.extension(mimeType) || 'bin';

      dialog.showSaveDialog(ownerWindow || undefined, {
        title: options.title || 'Save File',
        defaultPath: path.join(downloadFolder(), `download.${extension}`)
      }).then((result) => {
        if (!result.canceled && result.filePath) {
          fs.promises.writeFile(result.filePath, data).catch(error => {
            console.error('[Download] Failed to save data URL:', error);
          });
        }
      });

      return { success: true };
    }

    const targetSession = session.fromPartition(options.partition || 'persist:main');
    queueDownload(targetSession, url, {
      title: options.title || 'Save File',
      windowId: ownerWindow?.id,
      prompt: options.prompt
    });
    return { success: true };
  } catch (error) {
    console.error('[Download] Failed to start download:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-image-url', async (event, url) => {
  if (!url) {
    return { success: false, error: 'No image URL provided' };
  }

  try {
    if (url.startsWith('data:image/')) {
      const image = nativeImage.createFromDataURL(url);
      if (image.isEmpty()) throw new Error('Image data could not be decoded');
      await clipboard.write([new ClipboardItem({
        'image/png': new Blob([image.toPNG()], { type: 'image/png' })
      })]);
      return { success: true };
    }

    const response = await net.fetch(url);
    if (!response.ok) {
      throw new Error(`Image request failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      throw new Error('Image data could not be decoded');
    }

    await clipboard.write([new ClipboardItem({
      'image/png': new Blob([image.toPNG()], { type: 'image/png' })
    })]);
    return { success: true };
  } catch (error) {
    console.error('[Clipboard] Failed to copy image:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-item-in-folder', async (event, pathToShow) => {
  if (!pathToShow) return { success: false, error: 'No path provided' };
  shell.showItemInFolder(pathToShow);
  return { success: true };
});

// Favorites IPC handlers
ipcMain.handle('favorites-get', () => {
  return favoritesService.getFavorites();
});

ipcMain.handle('favorites-set-enabled', (event, enabled) => {
  return favoritesService.setEnabled(enabled);
});

ipcMain.handle('favorites-set', (event, slotIndex, url, name) => {
  return favoritesService.setFavorite(slotIndex, url, name);
});

ipcMain.handle('favorites-remove', (event, slotIndex) => {
  return favoritesService.removeFavorite(slotIndex);
});

// Bookmarks IPC handlers
ipcMain.handle('bookmarks-get', () => {
  return bookmarksService.getBookmarks();
});

ipcMain.handle('bookmarks-set-bar-enabled', (event, enabled) => {
  return bookmarksService.setBarEnabled(enabled);
});

ipcMain.handle('bookmarks-is-bar-enabled', () => {
  return bookmarksService.isBarEnabled();
});

ipcMain.handle('bookmarks-add', (event, { url, title, icon, folderId }) => {
  return bookmarksService.addBookmark({ url, title, icon, folderId });
});

ipcMain.handle('bookmarks-create-folder', (event, { name, parentFolderId }) => {
  return bookmarksService.createFolder({ name, parentFolderId });
});

ipcMain.handle('bookmarks-remove', (event, itemId) => {
  return bookmarksService.removeItem(itemId);
});

ipcMain.handle('bookmarks-update', (event, itemId, updates) => {
  return bookmarksService.updateItem(itemId, updates);
});

ipcMain.handle('bookmarks-move', (event, itemId, targetFolderId, targetIndex) => {
  return bookmarksService.moveItem(itemId, targetFolderId, targetIndex);
});

ipcMain.handle('bookmarks-is-bookmarked', (event, url) => {
  return bookmarksService.isBookmarked(url);
});

ipcMain.handle('bookmarks-find-by-url', (event, url) => {
  return bookmarksService.findBookmarkByUrl(url);
});

ipcMain.handle('bookmarks-get-folders', () => {
  return bookmarksService.getFolderList();
});

ipcMain.handle('bookmarks-import', (event, htmlContent) => {
  return bookmarksService.importFromHtml(htmlContent);
});

ipcMain.handle('bookmarks-save-icon', (event, bookmarkId, base64Data, mimeType) => {
  return bookmarksService.saveCustomIcon(bookmarkId, base64Data, mimeType);
});

ipcMain.handle('bookmarks-delete-icon', (event, bookmarkId) => {
  return bookmarksService.deleteCustomIcon(bookmarkId);
});

// Browser-chrome APIs are available only to the local UI, never to websites or
// extension pages sharing its preload bridge.
function isBrowserChromeSender(event) {
  const { pathToFileURL } = require('url');
  const rendererRoot = pathToFileURL(path.join(__dirname, '../renderer')).href;
  const frameUrl = event.senderFrame?.url;
  return event.senderFrame === event.sender.mainFrame && typeof frameUrl === 'string' &&
    (frameUrl === pathToFileURL(path.join(__dirname, '../renderer/index.html')).href ||
     frameUrl.startsWith(rendererRoot + '/'));
}
ipcMain.handle('clipboard-read-text', event => isBrowserChromeSender(event) ? clipboard.readText() : '');
ipcMain.handle('clipboard-write-text', async (event, text) => {
  if (!isBrowserChromeSender(event) || typeof text !== 'string') throw new Error('Unavailable.');
  await clipboard.writeText(text);
  return true;
});
ipcMain.handle('search-status', event => isBrowserChromeSender(event) ? searchService.status() : {});
ipcMain.handle('search-set-key', (event, provider, key) => isBrowserChromeSender(event) ? searchService.setKey(provider, key) : { success: false, error: 'Unavailable.' });
const searchOwners = new Set();
ipcMain.handle('search-query', (event, request) => {
  if (!isBrowserChromeSender(event)) return { success: false, error: 'Unavailable.' };
  const owner = event.sender.id;
  if (!searchOwners.has(owner)) {
    searchOwners.add(owner);
    event.sender.once('destroyed', () => { searchService.cancelOwner(owner); searchOwners.delete(owner); });
  }
  return searchService.search(owner, request);
});
ipcMain.handle('search-cancel', (event, id) => {
  if (isBrowserChromeSender(event) && typeof id === 'string') searchService.cancel(event.sender.id, id);
});
ipcMain.handle('get-url-suggestions', async (event, query, provider) => {
  if (!isBrowserChromeSender(event) || !privacyService.isUrlSuggestionsEnabled() || privacyService.getSuggestionsProvider() === 'none') return [];
  return searchService.suggest(query, provider);
});

// Password Manager IPC Handlers
ipcMain.handle('passwords-get-all', () => {
  return passwordService.getAllPasswords();
});

ipcMain.handle('passwords-get-for-url', (event, url) => {
  return passwordService.getPasswordsForUrl(url);
});

ipcMain.handle('passwords-add', (event, url, username, password) => {
  return passwordService.addPassword(url, username, password);
});

ipcMain.handle('passwords-update', (event, id, url, username, password) => {
  passwordService.updatePassword(id, url, username, password);
  return { success: true };
});

ipcMain.handle('passwords-delete', (event, id) => {
  passwordService.deletePassword(id);
  return { success: true };
});

ipcMain.handle('passwords-import-csv', (event, csvData) => {
  return passwordService.importFromCSV(csvData);
});

ipcMain.handle('passwords-import-selected', (event, entries) => {
  return passwordService.importSelected(entries);
});

ipcMain.handle('passwords-delete-all', async () => {
  try {
    const fs = require('fs');
    const dbPath = path.join(app.getPath('userData'), 'passwords.db');
    const keyPath = path.join(app.getPath('userData'), 'password.key');
    
    // Close the database connection first to release the lock
    passwordService.close();
    
    // Delete both files if they exist
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
    }
    
    // Also delete key from OS credential storage
    const keytar = require('keytar');
    try {
      await keytar.deletePassword('Shiira Browser', 'master-encryption-key');
    } catch (e) {
      // Key might not exist, ignore error
    }
    
    // Reinitialize the password service with fresh database
    await passwordService.initialize();
    
    return { success: true };
  } catch (err) {
    console.error('Error deleting passwords:', err);
    
    // Try to reinitialize even if deletion failed partially
    try {
      await passwordService.initialize();
    } catch (reinitErr) {
      console.error('Error reinitializing password service:', reinitErr);
    }
    
    return { success: false, error: err.message };
  }
});

// Vault (Safe Folder) IPC Handlers
ipcMain.handle('vault-has-pin', () => {
  return vaultService ? vaultService.hasPIN() : false;
});

ipcMain.handle('vault-setup-pin', (event, pin) => {
  if (!vaultService) return { success: false, error: 'Vault not ready' };
  vaultService.setupPIN(pin);
  return { success: true };
});

ipcMain.handle('vault-verify-pin', (event, pin) => {
  return vaultService ? vaultService.verifyPIN(pin) : false;
});

ipcMain.handle('vault-try-biometric', (event, reason) => {
  return vaultService ? vaultService.tryBiometric(reason) : Promise.resolve(false);
});

ipcMain.handle('vault-safe-list', () => {
  return vaultService ? vaultService.list() : [];
});

ipcMain.handle('vault-safe-add', (event, name, base64Data, mimeType) => {
  if (!vaultService) return { success: false, error: 'Vault not ready' };
  const data = Buffer.from(base64Data, 'base64');
  return vaultService.addFile(name, data, mimeType);
});

ipcMain.handle('vault-safe-get', (event, id) => {
  if (!vaultService) return null;
  const result = vaultService.getFile(id);
  if (!result) return null;
  return { file: result.file, data: result.data.toString('base64') };
});

ipcMain.handle('vault-safe-remove', (event, id) => {
  if (!vaultService) return { success: false, error: 'Vault not ready' };
  vaultService.removeFile(id);
  return { success: true };
});

ipcMain.handle('create-password-anvil-window', () => {
  const passwordWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Password Anvil',
    icon: getAssetPath('shiira-logo.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });
  
  passwordWindow.loadFile(path.join(__dirname, '../renderer/password-anvil/index.html'));
  return { success: true };
});

