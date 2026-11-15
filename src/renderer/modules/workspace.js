import { escapeHtml } from './utils.js';
import { uid } from './spaces-model.js';
import { PALETTE, noteBlocks, renderNote, safeNoteLink } from './workspace-model.js';
const api = () => window.shiiraAPI.workspace;
export const WorkspaceMixin = {
  initWorkspace() {
    if (this.isLittle) return;
    const panel = document.createElement('section'); panel.id = 'workspace-panel'; panel.className = 'workspace-panel hidden';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Notes and Easels');
    panel.innerHTML = `<header><strong>Notes &amp; Easels</strong><span id="workspace-profile"></span><span class="workspace-spacer"></span><button data-workspace="new-note">New note</button><button data-workspace="new-easel">New Easel</button><button data-workspace="close" aria-label="Close Notes and Easels">Close</button></header>
      <div class="workspace-layout"><aside><input id="workspace-search" type="search" aria-label="Find a note or Easel" placeholder="Find a document"><div id="workspace-list"></div></aside>
      <main><div id="workspace-empty"><h2>A place for ideas</h2><p>Write a note or arrange text, drawings, images and page captures on an Easel.</p></div>
      <div id="workspace-document" class="hidden"><div class="workspace-titlebar"><input id="workspace-title" maxlength="120" aria-label="Document title"><button data-workspace="export">Export</button><button data-workspace="delete">Delete</button></div>
      <div class="workspace-savebar"><span id="workspace-status" role="status" aria-live="polite">Saved</span><button id="workspace-copy" class="hidden" data-workspace="copy">Save as copy</button><button id="workspace-reload" class="hidden" data-workspace="reload">Reload saved version</button></div>
      <div id="workspace-note" class="workspace-note"><div class="note-toolbar" role="toolbar" aria-label="Note formatting"><button data-note-command="bold">Bold</button><button data-note-command="italic">Italic</button><button data-note-command="h1">Heading</button><button data-note-command="p">Paragraph</button><button data-note-command="insertUnorderedList">Bullets</button><button data-note-command="insertOrderedList">Numbered list</button><button data-note-command="todo">Checklist</button><button data-note-command="link">Link</button></div><div id="note-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note text" spellcheck="true"></div></div>
      <div id="workspace-easel" class="workspace-easel hidden"><div class="easel-toolbar" role="toolbar" aria-label="Easel tools">${['select', 'pan', 'text', 'note', 'rect', 'ellipse', 'arrow', 'pen'].map(tool => `<button data-easel-tool="${tool}" aria-pressed="${tool === 'select'}">${{ select:'Select',pan:'Pan',text:'Text',note:'Sticky note',rect:'Rectangle',ellipse:'Ellipse',arrow:'Arrow',pen:'Draw' }[tool]}</button>`).join('')}
      <select id="easel-color" aria-label="Item color">${Object.keys(PALETTE).map(color => `<option>${color}</option>`).join('')}</select><button data-workspace="image">Image</button><button data-workspace="capture">Capture page</button><button data-workspace="undo">Undo</button><button data-workspace="redo">Redo</button><button data-workspace="remove-item">Remove item</button><button data-workspace="fit">Fit</button><span id="easel-zoom-label">100%</span></div>
      <div class="easel-surface"><canvas id="easel-canvas" tabindex="0" aria-label="Easel canvas. Drag to move or resize. Arrow keys move selected items, Delete removes them, Control Z undoes. Control wheel zooms."></canvas><details class="easel-outline"><summary>Items</summary><textarea id="easel-item-text" class="hidden" maxlength="20000" rows="5" aria-label="Selected item text"></textarea><div id="easel-outline"></div></details></div></div></div></main></div>`;
    document.body.appendChild(panel); this.workspacePanel = panel; this.noteEditor = panel.querySelector('#note-editor'); this.easelCanvas = panel.querySelector('#easel-canvas'); this.easelImages = new Map();
    const button = document.createElement('button'); button.type = 'button'; button.className = 'nav-btn'; button.id = 'workspace-open'; button.title = 'Notes and Easels'; button.setAttribute('aria-label', button.title); button.textContent = '✎';
    document.getElementById('btn-menu')?.before(button); button.onclick = () => this.showWorkspace();
    panel.addEventListener('click', e => {
      const action = e.target.closest('[data-workspace]')?.dataset.workspace;
      if (action) void this.workspaceAction(action).catch(error => this.workspaceStatus(error.message));
      const tool = e.target.closest('[data-easel-tool]')?.dataset.easelTool;
      if (tool) { this.easelTool = tool; panel.querySelectorAll('[data-easel-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.easelTool === tool))); this.easelCanvas.focus(); }
    });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void this.hideWorkspace(); }
      if (e.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('button,input,select,[contenteditable],canvas[tabindex]')].filter(el => !el.disabled && el.getClientRects().length);
        const next = e.shiftKey ? focusable.at(-1) : focusable[0], boundary = e.shiftKey ? focusable[0] : focusable.at(-1);
        if (document.activeElement === boundary) { e.preventDefault(); next?.focus(); }
      }
    });
    panel.querySelector('#workspace-search').oninput = () => this.renderWorkspaceList();
    panel.querySelector('#workspace-title').oninput = e => { this.workspaceDoc.title = e.target.value; this.workspaceEdited(); };
    panel.querySelector('#easel-color').onchange = e => {
      this.easelColor = e.target.value; const it = this.workspaceDoc?.items.find(i => i.id === this.easelSelected);
      if (it) { this.rememberEasel(); it.color = this.easelColor; this.workspaceEdited(); this.paintEasel(); }
    };
    panel.querySelector('#easel-item-text').onfocus = () => this.rememberEasel();
    panel.querySelector('#easel-item-text').oninput = e => {
      const item = this.workspaceDoc?.items?.find(i => i.id === this.easelSelected);
      if (item && ['text', 'note'].includes(item.type)) { item.text = e.target.value; this.workspaceEdited(); this.paintEasel(); }
    };
    panel.querySelectorAll('[data-note-command]').forEach(b => {
      b.onmousedown = e => e.preventDefault(); b.onclick = () => void this.formatWorkspaceNote(b.dataset.noteCommand);
    });
    this.noteEditor.oninput = () => { this.workspaceDoc.blocks = noteBlocks(this.noteEditor); this.workspaceEdited(); };
    this.noteEditor.onpaste = e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };
    this.noteEditor.ondrop = e => e.preventDefault();
    this.noteEditor.onclick = e => {
      const todo = e.target.closest('[data-todo-toggle]');
      if (todo) { const p = todo.parentElement; p.dataset.done = String(p.dataset.done !== 'true'); todo.textContent = p.dataset.done === 'true' ? '☑' : '☐'; this.noteEditor.oninput(); }
      const link = e.target.closest('a');
      if (link) {
        e.preventDefault(); const href = safeNoteLink(link.getAttribute('href'));
        if ((e.ctrlKey || e.metaKey) && /^https?:/.test(href)) void this.hideWorkspace().then(closed => {
          if (!closed) return; const space = this.spaceForProfile(this.workspaceProfile);
          if (space) this.createTab(href, { spaceId: space.id }); else this.setStatus('Create a Space for this browser profile before opening its links.', 3000);
        });
      }
    };
    this.initEaselEditor();
    api().onChanged(change => { void this.workspaceRemoteChanged(change).catch(error => this.workspaceStatus(error.message)); });
  },
  async workspaceRemoteChanged(change) {
      if (!this.workspacePanel || this.workspacePanel.classList.contains('hidden') || change.profileId !== this.workspaceProfile) return;
      await this.refreshWorkspaceList();
      if (this.workspaceDoc?.id !== change.id || (!change.deleted && change.revision <= this.workspaceDoc.revision)) return;
      if (this.workspaceSaving) { if (!this.pendingWorkspaceChange || change.revision >= this.pendingWorkspaceChange.revision) this.pendingWorkspaceChange = change; return; }
      if (this.workspaceDirty) { this.workspaceConflict = true; this.workspaceStatus('Changed in another window. Save your edits as a copy or reload.'); return; }
      if (change.deleted) this.showWorkspaceDocument(null); else if (change.revision > this.workspaceDoc.revision) await this.openWorkspaceDocument(change.id);
  },
  workspaceStatus(text) {
    document.getElementById('workspace-status').textContent = text;
    for (const id of ['workspace-copy', 'workspace-reload']) document.getElementById(id).classList.toggle('hidden', !this.workspaceConflict);
  },
  async showWorkspace(kind) {
    if (!this.workspacePanel) return;
    if (!this.spacesLoaded) { this.setStatus('Wait for Spaces to finish loading.', 1500); return; }
    this.hideCommandBar(); this.hideMainMenu();
    if (!await this.flushWorkspace()) return;
    this.workspaceProfile = this.profileForSpace();
    this.workspaceReturnFocus = document.activeElement;
    document.getElementById('workspace-profile').textContent = this.profiles?.find(p => p.id === this.workspaceProfile)?.name || 'Default';
    this.workspacePanel.classList.remove('hidden');
    if (this.workspaceDoc?.profileId !== this.workspaceProfile) this.showWorkspaceDocument(null);
    await this.refreshWorkspaceList();
    if (kind) await this.newWorkspaceDocument(kind);
    else if (!this.workspaceDoc && this.workspaceDocuments.length) await this.openWorkspaceDocument(this.workspaceDocuments[0].id);
    this.workspacePanel.querySelector('#workspace-search').focus(); this.paintEasel();
  },
  async hideWorkspace() {
    if (!this.workspacePanel || this.workspacePanel.classList.contains('hidden')) return true;
    this.easelPointerUp();
    if (!await this.flushWorkspace()) return false;
    this.workspacePanel.classList.add('hidden'); this.workspaceReturnFocus?.focus?.(); return true;
  },
  async refreshWorkspaceList() { const result = await api().list(this.workspaceProfile); if (result.error) throw new Error(result.error); this.workspaceDocuments = result; this.renderWorkspaceList(); },
  renderWorkspaceList() {
    const host = document.getElementById('workspace-list'), query = document.getElementById('workspace-search').value.toLowerCase();
    host.innerHTML = (this.workspaceDocuments || []).filter(d => d.title.toLowerCase().includes(query)).map(d => `<button data-document="${d.id}" aria-pressed="${this.workspaceDoc?.id === d.id}"><span>${d.kind === 'note' ? 'Note' : 'Easel'}</span>${escapeHtml(d.title || 'Untitled')}</button>`).join('') || '<p>No documents yet.</p>';
    host.querySelectorAll('[data-document]').forEach(b => { b.onclick = () => this.openWorkspaceDocument(b.dataset.document); });
  },
  async newWorkspaceDocument(kind) {
    if (!await this.flushWorkspace()) return;
    const request = this.workspaceLoadGeneration = (this.workspaceLoadGeneration || 0) + 1;
    const version = this.workspaceEditVersion, sourceId = this.workspaceDoc?.id;
    const doc = await api().create(kind, this.workspaceProfile); if (doc.error) { this.workspaceStatus(doc.error); return; }
    if (request !== this.workspaceLoadGeneration || version !== this.workspaceEditVersion || sourceId !== this.workspaceDoc?.id) { await this.refreshWorkspaceList(); return; }
    this.showWorkspaceDocument(doc); await this.refreshWorkspaceList(); document.getElementById('workspace-title').focus();
  },
  async openWorkspaceDocument(id) {
    if (!await this.flushWorkspace()) return;
    const request = this.workspaceLoadGeneration = (this.workspaceLoadGeneration || 0) + 1;
    const version = this.workspaceEditVersion, sourceId = this.workspaceDoc?.id;
    const doc = await api().read(id); if (doc.error) { this.workspaceStatus(doc.error); return; }
    if (request !== this.workspaceLoadGeneration || version !== this.workspaceEditVersion || sourceId !== this.workspaceDoc?.id) return;
    if (doc.profileId !== this.workspaceProfile) return;
    this.showWorkspaceDocument(doc); this.renderWorkspaceList();
  },
  showWorkspaceDocument(doc) {
    clearTimeout(this.workspaceSaveTimer); this.workspaceDoc = doc; this.workspaceDirty = false; this.workspaceConflict = false; this.easelSelected = null; this.easelUndo = []; this.easelRedo = []; this.easelImages = new Map();
    document.getElementById('workspace-empty').classList.toggle('hidden', !!doc); document.getElementById('workspace-document').classList.toggle('hidden', !doc);
    if (!doc) return;
    document.getElementById('workspace-title').value = doc.title;
    document.getElementById('workspace-note').classList.toggle('hidden', doc.kind !== 'note'); document.getElementById('workspace-easel').classList.toggle('hidden', doc.kind !== 'easel');
    this.workspaceStatus('Saved');
    if (doc.kind === 'note') renderNote(this.noteEditor, doc.blocks);
    else { this.paintEasel(); void this.loadEaselImages(); }
  },
  workspaceEdited() {
    this.workspaceDirty = true; this.workspaceEditVersion = (this.workspaceEditVersion || 0) + 1;
    this.workspaceStatus(this.workspaceConflict ? 'Changed elsewhere. Save as copy to keep your edits.' : 'Unsaved changes');
    clearTimeout(this.workspaceSaveTimer); this.workspaceSaveTimer = setTimeout(() => void this.flushWorkspace(), 600);
  },
  async flushWorkspace() {
    clearTimeout(this.workspaceSaveTimer);
    if (this.workspaceSaving) { await this.workspaceSaving; return this.flushWorkspace(); }
    if (!this.workspaceDoc || !this.workspaceDirty) return true;
    if (this.workspaceConflict) return false;
    this.workspaceSaving = this.saveWorkspaceSnapshot();
    return this.workspaceSaving;
  },
  async saveWorkspaceSnapshot() {
    const doc = structuredClone(this.workspaceDoc), version = this.workspaceEditVersion;
    try {
      const result = await api().save(doc);
      if (!result.success) { this.workspaceConflict = result.conflict === true; this.workspaceStatus(result.error || 'Could not save.'); return false; }
      this.workspaceDoc.revision = result.doc.revision;
      this.workspaceDoc.updated = result.doc.updated;
      if (this.workspaceEditVersion === version) this.workspaceDirty = false;
      this.workspaceStatus(this.workspaceDirty ? 'Unsaved changes' : 'Saved'); await this.refreshWorkspaceList();
    } catch (error) { this.workspaceStatus(error.message); return false; }
    finally {
      this.workspaceSaving = null;
      if (this.pendingWorkspaceChange) { const change = this.pendingWorkspaceChange; this.pendingWorkspaceChange = null; await this.workspaceRemoteChanged(change); }
    }
    return this.workspaceDirty ? this.flushWorkspace() : true;
  },
  async formatWorkspaceNote(command) {
    if (this.workspaceDoc?.kind !== 'note') return;
    if (command === 'link') {
      const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const href = await this.showPrompt('Insert link', 'Web address or mailto link', 'https://');
      if (!safeNoteLink(href)) return;
      this.noteEditor.focus(); if (range) { selection.removeAllRanges(); selection.addRange(range); }
      document.execCommand('createLink', false, safeNoteLink(href));
    } else if (command === 'todo') {
      const p = document.createElement('p'); p.dataset.todo = 'true'; p.dataset.done = 'false';
      const b = document.createElement('button'); b.type = 'button'; b.contentEditable = 'false'; b.dataset.todoToggle = 'true'; b.textContent = '☐'; b.setAttribute('aria-label', 'Mark complete');
      p.append(b, document.createTextNode('Checklist item')); this.noteEditor.appendChild(p);
    } else { this.noteEditor.focus(); document.execCommand(['p', 'h1'].includes(command) ? 'formatBlock' : command, false, ['p', 'h1'].includes(command) ? command : null); }
    this.noteEditor.oninput();
  },
  async workspaceAction(action) {
    if (action === 'close') return this.hideWorkspace();
    if (action.startsWith('new-')) return this.newWorkspaceDocument(action.slice(4));
    const doc = this.workspaceDoc; if (!doc) return;
    if (action === 'copy') {
      const version = this.workspaceEditVersion;
      const result = await api().copy(structuredClone(doc)); if (result.error) return this.workspaceStatus(result.error);
      if (this.workspaceEditVersion === version) this.showWorkspaceDocument(result.doc);
      else { doc.id = result.doc.id; doc.revision = result.doc.revision; doc.title = result.doc.title; this.workspaceConflict = false; await this.flushWorkspace(); }
      await this.refreshWorkspaceList(); return;
    }
    if (action === 'reload') {
      const saved = await api().read(doc.id); if (saved.error) { this.showWorkspaceDocument(null); await this.refreshWorkspaceList(); } else this.showWorkspaceDocument(saved); return;
    }
    if (action === 'delete') {
      if (!await this.showConfirmation('Delete document?', `Delete “${doc.title}”? This cannot be undone.`, { danger: true, confirmText: 'Delete' })) return;
      if (!await this.flushWorkspace()) return;
      const result = await api().remove(doc.id, doc.revision); if (result.error) return this.workspaceStatus(result.error);
      this.showWorkspaceDocument(null); return this.refreshWorkspaceList();
    }
    if (action === 'export') {
      if (!await this.flushWorkspace()) return;
      await this.loadEaselImages(); const result = await api().export(doc.id, doc.kind === 'easel' ? this.exportEaselPng() : undefined);
      this.workspaceStatus(result.error || (result.canceled ? 'Export canceled' : 'Exported')); return;
    }
    if (doc.kind !== 'easel') return;
    if (action === 'undo' || action === 'redo') return this.undoEasel(action === 'redo');
    if (action === 'remove-item') return this.deleteEaselItem();
    if (action === 'fit') return this.fitEasel();
    if (['image', 'capture'].includes(action)) {
      const tab = this.tabs.find(t => t.id === this.activeTabId);
      const pageId = action === 'capture' ? this.webContentsIdOf(tab) : null;
      if (action === 'capture' && (!pageId || tab.privateMode)) return this.workspaceStatus('Choose a normal webpage to capture.');
      const result = await api().addImage(doc.id, { pageId });
      if (result.error) return this.workspaceStatus(result.error); if (result.canceled || this.workspaceDoc?.id !== doc.id) return;
      this.rememberEasel(); const v = doc.view, image = new Image(); image.onload = () => this.paintEasel(); image.src = result.data; this.easelImages.set(result.name, image);
      const scale = Math.min(1, 600 / result.width);
      const offset = 30 * doc.items.filter(i => i.type === 'image').length;
      doc.items.push({ id: uid('e-'), type: 'image', x: (50 + offset - v.x) / v.z, y: (50 + offset - v.y) / v.z, w: result.width * scale, h: result.height * scale, img: result.name, sourceUrl: result.sourceUrl, sourceTitle: result.sourceTitle });
      this.workspaceEdited(); this.paintEasel();
    }
  }
};
