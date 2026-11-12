const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shiira-electron-settings-'));
const env = { ...process.env, SHIIRA_SETTINGS_SMOKE_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
const artifacts = path.resolve(__dirname, '../tmp/settings-smoke');
fs.mkdirSync(artifacts, { recursive: true });
const results = [];
function run(phase) {
  return spawnSync(require('electron'), [path.join(__dirname, 'electron-settings-smoke.cjs')], {
    env: { ...env, SHIIRA_SETTINGS_SMOKE_PHASE: phase }, stdio: 'inherit', windowsHide: true, timeout: 45000
  });
}
let success = true;
try {
  for (const phase of ['write', 'read']) {
    const child = run(phase);
    const file = path.join(profile, `settings-${phase}.json`);
    const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { phase, success: false, error: child.error?.message || 'Electron exited before producing a result' };
    results.push(result);
    console.log(JSON.stringify(result, null, 2));
    if (child.status !== 0 || !result.success) { success = false; break; }
  }
} finally {
  const cleaned = run('cleanup');
  if (cleaned.status !== 0) success = false;
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ success, launches: results }, null, 2));
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('shiira-electron-settings-')) {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
process.exit(success ? 0 : 1);
