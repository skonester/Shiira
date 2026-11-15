import { uid } from './spaces-model.js';
import { drawEasel, hitEasel, easelBounds } from './workspace-model.js';
export const EaselEditorMixin = {
  initEaselEditor() {
    const canvas = this.easelCanvas;
    canvas.addEventListener('pointerdown', e => this.easelPointerDown(e));
    canvas.addEventListener('pointermove', e => this.easelPointerMove(e));
    canvas.addEventListener('pointerup', () => this.easelPointerUp());
    canvas.addEventListener('pointercancel', () => this.easelPointerUp());
    canvas.addEventListener('dblclick', async () => {
      const item = this.workspaceDoc?.items.find(i => i.id === this.easelSelected);
      if (!item || !['text', 'note'].includes(item.type)) return;
      const text = await this.showPrompt('Edit Easel text', 'Text', item.text);
      if (text !== null) { this.rememberEasel(); item.text = text; this.workspaceEdited(); this.paintEasel(); }
    });
    canvas.addEventListener('wheel', e => {
      if (this.workspaceDoc?.kind !== 'easel') return;
      e.preventDefault(); const v = this.workspaceDoc.view;
      if (e.ctrlKey || e.metaKey) {
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const z = Math.max(.1, Math.min(8, v.z * Math.exp(-e.deltaY * .005)));
        v.x = x - (x - v.x) * z / v.z; v.y = y - (y - v.y) * z / v.z; v.z = z;
      } else { v.x -= e.deltaX; v.y -= e.deltaY; }
      this.workspaceEdited(); this.paintEasel();
    }, { passive: false });
    canvas.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undoEasel(e.shiftKey); return; }
      const it = this.workspaceDoc?.items.find(i => i.id === this.easelSelected);
      if (!it) return;
      if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); this.deleteEaselItem(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); this.rememberEasel(); const step = e.shiftKey ? 10 : 1;
        it.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        it.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.workspaceEdited(); this.paintEasel();
      }
    });
    this.easelResizeObserver = new ResizeObserver(() => this.paintEasel()); this.easelResizeObserver.observe(canvas.parentElement);
  },
  rememberEasel() {
    this.easelUndo ||= []; this.easelUndo.push(structuredClone(this.workspaceDoc.items)); this.easelRedo = [];
    let bytes = this.easelUndo.reduce((n, items) => n + JSON.stringify(items).length * 2, 0);
    while (this.easelUndo.length > 1 && (this.easelUndo.length > 50 || bytes > 32 * 1024 * 1024)) bytes -= JSON.stringify(this.easelUndo.shift()).length * 2;
  },
  undoEasel(redo = false) {
    const from = redo ? this.easelRedo : this.easelUndo, to = redo ? this.easelUndo : this.easelRedo;
    if (!from?.length || this.workspaceDoc?.kind !== 'easel') return;
    to.push(structuredClone(this.workspaceDoc.items)); this.workspaceDoc.items = from.pop(); this.workspaceEdited(); this.paintEasel();
  },
  deleteEaselItem() { if (!this.easelSelected) return; this.rememberEasel(); this.workspaceDoc.items = this.workspaceDoc.items.filter(it => it.id !== this.easelSelected); this.easelSelected = null; this.workspaceEdited(); this.paintEasel(); },
  easelPoint(e) { const r = this.easelCanvas.getBoundingClientRect(), v = this.workspaceDoc.view; return { x: (e.clientX - r.left - v.x) / v.z, y: (e.clientY - r.top - v.y) / v.z }; },
  async easelPointerDown(e) {
    if (this.workspaceDoc?.kind !== 'easel' || ![0, 1].includes(e.button)) return;
    this.easelCanvas.focus(); const p = this.easelPoint(e), v = this.workspaceDoc.view;
    const tool = e.button === 1 ? 'pan' : this.easelTool || 'select';
    if (['text', 'note'].includes(tool)) {
      const id = this.workspaceDoc.id; const text = await this.showPrompt(tool === 'note' ? 'Add sticky note' : 'Add text', 'Text', '');
      if (text && this.workspaceDoc?.id === id) {
        this.rememberEasel(); const it = { id: uid('e-'), type: tool, x: p.x, y: p.y, w: 260, h: 180, size: 18, color: this.easelColor || 'cyan', text };
        this.workspaceDoc.items.push(it); this.easelSelected = it.id; this.workspaceEdited(); this.paintEasel();
      }
      return;
    }
    e.preventDefault(); this.easelCanvas.setPointerCapture(e.pointerId);
    const item = hitEasel(this.workspaceDoc.items, p.x, p.y, 6 / v.z);
    if (tool === 'pan') this.easelDrag = { tool, sx: e.clientX, sy: e.clientY, x: v.x, y: v.y };
    else if (tool === 'select') {
      this.easelSelected = item?.id || null;
      if (item) {
        this.rememberEasel(); this.easelDrag = { tool: Math.hypot(p.x - item.x - item.w, p.y - item.y - item.h) < 14 / v.z ? 'resize' : 'move', item, p, old: structuredClone(item) };
      }
    } else if (this.workspaceDoc.items.length < 5000) {
      this.rememberEasel(); const it = { id: uid('e-'), type: tool, x: p.x, y: p.y, w: 1, h: 1, color: this.easelColor || 'cyan', sw: 2 };
      if (tool === 'pen') { it.pts = [0, 0]; it.pw = 1; it.ph = 1; }
      this.workspaceDoc.items.push(it); this.easelSelected = it.id; this.easelDrag = { tool, item: it, p, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    this.paintEasel();
  },
  easelPointerMove(e) {
    const d = this.easelDrag; if (!d) return; const p = this.easelPoint(e);
    if (d.tool === 'pan') { this.workspaceDoc.view.x = d.x + e.clientX - d.sx; this.workspaceDoc.view.y = d.y + e.clientY - d.sy; }
    else if (d.tool === 'move') { d.item.x = d.old.x + p.x - d.p.x; d.item.y = d.old.y + p.y - d.p.y; }
    else if (d.tool === 'resize') { d.item.w = Math.max(10, p.x - d.item.x); d.item.h = Math.max(10, p.y - d.item.y); }
    else if (d.tool === 'pen') {
      if (d.item.pts.length < 40000) {
        const x = p.x - d.p.x, y = p.y - d.p.y; d.item.pts.push(x, y);
        d.minX = Math.min(d.minX, x); d.maxX = Math.max(d.maxX, x); d.minY = Math.min(d.minY, y); d.maxY = Math.max(d.maxY, y);
        d.item.w = d.item.pw = Math.max(1, d.maxX - d.minX); d.item.h = d.item.ph = Math.max(1, d.maxY - d.minY);
      }
    } else if (d.tool === 'arrow') { d.item.w = p.x - d.p.x; d.item.h = p.y - d.p.y; }
    else { d.item.x = Math.min(p.x, d.p.x); d.item.y = Math.min(p.y, d.p.y); d.item.w = Math.max(1, Math.abs(p.x - d.p.x)); d.item.h = Math.max(1, Math.abs(p.y - d.p.y)); }
    this.workspaceEdited(); this.paintEasel();
  },
  easelPointerUp() {
    const d = this.easelDrag; if (!d) return;
    if (d.tool === 'pen') { d.item.x += d.minX; d.item.y += d.minY; d.item.pts = d.item.pts.map((v, i) => v - (i % 2 ? d.minY : d.minX)); }
    this.easelDrag = null; this.workspaceEdited(); this.paintEasel();
  },
  paintEasel() {
    if (this.easelPaintFrame || this.workspaceDoc?.kind !== 'easel' || this.workspacePanel.classList.contains('hidden')) return;
    this.easelPaintFrame = requestAnimationFrame(() => {
      this.easelPaintFrame = null;
      if (this.workspaceDoc?.kind !== 'easel') return;
      const canvas = this.easelCanvas, r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (!r.width || !r.height) return;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.fillStyle = '#071116'; ctx.fillRect(0, 0, r.width, r.height);
      const v = this.workspaceDoc.view; ctx.translate(v.x, v.y); ctx.scale(v.z, v.z);
      drawEasel(ctx, this.workspaceDoc.items, this.easelImages, this.easelSelected, v.z);
      document.getElementById('easel-zoom-label').textContent = Math.round(v.z * 100) + '%';
      const outline = document.getElementById('easel-outline'); outline.replaceChildren();
      const selected = this.workspaceDoc.items.find(i => i.id === this.easelSelected), text = document.getElementById('easel-item-text');
      const hasText = selected && ['text', 'note'].includes(selected.type); text.classList.toggle('hidden', !hasText);
      if (hasText && document.activeElement !== text) { text.value = selected.text; text.parentElement.open = true; }
      for (const item of this.workspaceDoc.items.slice(-200)) {
        const button = document.createElement('button'); button.textContent = `${item.type}: ${(item.text || item.alt || item.sourceTitle || item.id).slice(0, 55)}`;
        button.setAttribute('aria-pressed', String(item.id === this.easelSelected));
        button.onclick = () => { this.easelSelected = item.id; this.easelCanvas.focus(); this.paintEasel(); }; outline.appendChild(button);
      }
    });
  },
  async loadEaselImages() {
    const doc = this.workspaceDoc; if (doc?.kind !== 'easel') return;
    for (const name of new Set(doc.items.filter(i => i.type === 'image').map(i => i.img))) {
      if (this.easelImages.has(name)) { await this.easelImages.get(name).decode().catch(() => {}); continue; }
      const data = await window.shiiraAPI.workspace.image(doc.id, name);
      if (this.workspaceDoc?.id !== doc.id) return;
      if (typeof data !== 'string') continue;
      const image = new Image(); image.onload = () => this.paintEasel(); image.src = data; this.easelImages.set(name, image);
      await image.decode().catch(() => {});
    }
  },
  fitEasel() {
    const b = easelBounds(this.workspaceDoc.items), r = this.easelCanvas.getBoundingClientRect();
    const z = Math.max(.1, Math.min(2, r.width / b.width, r.height / b.height));
    this.workspaceDoc.view = { z, x: (r.width - b.width * z) / 2 - b.x * z, y: (r.height - b.height * z) / 2 - b.y * z };
    this.workspaceEdited(); this.paintEasel();
  },
  exportEaselPng() {
    const b = easelBounds(this.workspaceDoc.items), scale = Math.min(1, 8192 / b.width, 8192 / b.height, Math.sqrt(16000000 / (b.width * b.height)));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(b.width * scale)); canvas.height = Math.max(1, Math.ceil(b.height * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#071116'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.scale(scale, scale); ctx.translate(-b.x, -b.y);
    drawEasel(ctx, this.workspaceDoc.items, this.easelImages); return canvas.toDataURL('image/png');
  }
};
