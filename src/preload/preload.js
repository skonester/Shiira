const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('shiiraAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  
  // Window state listeners
  onMaximized: (callback) => {
    ipcRenderer.on('window-maximized', callback);
  },
  onRestored: (callback) => {
    ipcRenderer.on('window-restored', callback);
  },
  onOpenUrl: (callback) => {
    ipcRenderer.on('open-url', (event, url) => callback(url));
  },
  onOpenUrlInNewTab: (callback) => {
    ipcRenderer.on('open-url-in-new-tab', (event, url) => callback(url));
  },
  
  // OAuth modal
  onShowOAuthModal: (callback) => {
    ipcRenderer.on('show-oauth-modal', (event, url) => callback(url));
  },
  
  // Permission requests
  onPermissionRequest: (callback) => {
    ipcRenderer.on('permission-request', (event, data) => callback(data));
  },
  sendPermissionResponse: (requestId, granted, remember) => {
    ipcRenderer.send(`permission-response-${requestId}`, granted, remember);
  },
  
  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // Asset path resolver
  getAssetPath: (relativePath) => ipcRenderer.invoke('get-asset-path', relativePath),
  
  // Window management
  createNewWindow: (url) => ipcRenderer.invoke('create-new-window', url),
  createPasswordAnvilWindow: () => ipcRenderer.invoke('create-password-anvil-window'),
  downloadFile: (url, options) => ipcRenderer.invoke('download-url', url, options),
  copyImage: (url) => ipcRenderer.invoke('copy-image-url', url),
  showItemInFolder: (pathToShow) => ipcRenderer.invoke('show-item-in-folder', pathToShow),
  
  // Session management (tab persistence)
  session: {
    save: (sessionData) => ipcRenderer.invoke('session-save', sessionData),
    load: () => ipcRenderer.invoke('session-load'),
    clear: () => ipcRenderer.invoke('session-clear'),
    getWindowCount: () => ipcRenderer.invoke('get-window-count')
  },
  

  // Chrome Import
  chromeImport: {
    getProfiles: () => ipcRenderer.invoke('chrome-get-profiles'),
    getImportSummary: (profileId) => ipcRenderer.invoke('chrome-get-import-summary', profileId),
    importBookmarks: (profileId) => ipcRenderer.invoke('chrome-import-bookmarks', profileId),
    importHistory: (profileId, limit) => ipcRenderer.invoke('chrome-import-history', profileId, limit),
    getSavedLogins: (profileId) => ipcRenderer.invoke('chrome-get-saved-logins', profileId)
  },
  
  // Privacy Settings
  privacy: {
    getSettings: () => ipcRenderer.invoke('privacy-get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('privacy-set-setting', key, value),
    clearBrowsingData: (kind) => ipcRenderer.invoke('privacy-clear-browsing-data', kind)
  },
  
  // Favorites
  favorites: {
    get: () => ipcRenderer.invoke('favorites-get'),
    setEnabled: (enabled) => ipcRenderer.invoke('favorites-set-enabled', enabled),
    set: (slotIndex, url, name) => ipcRenderer.invoke('favorites-set', slotIndex, url, name),
    remove: (slotIndex) => ipcRenderer.invoke('favorites-remove', slotIndex)
  },
  
  // Bookmarks
  bookmarks: {
    get: () => ipcRenderer.invoke('bookmarks-get'),
    setBarEnabled: (enabled) => ipcRenderer.invoke('bookmarks-set-bar-enabled', enabled),
    isBarEnabled: () => ipcRenderer.invoke('bookmarks-is-bar-enabled'),
    add: ({ url, title, icon, folderId }) => ipcRenderer.invoke('bookmarks-add', { url, title, icon, folderId }),
    createFolder: ({ name, parentFolderId }) => ipcRenderer.invoke('bookmarks-create-folder', { name, parentFolderId }),
    remove: (itemId) => ipcRenderer.invoke('bookmarks-remove', itemId),
    update: (itemId, updates) => ipcRenderer.invoke('bookmarks-update', itemId, updates),
    move: (itemId, targetFolderId, targetIndex) => ipcRenderer.invoke('bookmarks-move', itemId, targetFolderId, targetIndex),
    isBookmarked: (url) => ipcRenderer.invoke('bookmarks-is-bookmarked', url),
    findByUrl: (url) => ipcRenderer.invoke('bookmarks-find-by-url', url),
    getFolders: () => ipcRenderer.invoke('bookmarks-get-folders'),
    import: (htmlContent) => ipcRenderer.invoke('bookmarks-import', htmlContent),
    saveIcon: (bookmarkId, base64Data, mimeType) => ipcRenderer.invoke('bookmarks-save-icon', bookmarkId, base64Data, mimeType),
    deleteIcon: (bookmarkId) => ipcRenderer.invoke('bookmarks-delete-icon', bookmarkId)
  },
  
  // URL Autocomplete
  getUrlSuggestions: (query) => ipcRenderer.invoke('get-url-suggestions', query),
  
  // Auto-updater
  updates: {
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    getStatus: () => ipcRenderer.invoke('get-update-status'),
    onUpdateStatus: (callback) => {
      ipcRenderer.on('update-status', (event, data) => callback(data));
    }
  },
  
  // Ad-blocker controls
  adBlocker: {
    getStatus: () => ipcRenderer.invoke('adblock-get-status'),
    setEnabled: (enabled) => ipcRenderer.invoke('adblock-set-enabled', enabled),
    getStats: () => ipcRenderer.invoke('adblock-get-stats'),
    resetStats: () => ipcRenderer.invoke('adblock-reset-stats'),
    getRulesets: () => ipcRenderer.invoke('adblock-get-rulesets'),
    setRulesets: (rulesetIds) => ipcRenderer.invoke('adblock-set-rulesets', rulesetIds)
  },
  
  // Cosmetic filter controls (element hiding)
  cosmeticFilter: {
    getStatus: () => ipcRenderer.invoke('cosmetic-get-status'),
    setEnabled: (enabled) => ipcRenderer.invoke('cosmetic-set-enabled', enabled),
    getCSS: (url) => ipcRenderer.invoke('cosmetic-get-css', url)
  },

  // Forced dark page rendering
  darkMode: {
    getDarkReaderScript: () => ipcRenderer.invoke('dark-reader-get-script')
  },
  
  // Script injection controls (YouTube ad blocking)
  scriptInjector: {
    getStatus: () => ipcRenderer.invoke('script-get-status'),
    setEnabled: (enabled) => ipcRenderer.invoke('script-set-enabled', enabled),
    getScript: (url) => ipcRenderer.invoke('script-get-for-url', url)
  },
  
  // Tab audio state
  isWebContentsAudible: (webContentsId) => ipcRenderer.invoke('is-webcontents-audible', webContentsId),
  
  // Keyboard shortcuts (from main process)
  onKeyboardShortcut: (callback) => {
    ipcRenderer.on('keyboard-shortcut', (event, shortcut) => callback(shortcut));
  },
});

// Expose password manager API
contextBridge.exposeInMainWorld('electronAPI', {
  passwords: {
    getAll: () => ipcRenderer.invoke('passwords-get-all'),
    getForUrl: (url) => ipcRenderer.invoke('passwords-get-for-url', url),
    add: (url, username, password) => ipcRenderer.invoke('passwords-add', url, username, password),
    update: (id, url, username, password) => ipcRenderer.invoke('passwords-update', id, url, username, password),
    delete: (id) => ipcRenderer.invoke('passwords-delete', id),
    importCSV: (csvData) => ipcRenderer.invoke('passwords-import-csv', csvData),
    importSelected: (entries) => ipcRenderer.invoke('passwords-import-selected', entries),
    deleteAll: () => ipcRenderer.invoke('passwords-delete-all')
  }
});
