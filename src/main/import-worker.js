// Keep large bookmark parsing and foreign SQLite reads off Electron's UI thread.
const { parentPort, workerData } = require('node:worker_threads');
const browsers = require('./import-browsers');
const bookmarks = require('./import-bookmarks');
if (workerData.config) browsers.configure(workerData.config);
(async () => {
  const { task, browserId, profileId, file } = workerData;
  if (task === 'detect') return browsers.detect();
  if (task === 'browser') return browsers.read(browserId, profileId);
  if (task === 'file') return bookmarks.read(file);
  throw new Error('Unknown import source.');
})().then(data => parentPort.postMessage(data), error => parentPort.postMessage({ error: error.message }));
