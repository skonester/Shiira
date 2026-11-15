// Site/path matching adapted from Orbe's prefs.js (MIT). Ports and path segment
// boundaries are explicit; source URLs never match by substring.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function webUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f]/.test(value)) return null;
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
function routeRule(text) {
  if (typeof text !== 'string') return null;
  let value = text.trim();
  if (!value || value.length > 200 || /[\s\\@?#]/.test(value)) return null;
  value = value.replace(/^https?:\/\//i, '').replace(/^\*\./, '');
  if (value.includes('://')) return null;
  try {
    const url = new URL('https://' + value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host || !/^(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:.]+\])$/.test(host)) return null;
    const authority = value.split('/')[0];
    const explicitPort = /:(\d+)$/.exec(authority)?.[1] || '';
    if (explicitPort && (Number(explicitPort) < 1 || Number(explicitPort) > 65535)) return null;
    const normalizedPath = url.pathname.replace(/\/+$/, '').replace(/%[a-f0-9]{2}/gi, part => part.toUpperCase());
    return { host, port: explicitPort ? String(Number(explicitPort)) : '', path: normalizedPath };
  } catch { return null; }
}
function routeText(text) {
  const rule = routeRule(text);
  return rule ? rule.host + (rule.port ? ':' + rule.port : '') + rule.path : '';
}
function routeMatches(rule, url) {
  const r = typeof rule === 'string' ? routeRule(rule) : rule;
  if (!r || !webUrl(url)) return false;
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host !== r.host && !host.endsWith('.' + r.host)) return false;
  if (r.port && (u.port || (u.protocol === 'https:' ? '443' : '80')) !== r.port) return false;
  const pathname = u.pathname.replace(/%[a-f0-9]{2}/gi, part => part.toUpperCase());
  return !r.path || pathname === r.path || pathname.startsWith(r.path + '/');
}
function validDestination(to, spaces, { allowMissing = false } = {}) {
  return to === 'main' || to === 'little' || (typeof to === 'string' && /^space:[\w-]{1,64}$/.test(to) && (allowMissing || spaces.some(s => s.id === to.slice(6))));
}
function sizeOf(size) {
  return { width: Math.max(420, Math.min(1800, Math.round(Number(size?.width) || 860))), height: Math.max(320, Math.min(1400, Math.round(Number(size?.height) || 640))) };
}
class LinkRoutingSettings {
  constructor(file) { this.file = file; this.values = { defaultDestination: 'main', rules: [], littleSize: sizeOf() }; }
  load() {
    try {
      if (fs.statSync(this.file).size > 100000) return;
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.values = {
        defaultDestination: validDestination(saved.defaultDestination, [], { allowMissing: true }) ? saved.defaultDestination : 'main',
        littleSize: sizeOf(saved.littleSize),
        rules: (Array.isArray(saved.rules) ? saved.rules : []).slice(0, 100).filter(r => routeText(r?.match) && validDestination(r.to, [], { allowMissing: true }))
          .map(r => ({ id: randomUUID(), match: routeText(r.match), to: r.to }))
      };
    } catch {}
  }
  set(input, spaces) {
    if (!input || !validDestination(input.defaultDestination, spaces) || !Array.isArray(input.rules) || input.rules.length > 100) return { error: 'Choose valid link destinations and no more than 100 rules.' };
    const rules = [];
    const seen = new Set();
    for (const r of input.rules) {
      const match = routeText(r?.match);
      if (!match || !validDestination(r.to, spaces)) return { error: 'Each rule needs a valid site/path and an existing destination.' };
      if (seen.has(match)) return { error: `The site “${match}” appears more than once.` };
      seen.add(match);
      rules.push({ id: randomUUID(), match, to: r.to });
    }
    return this.save({ ...this.values, defaultDestination: input.defaultDestination, rules });
  }
  save(next) {
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
      this.values = next;
      return { success: true };
    } catch (error) { return { error: error.message }; }
  }
  destination(url, spaces) {
    const rule = this.values.rules.find(r => routeMatches(r.match, url));
    const selected = rule?.to || this.values.defaultDestination;
    return { to: validDestination(selected, spaces) ? selected : 'main', match: rule?.match || null };
  }
}
const urlsFromArgs = args => (Array.isArray(args) ? args : []).filter(a => typeof a === 'string' && /^https?:\/\//i.test(a)).map(webUrl).filter(Boolean).slice(0, 20);
module.exports = { webUrl, routeRule, routeText, routeMatches, validDestination, LinkRoutingSettings, urlsFromArgs, sizeOf };
