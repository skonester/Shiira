# Arc feature comparison with YARC

Compared against the local `yarc-main` source snapshot on November 11, 2026. This is a source-code comparison, not a claim of full Arc compatibility. YARC's README contains stale roadmap entries for features already present in its code, so the implementation was checked too.

## Implemented in this change

| Feature | Shiira behavior |
| --- | --- |
| Arc data selection | Auto-detected installation, selected sidebar JSON, or a copied Arc folder. The Arc root, `User Data`, an `Application Support` parent, or an extracted Windows package folder can be selected. |
| Arc sidebar compatibility | Modern and legacy sync layouts, Swift dictionary pairs, object maps, object arrays, value wrappers, multiple containers, parent-ID child recovery, and `newContainerIDs` fallback. |
| Spaces and pinned trees | Names, emoji and named icons, colors including extended sRGB/background themes, folder order and nesting, saved URLs and custom tab names. Imported tabs start asleep. |
| Favorites | Reads every Arc profile's favorites, skips stale favorites from another machine, deduplicates URLs, and merges into Shiira's shared favorites. |
| Today tabs | Optional import, with fresh activity timestamps to prevent immediate auto-archiving. Persist across restarts when session restore is enabled. |
| Archive | Reads `StorableArchiveItems.json`, converts Arc timestamps, remaps source spaces, and merges newest first into the existing 500-entry archive. |
| History | Optional import from `User Data/Default/History` and `User Data/Profile N/History`. Reads disposable copies including WAL/journal files; filters hidden/internal URLs and merges/deduplicates the newest 1,000 visits in Shiira's shared history. |
| Cached favicons | Reads local Arc PNG icons, with size/type restrictions; persists them in saved tabs. No third-party icon requests. |
| Arc window preferences | Focuses the imported last-used space. On the first import into an empty default sidebar, adopts Arc's sidebar width within Shiira's supported range. |
| Import resilience | Optional-file failures become visible warnings. Invalid source files and imports exceeding space/folder/pinned-item limits produce errors. Existing spaces are kept, with unique names for imported spaces. |
| Site search | Type `youtube`, `github`, `gmail`, or another supported site in the command bar, press Tab, then type a query. Backspace on an empty query or Escape leaves site search. No general web suggestions are requested in this mode. |
| Command-bar tab discovery | Matching open tabs appear before a new search. Archived tabs are searchable too. |
| Command-bar split | Shift+Enter or Shift+click on a webpage URL/site-search/history/archive result opens it beside the current page. Shiira's internal API search results use a home tab. |
| Pinned-link Peek | Ordinary links to a different hostname from pinned tabs/favorites open in Peek. Same-host links stay in the page. Shift+click also opens Peek. Ctrl/Command/middle-click still open tabs. Settings changes and pin/unpin changes take effect on loaded pages. |
| Private Peek | Peek uses the source tab's session; promoting a private preview to a tab/split keeps it private. |

Arc sources are read only. Import does not transfer saved passwords, cookies, authenticated sessions, installed extensions, Boosts, Easels, or Notes. Choose the complete copied Arc folder to include companion files; a sidebar file alone can only supply sidebar data unless its companions are alongside it.

## Features already in Shiira before this comparison

Spaces; global favorites; persistent pinned tabs; nested folders and drag/drop; Today auto-archive and restore; tab sleep; command actions; two-pane split with a draggable divider; Shift+click Peek with tab/split promotion; pin/unpin; reset pinned URL; rename/reset tab name; duplicate/mute tabs; Chrome extensions; ad blocking; private tabs; history and downloads; themes and sidebar sizing. These did not need another implementation.

## Remaining differences found in YARC

| YARC feature | Shiira gap | Relevant YARC source |
| --- | --- | --- |
| Profiles linked to spaces | Shiira uses one normal `persist:main` session. Favorites, history and extensions are shared. Import preserves each space's content but does not create isolated work/personal profiles. Full parity needs coordinated session, permission, extension and history changes. | `src/main/profiles.ts`, `src/main/profile-dir.ts`, `src/main/importers/index.ts` |
| Little Arc | Dedicated temporary windows for external links, promotion to a chosen space, a profile selector, and remembered profile choices by site. Shiira has no equivalent temporary-window workflow. | `src/main/little.ts`, `src/main/external-links.ts`, `src/renderer/src/little.tsx` |
| Advanced split layouts | YARC supports 2–4 panes, horizontal/vertical combinations and page-edge drag targets. Shiira supports two side-by-side tabs. | `src/shared/split.ts`, `src/main/browser.ts` |
| Shared multiwindow workspaces | YARC shares sidebar state while keeping each window's active space/tab/splits independent. Shiira windows have separate renderer state; only the first window owns sidebar persistence. | `src/main/window-state.ts`, `docs/multi-window.md` |
| MRU Ctrl+Tab switcher | YARC offers a switcher in most-recently-used order while holding Ctrl. Shiira cycles tabs in sidebar order. | `src/main/browser.ts` |
| More migration sources | YARC also imports Zen spaces/containers and Chrome, Edge and Brave bookmarks/history through a unified flow. Shiira's existing separate importer targets Chrome. | `src/main/importers/zen.ts`, `zen-session.ts`, `chromium.ts` |
| Guided Arc-style onboarding | YARC's tour responds to user actions while teaching its sidebar workflows. Shiira has first-run setup but no equivalent interactive tour. | `src/shared/tour.ts`, `src/renderer/src/panels/Intro.tsx` |

Boosts, Easels/Notes, and cross-device sync are not implemented in either compared codebase; they are not features to port from this YARC snapshot.

## Verification

`npm test` exercises the Arc parser, YARC's sanitized sample, copied folders, live-WAL SQLite history, source-file preservation, icons, history deduplication, command-bar site search/split/archive results, pinned-link routing and private preview promotion. Imported data is tested using fixtures and temporary profiles rather than modifying an installed Arc profile.

`npm run test:arc:electron` starts the real Electron main/preload/renderer with an isolated temporary profile and an ephemeral password-encryption key. It chooses a fixture through the native import bridge, verifies saved pinned tabs/archive/history and source-file preservation, and exercises Tab to Search in the real DOM. The runner removes its temporary profile after exit; results and an offscreen layout capture are written to the ignored `tmp/arc-smoke/` directory.
