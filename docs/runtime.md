# Browser runtime maintenance

Shiira uses **Castlabs Electron 45.2.1+wvcus**, embedding **Chromium 156.0.8078.75** and **Node.js 24.22.1**. This is the latest stable Castlabs release verified on November 13, 2026. The exact Git tag and commit are pinned in `package.json` and `package-lock.json`; electron-builder uses the installed Castlabs distribution.

Electron 39 / Chromium 142 is out of support. Updating a user-agent string cannot update the browser engine or install security fixes. The engine changes when a new Shiira binary is built and distributed.

## Keeping security fixes current

[Electron supports its latest three stable major versions](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). [Castlabs supports those branches on a best-effort basis and normally produces one build per branch per month](https://github.com/castlabs/electron-releases/wiki). Check [Castlabs releases](https://github.com/castlabs/electron-releases/releases) and [upstream Electron releases](https://releases.electronjs.org/) at least weekly, and immediately after a Chromium security advisory. Adopt stable patch releases promptly, and move to each new supported stable major after compatibility checks.

As of the verification date, upstream Electron is already at **45.3.2 / Chromium 156.0.8078.100**, ahead of the Castlabs build. The current upgrade restores a supported engine, but Castlabs' slower publication cadence still creates a security-update gap. For an urgent fix without a Castlabs build, request an updated build from Castlabs; alternatively, evaluate stock Electron while explicitly accounting for the loss of Castlabs Widevine/VMP support. Widevine component updates do not update Chromium itself.

## Upgrade procedure

1. Select the newest stable Castlabs release and read [Electron's breaking changes](https://www.electronjs.org/docs/latest/breaking-changes) for every intervening major.
2. Update the `electron` development dependency using its exact Castlabs Git tag and regenerate the lockfile with npm. Preserve the SQLite `gypfile: false` lockfile workaround described below. Set `build.electronVersion` to the matching upstream version, without `+wvcus`, and update the Chromium target in `build/preloads.js`.
3. Install from the lockfile with `npm ci`, then explicitly download the runtime with `node node_modules/electron/install.js`. Electron 42+ otherwise downloads on first use.
4. Run `npm test` and the Electron smoke tests: `test:runtime:electron`, `test:arc:electron`, `test:search:electron`, `test:settings:electron`, `test:scira:website:electron`, and `test:youtube:electron`. These use temporary browser profiles. The runtime test checks encrypted SQLite password storage, the sandboxed clipboard bridge, and a local MV3 extension without changing the OS clipboard.
5. Build each supported platform, verify the runtime reported by the packaged browser, and test ordinary browsing, installed extensions, profile persistence, downloads, and DRM playback. Paid streaming services also depend on production Widevine/VMP signing and their own policies; fixture video tests cannot verify those services.
6. Bump Shiira's application version and distribute a new release through the existing release/update workflow. Dependency changes alone do not upgrade already-installed browsers.

## Native modules and packaging

`better-sqlite3` 13 ships prebuilt Node-API binaries, and `keytar` uses Node-API too. They do not need rebuilding for each Electron ABI. `build.npmRebuild` is disabled to avoid unnecessary source compilation, and `build.asarUnpack` explicitly unpacks native `.node` files. A clean `npm ci` must still install keytar's platform binary. Revisit this setting if adding a native dependency that does not use Node-API, or targeting an architecture without prebuilt binaries.

The SQLite lockfile entry explicitly preserves the package's `gypfile: false` metadata. [npm issue 9837](https://github.com/npm/cli/issues/9837) causes clean lockfile installs to discard that field and attempt an unnecessary C++ build. Keep it when regenerating the lockfile until npm fixes this issue; always verify a clean `npm ci` after dependency updates.

To verify the Windows package with the same isolated runtime smoke test, set `SHIIRA_SMOKE_APP_ROOT` to the absolute path of `dist/win-unpacked/resources/app.asar` and run `npm run test:runtime:electron`. The harness loads the packaged main process, renderer, preloads, and native modules using the installed matching Castlabs executable.

The Electron 44 clipboard migration uses asynchronous `ClipboardItem`/`Blob` writes for Copy image. Sandboxed preloads use bundled browser code and Electron's bridge; they cannot depend on the Node shims removed in Electron 45.

This runtime requires macOS 13 or newer. Electron 44+ removed Windows ia32 and Linux armv7l support; build x64 or arm64 instead. The separate `installer/` project is a legacy installer UI with its own Electron dependency and is not built by the current release workflow.
