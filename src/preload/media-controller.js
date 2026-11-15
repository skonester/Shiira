// This controller stays in Electron's isolated preload world. Sites cannot call
// it or reach the video in Shiira's closed player shadow root.
function installMediaController({ document, HTMLMediaElement, send, now = Date.now }) {
  let custom = null, autoVideo = null, generation = 0, lastProgress = 0;
  const events = ['play', 'pause', 'ended', 'volumechange', 'durationchange', 'timeupdate', 'seeking', 'seeked'];
  const media = () => custom || [...document.querySelectorAll('video,audio')].find(m => !m.paused && !m.ended)
    || [...document.querySelectorAll('video,audio')].find(m => m.currentSrc);
  const inPip = video => video && (video.getRootNode?.().pictureInPictureElement === video || document.pictureInPictureElement === video);
  function report(event) {
    if (event && !(event.target instanceof HTMLMediaElement)) return;
    // Native YouTube events must not replace or delay the closed player's
    // state while it is registered. This bridge observes; Shaka owns buffering.
    if (custom && event && event.target !== custom) return;
    if (event?.type === 'timeupdate' && now() - lastProgress < 1000) return;
    const selected = media() || event?.target;
    if (!selected) return;
    lastProgress = now();
    send('shiira-media-state', { paused: selected.paused || selected.ended, muted: selected.muted,
      time: Number.isFinite(selected.currentTime) ? selected.currentTime : 0,
      duration: Number.isFinite(selected.duration) ? selected.duration : 0 });
  }
  function pip(event) {
    if (event.type === 'leavepictureinpicture' && autoVideo === event.target) autoVideo = null;
    send('shiira-page-pip', event.type === 'enterpictureinpicture');
  }
  for (const name of events) document.addEventListener(name, report, true);
  for (const name of ['enterpictureinpicture', 'leavepictureinpicture']) document.addEventListener(name, pip, true);
  async function exitAuto() {
    generation++;
    const old = autoVideo;
    autoVideo = null;
    if (inPip(old)) await document.exitPictureInPicture().catch(() => {});
    return true;
  }
  function register(video) {
    custom = video;
    generation++;
    for (const name of events) video.addEventListener(name, report);
    for (const name of ['enterpictureinpicture', 'leavepictureinpicture']) video.addEventListener(name, pip);
    return () => {
      if (custom === video) { custom = null; generation++; }
      if (autoVideo === video) void exitAuto();
      for (const name of events) video.removeEventListener(name, report);
      for (const name of ['enterpictureinpicture', 'leavepictureinpicture']) video.removeEventListener(name, pip);
      report();
    };
  }
  async function control(action, value = 0) {
    if (action === 'exit-auto-pip') return exitAuto();
    const selected = media();
    if (!selected) return false;
    if (action === 'auto-pip') {
      if (document.pictureInPictureElement || !document.pictureInPictureEnabled || selected.paused || selected.ended || selected.disablePictureInPicture || selected.readyState < 2 || !(selected.videoWidth > 100)) return false;
      const version = ++generation;
      try {
        await selected.requestPictureInPicture();
        if (version !== generation || selected !== media()) {
          if (inPip(selected)) await document.exitPictureInPicture().catch(() => {});
          return false;
        }
        autoVideo = selected;
        return true;
      } catch { return false; }
    }
    if (action === 'toggle') { if (selected.paused) await selected.play(); else selected.pause(); }
    if (action === 'pause') selected.pause();
    if (action === 'mute') selected.muted = !selected.muted;
    if (['seek', 'back', 'forward'].includes(action) && Number.isFinite(selected.duration)) {
      selected.currentTime = Math.max(0, Math.min(selected.duration, action === 'seek' ? value : selected.currentTime + (action === 'back' ? -10 : 10)));
    }
    report();
    return true;
  }
  return { register, control };
}
module.exports = { installMediaController };
