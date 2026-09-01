// Forces loaded web content into Shiira's super-dark rendering mode.

import { isInternalUrl } from './utils.js';

const BASE_DARK_CSS = `
  :root {
    color-scheme: dark !important;
  }

  html,
  body {
    background: #020308 !important;
  }

  input,
  textarea,
  select,
  button {
    color-scheme: dark !important;
  }
`;

const MEDIA_SAFE_DARK_CSS = `
  ${BASE_DARK_CSS}

  :where(
    img,
    picture,
    video,
    canvas,
    svg,
    iframe,
    object,
    embed,
    source,
    [style*="background-image"],
    [style*="--background-image"],
    [data-click-id="media"],
    [data-testid*="post-media"],
    [data-testid*="image"],
    [slot="post-media-container"],
    .media-lightbox-img,
    .media-element,
    .preview,
    .ImageBox-image,
    .shreddit-post-media
  ) {
    filter: none !important;
    opacity: 1 !important;
    mix-blend-mode: normal !important;
    background-blend-mode: normal !important;
    isolation: auto !important;
  }
`;

const REDDIT_DARK_CSS = `
  ${MEDIA_SAFE_DARK_CSS}

  shreddit-app,
  faceplate-batch,
  reddit-feed,
  shreddit-post,
  shreddit-comment-tree,
  shreddit-comment,
  shreddit-feed,
  faceplate-partial,
  main,
  aside,
  header,
  nav,
  section,
  article {
    color-scheme: dark !important;
  }

  body,
  shreddit-app,
  reddit-feed {
    background: #020308 !important;
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
    background: #020308 !important;
  }

  #movie_player,
  .html5-video-player,
  .html5-video-container,
  .ytp-player-content,
  .ytp-player-content *,
  ytd-player,
  #player,
  #player-container,
  #player-container-inner,
  #player-container-outer,
  #player-container ytd-player,
  #player-container img,
  #player-container canvas,
  #player-container svg,
  .ytp-videowall-still-image,
  .ytp-cued-thumbnail-overlay-image,
  img,
  picture,
  canvas,
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
    background: #020308 !important;
  }
`;

const SITE_MEDIA_GUARD_SCRIPT = `
  (() => {
    const styleId = 'shiira-media-safety-guard';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = ${JSON.stringify(MEDIA_SAFE_DARK_CSS)};
      document.documentElement.appendChild(style);
    }

    const mediaSelector = [
      'img',
      'picture',
      'video',
      'canvas',
      'svg',
      'iframe',
      'object',
      'embed',
      '[style*="background-image"]',
      '[style*="--background-image"]',
      '[data-click-id="media"]',
      '[data-testid*="post-media"]',
      '[data-testid*="image"]',
      '[slot="post-media-container"]'
    ].join(',');

    const protect = root => {
      const nodes = root?.querySelectorAll ? root.querySelectorAll(mediaSelector) : [];
      for (const node of nodes) {
        node.style.setProperty('filter', 'none', 'important');
        node.style.setProperty('opacity', '1', 'important');
        node.style.setProperty('mix-blend-mode', 'normal', 'important');
        node.style.setProperty('background-blend-mode', 'normal', 'important');
      }
    };

    protect(document);

    if (!window.__shiiraMediaGuardObserver) {
      window.__shiiraMediaGuardObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) protect(node);
          }
        }
      });
      window.__shiiraMediaGuardObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  })();
`;

const REDDIT_DARK_SCRIPT = `
  (() => {
    window.__shiiraDarkReaderEnabled = false;
    if (window.DarkReader?.isEnabled?.()) window.DarkReader.disable();

    document.documentElement.dataset.shiiraForcedDark = 'reddit-safe';
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.style.backgroundColor = '#020308';
    if (document.body) {
      document.body.style.colorScheme = 'dark';
      document.body.style.backgroundColor = '#020308';
    }

    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('reddit-theme', 'dark');
      localStorage.setItem('reddit-web-client-theme', 'dark');
    } catch (error) {}

    ${SITE_MEDIA_GUARD_SCRIPT}
  })();
`;

const YOUTUBE_DARK_SCRIPT = `
  (() => {
    window.__shiiraDarkReaderEnabled = false;
    if (window.DarkReader?.isEnabled?.()) window.DarkReader.disable();

    document.documentElement.dataset.shiiraForcedDark = 'youtube-safe';
    document.documentElement.setAttribute('dark', '');
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.style.backgroundColor = '#020308';
    if (document.body) {
      document.body.style.colorScheme = 'dark';
      document.body.style.backgroundColor = '#020308';
    }

    const app = document.querySelector('ytd-app');
    if (app) app.setAttribute('dark', '');

    try {
      localStorage.setItem('yt-player-theme', 'dark');
      localStorage.setItem('youtube-theme', 'dark');
    } catch (error) {}

    const styleId = 'shiira-youtube-media-safety';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = ${JSON.stringify(YOUTUBE_DARK_CSS)};
      document.documentElement.appendChild(style);
    }

    ${SITE_MEDIA_GUARD_SCRIPT}
  })();
`;

const DARK_READER_OPTIONS = {
  engine: 'dynamicTheme',
  brightness: 100,
  contrast: 100,
  sepia: 0,
  darkSchemeBackgroundColor: '#020308',
  darkSchemeTextColor: '#e2ebf0',
  lightSchemeBackgroundColor: '#020308',
  lightSchemeTextColor: '#e2ebf0',
  selectionColor: '#28d7ef',
  scrollbarColor: '#080a16',
  styleSystemControls: true
};

const DARK_READER_MEDIA_SAFE_OPTIONS = {
  ...DARK_READER_OPTIONS,
  brightness: 100,
  contrast: 100,
  ignoreImageAnalysis: true,
  ignoreInlineStyle: [
    'img',
    'picture',
    'video',
    'canvas',
    'svg',
    '[style*="background-image"]',
    '[data-click-id="media"]',
    '[data-testid*="post-media"]',
    '[slot="post-media-container"]'
  ]
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
      // Do not force dark-mode or any player manipulation on YouTube or adult-video sites.
      // Those pages rely on their own player runtime and DOM state; custom rewrites blank the player.
      if (this.isYouTubeUrl(url) || this.isAdultVideoUrl(url)) {
        return;
      }

      if (this.isRedditUrl(url)) {
        await webview.insertCSS(REDDIT_DARK_CSS);
        await webview.executeJavaScript(REDDIT_DARK_SCRIPT, true);
        return;
      }

      const mediaSafeSite = this.isMediaSafeUrl(url);
      await webview.insertCSS(mediaSafeSite ? MEDIA_SAFE_DARK_CSS : BASE_DARK_CSS);

      const darkReaderScript = await this.getDarkReaderScript();
      const darkReaderOptions = mediaSafeSite ? DARK_READER_MEDIA_SAFE_OPTIONS : DARK_READER_OPTIONS;
      const enableDarkReader = `
        (() => {
          if (!window.DarkReader) {
            ${darkReaderScript}
          }

          if (window.DarkReader && !window.__shiiraDarkReaderEnabled) {
            window.DarkReader.enable(${JSON.stringify(darkReaderOptions)});
            window.__shiiraDarkReaderEnabled = true;
          }

          document.documentElement.dataset.shiiraForcedDark = 'true';
          document.documentElement.style.backgroundColor = '#020308';
          document.body && (document.body.style.backgroundColor = '#020308');

          ${mediaSafeSite ? SITE_MEDIA_GUARD_SCRIPT : ''}
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
  },

  isAdultVideoUrl(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const normalized = hostname.replace(/^www\./, '');
      return [
        'pornhub.com',
        'www.pornhub.com',
        'xvideos.com',
        'xnxx.com',
        'redtube.com',
        'youporn.com',
        'tube8.com'
      ].includes(normalized) || normalized.endsWith('.pornhub.com');
    } catch (e) {
      return false;
    }
  },

  isMediaSafeUrl(url) {
    return this.isRedditUrl(url);
  },

  isRedditUrl(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname === 'reddit.com' ||
        hostname.endsWith('.reddit.com') ||
        hostname === 'redd.it' ||
        hostname.endsWith('.redd.it') ||
        hostname === 'redditmedia.com' ||
        hostname.endsWith('.redditmedia.com');
    } catch (e) {
      return false;
    }
  }
};
