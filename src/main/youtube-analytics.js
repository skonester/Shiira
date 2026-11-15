const { randomUUID } = require('node:crypto');
const { cleanPacket, numbers } = require('../shared/youtube-analytics');

class PlaybackAnalyticsStore {
  constructor({ now = Date.now, limit = 30 } = {}) { this.now = now; this.limit = limit; this.sessions = new Map(); }
  start({ ownerId, hostId, videoId, privateMode = false }) {
    const id = randomUUID();
    this.sessions.set(id, { ownerId, hostId, sequence: 0, sourceUri: null,
      report: { schemaVersion: 1, id, videoId, privateMode,
        integration: { adapter: '@fastpix/video-data-shakaplayer', version: '1.0.7', sink: 'local' },
        startedAt: new Date(this.now()).toISOString(),
        phase: 'loading', metrics: {}, state: {}, sources: [], events: [], samples: [],
        transport: { requests: 0, httpAttempts: 0, completed: 0, failed: 0, cancelled: 0, bytes: 0, durationMs: 0, httpStatuses: {}, formats: {}, recent: [] } } });
    while (this.sessions.size > this.limit) this.sessions.delete(this.sessions.keys().next().value);
    return id;
  }
  source(id, source, uri) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.sourceUri = uri;
    session.sourceCount = (session.sourceCount || 0) + 1;
    session.report.sources.push({ client: source.client, protocol: source.kind, live: !!source.live,
      atMs: this.age(session), attempt: session.sourceCount });
    if (session.report.sources.length > 20) session.report.sources.shift();
  }
  age(session) { return Math.max(0, this.now() - Date.parse(session.report.startedAt)); }
  ingest(id, uri, input) {
    const session = this.sessions.get(id), packet = cleanPacket(input);
    if (!session || session.report.endedAt || session.sourceUri !== uri || !packet || packet.sequence <= session.sequence) return false;
    session.sequence = packet.sequence;
    const report = session.report;
    Object.assign(report, { phase: packet.phase, metrics: packet.metrics, state: packet.state, updatedAt: new Date(this.now()).toISOString() });
    report.events.push(...packet.events);
    report.events = report.events.slice(-400);
    report.samples.push({ atMs: this.age(session), phase: packet.phase, ...packet.state });
    report.samples = report.samples.slice(-180);
    return true;
  }
  transport(id, input) {
    const session = this.sessions.get(id);
    if (!session || session.report.endedAt) return;
    const outcome = ['completed', 'failed', 'cancelled'].includes(input.outcome) ? input.outcome : 'failed';
    const record = { atMs: this.age(session), outcome,
      ...numbers(input, ['status', 'bytes', 'durationMs', 'rangeStart', 'rangeEnd', 'itag']) };
    if (['GET', 'POST'].includes(input.method)) record.method = input.method;
    if (['dash', 'hls'].includes(input.protocol)) record.protocol = input.protocol;
    record.httpAttempts = Array.isArray(input.httpAttempts) ? input.httpAttempts.slice(0, 12)
      .filter(attempt => Number.isInteger(attempt.status) && attempt.status >= 100 && attempt.status <= 599 && ['GET', 'POST'].includes(attempt.method))
      .map(attempt => ({ method: attempt.method, ...numbers(attempt, ['status', 'headersMs']) })) : [];
    const stats = session.report.transport;
    stats.requests++; stats[outcome]++;
    stats.bytes += record.bytes || 0; stats.durationMs += record.durationMs || 0;
    stats.httpAttempts += record.httpAttempts.length;
    const statuses = record.httpAttempts.length ? record.httpAttempts.map(attempt => attempt.status) : [record.status].filter(Boolean);
    for (const status of statuses) stats.httpStatuses[status] = (stats.httpStatuses[status] || 0) + 1;
    const key = String(record.itag ?? 'playlist');
    if (Object.hasOwn(stats.formats, key) || Object.keys(stats.formats).length < 40) {
      const format = stats.formats[key] ||= { completed: 0, failed: 0, cancelled: 0, bytes: 0 };
      format[outcome]++; format.bytes += record.bytes || 0;
    }
    stats.recent.push(record); stats.recent = stats.recent.slice(-150);
  }
  end(id, reason = 'navigation') {
    const session = this.sessions.get(id);
    if (!session || session.report.endedAt) return;
    Object.assign(session.report, { endedAt: new Date(this.now()).toISOString(), endReason: reason });
  }
  get(id) { const session = this.sessions.get(id); return session ? structuredClone(session.report) : null; }
  list(hostId) {
    return [...this.sessions.values()].filter(session => session.hostId === hostId).map(({ report }) => ({
      id: report.id, videoId: report.videoId, phase: report.phase, privateMode: report.privateMode,
      startedAt: report.startedAt, endedAt: report.endedAt, metrics: { ...report.metrics } }));
  }
  belongsTo(id, hostId) { return this.sessions.get(id)?.hostId === hostId; }
}
module.exports = { PlaybackAnalyticsStore };
