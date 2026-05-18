# Credits & Attributions

This document credits the contributors, historical creators, and underlying libraries of the modern **Shiira Browser**.

---

## Modern Project Summary & Licensing

The modern **Shiira Browser** is a fully Electron-based web browser reimagining and homage to the classic Mac OS X Shiira web browser.

* **Core Shell & Execution Engine**: Developed on top of **Electron**, **Chromium**, and **Node.js**.
* **Modern Codebase License**: The reimagined Electron repository and all its modern, functional browser modules are released under the **GNU General Public License v3 (GPL-3.0-only)**.

---

## Forgeworks Interactive Limited Attribution (MIT License)

Custom additions, branding themes (such as **Shiira Night**), specific visual assets, and tailored Electron window styles are designed and maintained by **Forgeworks Interactive Limited**. These specific contributions and tailored assets are released under the terms of the **MIT License**.

```text
MIT License

Copyright (c) 2026 Forgeworks Interactive Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Historical Roots: The Original Shiira Browser

This modern project stands as a dedicated homage to the classic, open-source **Shiira** browser, which was originally developed for Apple's Mac OS X.

### Who is Makoto Kinoshita?
The original Shiira web browser was created and primarily developed by **Makoto Kinoshita** alongside members of the **Shiira Project**.

* **Identity & Background**: Makoto Kinoshita is a highly respected Japanese software developer, author, and UI/UX expert. He is the founder and president of **HMDT Co., Ltd.**, a software design and engineering firm based in Japan that specializes in iOS, macOS, and Android application development.
* **Influence in the Apple Developer Community**: Within the Japanese macOS and iOS developer community, Kinoshita is a prominent figure. He has authored multiple popular technical books and educational guides on Objective-C, Cocoa, and iOS application development, helping train a generation of Japanese developers.
* **The Shiira Vision**: In 2004, Kinoshita launched the open-source Shiira Project to create a highly flexible, lightweight, and customizable web browser built natively in Cocoa using Apple's WebKit rendering engine. Shiira was built as a modern, feature-rich alternative to Safari, pioneering features that we replicate in our modern homage:
  * **Tab Expose**: A full-window visual grid of all active tabs, allowing users to quickly see and navigate between open pages.
  * **Palette Drawer**: A customizable sidebar drawer containing bookmarked folders, history search, web feeds (RSS), and cache tools.
  * **Tailored Aesthetics**: Comprehensive window themes and custom appearances, allowing users to style the frame.

### Original Shiira Project License (BSD-3-Clause)
The historical Shiira browser was released under the **3-Clause BSD License**. We preserve and acknowledge their licensing terms here for historical continuity and legal integrity:

```text
Copyright © Shiira Project. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of Shiira Project nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY SHIIRA PROJECT "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL SHIIRA PROJECT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Dependency & Third-Party Library Credits

Our modern browser shell utilizes the following open-source frameworks and dependencies:

| Dependency | Purpose | License |
| :--- | :--- | :--- |
| [Electron](https://github.com/electron/electron) | Cross-platform desktop application framework | MIT |
| [Chromium](https://www.chromium.org/Home) | High-performance browser rendering engine | BSD / Various |
| [Node.js](https://github.com/nodejs/node) | JavaScript backend runtime | MIT / Custom |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | High-speed SQLite3 bindings for historical/settings storage | MIT |
| [darkreader](https://github.com/darkreader/darkreader) | Real-time dark mode styles for web content | MIT |
| [electron-log](https://github.com/megahertz/electron-log) | Diagnostic logging utility | MIT |
| [electron-updater](https://github.com/develar/electron-updater) | Seamless over-the-air app updates | MIT |
| [electron-widevinecdm](https://github.com/castlabs/electron-widevinecdm) | Widevine DRM helper for streaming media | MIT |
| [keytar](https://github.com/atom/node-keytar) | Integration with native credential storage (Keychain, Credential Manager) | MIT |
| [three](https://github.com/mrdoob/three.js) | Three.js WebGL library for aesthetic background visual effects | MIT |
| [jimp](https://github.com/jimp-dev/jimp) | Image manipulation utility for processing custom icons | MIT |
| [rcedit](https://github.com/electron/rcedit) | Native executable modification utility for Windows | MIT |
