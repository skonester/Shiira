<p align="center">
  <img src="Shiira.png" width="128" height="128" alt="Shiira Logo" />
</p>

<p align="center">
  <img src="github.png" width="420" alt="Shiira Browser GitHub preview" />
</p>

# Shiira Browser <img src="GPL3.png" align="right" height="48" alt="GPLv3 Logo" />

Shiira is an Electron-based desktop browser inspired by the classic Shiira browser for Mac OS X. It combines a dark custom interface with practical browser features such as tab management, bookmarks, history, ad blocking, session restore, password storage, and an assistant sidebar. It is meant to function as a backup secondary browser.

The project is a modern homage rather than a port. It does not depend on original Shiira source code; the design direction is based on public descriptions of the original browser and its interface ideas.

## Highlights

- Dark custom browser chrome with the Shiira Night theme
- First-run welcome setup for theme and search engine choices
- Settings for home and startup behavior, appearance, search, downloads, site permissions, privacy, passwords, and updates
- Custom theme color wheel with color harmony, monochrome, texture, strength, and rotation controls
- Tabbed browsing with drag support, audio mute indicators, and lazy session restore
- Full-window Tab Expose view for switching between open tabs
- Drawer-style panels for bookmarks, history, cache controls, and RSS
- Bookmarks bar, favorites launcher, and Chrome bookmark import
- Search from the home view with Google, DuckDuckGo, Brave, and Wikipedia
- Native ad blocking with network and cosmetic filtering
- Passive, compatibility-safe filtering for YouTube and video-heavy sites
- Password manager with secure storage and CSV import
- Cache, cookie, and site storage cleanup tools
- Optional clear-on-exit cache behavior
- Built-in update checks and in-app installer flow

## Recent Changes (0.3.5)

Shiira now has an Arc-style vertical sidebar and Chrome extensions, both designed after [Solamar](https://github.com/Bambeek/solamar). The classic top tab bar is still available in Settings > Look and Feel.

- **Spaces**: separate sets of tabs, each with its own name, emoji and colour. The sidebar takes on the space's colour.
- **Favorites**: a grid of icons at the top of the sidebar, shared by every space.
- **Pinned tabs and folders**: kept across restarts. Closing a pinned tab only unloads it, and it returns to its pinned page.
- **Today tabs**: tabs you have not opened for 12 hours move to the Archive (Ctrl+Shift+A). You can change the time or turn this off.
- **Drag and drop**: reorder tabs, drop them on the favorites grid, into folders, or onto another space's icon.
- **Command bar** (Ctrl+T): open a site, search, jump to any tab or space, or run an action.
- **Split view**: two tabs side by side, with a divider you can drag.
- **Peek**: Shift+click a link to preview it over the page, then keep it as a tab or put it in split view.
- **Tab sleep**: tabs you are not using free their memory after 30 minutes and reload when opened.
- **Import from Arc**: brings over Arc's spaces, pinned tabs, folders and favorites. Arc's files are only read.
- **Chrome extensions**: add Manifest V3 extensions from the Chrome Web Store. Shiira shows what an extension can do before it is added, and its button appears next to the address bar. Manage or remove them in Settings > Extensions. Extensions never run in private tabs.
- **Ad blocker fix**: the full Ghostery engine failed to start ("second handler") and Shiira fell back to its small bundled rule list, while YouTube's blocking scripts ran several times per page and broke parts of YouTube. Ghostery now runs on the tabs' session only, and each blocking script runs once per page.

## Previous Changes (0.3.4)

- Expanded Settings with Zenium-inspired sections for startup, downloads, search suggestions, site permissions, browsing data, passwords, and updates.
- Added persistent download folder, save prompt, and automatic update check preferences.
- Added configurable Home button destination and a choice to restore tabs on startup.

## Previous Changes (0.3.2)

- Fixed the default YouTube playback breakage caused by aggressive site-specific script injection.
- Removed the custom DOM/player hacks that were causing black screens and anti-adblock detection triggers.
- Simplified startup so the browser opens quickly without waiting on slower background services.
- Removed the duplicate startup window initialization that created the extra Electron window.
- Bumped the app version and ensured the About panel can trigger a real app update check from the browser UI.
- Updated the app update flow so the check-for-updates action in the About panel reports status and can download/install updates.

## Shiira-Inspired Features

| Feature | Current status |
| --- | --- |
| Tabbed windows | Implemented |
| Bookmark management | Implemented |
| Side drawer for bookmarks and history | Implemented as Shiira palettes |
| Bookmarks toolbar | Implemented |
| Search field with selectable search engine | Implemented |
| Cache control panel | Implemented in the Cache palette |
| Remove cookies and cache at termination | Implemented as a Cache palette toggle |
| Window appearance switching | Implemented as themes |
| Favicons | Implemented |
| Searchable history | Implemented |
| Safari bookmark sharing | Not implemented; Chrome import is available |
| Toolbar customization and toolbar icon switching | Not implemented |
| Favicon list and per-bookmark favicon toggle | Not implemented |
| Help document | Not implemented |
| Multiple source windows and HTTP header source view | Not implemented |
| Wheel-button tab operations | Not implemented |
| Auto-tab for bookmark folders | Not implemented |
| Back/forward list on toolbar buttons | Not implemented |

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+T` | Command bar (sidebar layout) or new tab (top tabs layout) |
| `Ctrl+W` | Close tab (pinned tabs and favorites unload) |
| `Ctrl+S` | Hide or show the sidebar |
| `Ctrl+D` | Pin or unpin tab |
| `Ctrl+Shift+\` | Split view with the next tab |
| `Ctrl+Shift+A` | Archived tabs |
| `Ctrl+Shift+C` | Copy page address |
| `Ctrl+Shift+N` | New private tab |
| `Alt+1`…`Alt+9` | Go to space 1–9 |
| `Ctrl+Alt+Left` / `Ctrl+Alt+Right` | Previous / next space |
| `Shift+click` a link | Open it in Peek |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+L` | Focus URL bar |
| `Ctrl+R` / `F5` | Reload |
| `Ctrl+Shift+R` | Hard reload |
| `Alt+Left` | Back |
| `Alt+Right` | Forward |
| `Ctrl+H` | History |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+B` | Toggle bookmarks bar |
| `Ctrl+Shift+E` | Tab Expose |
| `Ctrl+Shift+I` | Developer tools |
| `Escape` | Close popups and panels |

## Development

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run dev
```

## Build

Create a production build:

```bash
npm run build
```

Platform-specific builds are also available:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Build artifacts are written to `dist/`.

## Project Structure

```text
src/main/                 Main Electron process and services
src/preload/              Secure IPC bridge
src/renderer/             Browser UI
src/renderer/modules/     Browser feature modules
assets/                   App artwork, UI icons, and site logos
filter-lists/             Ad-blocking rules
build/                    Build hooks and installer assets
installer/                Installer UI
```

## License

Shiira Browser is licensed under **GPL-3.0-only**.

The original Shiira project was released under **BSD-3-Clause**. This project is an independent Electron implementation and homage, with no original Shiira source code included.

For copyright attributions, project background, and dependency licensing details, see [credits.md](credits.md).
