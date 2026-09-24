const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  askWhereToSave: true,
  downloadDirectory: null,
  autoCheckUpdates: true
});

class BrowserSettings {
  static nextAvailablePath(directory, filename, reserved = new Set()) {
    const parsed = path.parse(path.basename(filename || 'download'));
    let candidate = path.join(directory, parsed.base);
    let suffix = 1;
    while (fs.existsSync(candidate) || reserved.has(candidate)) {
      candidate = path.join(directory, `${parsed.name} (${suffix++})${parsed.ext}`);
    }
    return candidate;
  }

  constructor() {
    this.filePath = null;
    this.values = { ...DEFAULTS };
  }

  initialize(filePath) {
    this.filePath = filePath;
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof saved.askWhereToSave === 'boolean') this.values.askWhereToSave = saved.askWhereToSave;
      if (typeof saved.autoCheckUpdates === 'boolean') this.values.autoCheckUpdates = saved.autoCheckUpdates;
      if (typeof saved.downloadDirectory === 'string' && saved.downloadDirectory) {
        this.values.downloadDirectory = saved.downloadDirectory;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[Settings] Could not load browser settings:', error);
    }
  }

  get() { return { ...this.values }; }

  setBoolean(key, value) {
    if (!['askWhereToSave', 'autoCheckUpdates'].includes(key) || typeof value !== 'boolean') {
      return { success: false, error: 'Invalid browser setting' };
    }
    const previous = this.values[key];
    this.values[key] = value;
    const result = this.save();
    if (!result.success) this.values[key] = previous;
    return result;
  }

  setDownloadDirectory(directory) {
    if (directory !== null) {
      try {
        if (typeof directory !== 'string' || !fs.statSync(directory).isDirectory()) {
          return { success: false, error: 'Choose an existing folder' };
        }
      } catch {
        return { success: false, error: 'Choose an existing folder' };
      }
    }
    const previous = this.values.downloadDirectory;
    this.values.downloadDirectory = directory;
    const result = this.save();
    if (!result.success) this.values.downloadDirectory = previous;
    return result;
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.values, null, 2));
      return { success: true, settings: this.get() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = BrowserSettings;
