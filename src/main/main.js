const { app, BrowserWindow, ipcMain, session, protocol, nativeImage, Menu } = require('electron');

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

// Disable default Electron menu to prevent Ctrl+R from reloading the whole window
// Our renderer handles all keyboard shortcuts
Menu.setApplicationMenu(null);
const ChromeImporter = require('./chrome-importer');
const AIService = require('./ai-service');
const autoUpdaterService = require('./auto-updater');
const FavoritesService = require('./favorites-service');
const PasswordService = require('./password-service');
const BookmarksService = require('./bookmarks-service');
const PrivacyService = require('./privacy-service');
const { getAdBlocker, getCosmeticInjector, getScriptInjector } = require('./ad-blocker');

// Initialize Chrome Importer
const chromeImporter = new ChromeImporter();

// Initialize Favorites Service
const favoritesService = new FavoritesService();

// Initialize Password Service
const passwordService = new PasswordService();

// Initialize Bookmarks Service
const bookmarksService = new BookmarksService();

// Initialize Privacy Service
const privacyService = new PrivacyService();

// Initialize Ad Blocker (network blocking)
const adBlocker = getAdBlocker();

// Initialize Cosmetic Injector (element hiding)
const cosmeticInjector = getCosmeticInjector();

// Initialize Script Injector (YouTube ad blocking)
const scriptInjector = getScriptInjector();

// AI Service will be initialized after app is ready
let aiService = null;
let darkReaderScriptCache = null;
let hardwareAccelerationProfile = {
  avx2: false,
  vulkanLikely: false,
  renderer: 'default',
  controllers: []
};

configureHardwareAcceleration();

// Set app name for taskbar
app.setName('Shiira');

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

function configureHardwareAcceleration() {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('enable-features', [
    'Vulkan',
    'VulkanFromANGLE',
    'DefaultANGLEVulkan',
    'CanvasOopRasterization',
    'UseSkiaRenderer'
  ].join(','));
  app.commandLine.appendSwitch('use-angle', 'vulkan');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
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
      renderer: vulkanLikely ? 'vulkan-angle' : 'default',
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
  if (input.type !== 'keyDown') return;
  
  const ctrl = input.control || input.meta;
  const shift = input.shift;
  const alt = input.alt;
  const key = input.key.toLowerCase();
  
  // Define shortcuts that should be handled by the browser UI
  let shortcut = null;
  
  if (ctrl && !shift && key === 't') shortcut = 'new-tab';
  else if (ctrl && !shift && key === 'w') shortcut = 'close-tab';
  else if (ctrl && shift && key === 't') shortcut = 'reopen-tab';
  else if (ctrl && !shift && key === 'tab') shortcut = 'next-tab';
  else if (ctrl && shift && key === 'tab') shortcut = 'prev-tab';
  else if (ctrl && !shift && key === 'l') shortcut = 'focus-url';
  else if (ctrl && shift && key === 'r') shortcut = 'hard-reload';
  else if (ctrl && !shift && key === 'r') shortcut = 'reload';
  else if (!ctrl && !shift && !alt && key === 'f5') shortcut = 'reload';
  else if (alt && !ctrl && key === 'arrowleft') shortcut = 'go-back';
  else if (alt && !ctrl && key === 'arrowright') shortcut = 'go-forward';
  else if (ctrl && !shift && key === 'h') shortcut = 'show-history';
  else if (ctrl && shift && key === 'b') shortcut = 'toggle-bookmarks-bar';
  else if (ctrl && shift && key === 'e') shortcut = 'tab-expose';
  else if (key === 'escape') shortcut = 'close-popups';
  else if (ctrl && shift && key === 'i') {
    // Open DevTools for the main window (docked) - works for inspecting both browser UI and webviews
    event.preventDefault();
    targetWindow.webContents.openDevTools();
    return;
  }
  
  if (shortcut) {
    event.preventDefault();
    targetWindow.webContents.send('keyboard-shortcut', shortcut);
  }
}

// Listen for all new webContents (including webviews) and add keyboard shortcut handling
app.on('web-contents-created', (event, contents) => {
  // Handle popup windows created by setWindowOpenHandler
  if (contents.getType() === 'window') {
    console.log('[Popup] New popup window created');
    
    // Inject password autofill when popup loads
    contents.on('did-finish-load', async () => {
      const url = contents.getURL();
      console.log('[Popup] did-finish-load:', url);
      
      // Inject password autofill script (same as webviews)
      try {
        const scriptPath = path.join(__dirname, '../renderer/password-anvil/password-autofill.js');
        const script = fs.readFileSync(scriptPath, 'utf8');
        
        // Wrap script execution to catch errors
        const result = await contents.executeJavaScript(`
          (function() {
            try {
              ${script}
              return { success: true, message: 'Script executed' };
            } catch (error) {
              return { success: false, error: error.message, stack: error.stack };
            }
          })();
        `);
        
        console.log('[Popup] Password autofill injection result:', result);
        
        // Check if APIs are available in popup
        const apiCheck = await contents.executeJavaScript(`({
          shiiraAPI: typeof window.shiiraAPI !== 'undefined',
          electronAPI: typeof window.electronAPI !== 'undefined',
          passwords: typeof window.electronAPI?.passwords !== 'undefined'
        })`);
        console.log('[Popup] API availability:', apiCheck);
        
        // Check if script is detecting password fields
        setTimeout(async () => {
          try {
            const fieldCheck = await contents.executeJavaScript(`
              document.querySelectorAll('input[type="password"], input[type="email"], input[type="text"][autocomplete*="username"]').length
            `);
            console.log('[Popup] Password/login fields detected:', fieldCheck);
          } catch (e) {
            console.error('[Popup] Error checking fields:', e);
          }
        }, 2000); // Wait 2 seconds for page to load
        
      } catch (error) {
        console.error('[Popup] Error injecting password autofill:', error);
      }
    });
  }
  
  // Only handle webview webContents
  if (contents.getType() === 'webview') {
    contents.on('before-input-event', (event, input) => {
      // Find the parent BrowserWindow to send the shortcut to
      if (mainWindow && !mainWindow.isDestroyed()) {
        handleKeyboardShortcut(event, input, mainWindow);
      }
    });
    
    // Handle window.open() and target="_blank" links
    contents.setWindowOpenHandler(({ url, frameName, features, disposition }) => {
      console.log('[WebContents] Window open requested:', { url, frameName, features, disposition });
      
      // Check if this looks like an OAuth/SSO popup (common patterns)
      const isOAuthPopup = 
        disposition === 'new-window' || 
        disposition === 'foreground-tab' ||
        features.includes('popup') ||
        url.includes('oauth') ||
        url.includes('accounts.google.com') ||
        url.includes('login.microsoftonline.com') ||
        url.includes('facebook.com/login') ||
        url.includes('github.com/login') ||
        url.includes('auth') && (features.includes('width=') || features.includes('height='));
      
      if (isOAuthPopup) {
        console.log('[WebContents] OAuth/SSO popup detected, showing in modal overlay');
        
        // Instead of opening a new window, send message to renderer to show OAuth modal
        const parentWindow = BrowserWindow.fromWebContents(contents.hostWebContents);
        if (parentWindow && !parentWindow.isDestroyed()) {
          parentWindow.webContents.send('show-oauth-modal', url);
        }
        
        // Deny the automatic popup creation since we'll handle it in-app
        return { action: 'deny' };
      }
      
      // For regular links, open in new tab instead
      console.log('[WebContents] Regular link, opening in new tab');
      const parentWindow = BrowserWindow.fromWebContents(contents.hostWebContents);
      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.webContents.send('open-url-in-new-tab', url);
      }
      return { action: 'deny' };
    });
  }
});

// Shiira Browser Configuration
const SHIIRA_CONFIG = {
  name: 'Shiira',
  version: require('../../package.json').version,
  company: 'Shiira Project',
  homepage: 'https://www.google.com',
  userAgent: null // Will be set dynamically
};

function createWindow() {
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
    backgroundColor: '#161616',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/preload.js'),
      webviewTag: true // Enable webview for browser tabs
    }
  });
  
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

  // Set custom user agent - use standard Chrome UA for DRM compatibility
  // Netflix/Disney+ detect non-standard browsers and block DRM playback
  const chromeVersion = process.versions.chrome;
  SHIIRA_CONFIG.userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  session.defaultSession.setUserAgent(SHIIRA_CONFIG.userAgent);

  // Runtime cache for temporary permissions (cleared on restart)
  const runtimePermissions = new Map(); // Format: "hostname:permission" -> true/false

  // Set up permission request handler for security
  // This controls access to sensitive device capabilities
  const setupPermissionHandlers = (sessionInstance, sessionName) => {
    sessionInstance.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
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
      const savedPermission = privacyService.getPermissionForSite(hostname, specificPermission);
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
        const window = BrowserWindow.fromWebContents(webContents.hostWebContents || webContents);
        if (window && !window.isDestroyed()) {
          try {
            // Send permission request to renderer and wait for response
            const response = await new Promise((resolve) => {
              const requestId = Date.now().toString();
              
              // Set up one-time listener for response
              ipcMain.once(`permission-response-${requestId}`, (event, granted, remember) => {
                resolve({ granted, remember });
              });
              
              // Send request to renderer
              window.webContents.send('permission-request', {
                requestId,
                permission: specificPermission,
                hostname,
                url
              });
              
              // Timeout after 60 seconds
              setTimeout(() => resolve({ granted: false, remember: false }), 60000);
            });
            
            // Save permission if user chose to remember
            if (response.remember) {
              privacyService.setPermissionForSite(hostname, specificPermission, response.granted);
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
        const micPermission = privacyService.getPermissionForSite(hostname, 'microphone') ?? runtimePermissions.get(`${hostname}:microphone`);
        const camPermission = privacyService.getPermissionForSite(hostname, 'camera') ?? runtimePermissions.get(`${hostname}:camera`);
        const mediaPermission = privacyService.getPermissionForSite(hostname, 'media') ?? runtimePermissions.get(`${hostname}:media`);
        
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
        const savedPermission = privacyService.getPermissionForSite(hostname, permission);
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
  
  // Apply to persist:main partition (used by webviews)
  const webviewSession = session.fromPartition('persist:main');
  webviewSession.setUserAgent(SHIIRA_CONFIG.userAgent);
  setupPermissionHandlers(webviewSession, 'persist:main');

  // Load the browser UI
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Maximize window on startup
  mainWindow.maximize();

  // Handle keyboard shortcuts globally (for main window, not webviews)
  // Webviews are handled separately via app.on('web-contents-created')
  mainWindow.webContents.on('before-input-event', (event, input) => {
    handleKeyboardShortcut(event, input, mainWindow);
  });

  // DevTools can be opened manually via menu or keyboard shortcut (Ctrl+Shift+I)

  // Track this window
  browserWindows.add(mainWindow);
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

// App lifecycle
app.whenReady().then(async () => {
  await detectHardwareAccelerationProfile();

  // Wait for Widevine CDM to be ready (Castlabs Electron for DRM support)
  // NOTE: Skipping components.whenReady() due to crash in Castlabs v39
  // The CDM will still be downloaded/updated automatically in the background
  if (components) {
    console.log('[Widevine] Components API available - CDM will update in background');
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
  
  // Initialize services
  favoritesService.initialize();
  await passwordService.initialize(); // Now async due to keytar
  bookmarksService.initialize();
  privacyService.initialize();
  
  createWindow();
  
  // Initialize auto-updater after window is created
  if (app.isPackaged) {
    autoUpdaterService.initialize(mainWindow);
    // Check for updates 3 seconds after app starts
    setTimeout(() => {
      autoUpdaterService.checkForUpdates().catch(err => {
        console.log('Auto-update check failed:', err.message);
      });
    }, 3000);
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
  saveSession(sessionData);
  return true;
});

ipcMain.handle('session-load', () => {
  return loadSession();
});

ipcMain.handle('session-clear', () => {
  clearSession();
  return true;
});

ipcMain.handle('get-window-count', () => {
  return browserWindows.size;
});

// IPC Handler for opening DevTools (docked in main window)
ipcMain.handle('open-devtools', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.webContents.openDevTools();
  }
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
    backgroundColor: '#161616',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../preload/preload.js'),
      webviewTag: true
    }
  });
  
  session.defaultSession.setUserAgent(SHIIRA_CONFIG.userAgent);
  
  newWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // Track this window
  browserWindows.add(newWindow);
  console.log('[Session] New window opened. Total windows:', browserWindows.size);
  
  newWindow.on('closed', () => {
    browserWindows.delete(newWindow);
    console.log('[Session] Window closed. Remaining windows:', browserWindows.size);
  });
  
  // If URL is provided, send it to the new window once it's ready
  if (url) {
    newWindow.webContents.once('did-finish-load', () => {
      newWindow.webContents.send('open-url', url);
    });
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

// DevTools IPC handlers
ipcMain.handle('devtools-open', (event, targetWebContentsId, devtoolsWebContentsId) => {
  try {
    const { webContents } = require('electron');
    const targetWC = webContents.fromId(targetWebContentsId);
    const devtoolsWC = webContents.fromId(devtoolsWebContentsId);
    
    if (targetWC && devtoolsWC) {
      targetWC.setDevToolsWebContents(devtoolsWC);
      targetWC.openDevTools({ mode: 'detach' });
      return true;
    }
  } catch (e) {
    console.error('[DevTools] Failed to open:', e);
  }
  return false;
});

ipcMain.handle('devtools-close', (event, targetWebContentsId) => {
  try {
    const { webContents } = require('electron');
    const targetWC = webContents.fromId(targetWebContentsId);
    
    if (targetWC) {
      targetWC.closeDevTools();
      return true;
    }
  } catch (e) {
    console.error('[DevTools] Failed to close:', e);
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

// AI Service IPC Handlers
ipcMain.handle('ai-get-providers', () => {
  return aiService ? aiService.getProviders() : {};
});

ipcMain.handle('ai-toggle-provider', (event, providerId, enabled) => {
  return aiService ? aiService.toggleProvider(providerId, enabled) : { success: false, error: 'AI service not ready' };
});

// Privacy Service IPC Handlers
ipcMain.handle('privacy-get-settings', () => {
  return privacyService.getSettings();
});

ipcMain.handle('privacy-set-setting', (event, key, value) => {
  return privacyService.setSetting(key, value);
});

ipcMain.handle('privacy-clear-browsing-data', async (event, kind = 'cache') => {
  const targets = [session.defaultSession, session.fromPartition('persist:main')];
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

// URL Autocomplete IPC handler
ipcMain.handle('get-url-suggestions', async (event, query) => {
  // Check privacy setting
  if (!privacyService.isUrlSuggestionsEnabled()) {
    return [];
  }
  
  try {
    const https = require('https');
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
    
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed[1] || []);
          } catch (e) {
            resolve([]);
          }
        });
      }).on('error', (e) => {
        if (!app.isPackaged) {
          console.error('[Suggestions] Fetch error:', e);
        }
        resolve([]);
      });
    });
  } catch (e) {
    if (!app.isPackaged) {
      console.error('[Suggestions] Error:', e);
    }
    return [];
  }
});

// Load credentials on startup
app.whenReady().then(() => {
  aiService = new AIService(app);
  favoritesService.initialize();
  bookmarksService.initialize();
  
  // Initialize ad-blocker with bundled filter lists
  const rulesDir = app.isPackaged
    ? path.join(process.resourcesPath, 'filter-lists')
    : path.join(__dirname, '../../filter-lists');
  
  // Create filter-lists directory if it doesn't exist
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
    console.log('[AdBlocker] Created filter-lists directory:', rulesDir);
  }
  
  // Initialize network request blocking (with YouTube-specific rules)
  adBlocker.init(rulesDir, { enabledRulesets: ['default', 'youtube'] }).catch(err => {
    console.error('[AdBlocker] Initialization failed:', err);
  });
  
  // Initialize cosmetic filtering (element hiding)
  try {
    const cosmeticStats = cosmeticInjector.init(rulesDir);
    console.log('[Cosmetic Injector] Ready with', cosmeticStats.genericCount, 'generic selectors');
  } catch (err) {
    console.error('[Cosmetic Injector] Initialization failed:', err);
  }
  
  // Initialize script injection (YouTube ad skipping)
  try {
    const scriptStats = scriptInjector.init(rulesDir);
    console.log('[Script Injector] Ready with', scriptStats.sitesCovered, 'site scripts (YouTube, etc.)');
  } catch (err) {
    console.error('[Script Injector] Initialization failed:', err);
  }
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
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });
  
  passwordWindow.loadFile(path.join(__dirname, '../renderer/password-anvil/index.html'));
  return { success: true };
});

