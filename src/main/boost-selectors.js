// Zap selector checks adapted from Orbe (MIT). See THIRD_PARTY_NOTICES/orbe-MIT.txt.
const SELECTOR_MAX = 500;
function unescapeCss(s) {
  return String(s).replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16) || 0xfffd); } catch { return '\ufffd'; } }).replace(/\\(.)/g, '$1');
}

const BROAD = /^(html|body|\*)?(:root|:scope)*$/;
function tooBroad(sel) {
  let s = String(sel).toLowerCase();
  for (let i = 0; i < 8 && /:not\([^()]*\)/.test(s); i++) s = s.replace(/:not\([^()]*\)/g, '');
  s = s.replace(/:(is|where)\(([^()]*)\)/g, (m, f, inner) => (inner.split(',').some((x) => BROAD.test(x.trim())) ? '*' : m));
  const parts = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return !parts.length || parts.every((p) => BROAD.test(p));
}

function validSelector(sel) {
  if (typeof sel !== 'string') return false;
  const s = sel.trim();
  if (!s || s.length > SELECTOR_MAX || s !== sel) return false;

  if (/[\u0000-\u001f\u007f{};@<]/.test(s) || s.includes('/*') || s.includes('*/')) return false;

  if (/url\s*\(/i.test(s) || /url\s*\(/i.test(unescapeCss(s))) return false;
  const stack = [];
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { if (i === s.length - 1) return false; i += 1; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') stack.push(c);
    else if (c === ')') { if (stack.pop() !== '(') return false; }
    else if (c === ']') { if (stack.pop() !== '[') return false; }
    else if (c === ',' && !stack.length) return false;
  }
  return !quote && !stack.length;
}
module.exports = { validSelector, tooBroad };
