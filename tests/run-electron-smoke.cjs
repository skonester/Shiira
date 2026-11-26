const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const env = { ...process.env };
// Coding tools sometimes run inside Electron and export this flag. The smoke
// test needs Electron's browser process rather than its Node-only mode.
delete env.ELECTRON_RUN_AS_NODE;
const kind = process.argv[2] || 'arc';
if (!['runtime', 'auth', 'clipboard', 'orbe', 'orbe-next', 'orbe-shared', 'arc', 'search', 'scira-website', 'youtube', 'youtube-live'].includes(kind)) throw new Error('Unknown smoke test');
const resultFile = path.resolve(__dirname, `../tmp/${kind}-smoke/result.json`);
fs.rmSync(resultFile, { force: true });
let child = spawnSync(require('electron'), [path.join(__dirname, kind === 'youtube-live' ? 'electron-youtube-live.cjs' : `electron-${kind}-smoke.cjs`),
  ...(kind === 'youtube-live' ? process.argv.slice(3) : [])], {
  env, stdio: 'inherit', windowsHide: true, timeout: kind === 'youtube-live' ? 300000 : kind.startsWith('orbe') ? 90000 : kind === 'youtube' && env.SHIIRA_YOUTUBE_LIVE === '1' ? 120000 : 60000
});
if (kind === 'orbe-shared' && child.status === 0 && fs.existsSync(resultFile)) {
  const written = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  if (written.success) child = spawnSync(require('electron'), [path.join(__dirname, 'electron-orbe-shared-smoke.cjs')], {
    env: { ...env, SHIIRA_SHARED_PROFILE: written.temporaryProfile, SHIIRA_SHARED_PHASE: 'read' },
    stdio: 'inherit', windowsHide: true, timeout: 60000
  });
}
if (fs.existsSync(resultFile)) {
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const displayed = kind === 'youtube-live'
    ? { ...result, samples: `${result.samples.length} samples saved in ${resultFile}`,
      diagnostics: result.diagnostics.slice(-15) } : result;
  console.log(JSON.stringify(displayed, null, 2));
  const profile = result.temporaryProfile;
  try {
    if (profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith(`shiira-electron-${kind}-`)) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  } catch {
    // Windows file locks may briefly delay temporary profile cleanup.
  }
}
if (child.error) console.error(child.error.message);
process.exit(child.status ?? 1);
