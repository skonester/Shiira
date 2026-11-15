// Activity is observed in the isolated preload, without exposing a bridge to sites.
const { ipcRenderer } = require('electron');
const { installMediaController } = require('./media-controller');
const mediaController = installMediaController({ document, HTMLMediaElement, send: (...args) => ipcRenderer.sendToHost(...args) });
globalThis.__shiiraMediaControl = mediaController.control;
module.exports = mediaController;
let edited = false;
function onEdit(event) {
  if (edited || !event.isTrusted) return;
  edited = true;
  ipcRenderer.sendToHost('shiira-page-edited');
}
document.addEventListener('input', onEdit, true);
document.addEventListener('change', onEdit, true);
document.addEventListener('pointerdown', event => {
  if (event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) onEdit(event);
}, true);
document.addEventListener('keydown', event => {
  if (event.target?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') && !event.ctrlKey && !event.metaKey && (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key))) onEdit(event);
}, true);
