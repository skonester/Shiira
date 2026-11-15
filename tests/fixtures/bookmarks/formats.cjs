// Synthetic format writers adapted from Orbe (MIT), Amadou Ba / PIXEWORK.
function lz4Compress(src) {
  const out = [];
  const table = new Map();
  let anchor = 0;
  let i = 0;
  const ext = (n) => { while (n >= 255) { out.push(255); n -= 255; } out.push(n); };
  const emit = (litEnd, matchLen, off) => {
    const lit = litEnd - anchor;
    out.push((Math.min(lit, 15) << 4) | (matchLen ? Math.min(matchLen - 4, 15) : 0));
    if (lit >= 15) ext(lit - 15);
    for (let k = anchor; k < litEnd; k++) out.push(src[k]);
    if (matchLen) { out.push(off & 255, off >> 8); if (matchLen - 4 >= 15) ext(matchLen - 19); }
  };
  while (i < src.length - 12) {
    const key = src.readUInt32LE(i);
    const cand = table.get(key);
    table.set(key, i);
    if (cand !== undefined && i - cand <= 65535) {
      let len = 4;
      while (i + len < src.length - 5 && src[cand + len] === src[i + len]) len += 1;
      emit(i, len, i - cand);
      i += len;
      anchor = i;
    } else i += 1;
  }
  emit(src.length, 0, 0);
  return Buffer.from(out);
}
function mozlz4(json) {
  const raw = Buffer.from(JSON.stringify(json), 'utf8');
  const head = Buffer.alloc(12);
  head.write('mozLz40\0', 0, 'latin1');
  head.writeUInt32LE(raw.length, 8);
  return Buffer.concat([head, lz4Compress(raw)]);
}

function bplist(root) {
  const objs = [];
  const add = (v) => {
    const i = objs.length;
    objs.push(null);
    if (Array.isArray(v)) objs[i] = { t: 'a', refs: v.map(add) };
    else if (Buffer.isBuffer(v)) objs[i] = { t: 'd', v };
    else if (v instanceof Date) objs[i] = { t: 'date', v };
    else if (v && typeof v === 'object') { const keys = Object.keys(v); objs[i] = { t: 'o', k: keys.map(add), v: keys.map((k) => add(v[k])) }; }
    else objs[i] = { t: typeof v, v };
    return i;
  };
  add(root);
  const ref = (n) => Buffer.from([n >> 8, n & 255]);
  const head = (type, n) => (n < 15 ? Buffer.from([(type << 4) | n]) : n < 256 ? Buffer.from([(type << 4) | 15, 0x10, n]) : Buffer.from([(type << 4) | 15, 0x11, n >> 8, n & 255]));
  const enc = (o) => {
    if (o.t === 'string') {

      if (/^[\x00-\x7f]*$/.test(o.v)) return Buffer.concat([head(5, o.v.length), Buffer.from(o.v, 'latin1')]);
      const b = Buffer.from(o.v, 'utf16le');
      b.swap16();
      return Buffer.concat([head(6, o.v.length), b]);
    }
    if (o.t === 'number') { const b = Buffer.alloc(9); b[0] = 0x13; b.writeBigUInt64BE(BigInt(o.v), 1); return b; }
    if (o.t === 'boolean') return Buffer.from([o.v ? 9 : 8]);
    if (o.t === 'd') return Buffer.concat([head(4, o.v.length), o.v]);
    if (o.t === 'date') { const b = Buffer.alloc(9); b[0] = 0x33; b.writeDoubleBE(o.v.getTime() / 1000 - 978307200, 1); return b; }
    if (o.t === 'a') return Buffer.concat([head(10, o.refs.length), ...o.refs.map(ref)]);
    return Buffer.concat([head(13, o.k.length), ...o.k.map(ref), ...o.v.map(ref)]);
  };
  const parts = [Buffer.from('bplist00', 'latin1')];
  const offsets = [];
  let at = 8;
  for (const o of objs) { const b = enc(o); offsets.push(at); parts.push(b); at += b.length; }
  const table = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, i) => table.writeUInt32BE(o, i * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = 2;
  trailer.writeBigUInt64BE(BigInt(objs.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([...parts, table, trailer]);
}

module.exports = { mozlz4, bplist };
