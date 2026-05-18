/**
 * After pack hook for electron-builder
 * Sets the icon on the executable since signAndEditExecutable is disabled
 */

const path = require('path');
const { rcedit } = require('rcedit');

exports.default = async function(context) {
  // Only run for Windows
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(__dirname, '..', 'assets', 'shiira-logo.ico');

  console.log(`[afterPack] Setting icon on ${exePath}`);
  console.log(`[afterPack] Icon path: ${iconPath}`);

  try {
    await rcedit(exePath, {
      icon: iconPath,
      'version-string': {
        ProductName: 'Shiira Browser',
        FileDescription: 'Shiira Browser',
        CompanyName: 'Shiira Project',
        LegalCopyright: 'Copyright (C) 2026 Shiira Project'
      }
    });
    console.log('[afterPack] Icon set successfully!');
  } catch (error) {
    console.error('[afterPack] Failed to set icon:', error);
    throw error;
  }
};
