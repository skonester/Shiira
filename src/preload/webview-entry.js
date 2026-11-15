require('./scira-search');
const mediaController = require('./page-activity');
const { isYouTubeUrl } = require('../shared/youtube');
if (window.top === window && isYouTubeUrl(window.location.href)) {
  const { ipcRenderer } = require('electron');
  const shaka = require('shaka-player/dist/shaka-player.compiled.js');
  const { installPlayer } = require('./youtube-player');
  const { createPlaybackAnalytics } = require('./youtube-analytics');
  installPlayer({ ipcRenderer, shaka, window, document, registerMedia: mediaController.register, createAnalytics: createPlaybackAnalytics });
}
