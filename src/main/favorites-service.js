const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class FavoritesService {
    constructor() {
        this.configPath = null;
        this.favorites = [];
        this.enabled = false;
        this.maxSlots = 10;
    }

    initialize() {
        this.configPath = path.join(app.getPath('userData'), 'favorites.json');
        this.loadConfig();
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.favorites = data.favorites || [];
                this.enabled = data.enabled ?? false;
                
                // Ensure we have up to maxSlots
                this.favorites = this.favorites.slice(0, this.maxSlots);
            } else {
                // Initialize with empty array
                this.favorites = [];
                this.enabled = false;
                this.saveConfig();
            }
        } catch (e) {
            if (!app.isPackaged) {
                console.error('Failed to load favorites config:', e);
            }
            this.favorites = [];
            this.enabled = false;
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify({
                favorites: this.favorites,
                enabled: this.enabled
            }, null, 2));
        } catch (e) {
            console.error('Failed to save favorites config:', e);
        }
    }

    isEnabled() {
        return this.enabled;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.saveConfig();
        return this.enabled;
    }

    getFavorites() {
        return {
            enabled: this.enabled,
            favorites: this.favorites
        };
    }

    setFavorite(slotIndex, url, name = null) {
        if (slotIndex < 0 || slotIndex >= this.maxSlots) {
            return { success: false, error: 'Invalid slot index' };
        }

        if (!url) {
            return { success: false, error: 'URL is required' };
        }

        // Normalize URL
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        try {
            const urlObj = new URL(url);
            this.favorites[slotIndex] = {
                url: url,
                name: name || urlObj.hostname,
                favicon: `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`
            };
            this.saveConfig();
            return { success: true, favorite: this.favorites[slotIndex] };
        } catch (e) {
            return { success: false, error: 'Invalid URL' };
        }
    }

    removeFavorite(slotIndex) {
        if (slotIndex < 0 || slotIndex >= this.maxSlots) {
            return { success: false, error: 'Invalid slot index' };
        }

        this.favorites[slotIndex] = null;
        this.saveConfig();
        return { success: true };
    }
}

module.exports = FavoritesService;
