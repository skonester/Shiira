/**
 * Shiira Browser - Custom Installer
 * Main Process
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const originalFs = require('original-fs'); // Use original fs to avoid ASAR issues
const { exec, spawn } = require('child_process');

// Determine if running in development or packaged
const isDev = !app.isPackaged;

// Log to file for debugging packaged app
function logToFile(message) {
    const logPath = path.join(process.env.TEMP || 'C:\\Temp', 'shiira-installer-debug.log');
    const timestamp = new Date().toISOString();
    try {
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch (e) {}
}

// Get the path to the app files to install
function getAppFilesPath() {
    // Log paths for debugging
    logToFile('isDev: ' + isDev);
    logToFile('__dirname: ' + __dirname);
    logToFile('process.resourcesPath: ' + process.resourcesPath);
    logToFile('app.getAppPath(): ' + app.getAppPath());
    logToFile('process.execPath: ' + process.execPath);
    
    console.log('[Installer] isDev:', isDev);
    console.log('[Installer] __dirname:', __dirname);
    console.log('[Installer] process.resourcesPath:', process.resourcesPath);
    console.log('[Installer] app.getAppPath():', app.getAppPath());
    console.log('[Installer] process.execPath:', process.execPath);
    
    if (isDev) {
        // In development, check multiple possible locations
        const possiblePaths = [
            path.join(__dirname, '..', '..', 'dist', 'win-unpacked'),  // From installer folder
            path.join(__dirname, '..', 'dist', 'win-unpacked'),        // Alternative location
            path.join(process.cwd(), 'dist', 'win-unpacked')           // From current working dir
        ];
        
        for (const p of possiblePaths) {
            console.log('[Installer] Checking dev path:', p, 'exists:', fs.existsSync(p));
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                return p;
            }
        }
        
        // Return the expected path for error messaging
        return possiblePaths[0];
    } else {
        // In production, check multiple possible locations for portable apps
        const possiblePaths = [
            path.join(process.resourcesPath, 'app-files'),
            path.join(path.dirname(process.execPath), 'resources', 'app-files'),
            path.join(app.getAppPath(), '..', 'app-files')
        ];
        
        for (const p of possiblePaths) {
            const exists = fs.existsSync(p);
            let isDir = false;
            if (exists) {
                try { isDir = fs.statSync(p).isDirectory(); } catch(e) {}
            }
            logToFile('Checking prod path: ' + p + ' exists: ' + exists + ' isDir: ' + isDir);
            console.log('[Installer] Checking prod path:', p, 'exists:', exists, 'isDir:', isDir);
            if (exists && isDir) {
                logToFile('Using app-files path: ' + p);
                console.log('[Installer] Using app-files path:', p);
                return p;
            }
        }
        
        // Return the expected path for error messaging
        return possiblePaths[0];
    }
}

// Default installation paths
const DEFAULT_INSTALL_PATH = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Shiira');
const APPDATA_PATH = path.join(process.env.APPDATA || '', 'Shiira');

let mainWindow = null;
let installPath = DEFAULT_INSTALL_PATH;
let isSilentInstall = false;
let shouldRelaunch = false;
let isUninstallMode = false;
let pendingCleanupBatchPath = null; // Store batch path to execute on app quit

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(1);
    
    logToFile('Command line arguments: ' + JSON.stringify(args));
    logToFile('process.argv: ' + JSON.stringify(process.argv));
    
    // Auto-detect uninstall mode if executable name contains "Uninstall"
    const exeName = path.basename(process.execPath).toLowerCase();
    if (exeName.includes('uninstall')) {
        isUninstallMode = true;
        logToFile('Auto-detected uninstall mode from exe name: ' + exeName);
    }
    
    for (const arg of args) {
        if (arg === '/S' || arg === '-S' || arg === '--silent') {
            isSilentInstall = true;
        }
        // Check for various relaunch flags (electron-updater may use different ones)
        if (arg === '/relaunch' || arg === '--relaunch' || arg === '--updated' || arg === '/updated') {
            shouldRelaunch = true;
        }
        if (arg.startsWith('/D=') || arg.startsWith('--dir=')) {
            installPath = arg.split('=')[1];
        }
        if (arg === '/uninstall' || arg === '--uninstall') {
            isUninstallMode = true;
        }
    }
    
    // For silent installs, always relaunch the app (this is what users expect from auto-updates)
    if (isSilentInstall && !isUninstallMode) {
        shouldRelaunch = true;
        logToFile('Silent install detected - will relaunch app after installation');
    }
    
    logToFile('Parsed: isSilentInstall=' + isSilentInstall + ' shouldRelaunch=' + shouldRelaunch + ' isUninstallMode=' + isUninstallMode);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 700,
        height: 500,
        resizable: false,
        maximizable: false,
        minimizable: true,
        frame: false, // Frameless for custom title bar
        transparent: false,
        backgroundColor: '#161616',
        icon: path.join(__dirname, 'assets', 'shiira.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    
    // Enable Windows dark mode for title bar
    if (process.platform === 'win32') {
        try {
            mainWindow.setBackgroundColor('#161616');
        } catch (e) {}
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Silent installation (for auto-updates)
async function performSilentInstall() {
    console.log('[Installer] Performing silent installation...');
    
    try {
        await performInstallation(installPath, (progress, message) => {
            console.log(`[Installer] ${progress}% - ${message}`);
        });
        
        console.log('[Installer] Silent installation complete');
        
        if (shouldRelaunch) {
            const exePath = path.join(installPath, 'Shiira.exe');
            if (fs.existsSync(exePath)) {
                console.log('[Installer] Relaunching Shiira...');
                spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
            }
        }
        
        app.quit();
    } catch (error) {
        console.error('[Installer] Silent installation failed:', error);
        app.exit(1);
    }
}

// Main installation logic
async function performInstallation(targetPath, progressCallback) {
    const sourcePath = getAppFilesPath();
    
    logToFile('performInstallation started');
    logToFile('sourcePath: ' + sourcePath);
    logToFile('targetPath: ' + targetPath);
    
    // Validate source path exists
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source files not found. Please build the browser first.\nExpected: ${sourcePath}`);
    }
    
    let sourceStats;
    try {
        sourceStats = fs.statSync(sourcePath);
    } catch (e) {
        logToFile('Error getting source stats: ' + e.message);
        throw new Error(`Cannot access source path: ${sourcePath}\n${e.message}`);
    }
    
    if (!sourceStats.isDirectory()) {
        throw new Error(`Source path is not a directory: ${sourcePath}`);
    }
    
    // Step 1: Create installation directory
    progressCallback(5, 'Creating installation directory...');
    try {
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }
    } catch (e) {
        logToFile('Error creating target directory: ' + e.message);
        throw new Error(`Cannot create installation directory: ${targetPath}\n${e.message}`);
    }
    
    // Step 2: Copy files
    progressCallback(10, 'Copying application files...');
    try {
        await copyDirectory(sourcePath, targetPath, (copied, total) => {
            const progress = 10 + Math.floor((copied / total) * 70);
            progressCallback(progress, `Copying files... (${copied}/${total})`);
        });
    } catch (e) {
        logToFile('Error copying files: ' + e.message);
        throw new Error(`Failed to copy files: ${e.message}`);
    }
    
    // Step 3: Create shortcuts
    progressCallback(85, 'Creating shortcuts...');
    try {
        logToFile('Creating shortcuts...');
        await createShortcuts(targetPath);
        logToFile('Shortcuts created successfully');
    } catch (e) {
        logToFile('Error creating shortcuts: ' + e.message);
        // Don't fail installation for shortcut errors
        console.error('Shortcut creation failed:', e);
    }
    
    // Step 4: Add to registry (for uninstall)
    progressCallback(92, 'Registering application...');
    try {
        logToFile('Adding registry entries...');
        await addToRegistry(targetPath);
        logToFile('Registry entries added successfully');
    } catch (e) {
        logToFile('Error adding registry: ' + e.message);
        // Don't fail installation for registry errors
        console.error('Registry addition failed:', e);
    }
    
    // Step 5: Complete
    logToFile('Installation complete!');
    progressCallback(100, 'Installation complete!');
}

// Copy directory recursively with progress (using original-fs to avoid ASAR issues)
async function copyDirectory(src, dest, onProgress) {
    const files = getAllFiles(src);
    const total = files.length;
    let copied = 0;
    
    logToFile('Total files to copy: ' + total);
    
    for (const file of files) {
        const relativePath = path.relative(src, file);
        const destPath = path.join(dest, relativePath);
        const destDir = path.dirname(destPath);
        
        // Create directory if needed
        if (!originalFs.existsSync(destDir)) {
            originalFs.mkdirSync(destDir, { recursive: true });
        }
        
        // Copy file using original-fs to avoid ASAR interception
        originalFs.copyFileSync(file, destPath);
        copied++;
        onProgress(copied, total);
        
        // Small delay to prevent UI freeze
        if (copied % 50 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }
}

// Get all files in directory recursively (using original-fs to avoid ASAR issues)
function getAllFiles(dir, files = []) {
    logToFile('getAllFiles scanning: ' + dir);
    
    let items;
    try {
        items = originalFs.readdirSync(dir);
    } catch (e) {
        logToFile('Error reading directory ' + dir + ': ' + e.message);
        throw e;
    }
    
    for (const item of items) {
        const fullPath = path.join(dir, item);
        let stat;
        try {
            stat = originalFs.statSync(fullPath);
        } catch (e) {
            logToFile('Error getting stat for ' + fullPath + ': ' + e.message);
            throw e;
        }
        
        if (stat.isDirectory()) {
            getAllFiles(fullPath, files);
        } else {
            files.push(fullPath);
        }
    }
    
    return files;
}

// Create desktop and start menu shortcuts
async function createShortcuts(targetPath) {
    const exePath = path.join(targetPath, 'Shiira.exe');
    const iconPath = exePath;
    
    // Desktop shortcut
    const desktopPath = path.join(process.env.USERPROFILE || '', 'Desktop', 'Shiira Browser.lnk');
    
    // Start menu shortcut
    const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Shiira');
    const startMenuPath = path.join(startMenuDir, 'Shiira Browser.lnk');
    
    // Create start menu directory
    if (!fs.existsSync(startMenuDir)) {
        fs.mkdirSync(startMenuDir, { recursive: true });
    }
    
    // Use PowerShell to create shortcuts
    const createShortcutScript = (shortcutPath, targetExe, icon) => `
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
        $Shortcut.TargetPath = "${targetExe.replace(/\\/g, '\\\\')}"
        $Shortcut.IconLocation = "${icon.replace(/\\/g, '\\\\')}"
        $Shortcut.Description = "Shiira Browser - A lightweight, privacy-focused browser"
        $Shortcut.WorkingDirectory = "${targetPath.replace(/\\/g, '\\\\')}"
        $Shortcut.Save()
    `;
    
    // Create desktop shortcut
    await runPowerShell(createShortcutScript(desktopPath, exePath, iconPath));
    
    // Create start menu shortcut  
    await runPowerShell(createShortcutScript(startMenuPath, exePath, iconPath));
}

// Add uninstall registry entry and copy installer as uninstaller
async function addToRegistry(targetPath) {
    // Get version - hardcode it since we can't require package.json from ASAR
    const appVersion = '0.2.5-alpha';
    const exePath = path.join(targetPath, 'Shiira.exe');
    
    // Create a separate uninstaller folder to avoid DLL conflicts with Shiira
    const uninstallerDir = path.join(targetPath, 'uninstaller');
    const uninstallerExePath = path.join(uninstallerDir, 'Uninstall Shiira.exe');
    const installerExePath = process.execPath;
    const installerDir = path.dirname(installerExePath);
    
    try {
        // Create uninstaller directory
        if (!originalFs.existsSync(uninstallerDir)) {
            originalFs.mkdirSync(uninstallerDir, { recursive: true });
        }
        
        // Copy the entire installer directory (exe + DLLs + resources) to avoid DLL conflicts
        if (!isDev) {
            // Get all files in the installer directory (not subdirectories)
            const installerFiles = originalFs.readdirSync(installerDir);
            
            for (const file of installerFiles) {
                const srcPath = path.join(installerDir, file);
                const destPath = path.join(uninstallerDir, file === 'Shiira Setup.exe' ? 'Uninstall Shiira.exe' : file);
                
                try {
                    const stat = originalFs.statSync(srcPath);
                    
                    if (stat.isFile()) {
                        // Copy files (exe, dlls, pak files, etc.)
                        originalFs.copyFileSync(srcPath, destPath);
                        logToFile('Copied: ' + file);
                    } else if (stat.isDirectory() && file === 'locales') {
                        // Copy locales folder
                        await copyDirectory(srcPath, destPath, () => {});
                        logToFile('Copied folder: ' + file);
                    } else if (stat.isDirectory() && file === 'resources') {
                        // Copy resources folder but SKIP app-files (saves ~400MB)
                        // We only need app.asar for the uninstaller UI
                        const resourcesDestDir = destPath;
                        if (!originalFs.existsSync(resourcesDestDir)) {
                            originalFs.mkdirSync(resourcesDestDir, { recursive: true });
                        }
                        
                        const resourceItems = originalFs.readdirSync(srcPath);
                        for (const item of resourceItems) {
                            if (item === 'app-files') {
                                logToFile('Skipping app-files folder to reduce size');
                                continue; // Skip the large app-files folder
                            }
                            const itemSrc = path.join(srcPath, item);
                            const itemDest = path.join(resourcesDestDir, item);
                            const itemStat = originalFs.statSync(itemSrc);
                            
                            if (itemStat.isFile()) {
                                originalFs.copyFileSync(itemSrc, itemDest);
                            } else if (itemStat.isDirectory()) {
                                await copyDirectory(itemSrc, itemDest, () => {});
                            }
                        }
                        logToFile('Copied resources folder (excluding app-files)');
                    }
                } catch (e) {
                    logToFile('Failed to copy ' + file + ': ' + e.message);
                }
            }
            
            logToFile('Uninstaller copied to: ' + uninstallerDir);
        }
    } catch (e) {
        logToFile('Failed to copy uninstaller: ' + e.message);
        // Continue anyway - uninstall won't work but installation should proceed
    }
    
    // The uninstall command now points to our installer with /uninstall flag
    const uninstallCmd = `"${uninstallerExePath}" /uninstall`;
    
    // Calculate installed size (approximate in KB)
    let installedSize = 0;
    try {
        const files = getAllFiles(targetPath);
        for (const file of files) {
            installedSize += originalFs.statSync(file).size;
        }
        installedSize = Math.round(installedSize / 1024); // Convert to KB
    } catch (e) {
        installedSize = 400000; // Default ~400MB
    }
    
    const registryScript = `
        $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ShiiraBrowser"
        
        if (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
        }
        
        Set-ItemProperty -Path $regPath -Name "DisplayName" -Value "Shiira Browser"
        Set-ItemProperty -Path $regPath -Name "DisplayVersion" -Value "${appVersion}"
        Set-ItemProperty -Path $regPath -Name "Publisher" -Value "Shiira Project"
        Set-ItemProperty -Path $regPath -Name "DisplayIcon" -Value "${exePath.replace(/\\/g, '\\\\')}"
        Set-ItemProperty -Path $regPath -Name "InstallLocation" -Value "${targetPath.replace(/\\/g, '\\\\')}"
        Set-ItemProperty -Path $regPath -Name "UninstallString" -Value '${uninstallCmd.replace(/'/g, "''")}'
        Set-ItemProperty -Path $regPath -Name "QuietUninstallString" -Value '${uninstallCmd.replace(/'/g, "''")} /S'
        Set-ItemProperty -Path $regPath -Name "EstimatedSize" -Value ${installedSize} -Type DWord
        Set-ItemProperty -Path $regPath -Name "NoModify" -Value 1 -Type DWord
        Set-ItemProperty -Path $regPath -Name "NoRepair" -Value 1 -Type DWord
    `;
    
    await runPowerShell(registryScript);
}

// Run PowerShell script
function runPowerShell(script) {
    return new Promise((resolve, reject) => {
        logToFile('Running PowerShell script...');
        const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
            stdio: 'pipe',
            windowsHide: true
        });
        
        let output = '';
        let error = '';
        
        ps.stdout.on('data', (data) => { output += data.toString(); });
        ps.stderr.on('data', (data) => { error += data.toString(); });
        
        ps.on('close', (code) => {
            logToFile('PowerShell exited with code: ' + code);
            if (error) {
                logToFile('PowerShell stderr: ' + error);
            }
            if (code === 0) {
                resolve(output);
            } else {
                console.error('PowerShell error:', error);
                resolve(output); // Don't fail installation on shortcut errors
            }
        });
        
        ps.on('error', (err) => {
            logToFile('PowerShell spawn error: ' + err.message);
            resolve(''); // Don't fail
        });
    });
}

// Uninstall logic
async function performUninstall(progressCallback) {
    logToFile('performUninstall started');
    
    // Get install location from registry
    let targetPath = DEFAULT_INSTALL_PATH;
    
    try {
        // Try to get install location from registry
        const getInstallPath = await runPowerShell(`
            $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ShiiraBrowser"
            if (Test-Path $regPath) {
                (Get-ItemProperty -Path $regPath -Name "InstallLocation" -ErrorAction SilentlyContinue).InstallLocation
            }
        `);
        if (getInstallPath && getInstallPath.trim()) {
            targetPath = getInstallPath.trim();
        }
    } catch (e) {
        logToFile('Failed to get install path from registry: ' + e.message);
    }
    
    logToFile('Uninstall target path: ' + targetPath);
    
    // Step 1: Close Shiira if running
    progressCallback(5, 'Closing Shiira Browser...');
    try {
        await runPowerShell('Stop-Process -Name "Shiira" -Force -ErrorAction SilentlyContinue');
        // Wait for process to close
        await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (e) {
        logToFile('Error Closing Shiira: ' + e.message);
    }
    
    // Step 2: Remove shortcuts
    progressCallback(20, 'Removing shortcuts...');
    try {
        const desktopShortcut = path.join(process.env.USERPROFILE || '', 'Desktop', 'Shiira Browser.lnk');
        const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Shiira');
        
        if (fs.existsSync(desktopShortcut)) {
            fs.unlinkSync(desktopShortcut);
            logToFile('Removed desktop shortcut');
        }
        
        if (fs.existsSync(startMenuDir)) {
            await runPowerShell(`Remove-Item -Path "${startMenuDir.replace(/\\/g, '\\\\')}" -Recurse -Force -ErrorAction SilentlyContinue`);
            logToFile('Removed start menu folder');
        }
    } catch (e) {
        logToFile('Error removing shortcuts: ' + e.message);
    }
    
    // Step 3: Remove registry entry
    progressCallback(40, 'Removing registry entries...');
    try {
        await runPowerShell(`
            $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ShiiraBrowser"
            if (Test-Path $regPath) {
                Remove-Item -Path $regPath -Force -ErrorAction SilentlyContinue
            }
        `);
        logToFile('Removed registry entry');
    } catch (e) {
        logToFile('Error removing registry: ' + e.message);
    }
    
    // Step 4: Remove installation directory (using delayed batch file since we're running from it)
    progressCallback(60, 'Removing application files...');
    
    // Get the uninstaller directory path (we're running from inside it)
    const uninstallerDir = path.dirname(process.execPath);
    
    // Create a batch file to delete the installation folder AND the uninstaller folder after we exit
    const batchContent = `@echo off
timeout /t 2 /nobreak >nul
rmdir /s /q "${targetPath}"
del "%~f0"
`;
    
    const batchPath = path.join(process.env.TEMP || 'C:\\Temp', 'shiira_cleanup.bat');
    try {
        fs.writeFileSync(batchPath, batchContent, 'utf8');
        logToFile('Cleanup batch file created at: ' + batchPath);
        // Store the batch path - it will be executed when the app quits
        pendingCleanupBatchPath = batchPath;
    } catch (e) {
        logToFile('Error creating cleanup batch: ' + e.message);
    }
    
    progressCallback(80, 'Ready for cleanup...');
    progressCallback(100, 'Uninstall complete!');
    logToFile('Uninstall complete - cleanup will run when app closes');
}

// IPC Handlers
ipcMain.handle('get-default-path', () => {
    return DEFAULT_INSTALL_PATH;
});

ipcMain.handle('get-app-version', () => {
    // Get version from main app's package.json
    try {
        const mainPackage = require('../package.json');
        return mainPackage.version || '0.2.5-alpha';
    } catch (e) {
        return '0.2.5-alpha';
    }
});

ipcMain.handle('browse-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Installation Folder',
        defaultPath: installPath
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('check-path-writable', async (event, targetPath) => {
    try {
        // Check if we can write to the path
        const testFile = path.join(targetPath, '.shiira-test');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }
        
        // Try to write a test file
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        return { writable: true };
    } catch (error) {
        return { writable: false, error: error.message };
    }
});

ipcMain.handle('start-installation', async (event, targetPath) => {
    installPath = targetPath;
    logToFile('start-installation IPC called with path: ' + targetPath);
    
    try {
        await performInstallation(targetPath, (progress, message) => {
            mainWindow.webContents.send('installation-progress', { progress, message });
        });
        logToFile('start-installation completed successfully');
        return { success: true };
    } catch (error) {
        logToFile('start-installation failed: ' + error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('launch-app', () => {
    const exePath = path.join(installPath, 'Shiira.exe');
    if (fs.existsSync(exePath)) {
        spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
    }
});

ipcMain.handle('close-installer', () => {
    app.quit();
});

ipcMain.handle('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('open-link', (event, url) => {
    shell.openExternal(url);
});

// Uninstall IPC handlers
ipcMain.handle('is-uninstall-mode', () => {
    return isUninstallMode;
});

ipcMain.handle('start-uninstall', async () => {
    logToFile('start-uninstall IPC called');
    
    try {
        await performUninstall((progress, message) => {
            mainWindow.webContents.send('uninstall-progress', { progress, message });
        });
        logToFile('start-uninstall completed successfully');
        return { success: true };
    } catch (error) {
        logToFile('start-uninstall failed: ' + error.message);
        return { success: false, error: error.message };
    }
});

// App lifecycle
app.whenReady().then(() => {
    parseArgs();
    
    if (isSilentInstall) {
        performSilentInstall();
    } else {
        createWindow();
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

// Execute cleanup batch when app is quitting (after uninstall)
app.on('will-quit', () => {
    if (pendingCleanupBatchPath && fs.existsSync(pendingCleanupBatchPath)) {
        logToFile('App quitting - launching cleanup batch: ' + pendingCleanupBatchPath);
        try {
            spawn('cmd.exe', ['/c', pendingCleanupBatchPath], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            }).unref();
            logToFile('Cleanup batch launched successfully');
        } catch (e) {
            logToFile('Error launching cleanup batch: ' + e.message);
        }
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
