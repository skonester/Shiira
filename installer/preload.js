/**
 * Shiira Browser Installer - Preload Script
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
    // Get default installation path
    getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
    
    // Get app version
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // Browse for folder
    browseFolder: () => ipcRenderer.invoke('browse-folder'),
    
    // Check if path is writable
    checkPathWritable: (path) => ipcRenderer.invoke('check-path-writable', path),
    
    // Start installation
    startInstallation: (path) => ipcRenderer.invoke('start-installation', path),
    
    // Listen for installation progress
    onProgress: (callback) => {
        ipcRenderer.on('installation-progress', (event, data) => callback(data));
    },
    
    // Launch the installed app
    launchApp: () => ipcRenderer.invoke('launch-app'),
    
    // Close installer
    close: () => ipcRenderer.invoke('close-installer'),
    
    // Minimize window
    minimize: () => ipcRenderer.invoke('minimize-window'),
    
    // Open external link
    openLink: (url) => ipcRenderer.invoke('open-link', url),
    
    // Check if in uninstall mode
    isUninstallMode: () => ipcRenderer.invoke('is-uninstall-mode'),
    
    // Start uninstallation
    startUninstall: () => ipcRenderer.invoke('start-uninstall'),
    
    // Listen for uninstall progress
    onUninstallProgress: (callback) => {
        ipcRenderer.on('uninstall-progress', (event, data) => callback(data));
    }
});
