<p align="center">
  <img src="assets/shiira.png" width="128" height="128" alt="Shiira Logo" />
</p>

# Shiira Browser <img src="GPL3.png" align="right" height="48" alt="GPLv3 Logo" />

A super dark Electron browser inspired by the classic **Shiira** project for Mac OS X.

This rebrand keeps the project's practical, high-performance browser foundation and meticulously turns the user interface chrome into a premium, state-of-the-art **Shiira** homage:

- **The Colors of the Deep**: Inspired by the original browser's namesake (the Mahi-mahi or "Shiira" in Japanese), the interface shines with a stunning custom-tailored dark color palette:
  - **Cyan Surf Accent (`#28d7ef`)**: Reflects glowing tropical waters, highlighting focus states, active borders, and primary navigation actions.
  - **Luminous Violet Hover (`#b85cff`)**: Recreates the shimmery deep-water effect, showing up during user interactions and button hover transitions.
  - **Hot-Pink Fins (`#ff4d9f`)**: Adds a vibrant, energetic visual touch, indicating alerts, warnings, and special tab states (like private browsing tabs).
- **Atmospheric Glassmorphism**: High-end frosted glass overlays (`rgba(8, 10, 22, 0.76)`) and dual glowing radial gradients (cyan glow at the top-left, violet glow at the top-right) blend into a deep black background, making the browser chrome feel responsive, premium, and alive.
- **Fluid Motion & Cascades**:
  - Tab switching and operations use smooth sliding animations (`slideUp` and `slideDown`).
  - Autocomplete search suggestions cascade downwards gracefully with incremental delays (`0ms` to `225ms`), ensuring a premium tactile feel.

## Shiira Homage

- **Tab Expose** - View every open tab as a full-window grid, inspired by Shiira's Tab Expose feature.
- **Page-turn motion** - Navigating and switching tabs uses a quick page-turn transition as a nod to Shiira 1.x.
- **Palette drawer** - Bookmarks, History, Cache, and RSS live in a left-side drawer inspired by Shiira's customizable drawer/palette UI.
- **Many search engines** - The home search supports Google, DuckDuckGo, Brave, and Wikipedia, echoing Shiira's multi-engine toolbar search.
- **Thumbnail-style tabs** - The Expose view gives each tab a visual preview panel for faster selection.
- **Cache controls** - Clear cache, cookies, and site storage from the Shiira drawer, with an optional clear-on-exit mode.

## Original Feature Parity

The final original Shiira 2.3 listing called out these everyday browsing features. Current status:

| Original Shiira feature                             | Status in this build                          |
| --------------------------------------------------- | --------------------------------------------- |
| Tabbed windows                                      | Implemented                                   |
| Bookmark management                                 | Implemented                                   |
| Side drawer showing bookmarks and history           | Implemented as Shiira palettes                |
| Bookmarks toolbar                                   | Implemented                                   |
| Search field with choice of search engine           | Implemented                                   |
| Cache control panel                                 | Implemented in the Cache palette              |
| Removing cookies and cache at termination           | Implemented as a Cache palette toggle         |
| Window appearance switching                         | Implemented as themes                         |
| Displaying favicons                                 | Implemented                                   |
| Search text field for history                       | Implemented                                   |
| Sharing bookmarks with Safari                       | Not implemented; Chrome import exists instead |
| Customizing toolbar and toolbar icon switching      | Not implemented                               |
| Favicon list and per-bookmark favicon toggle        | Not implemented                               |
| Help document                                       | Not implemented                               |
| Multiple source windows and HTTP header source view | Not implemented                               |
| Wheel button tab operations                         | Not implemented                               |
| Auto-tab for bookmark folders                       | Not implemented                               |
| Back-forward list on toolbar buttons                | Not implemented                               |

## Features

- Native ad blocker with network and cosmetic filtering
- Password manager with secure storage and CSV import
- History and bookmarks management
- Favorites launcher
- Session restore with lazy tab loading
- AI assistant sidebar
- Custom themes, now led by **Shiira Night**
- Custom titlebar, tab dragging, audio mute indicators, and update checks

## Shortcuts

| Shortcut         | Action                  |
| ---------------- | ----------------------- |
| `Ctrl+T`         | New tab                 |
| `Ctrl+W`         | Close tab               |
| `Ctrl+Shift+T`   | Reopen closed tab       |
| `Ctrl+Tab`       | Next tab                |
| `Ctrl+Shift+Tab` | Previous tab            |
| `Ctrl+L`         | Focus URL bar           |
| `Ctrl+R` / `F5`  | Reload                  |
| `Ctrl+Shift+R`   | Hard reload             |
| `Alt+Left`       | Back                    |
| `Alt+Right`      | Forward                 |
| `Ctrl+H`         | History                 |
| `Ctrl+Shift+B`   | Toggle bookmarks bar    |
| `Ctrl+Shift+E`   | Tab Expose              |
| `Ctrl+Shift+I`   | Developer tools         |
| `Escape`         | Close popups and panels |

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run build:win
npm run build:mac
npm run build:linux
```

## Project Structure

```text
src/main/                 Main Electron process and services
src/preload/              Secure IPC bridge
src/renderer/             Browser UI
src/renderer/modules/     Browser feature modules
assets/                   App artwork, UI icons, and site logos
filter-lists/             Ad-blocking rules
build/                    Build hooks and installer assets
```

## License

Shiira Browser is licensed under **GPL-3.0-only**.

The original Shiira project was published under **BSD-3-Clause**. This reimagined Electron codebase now transitions to GPLv3 for future changes and redistribution. No original Shiira source code is required for this rebrand; the homage is based on public feature descriptions and visual direction.

For full copyright attributions, developer biography, historical background, and detailed dependency licensing, please see the [credits.md](credits.md) file.
