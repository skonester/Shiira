require('./scira-search');
const { isYouTubeUrl } = require('../shared/youtube');
if (window.top === window && isYouTubeUrl(window.location.href)) {
  const { ipcRenderer } = require('electron');
  const shaka = require('shaka-player/dist/shaka-player.compiled.js');
  const { installPlayer } = require('./youtube-player');
  installPlayer({ ipcRenderer, shaka, window, document });
}
