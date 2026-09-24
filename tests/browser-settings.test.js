const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BrowserSettings = require('../src/main/browser-settings');

test('browser settings persist validated download and update preferences', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-settings-'));
  const file = path.join(directory, 'browser-settings.json');
  t.after(() => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });

  const settings = new BrowserSettings();
  settings.initialize(file);
  assert.deepEqual(settings.get(), {
    askWhereToSave: true,
    downloadDirectory: null,
    autoCheckUpdates: true
  });
  assert.equal(settings.setBoolean('askWhereToSave', false).success, true);
  assert.equal(settings.setBoolean('autoCheckUpdates', false).success, true);
  assert.equal(settings.setDownloadDirectory(directory).success, true);
  assert.equal(settings.setBoolean('downloadDirectory', true).success, false);
  assert.equal(settings.setDownloadDirectory(path.join(directory, 'missing')).success, false);

  const reloaded = new BrowserSettings();
  reloaded.initialize(file);
  assert.deepEqual(reloaded.get(), {
    askWhereToSave: false,
    downloadDirectory: directory,
    autoCheckUpdates: false
  });
  assert.equal(reloaded.setDownloadDirectory(null).success, true);
  assert.equal(reloaded.get().downloadDirectory, null);
});

test('automatic downloads use a new path and stay inside the chosen folder', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-download-'));
  const existing = path.join(directory, 'report.pdf');
  fs.writeFileSync(existing, 'existing download');
  t.after(() => {
    fs.unlinkSync(existing);
    fs.rmdirSync(directory);
  });

  const reserved = new Set([path.join(directory, 'report (1).pdf')]);
  assert.equal(BrowserSettings.nextAvailablePath(directory, 'report.pdf', reserved), path.join(directory, 'report (2).pdf'));
  assert.equal(BrowserSettings.nextAvailablePath(directory, '../outside.txt'), path.join(directory, 'outside.txt'));
});
