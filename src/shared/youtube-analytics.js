// Shared allowlists: page strings, error.data, URLs, headers and cookies never
// enter the local reports, even if an IPC payload includes extra properties.
const METRICS = ['observedMs', 'startupMs', 'watchMs', 'rebufferCount', 'rebufferMs', 'seekCount',
  'seekCompleted', 'seekMs', 'seekPendingMs', 'sourceLoads', 'recoveries', 'errorCount',
  'criticalErrorCount', 'variantChanges', 'upshifts', 'downshifts'];
const STATE = ['time', 'duration', 'bufferAheadMs', 'width', 'height', 'frames', 'droppedFrames',
  'bandwidth', 'audioBandwidth', 'estimatedBandwidth', 'frameRate', 'readyState', 'playbackRate', 'liveLatency'];
const TEXT = ['videoCodec', 'audioCodec', 'language', 'hdr'];
const PHASES = new Set(['loading', 'playing', 'paused', 'seeking', 'buffering', 'recovering', 'failed', 'ended', 'stopped']);
const EVENTS = new Set(['play', 'pause', 'playing', 'seeking', 'seeked', 'stalled', 'waiting', 'ended',
  'ratechange', 'volumechange', 'playerReady', 'variantChanged', 'loadstart', 'loaded', 'recovery',
  'first_frame', 'error', 'failed', 'stopped']);
function numbers(input, keys, max = 1e15) {
  const output = {};
  for (const key of keys) if (Number.isFinite(input?.[key]) && input[key] >= 0 && input[key] <= max) output[key] = input[key];
  return output;
}
function cleanState(input) {
  const output = numbers(input, STATE);
  for (const key of TEXT) if (typeof input?.[key] === 'string' && /^[\w .,+-]{0,100}$/.test(input[key])) output[key] = input[key];
  for (const key of ['paused', 'seeking', 'muted', 'failed']) if (typeof input?.[key] === 'boolean') output[key] = input[key];
  for (const key of ['buffered', 'seekable']) if (Array.isArray(input?.[key])) {
    output[key] = input[key].slice(0, 16).filter(range => Array.isArray(range) && range.length === 2 &&
      range.every(value => Number.isFinite(value) && value >= 0 && value < 1e12) && range[1] >= range[0]);
  }
  return output;
}
function cleanEvent(input) {
  if (!EVENTS.has(input?.event) || !Number.isFinite(input.atMs) || input.atMs < 0) return null;
  const output = { event: input.event, ...numbers(input, ['atMs', 'time', 'code', 'category', 'severity', 'httpStatus', 'from', 'to', 'durationMs', 'width', 'height', 'frames']) };
  if (typeof input.handled === 'boolean') output.handled = input.handled;
  if (['attach', 'load', 'playback'].includes(input.phase)) output.phase = input.phase;
  return output;
}
function cleanPacket(input) {
  if (!Number.isSafeInteger(input?.sequence) || input.sequence < 1 || !PHASES.has(input.phase)) return null;
  return { sequence: input.sequence, phase: input.phase, metrics: numbers(input.metrics, METRICS),
    state: cleanState(input.state), events: Array.isArray(input.events) ? input.events.slice(0, 100).map(cleanEvent).filter(Boolean) : [] };
}
module.exports = { METRICS, STATE, PHASES, numbers, cleanState, cleanEvent, cleanPacket };
