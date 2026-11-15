// Secondary launch fixture: shares only the owning smoke test's temporary profile.
const { app } = require('electron');
const path = require('node:path');
const profile = process.env.SHIIRA_EXTERNAL_LAUNCH_PROFILE;
if (!profile || !path.basename(profile).startsWith('shiira-electron-orbe-next-') || path.dirname(path.resolve(profile)) !== path.resolve(require('node:os').tmpdir())) throw new Error('A smoke profile is required.');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const appRoot = process.env.SHIIRA_SMOKE_APP_ROOT || path.resolve(__dirname, '../..');
require(path.join(appRoot, 'src/main/bootstrap'));
