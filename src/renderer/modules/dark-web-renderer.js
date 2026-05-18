// Forces loaded web content into Shiira's super-dark rendering mode.

import { isInternalUrl } from './utils.js';

const BASE_DARK_CSS = `
  :root {
    color-scheme: dark !important;
  }

  html,
  body {
    background: #000 !important;
  }

  input,
  textarea,
  select,
  button {
    color-scheme: dark !important;
  }
`;

const YOUTUBE_DARK_CSS = `
  :root {
    color-scheme: dark !important;
  }

  html,
  body,
  ytd-app,
  #page-manager,
  #content {
    background: #000 !important;
  }

  #movie_player,
  .html5-video-player,
  .html5-video-container,
  .ytp-player-content,
  video {
    background: #000 !important;
    filter: none !important;
    opacity: 1 !important;
    mix-blend-mode: normal !important;
  }

  ytd-watch-flexy,
  ytd-watch-metadata,
  ytd-comments,
  ytd-playlist-panel-renderer,
  ytd-engagement-panel-section-list-renderer {
    background: #000 !important;
  }
`;

const DARK_READER_OPTIONS = {
  brightness: 100,
  contrast: 96,
  sepia: 4,
  darkSchemeBackgroundColor: '#000000',
  darkSchemeTextColor: '#eaf6ff',
  lightSchemeBackgroundColor: '#000000',
  lightSchemeTextColor: '#eaf6ff',
  selectionColor: '#28d7ef',
  scrollbarColor: '#070a16',
  styleSystemControls: true
};

export const DarkWebRendererMixin = {
  initDarkWebRenderer() {
    this.darkReaderScript = null;
    this.darkReaderScriptPromise = null;
  },

  async getDarkReaderScript() {
    if (this.darkReaderScript) {
      return this.darkReaderScript;
    }

    if (!this.darkReaderScriptPromise) {
      this.darkReaderScriptPromise = window.shiiraAPI.darkMode.getDarkReaderScript()
        .then(result => {
          if (!result?.success || !result.script) {
            throw new Error(result?.error || 'Dark Reader script unavailable');
          }
          this.darkReaderScript = result.script;
          return result.script;
        })
        .catch(error => {
          this.darkReaderScriptPromise = null;
          throw error;
        });
    }

    return this.darkReaderScriptPromise;
  },

  async injectForcedDarkMode(webview, url) {
    if (!webview || !url || isInternalUrl(url) || url === 'about:blank') {
      return;
    }

    try {
      if (this.isYouTubeUrl(url)) {
        await webview.insertCSS(YOUTUBE_DARK_CSS);
        await webview.executeJavaScript(`
          (() => {
            if (window.DarkReader?.isEnabled?.()) {
              window.DarkReader.disable();
            }
            window.__shiiraDarkReaderEnabled = false;
            document.documentElement.dataset.shiiraForcedDark = 'youtube-safe';
            document.documentElement.style.backgroundColor = '#000';
            document.body && (document.body.style.backgroundColor = '#000');
          })();
        `, true);
        return;
      }

      await webview.insertCSS(BASE_DARK_CSS);

      const darkReaderScript = await this.getDarkReaderScript();
      const enableDarkReader = `
        (() => {
          if (!window.DarkReader) {
            ${darkReaderScript}
          }

          if (window.DarkReader && !window.__shiiraDarkReaderEnabled) {
            window.DarkReader.enable(${JSON.stringify(DARK_READER_OPTIONS)});
            window.__shiiraDarkReaderEnabled = true;
          }

          document.documentElement.dataset.shiiraForcedDark = 'true';
          document.documentElement.style.backgroundColor = '#000';
          document.body && (document.body.style.backgroundColor = '#000');
        })();
      `;

      await webview.executeJavaScript(enableDarkReader, true);
    } catch (error) {
      console.warn('[Dark Mode] Failed to inject forced dark renderer:', error);
    }
  },

  isYouTubeUrl(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
    } catch (e) {
      return false;
    }
  }
};
