// Orbe's persistent-session-per-profile model, preserving Shiira's existing
// default partition so existing cookies and logins stay available.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const PROFILE = /^p-[a-f0-9]{32}$/;
const validProfile = id => id === 'default' || (typeof id === 'string' && PROFILE.test(id));
const partitionFor = id => id === 'default' ? 'persist:main' : validProfile(id) ? `persist:shiira-${id}` : null;
class ProfilesService {
  constructor() { this.profiles = [{ id: 'default', name: 'Default' }]; }
  initialize(file) {
    this.file = file;
    try {
      if (fs.statSync(file).size > 100000) return;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const seen = new Set(['default']);
      this.profiles.push(...saved.filter(p => p && PROFILE.test(p.id) && typeof p.name === 'string' && p.name.trim() && !seen.has(p.id) && seen.add(p.id)).slice(0, 19).map(p => ({ id: p.id, name: p.name.trim().slice(0, 60) })));
    } catch {}
  }
  list() { return this.profiles.map(p => ({ ...p, partition: partitionFor(p.id) })); }
  has(id) { return this.profiles.some(p => p.id === id); }
  create(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Enter a profile name.');
    if (this.profiles.length >= 20) throw new Error('The profile limit is 20.');
    const profile = { id: `p-${randomUUID().replaceAll('-', '')}`, name: name.trim().slice(0, 60) };
    const next = [...this.profiles, profile];
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next)); fs.renameSync(this.file + '.tmp', this.file);
    this.profiles = next;
    return { ...profile, partition: partitionFor(profile.id) };
  }
  rename(id, name) {
    if (id === 'default' || !this.has(id) || typeof name !== 'string' || !name.trim()) throw new Error('Choose a custom profile and enter a name.');
    const next = this.profiles.map(p => p.id === id ? { ...p, name: name.trim().slice(0, 60) } : p);
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next)); fs.renameSync(this.file + '.tmp', this.file); this.profiles = next;
    return this.list();
  }
}
module.exports = { ProfilesService, partitionFor, validProfile };
