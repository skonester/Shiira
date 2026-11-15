const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');

test('the UI preload gives the document a dark canvas before renderer initialization', () => {
  for (const delayed of [false, true]) {
    const document = { documentElement: delayed ? null : { style: {} } };
    let mutation;
    let disconnected = false;
    let api;
    vm.runInNewContext(source, {
      document,
      MutationObserver: class {
        constructor(callback) { mutation = callback; }
        observe() {}
        disconnect() { disconnected = true; }
      },
      require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => {
        if (name === 'shiiraAPI') api = value;
      } }, ipcRenderer: {} })
    });
    if (delayed) {
      document.documentElement = { style: {} };
      mutation();
      assert.equal(disconnected, true);
    }
    assert.equal(document.documentElement.style.backgroundColor, 'var(--bg-primary, #020308)');
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    assert.equal(typeof api.startupReady, 'function');
  }
});

test('startup respects platform graphics selection and Chromium driver restrictions', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const configure = /function configureHardwareAcceleration\(\) \{[\s\S]*?\n\}/.exec(main)[0];
  for (const [platform, backend] of [['win32', 'd3d11'], ['darwin', 'metal'], ['linux', 'gl']]) {
    const switches = new Map([['use-angle', backend]]);
    vm.runInNewContext(`${configure}\nconfigureHardwareAcceleration();`, {
      process: { platform }, app: { commandLine: { appendSwitch: (name, value) => switches.set(name, value) } }
    });
    assert.equal(switches.get('use-angle'), backend, `${platform} must retain its supported graphics backend`);
    assert.equal(switches.has('ignore-gpu-blocklist'), false);
    assert.equal(switches.has('enable-unsafe-webgpu'), false);
    assert.doesNotMatch(switches.get('enable-features'), /Vulkan|DefaultANGLE/);
  }
});
