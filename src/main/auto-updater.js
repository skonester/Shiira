const { autoUpdater } = require('electron-updater');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const log = require('electron-log');

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Disable auto-download so user can decide
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

class AutoUpdaterService {
    constructor() {
        this.mainWindow = null;
        this.updateAvailable = false;
        this.updateDownloaded = false;
        this.updateInfo = null;
    }

    initialize(mainWindow) {
        this.mainWindow = mainWindow;
        this.setupEventListeners();
        this.setupIpcHandlers();
    }

    setupEventListeners() {
        // Checking for updates
        autoUpdater.on('checking-for-update', () => {
            log.info('Checking for updates...');
            this.sendStatusToWindow('checking-for-update');
        });

        // Update available
        autoUpdater.on('update-available', (info) => {
            log.info('Update available:', info.version);
            this.updateAvailable = true;
            this.updateInfo = info;
            this.sendStatusToWindow('update-available', {
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes
            });
        });

        // No update available
        autoUpdater.on('update-not-available', (info) => {
            log.info('No update available. Current version is up to date.');
            this.sendStatusToWindow('update-not-available', {
                version: info.version
            });
        });

        // Error during update
        autoUpdater.on('error', (err) => {
            log.error('Update error:', err);
            this.sendStatusToWindow('update-error', {
                error: err.message
            });
        });

        // Download progress
        autoUpdater.on('download-progress', (progressObj) => {
            log.info(`Download progress: ${progressObj.percent.toFixed(2)}%`);
            this.sendStatusToWindow('download-progress', {
                percent: progressObj.percent,
                bytesPerSecond: progressObj.bytesPerSecond,
                transferred: progressObj.transferred,
                total: progressObj.total
            });
        });

        // Update downloaded
        autoUpdater.on('update-downloaded', (info) => {
            log.info('Update downloaded:', info.version);
            this.updateDownloaded = true;
            this.sendStatusToWindow('update-downloaded', {
                version: info.version
            });
        });
    }

    setupIpcHandlers() {
        // Check for updates manually
        ipcMain.handle('check-for-updates', async () => {
            try {
                const result = await autoUpdater.checkForUpdates();
                return { success: true, result };
            } catch (error) {
                log.error('Check for updates failed:', error);
                return { success: false, error: error.message };
            }
        });

        // Start downloading update
        ipcMain.handle('download-update', async () => {
            try {
                await autoUpdater.downloadUpdate();
                return { success: true };
            } catch (error) {
                log.error('Download update failed:', error);
                return { success: false, error: error.message };
            }
        });

        // Install update and restart
        ipcMain.handle('install-update', () => {
            // isSilent: true - run installer silently (no wizard)
            // isForceRunAfter: true - restart app after update
            // This works because our NSIS installer handles /S flag for silent mode
            // and /relaunch flag to restart the app after installation
            log.info('Installing update silently with auto-relaunch...');
            autoUpdater.quitAndInstall(true, true);
        });

        // Get current update status
        ipcMain.handle('get-update-status', () => {
            return {
                updateAvailable: this.updateAvailable,
                updateDownloaded: this.updateDownloaded,
                updateInfo: this.updateInfo
            };
        });
    }

    sendStatusToWindow(status, data = {}) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('update-status', { status, ...data });
        }
    }

    // Check for updates (call this on app start or manually)
    async checkForUpdates() {
        try {
            return await autoUpdater.checkForUpdates();
        } catch (error) {
            log.error('Error checking for updates:', error);
            throw error;
        }
    }
}

module.exports = new AutoUpdaterService();
