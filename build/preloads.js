const path = require('node:path');
const fs = require('node:fs');

function buildPreloads() {
  require('esbuild').buildSync({
    entryPoints: [path.join(__dirname, '../src/preload/webview-entry.js')],
    outfile: path.join(__dirname, '../src/preload/webview.bundle.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome156',
    external: ['electron'], minify: true, legalComments: 'eof'
  });
  const output = path.join(__dirname, '../src/preload/webview.bundle.js');
  if (!fs.statSync(output).size) throw new Error('Tab preload bundle is empty');
}

module.exports = { buildPreloads, default: buildPreloads };
if (require.main === module) buildPreloads();
