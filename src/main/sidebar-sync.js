const { sanitize } = require('./spaces-service');
const merging = import('../shared/sidebar-merge.mjs');
class SidebarSync {
  constructor(store) { this.store = store; this.revision = 0; this.snapshots = new Map(); }
  current() {
    if (!this.snapshots.size) this.snapshots.set(0, this.store.load() || sanitize({
      focusedSpaceId: 'space-personal', spaces: [{ id: 'space-personal', title: 'Personal', icon: '🏠', color: '#7c6cf2', position: 0 }]
    }));
    return this.snapshots.get(this.revision);
  }
  load() { const doc = this.current(); return doc.spaces?.length ? { ...structuredClone(doc), revision: this.revision } : null; }
  async save(input, revision = 0) {
    this.current();
    if (!this.snapshots.has(revision)) return { success: false, conflict: true, error: 'The sidebar changed. Review the latest version and try again.', doc: this.load() };
    if (!input || Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024) return { success: false, error: 'The sidebar is too large.' };
    const base = this.snapshots.get(revision);
    const { mergeSidebar } = await merging;
    const clean = sanitize(mergeSidebar(base, sanitize(input), this.current()));
    const result = this.store.save(clean);
    if (!result.success) return result;
    this.snapshots.set(++this.revision, clean);
    if (this.snapshots.size > 32) this.snapshots.delete(this.snapshots.keys().next().value);
    return { success: true, doc: this.load() };
  }
}
module.exports = { SidebarSync };
