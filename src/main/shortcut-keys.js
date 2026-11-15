// Accelerator canonicalization adapted from Orbe (MIT, Amadou Ba / PIXEWORK).
// See THIRD_PARTY_NOTICES/orbe-MIT.txt.
const MODS = ['Ctrl', 'Alt', 'Shift', 'Cmd'];
const ALIAS = { cmd: 'Cmd', command: 'Cmd', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift' };
const NAMED = ['Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Return', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'];
const NAMED_BY_LOWER = new Map([...NAMED.map((k) => [k.toLowerCase(), k]), ['enter', 'Return'], ['esc', 'Escape']]);
const SIMPLE_KEY = /^[A-Z0-9,./;'[\]\\=`-]$/;
const F_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const MAX_LEN = 40;

function canon(accel) {
  if (typeof accel !== 'string' || !accel || accel.length > MAX_LEN) return null;
  const parts = accel.split('+');
  let key = parts.pop();
  if (!key) return null;
  const mods = new Set();
  for (const p of parts) {
    const m = ALIAS[p.toLowerCase()];
    if (!m || mods.has(m)) return null;
    mods.add(m);
  }
  if (key.length === 1) key = key.toUpperCase();
  else if (/^f\d+$/i.test(key)) key = key.toUpperCase();
  else key = NAMED_BY_LOWER.get(key.toLowerCase()) || '';
  if (!SIMPLE_KEY.test(key) && !F_KEY.test(key) && !NAMED.includes(key)) return null;
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}
module.exports = { canon, MODS, F_KEY };
