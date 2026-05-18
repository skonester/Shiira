/**
 * Privacy Service - Manages privacy settings
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class PrivacyService {
    constructor() {
        this.configPath = null;
        this.settings = {
            enableUrlSuggestions: true, // Default: enabled for convenience
            suggestionsProvider: 'google', // 'google' or 'none'
            sitePermissions: {} // { hostname: { media: true/false, geolocation: true/false } }
        };
    }

    initialize() {
        this.configPath = path.join(app.getPath('userData'), 'privacy.json');
        this.loadSettings();
    }

    loadSettings() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.settings = { ...this.settings, ...data };
            } else {
                this.saveSettings();
            }
        } catch (e) {
            if (!app.isPackaged) {
                console.error('[Privacy] Failed to load settings:', e);
            }
        }
    }

    saveSettings() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2));
        } catch (e) {
            if (!app.isPackaged) {
                console.error('[Privacy] Failed to save settings:', e);
            }
        }
    }

    getSettings() {
        return { ...this.settings };
    }

    setSetting(key, value) {
        if (this.settings.hasOwnProperty(key)) {
            this.settings[key] = value;
            this.saveSettings();
            return { success: true };
        }
        return { success: false, error: 'Unknown setting' };
    }

    isUrlSuggestionsEnabled() {
        return this.settings.enableUrlSuggestions;
    }

    getSuggestionsProvider() {
        return this.settings.suggestionsProvider;
    }

    // Permission management
    getPermissionForSite(hostname, permission) {
        if (!this.settings.sitePermissions[hostname]) {
            return null;
        }
        return this.settings.sitePermissions[hostname][permission] ?? null;
    }

    setPermissionForSite(hostname, permission, granted) {
        if (!this.settings.sitePermissions[hostname]) {
            this.settings.sitePermissions[hostname] = {};
        }
        this.settings.sitePermissions[hostname][permission] = granted;
        this.saveSettings();
        return { success: true };
    }

    getSitePermissions(hostname) {
        return this.settings.sitePermissions[hostname] || {};
    }

    clearSitePermissions(hostname) {
        if (hostname) {
            if (this.settings.sitePermissions[hostname]) {
                delete this.settings.sitePermissions[hostname];
                this.saveSettings();
            }
        } else {
            // Clear all site permissions
            this.settings.sitePermissions = {};
            this.saveSettings();
        }
        return { success: true };
    }
}

module.exports = PrivacyService;
