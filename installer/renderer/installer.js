/**
 * Shiira Browser Installer - Renderer Script
 */

// State
let currentPage = 'welcome';
let installPath = '';
let isUninstallMode = false;

// DOM Elements
const pages = {
    welcome: document.getElementById('page-welcome'),
    location: document.getElementById('page-location'),
    installing: document.getElementById('page-installing'),
    complete: document.getElementById('page-complete'),
    'uninstall-confirm': document.getElementById('page-uninstall-confirm'),
    'uninstall-progress': document.getElementById('page-uninstall-progress'),
    'uninstall-complete': document.getElementById('page-uninstall-complete')
};

// Initialize
async function init() {
    // Get version
    const version = await window.installer.getAppVersion();
    document.getElementById('version-text').textContent = `v${version}`;
    
    // Check if we're in uninstall mode
    isUninstallMode = await window.installer.isUninstallMode();
    
    if (isUninstallMode) {
        // Start in uninstall mode
        showPage('uninstall-confirm');
    } else {
        // Normal install mode
        installPath = await window.installer.getDefaultPath();
        document.getElementById('install-path').value = installPath;
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Start ember particles
    createEmberParticles();
}

// Setup all event listeners
function setupEventListeners() {
    // Title bar buttons
    document.getElementById('btn-minimize').addEventListener('click', () => {
        window.installer.minimize();
    });
    
    document.getElementById('btn-close').addEventListener('click', () => {
        window.installer.close();
    });
    
    // Welcome page
    document.getElementById('btn-cancel-welcome').addEventListener('click', () => {
        window.installer.close();
    });
    
    document.getElementById('btn-next-welcome').addEventListener('click', () => {
        showPage('location');
    });
    
    // Location page
    document.getElementById('btn-back-location').addEventListener('click', () => {
        showPage('welcome');
    });
    
    document.getElementById('btn-browse').addEventListener('click', async () => {
        const path = await window.installer.browseFolder();
        if (path) {
            installPath = path;
            document.getElementById('install-path').value = path;
            hidePathError();
        }
    });
    
    document.getElementById('btn-install').addEventListener('click', async () => {
        await startInstallation();
    });
    
    // Complete page
    document.getElementById('btn-finish').addEventListener('click', async () => {
        const shouldLaunch = document.getElementById('launch-checkbox').checked;
        if (shouldLaunch) {
            await window.installer.launchApp();
        }
        window.installer.close();
    });
    
    // Error buttons on installing page
    document.getElementById('btn-retry').addEventListener('click', () => {
        resetInstallPage();
        showPage('location');
    });
    
    document.getElementById('btn-close-error').addEventListener('click', () => {
        window.installer.close();
    });
    
    // GitHub link
    document.getElementById('link-github').addEventListener('click', (e) => {
        e.preventDefault();
        window.installer.openLink('https://github.com/skonester/Shiira');
    });
    
    // Uninstall page buttons
    document.getElementById('btn-cancel-uninstall').addEventListener('click', () => {
        window.installer.close();
    });
    
    document.getElementById('btn-confirm-uninstall').addEventListener('click', async () => {
        await startUninstall();
    });
    
    document.getElementById('btn-uninstall-finish').addEventListener('click', () => {
        window.installer.close();
    });
    
    // Listen for installation progress
    window.installer.onProgress((data) => {
        updateProgress(data.progress, data.message);
    });
    
    // Listen for uninstall progress
    window.installer.onUninstallProgress((data) => {
        updateUninstallProgress(data.progress, data.message);
    });
}

// Show a specific page
function showPage(pageName) {
    // Hide all pages
    Object.values(pages).forEach(page => {
        page.classList.remove('active');
    });
    
    // Show target page
    if (pages[pageName]) {
        pages[pageName].classList.add('active');
        currentPage = pageName;
    }
}

// Start installation
async function startInstallation() {
    // Check if path is writable
    const pathCheck = await window.installer.checkPathWritable(installPath);
    
    if (!pathCheck.writable) {
        showPathError(pathCheck.error || 'Cannot write to this location. Please choose a different folder.');
        return;
    }
    
    // Show installing page
    showPage('installing');
    
    // Start installation
    const result = await window.installer.startInstallation(installPath);
    
    if (result.success) {
        showPage('complete');
    } else {
        // Show error with actions
        document.getElementById('install-status').textContent = 'Installation failed!';
        document.getElementById('install-status').style.color = '#FF4D4D';
        document.getElementById('install-details').textContent = result.error || 'An unknown error occurred.';
        document.getElementById('install-details').classList.add('error');
        document.getElementById('install-error-actions').classList.remove('hidden');
        
        // Change progress bar to error state
        document.getElementById('progress-fill').classList.add('error');
    }
}

// Update progress bar
function updateProgress(percent, message) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const installDetails = document.getElementById('install-details');
    
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${Math.round(percent)}%`;
    
    if (message) {
        installDetails.textContent = message;
    }
}

// Show path error
function showPathError(message) {
    const errorDiv = document.getElementById('path-error');
    const errorText = errorDiv.querySelector('.error-text');
    errorText.textContent = message;
    errorDiv.classList.remove('hidden');
}

// Hide path error
function hidePathError() {
    const errorDiv = document.getElementById('path-error');
    errorDiv.classList.add('hidden');
}

// Reset install page state for retry
function resetInstallPage() {
    document.getElementById('install-status').textContent = 'Please wait while Shiira Browser is being installed...';
    document.getElementById('install-status').style.color = '';
    document.getElementById('install-details').textContent = 'Preparing installation...';
    document.getElementById('install-details').classList.remove('error');
    document.getElementById('install-error-actions').classList.add('hidden');
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-fill').classList.remove('error');
    document.getElementById('progress-text').textContent = '0%';
}

// Start uninstall process
async function startUninstall() {
    showPage('uninstall-progress');
    
    const result = await window.installer.startUninstall();
    
    if (result.success) {
        showPage('uninstall-complete');
    } else {
        document.getElementById('uninstall-status').textContent = 'Uninstall failed!';
        document.getElementById('uninstall-status').style.color = '#FF4D4D';
        document.getElementById('uninstall-details').textContent = result.error || 'An unknown error occurred.';
    }
}

// Update uninstall progress
function updateUninstallProgress(percent, message) {
    const progressFill = document.getElementById('uninstall-progress-fill');
    const progressText = document.getElementById('uninstall-progress-text');
    const details = document.getElementById('uninstall-details');
    
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${Math.round(percent)}%`;
    
    if (message) {
        details.textContent = message;
    }
}

// Create ember particles effect
function createEmberParticles() {
    const container = document.getElementById('ember-particles');
    const particleCount = 15;
    
    for (let i = 0; i < particleCount; i++) {
        createEmber(container, i * (4000 / particleCount));
    }
}

function createEmber(container, delay) {
    const ember = document.createElement('div');
    ember.className = 'ember';
    
    // Random position
    ember.style.left = `${20 + Math.random() * 160}px`;
    ember.style.bottom = `${-10 + Math.random() * 50}px`;
    ember.style.animationDelay = `${delay}ms`;
    ember.style.animationDuration = `${3000 + Math.random() * 2000}ms`;
    
    // Random size
    const size = 2 + Math.random() * 4;
    ember.style.width = `${size}px`;
    ember.style.height = `${size}px`;
    
    container.appendChild(ember);
    
    // Recreate when animation ends
    ember.addEventListener('animationend', () => {
        ember.remove();
        createEmber(container, 0);
    });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
