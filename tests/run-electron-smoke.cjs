const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const env = { ...process.env };
// Coding tools sometimes run inside Electron and export this flag. The smoke
// test needs Electron's browser process rather than its Node-only mode.
delete env.ELECTRON_RUN_AS_NODE;
const kind = process.argv[2] || 'arc';
if (!['arc', 'search', 'scira-website', 'youtube'].includes(kind)) throw new Error('Unknown smoke test');
const resultFile = path.resolve(__dirname, `../tmp/${kind}-smoke/result.json`);
fs.rmSync(resultFile, { force: true });
const child = spawnSync(require('electron'), [path.join(__dirname, `electron-${kind}-smoke.cjs`)], {
  env, stdio: 'inherit', windowsHide: true, timeout: kind === 'youtube' && env.SHIIRA_YOUTUBE_LIVE === '1' ? 120000 : 60000
});
if (fs.existsSync(resultFile)) {
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  console.log(JSON.stringify(result, null, 2));
  const profile = result.temporaryProfile;
  if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith(`shiira-electron-${kind}-`)) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
