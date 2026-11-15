const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class BookmarksService {
    constructor() {
        this.configPath = null;
        this.iconsPath = null;
        this.bookmarks = {
            bar: [],      // Root level bookmarks bar items
            folders: {}   // Folder ID -> folder data mapping
        };
        this.barEnabled = false;
        this.nextId = 1;
    }

    initialize() {
        this.configPath = path.join(app.getPath('userData'), 'bookmarks.json');
        this.iconsPath = path.join(app.getPath('userData'), 'bookmark-icons');
        
        // Create icons directory if it doesn't exist
        if (!fs.existsSync(this.iconsPath)) {
            fs.mkdirSync(this.iconsPath, { recursive: true });
        }
        
        this.loadConfig();
    }

    getIconsPath() {
        return this.iconsPath;
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.bookmarks = data.bookmarks || { bar: [], folders: {} };
                this.barEnabled = data.barEnabled ?? false;
                this.nextId = data.nextId || 1;
            } else {
                this.bookmarks = { bar: [], folders: {} };
                this.barEnabled = false;
                this.nextId = 1;
                this.saveConfig();
            }
        } catch (e) {
            if (!app.isPackaged) {
                console.error('Failed to load bookmarks config:', e);
            }
            this.bookmarks = { bar: [], folders: {} };
            this.barEnabled = false;
            this.nextId = 1;
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath + '.tmp', JSON.stringify({
                bookmarks: this.bookmarks,
                barEnabled: this.barEnabled,
                nextId: this.nextId
            }, null, 2));
            fs.renameSync(this.configPath + '.tmp', this.configPath);
            return true;
        } catch (e) {
            if (!app.isPackaged) {
                console.error('Failed to save bookmarks config:', e);
            }
            return false;
        }
    }

    generateId() {
        return `bm_${this.nextId++}`;
    }

    // Get all bookmarks data
    getBookmarks() {
        return {
            barEnabled: this.barEnabled,
            bookmarks: this.bookmarks
        };
    }

    // Toggle bookmarks bar
    setBarEnabled(enabled) {
        this.barEnabled = enabled;
        this.saveConfig();
        return this.barEnabled;
    }

    isBarEnabled() {
        return this.barEnabled;
    }

    // Add a bookmark
    addBookmark({ url, title, icon, folderId = null }) {
        if (!url) {
            return { success: false, error: 'URL is required' };
        }

        // Normalize URL
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            url = 'https://' + url;
        }

        // Allow empty string titles (icon-only bookmarks)
        // Only use fallback if title is undefined/null
        const bookmarkTitle = title !== undefined && title !== null ? title : this.extractTitleFromUrl(url);

        const bookmark = {
            id: this.generateId(),
            type: 'bookmark',
            url,
            title: bookmarkTitle,
            icon: icon || null,
            addedAt: Date.now()
        };

        if (folderId && this.bookmarks.folders[folderId]) {
            // Add to specific folder
            this.bookmarks.folders[folderId].children.push(bookmark);
        } else {
            // Add to bookmarks bar root
            this.bookmarks.bar.push(bookmark);
        }

        this.saveConfig();
        return { success: true, bookmark };
    }

    // Create a folder
    createFolder({ name, parentFolderId = null }) {
        if (!name) {
            return { success: false, error: 'Folder name is required' };
        }

        const folder = {
            id: this.generateId(),
            type: 'folder',
            name,
            children: [],
            createdAt: Date.now()
        };

        // Store folder in folders map
        this.bookmarks.folders[folder.id] = folder;

        if (parentFolderId && this.bookmarks.folders[parentFolderId]) {
            // Add folder reference to parent folder
            this.bookmarks.folders[parentFolderId].children.push({
                id: folder.id,
                type: 'folder-ref'
            });
        } else {
            // Add folder reference to bookmarks bar root
            this.bookmarks.bar.push({
                id: folder.id,
                type: 'folder-ref'
            });
        }

        this.saveConfig();
        return { success: true, folder };
    }

    // Remove a bookmark or folder
    removeItem(itemId) {
        // Check if it's a folder
        if (this.bookmarks.folders[itemId]) {
            // Remove from folders map
            delete this.bookmarks.folders[itemId];
            // Remove references from bar
            this.bookmarks.bar = this.bookmarks.bar.filter(item => item.id !== itemId);
            // Remove references from other folders
            Object.values(this.bookmarks.folders).forEach(folder => {
                folder.children = folder.children.filter(item => item.id !== itemId);
            });
        } else {
            // It's a bookmark - remove from bar
            this.bookmarks.bar = this.bookmarks.bar.filter(item => item.id !== itemId);
            // Remove from folders
            Object.values(this.bookmarks.folders).forEach(folder => {
                folder.children = folder.children.filter(item => item.id !== itemId);
            });
        }

        this.saveConfig();
        return { success: true };
    }

    // Update a bookmark or folder
    updateItem(itemId, updates) {
        // Check if it's a folder
        if (this.bookmarks.folders[itemId]) {
            Object.assign(this.bookmarks.folders[itemId], updates);
        } else {
            // Find bookmark in bar
            const barIndex = this.bookmarks.bar.findIndex(item => item.id === itemId);
            if (barIndex >= 0) {
                Object.assign(this.bookmarks.bar[barIndex], updates);
            } else {
                // Find in folders
                Object.values(this.bookmarks.folders).forEach(folder => {
                    const index = folder.children.findIndex(item => item.id === itemId);
                    if (index >= 0 && folder.children[index].type === 'bookmark') {
                        Object.assign(folder.children[index], updates);
                    }
                });
            }
        }

        this.saveConfig();
        return { success: true };
    }

    // Move a bookmark to a different location
    moveItem(itemId, targetFolderId = null, targetIndex = -1) {
        let item = null;

        // Find and remove the item from its current location
        const barIndex = this.bookmarks.bar.findIndex(i => i.id === itemId);
        if (barIndex >= 0) {
            item = this.bookmarks.bar.splice(barIndex, 1)[0];
        } else {
            // Check folders
            Object.values(this.bookmarks.folders).forEach(folder => {
                const index = folder.children.findIndex(i => i.id === itemId);
                if (index >= 0) {
                    item = folder.children.splice(index, 1)[0];
                }
            });
        }

        if (!item) {
            return { success: false, error: 'Item not found' };
        }

        // Add to new location
        if (targetFolderId && this.bookmarks.folders[targetFolderId]) {
            const children = this.bookmarks.folders[targetFolderId].children;
            if (targetIndex >= 0 && targetIndex < children.length) {
                children.splice(targetIndex, 0, item);
            } else {
                children.push(item);
            }
        } else {
            // Add to bar root
            if (targetIndex >= 0 && targetIndex < this.bookmarks.bar.length) {
                this.bookmarks.bar.splice(targetIndex, 0, item);
            } else {
                this.bookmarks.bar.push(item);
            }
        }

        this.saveConfig();
        return { success: true };
    }

    // Check if a URL is bookmarked
    isBookmarked(url) {
        // Check bar
        if (this.bookmarks.bar.some(item => item.type === 'bookmark' && item.url === url)) {
            return true;
        }
        // Check folders
        return Object.values(this.bookmarks.folders).some(folder =>
            folder.children.some(item => item.type === 'bookmark' && item.url === url)
        );
    }

    // Find bookmark by URL
    findBookmarkByUrl(url) {
        // Check bar
        const barItem = this.bookmarks.bar.find(item => item.type === 'bookmark' && item.url === url);
        if (barItem) return { bookmark: barItem, location: 'bar', folderId: null };

        // Check folders
        for (const [folderId, folder] of Object.entries(this.bookmarks.folders)) {
            const item = folder.children.find(i => i.type === 'bookmark' && i.url === url);
            if (item) return { bookmark: item, location: 'folder', folderId };
        }

        return null;
    }

    // Get folder list for UI
    getFolderList() {
        const folders = [{ id: null, name: 'Bookmarks Bar' }];
        Object.entries(this.bookmarks.folders).forEach(([id, folder]) => {
            folders.push({ id, name: folder.name });
        });
        return folders;
    }

    // Imports are staged and saved once, preserving folder paths and order.
    importFromHtml(htmlContent) {
        const parser = require('./import-bookmarks');
        if (typeof htmlContent !== 'string' || Buffer.byteLength(htmlContent) > parser.MAX_BYTES) return { success: false, error: 'Bookmark file is too large (8 MB maximum).' };
        const data = parser.parse(htmlContent);
        if (!data.bookmarks) return { success: false, error: 'No supported web bookmarks found.' };
        return this.importTree(data.nodes, 'Imported Bookmarks');
    }

    importTree(nodes, name = 'Imported Bookmarks') {
        const previous = this.bookmarks;
        const previousId = this.nextId;
        const previousEnabled = this.barEnabled;
        this.bookmarks = structuredClone(previous);
        const imported = { bookmarks: 0, folders: 0, skipped: 0 };
        try {
            const folderIn = (items, title) => {
                let folder = items.filter(item => item.type === 'folder-ref').map(item => this.bookmarks.folders[item.id]).find(item => item?.name === title);
                if (!folder) {
                    folder = { id: this.generateId(), type: 'folder', name: title, children: [], createdAt: Date.now() };
                    this.bookmarks.folders[folder.id] = folder;
                    items.push({ id: folder.id, type: 'folder-ref' });
                    imported.folders++;
                }
                return folder.children;
            };
            const walk = (list, items) => {
                for (const node of list) {
                    if (node.type === 'folder') walk(node.children, folderIn(items, node.name));
                    else if (items.some(item => item.type === 'bookmark' && item.url === node.url)) imported.skipped++;
                    else {
                        items.push({ id: this.generateId(), type: 'bookmark', title: node.title, url: node.url, icon: null, addedAt: Date.now() });
                        imported.bookmarks++;
                    }
                }
            };
            walk(nodes, folderIn(this.bookmarks.bar, name));
            this.barEnabled = true;
            if (!this.saveConfig()) throw new Error('Could not save imported bookmarks.');
            return { success: true, imported };
        } catch (error) {
            this.bookmarks = previous;
            this.nextId = previousId;
            this.barEnabled = previousEnabled;
            return { success: false, error: error.message };
        }
    }

    // Helper to decode HTML entities
    decodeHtmlEntities(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#x2F;/g, '/')
            .replace(/&nbsp;/g, ' ');
    }

    // Validate and sanitize bookmark icons
    validateAndSanitizeIcon(icon) {
        if (!icon || typeof icon !== 'string') {
            return null;
        }
        
        // Only allow data URIs for now (reject external URLs for security)
        if (!icon.startsWith('data:')) {
            return null;
        }
        
        // Validate data URI format
        const dataUriMatch = icon.match(/^data:([^;,]+)(;base64)?,(.+)$/);
        if (!dataUriMatch) {
            return null;
        }
        
        const [, mimeType, isBase64, data] = dataUriMatch;
        
        // Only allow image MIME types
        const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
        if (!allowedMimeTypes.includes(mimeType.toLowerCase())) {
            console.warn(`[Bookmarks] Rejected icon with invalid MIME type: ${mimeType}`);
            return null;
        }
        
        // Check size limit (100KB for data URIs)
        const sizeInBytes = isBase64 ? (data.length * 3) / 4 : data.length;
        const maxSize = 100 * 1024; // 100KB
        if (sizeInBytes > maxSize) {
            console.warn(`[Bookmarks] Rejected icon exceeding size limit: ${(sizeInBytes / 1024).toFixed(1)}KB`);
            return null;
        }
        
        // Return sanitized icon
        return icon;
    }

    // Extract title from URL as fallback
    extractTitleFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
        } catch {
            return url;
        }
    }

    // Save a custom icon for a bookmark
    saveCustomIcon(bookmarkId, base64Data, mimeType) {
        try {
            // Determine file extension from mime type
            const extMap = {
                'image/png': '.png',
                'image/jpeg': '.jpg',
                'image/jpg': '.jpg',
                'image/svg+xml': '.svg',
                'image/x-icon': '.ico',
                'image/webp': '.webp'
            };
            const ext = extMap[mimeType] || '.png';
            const filename = `${bookmarkId}${ext}`;
            const filePath = path.join(this.iconsPath, filename);
            
            // Remove data URL prefix if present
            const base64Content = base64Data.replace(/^data:image\/[a-z+]+;base64,/, '');
            
            // Security: Limit icon file size to 1MB
            const buffer = Buffer.from(base64Content, 'base64');
            const MAX_ICON_SIZE = 1024 * 1024; // 1MB
            if (buffer.length > MAX_ICON_SIZE) {
                throw new Error('Icon file too large (max 1MB)');
            }
            
            // Write the file
            fs.writeFileSync(filePath, buffer);
            
            // Return the file path as a file:// URL
            return `file://${filePath.replace(/\\/g, '/')}`;
        } catch (e) {
            if (!app.isPackaged) {
                console.error('Failed to save custom icon:', e.message);
            }
            return null;
        }
    }

    // Delete a custom icon
    deleteCustomIcon(bookmarkId) {
        try {
            const extensions = ['.png', '.jpg', '.svg', '.ico', '.webp'];
            for (const ext of extensions) {
                const filePath = path.join(this.iconsPath, `${bookmarkId}${ext}`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            return true;
        } catch (e) {
            if (!app.isPackaged) {
                console.error('Failed to delete custom icon:', e.message);
            }
            return false;
        }
    }
}

module.exports = BookmarksService;
