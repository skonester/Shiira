// Local event-sink compatibility for FastPix's MIT Shaka adapter. No cloud SDK,
// cookies, viewer identifiers, HTTP requests or beacons are used here.
const monitors = new Map();
let sequence = 0;
const utilityMethods = {
  now: () => Date.now(),
  generateIdToken: () => `local-${++sequence}`,
  convertSecToMs: seconds => seconds * 1000,
  fetchHost: () => undefined,
  identifyStreamingProtocol: () => undefined, // The opaque URI carries no protocol; main supplies it.
  buildRenditionName: (width, height, hdr) => width && height ? `${width}x${height}${hdr ? ` ${hdr}` : ''}` : undefined,
  measureBufferLength(video) {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
        return (video.buffered.end(i) - video.currentTime) * 1000;
      }
    }
    return 0;
  },
  observeViewability: () => ({ readState: () => ({}), disconnect() {} })
};
module.exports = {
  utilityMethods,
  configure(token, options) { monitors.set(token, options); },
  dispatch(token, event, data = {}) {
    const options = monitors.get(token);
    if (!options) return;
    try {
      options.onEvent({ event, playheadMs: options.fetchPlayheadTime(),
        state: options.fetchStateData(), data });
    } catch { /* Analytics must never interrupt playback or a network response. */ }
    if (event === 'destroy') monitors.delete(token);
  }
};
