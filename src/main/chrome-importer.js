/**
 * Chrome Local Data Importer
 * Imports bookmarks, history, and other data from local Chrome installation
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

class ChromeImporter {
  constructor() {
    this.chromeUserDataPath = this.getChromeUserDataPath();
  }

  getChromeUserDataPath() {
    switch (process.platform) {
      case 'win32':
        return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
      case 'darwin':
        return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
      case 'linux':
        return path.join(os.homedir(), '.config', 'google-chrome');
      default:
        return null;
    }
  }

  /**
   * Get list of available Chrome profiles
   */
  getProfiles() {
    if (!this.chromeUserDataPath || !fs.existsSync(this.chromeUserDataPath)) {
      return { success: false, error: 'Chrome user data not found' };
    }

    try {
      const profiles = [];
      const items = fs.readdirSync(this.chromeUserDataPath);

      for (const item of items) {
        const profilePath = path.join(this.chromeUserDataPath, item);
        const prefsPath = path.join(profilePath, 'Preferences');

        // Check if it's a profile directory (has Preferences file)
        if (fs.existsSync(prefsPath)) {
          try {
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
            const profileName = prefs.profile?.name || item;
            const accountEmail = prefs.account_info?.[0]?.email || null;

            profiles.push({
              id: item,
              name: profileName,
              email: accountEmail,
              path: profilePath
            });
          } catch (e) {
            // If we can't read prefs, still add the profile with folder name
            profiles.push({
              id: item,
              name: item,
              email: null,
              path: profilePath
            });
          }
        }
      }

      // Sort: Default first, then by name
      profiles.sort((a, b) => {
        if (a.id === 'Default') return -1;
        if (b.id === 'Default') return 1;
        return a.name.localeCompare(b.name);
      });

      return { success: true, profiles };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Import bookmarks from a Chrome profile
   */
  importBookmarks(profileId = 'Default') {
    const profilePath = path.join(this.chromeUserDataPath, profileId);
    const bookmarksPath = path.join(profilePath, 'Bookmarks');

    if (!fs.existsSync(bookmarksPath)) {
      return { success: false, error: 'Bookmarks file not found' };
    }

    try {
      const bookmarksData = JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'));
      const bookmarks = [];

      const parseNode = (node, folder = '') => {
        if (node.type === 'url') {
          bookmarks.push({
            title: node.name,
            url: node.url,
            folder: folder,
            dateAdded: this.chromeTimeToUnix(node.date_added)
          });
        } else if (node.type === 'folder' && node.children) {
          const folderPath = folder ? `${folder}/${node.name}` : node.name;
          for (const child of node.children) {
            parseNode(child, folderPath);
          }
        }
      };

      // Parse bookmark bar
      if (bookmarksData.roots?.bookmark_bar) {
        parseNode(bookmarksData.roots.bookmark_bar, 'Bookmarks Bar');
      }

      // Parse other bookmarks
      if (bookmarksData.roots?.other) {
        parseNode(bookmarksData.roots.other, 'Other Bookmarks');
      }

      // Parse synced bookmarks (mobile)
      if (bookmarksData.roots?.synced) {
        parseNode(bookmarksData.roots.synced, 'Mobile Bookmarks');
      }

      return { success: true, bookmarks, count: bookmarks.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Import history from a Chrome profile
   * Note: Chrome locks the History file while running, so we copy it first
   */
  importHistory(profileId = 'Default', limit = 10000) {
    const profilePath = path.join(this.chromeUserDataPath, profileId);
    const historyPath = path.join(profilePath, 'History');

    if (!fs.existsSync(historyPath)) {
      return { success: false, error: 'History database not found' };
    }

    // Copy the database to a temp location (Chrome locks it while running)
    const tempPath = path.join(os.tmpdir(), `shiira-chrome-history-${Date.now()}.db`);

    try {
      fs.copyFileSync(historyPath, tempPath);

      const db = new Database(tempPath, { readonly: true });

      const rows = db.prepare(`
        SELECT url, title, visit_count, last_visit_time
        FROM urls
        ORDER BY last_visit_time DESC
        LIMIT ?
      `).all(limit);

      db.close();

      // Clean up temp file
      try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }

      const history = rows.map(row => ({
        url: row.url,
        title: row.title || row.url,
        visitCount: row.visit_count,
        lastVisit: this.chromeTimeToUnix(row.last_visit_time)
      }));

      return { success: true, history, count: history.length };
    } catch (e) {
      // Clean up temp file on error
      try { fs.unlinkSync(tempPath); } catch (e2) { /* ignore */ }

      if (e.message.includes('SQLITE_BUSY') || e.message.includes('database is locked')) {
        return { success: false, error: 'Chrome is running. Please close Chrome and try again.' };
      }
      return { success: false, error: e.message };
    }
  }

  /**
   * Get saved login sites (not passwords - those are encrypted)
   * Returns the list of sites where passwords are saved
   */
  getSavedLoginSites(profileId = 'Default') {
    const profilePath = path.join(this.chromeUserDataPath, profileId);
    const loginDataPath = path.join(profilePath, 'Login Data');

    if (!fs.existsSync(loginDataPath)) {
      return { success: false, error: 'Login Data not found' };
    }

    // Copy the database to a temp location
    const tempPath = path.join(os.tmpdir(), `shiira-chrome-logins-${Date.now()}.db`);

    try {
      fs.copyFileSync(loginDataPath, tempPath);

      const db = new Database(tempPath, { readonly: true });

      const rows = db.prepare(`
        SELECT origin_url, username_value, date_created, date_last_used
        FROM logins
        ORDER BY date_last_used DESC
      `).all();

      db.close();

      // Clean up temp file
      try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }

      const logins = rows.map(row => ({
        url: row.origin_url,
        username: row.username_value,
        dateCreated: this.chromeTimeToUnix(row.date_created),
        dateLastUsed: this.chromeTimeToUnix(row.date_last_used)
      }));

      return { success: true, logins, count: logins.length };
    } catch (e) {
      try { fs.unlinkSync(tempPath); } catch (e2) { /* ignore */ }

      if (e.message.includes('SQLITE_BUSY') || e.message.includes('database is locked')) {
        return { success: false, error: 'Chrome is running. Please close Chrome and try again.' };
      }
      return { success: false, error: e.message };
    }
  }

  /**
   * Get summary of what can be imported from a profile
   */
  getImportSummary(profileId = 'Default') {
    const profilePath = path.join(this.chromeUserDataPath, profileId);

    const summary = {
      profileId,
      bookmarks: { available: false, count: 0 },
      history: { available: false, count: 0 },
      logins: { available: false, count: 0 }
    };

    // Check bookmarks
    const bookmarksPath = path.join(profilePath, 'Bookmarks');
    if (fs.existsSync(bookmarksPath)) {
      summary.bookmarks.available = true;
      try {
        const result = this.importBookmarks(profileId);
        if (result.success) {
          summary.bookmarks.count = result.count;
        }
      } catch (e) { /* ignore */ }
    }

    // Check history
    const historyPath = path.join(profilePath, 'History');
    if (fs.existsSync(historyPath)) {
      summary.history.available = true;
      // Don't count history here as it requires copying the db
    }

    // Check logins
    const loginDataPath = path.join(profilePath, 'Login Data');
    if (fs.existsSync(loginDataPath)) {
      summary.logins.available = true;
    }

    return { success: true, summary };
  }

  /**
   * Convert Chrome's timestamp (microseconds since 1601) to Unix timestamp (milliseconds since 1970)
   */
  chromeTimeToUnix(chromeTime) {
    if (!chromeTime || chromeTime === '0') return null;
    // Chrome time is microseconds since Jan 1, 1601
    // Unix time is milliseconds since Jan 1, 1970
    // Difference is 11644473600 seconds
    const chromeTimeNum = typeof chromeTime === 'string' ? parseInt(chromeTime, 10) : chromeTime;
    return Math.floor(chromeTimeNum / 1000) - 11644473600000;
  }
}

module.exports = ChromeImporter;
