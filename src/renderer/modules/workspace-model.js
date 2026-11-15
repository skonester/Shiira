// Orbe's text/block and bounded canvas models adapted for Shiira's native UI.
export const PALETTE = { cyan: '#70e5f2', pink: '#f7a2d2', yellow: '#f4d47b', green: '#9be0b1', white: '#eef6fa', purple: '#b7a0f8' };
export function safeNoteLink(value) {
  try { const u = new URL(value); return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function noteBlocks(editor) {
  const result = [];
  function block(node, type) {
    const runs = [];
    const walk = (el, marks = {}) => {
      if (el.nodeType === 3) { if (el.textContent) runs.push({ s: el.textContent, ...marks }); return; }
      if (el.nodeType !== 1 || el.matches('button,input,script,style,iframe,img,svg')) return;
      const next = { ...marks };
      if (el.matches('b,strong')) next.b = true;
      if (el.matches('i,em')) next.i = true;
      if (el.matches('a') && safeNoteLink(el.getAttribute('href'))) next.a = safeNoteLink(el.getAttribute('href'));
      if (el.tagName === 'BR') runs.push({ s: '\n', ...next });
      else el.childNodes.forEach(child => walk(child, next));
    };
    walk(node);
    result.push({ t: type, runs, ...(node.dataset?.todo ? { done: node.dataset.done === 'true' } : {}) });
  }
  for (const child of editor.childNodes) {
    if (['UL', 'OL'].includes(child.nodeName)) child.childNodes.forEach(li => block(li, child.nodeName.toLowerCase()));
    else block(child, child.dataset?.todo ? 'todo' : /^H[1-3]$/.test(child.nodeName) ? child.nodeName.toLowerCase() : 'p');
  }
  return result;
}
export function renderNote(editor, blocks) {
  editor.replaceChildren(); let list;
  for (const block of blocks || []) {
    let el;
    if (['ul', 'ol'].includes(block.t)) {
      if (!list || list.tagName.toLowerCase() !== block.t) { list = document.createElement(block.t); editor.appendChild(list); }
      el = document.createElement('li'); list.appendChild(el);
    } else {
      list = null; el = document.createElement(['h1', 'h2', 'h3'].includes(block.t) ? block.t : 'p'); editor.appendChild(el);
    }
    if (block.t === 'todo') {
      el.dataset.todo = 'true'; el.dataset.done = String(block.done === true);
      const button = document.createElement('button'); button.type = 'button'; button.contentEditable = 'false'; button.dataset.todoToggle = 'true';
      button.setAttribute('aria-label', block.done ? 'Mark incomplete' : 'Mark complete'); button.textContent = block.done ? '☑' : '☐'; el.appendChild(button);
    }
    for (const run of block.runs) {
      let node = document.createTextNode(run.s);
      for (const tag of [run.b && 'strong', run.i && 'em', safeNoteLink(run.a) && 'a'].filter(Boolean)) {
        const wrapper = document.createElement(tag); if (tag === 'a') wrapper.href = safeNoteLink(run.a);
        wrapper.appendChild(node); node = wrapper;
      }
      el.appendChild(node);
    }
    if (!block.runs.length) el.appendChild(document.createElement('br'));
  }
}
export function easelBounds(items) {
  if (!items.length) return { x: 0, y: 0, width: 800, height: 600 };
  const x = Math.min(...items.map(i => Math.min(i.x, i.x + i.w))) - 30;
  const y = Math.min(...items.map(i => Math.min(i.y, i.y + i.h))) - 30;
  const right = Math.max(...items.map(i => Math.max(i.x, i.x + i.w))) + 30;
  const bottom = Math.max(...items.map(i => Math.max(i.y, i.y + i.h))) + 30;
  return { x, y, width: right - x, height: bottom - y };
}
export function hitEasel(items, x, y, tolerance = 6) {
  return [...items].reverse().find(i => x >= Math.min(i.x, i.x + i.w) - tolerance && x <= Math.max(i.x, i.x + i.w) + tolerance
    && y >= Math.min(i.y, i.y + i.h) - tolerance && y <= Math.max(i.y, i.y + i.h) + tolerance);
}
function lines(ctx, text, width) {
  const out = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}
export function drawEasel(ctx, items, images, selected = null, zoom = 1) {
  for (const it of items) {
    ctx.save(); ctx.translate(it.x, it.y);
    const color = PALETTE[it.color] || PALETTE.cyan;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = it.sw || 2;
    if (it.type === 'image') { const img = images.get(it.img); if (img?.complete) ctx.drawImage(img, 0, 0, it.w, it.h); }
    if (['text', 'note'].includes(it.type)) {
      if (it.type === 'note') { ctx.fillStyle = color; ctx.fillRect(0, 0, it.w, it.h); ctx.fillStyle = '#10191f'; }
      ctx.beginPath(); ctx.rect(0, 0, it.w, it.h); ctx.clip();
      ctx.font = `${it.size || 18}px system-ui`; ctx.textBaseline = 'top';
      lines(ctx, it.text || '', Math.max(1, it.w - 24)).slice(0, 2000).forEach((line, n) => ctx.fillText(line, 12, 12 + n * (it.size || 18) * 1.35));
    }
    if (it.type === 'rect') { if (it.fill) ctx.fillRect(0, 0, it.w, it.h); else ctx.strokeRect(0, 0, it.w, it.h); }
    if (it.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(it.w / 2, it.h / 2, it.w / 2, it.h / 2, 0, 0, Math.PI * 2); if (it.fill) ctx.fill(); else ctx.stroke(); }
    if (it.type === 'arrow') {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(it.w, it.h);
      const a = Math.atan2(it.h, it.w); for (const angle of [a - .5, a + .5]) { ctx.moveTo(it.w, it.h); ctx.lineTo(it.w - 15 * Math.cos(angle), it.h - 15 * Math.sin(angle)); } ctx.stroke();
    }
    if (it.type === 'pen') {
      ctx.scale(it.w / (it.pw || 1), it.h / (it.ph || 1)); ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let n = 0; n < it.pts.length; n += 2) { if (!n) ctx.moveTo(it.pts[n], it.pts[n + 1]); else ctx.lineTo(it.pts[n], it.pts[n + 1]); } ctx.stroke();
    }
    ctx.restore();
    if (selected === it.id) {
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / zoom; ctx.setLineDash([5 / zoom, 3 / zoom]); ctx.strokeRect(it.x - 3, it.y - 3, it.w + 6, it.h + 6);
      ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.fillRect(it.x + it.w - 5 / zoom, it.y + it.h - 5 / zoom, 10 / zoom, 10 / zoom); ctx.restore();
    }
  }
}
