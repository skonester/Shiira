export function isLocalDevelopment(url) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); }
  catch { return false; }
}
const webOrigin = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };
export function mediaControl(view, action, value = 0) {
  // Webview methods can throw synchronously before attachment or after unload.
  try { return Promise.resolve(window.shiiraAPI.pageTools.mediaControl(view.getWebContentsId(), action, value)).catch(() => false); }
  catch { return Promise.resolve(false); }
}

export const PageToolsMixin = {
  initPageTools() {
    const button = document.createElement('button');
    button.className = 'nav-btn hidden';
    button.id = 'developer-tools-button';
    button.title = 'Open page developer tools';
    button.textContent = '{ }';
    button.onclick = () => this.togglePageDevTools();
    document.getElementById('btn-menu')?.before(button);
    const pip = document.getElementById('settings-auto-pip');
    if (pip) {
      pip.checked = localStorage.getItem('shiira-auto-pip') !== 'false';
      pip.onchange = () => localStorage.setItem('shiira-auto-pip', String(pip.checked));
    }
  },
  isDeveloperMode(tab = this.tabs.find(t => t.id === this.activeTabId)) {
    const origin = webOrigin(tab?.url);
    if (!origin) return false;
    const stored = localStorage.getItem(`shiira-developer:${origin}`);
    return stored === null ? isLocalDevelopment(tab.url) : stored === 'true';
  },
  updateDeveloperMode() {
    const enabled = this.isDeveloperMode();
    document.body.classList.toggle('developer-mode', enabled);
    document.getElementById('developer-tools-button')?.classList.toggle('hidden', !enabled);
  },
  toggleDeveloperMode() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    const origin = webOrigin(tab?.url);
    if (!origin) return;
    localStorage.setItem(`shiira-developer:${origin}`, String(!this.isDeveloperMode(tab)));
    this.updateDeveloperMode();
  },
  togglePageDevTools() {
    const view = this.tabs.find(t => t.id === this.activeTabId)?.webview;
    if (!view) return;
    try { view.isDevToolsOpened() ? view.closeDevTools() : view.openDevTools(); }
    catch { this.setStatus('Developer tools are unavailable for this page.', 2500); }
  },
  isAutoPipEnabled(tab) {
    return localStorage.getItem('shiira-auto-pip') !== 'false' && localStorage.getItem(`shiira-auto-pip-off:${webOrigin(tab?.url)}`) !== 'true';
  },
  toggleSiteAutoPip() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    const origin = webOrigin(tab?.url);
    if (!origin) return;
    const key = `shiira-auto-pip-off:${origin}`;
    localStorage.setItem(key, localStorage.getItem(key) === 'true' ? 'false' : 'true');
    this.setStatus(this.isAutoPipEnabled(tab) ? 'Automatic picture-in-picture enabled for this site' : 'Automatic picture-in-picture disabled for this site', 2500);
  },
  handleMediaTabChange(previousId, nextId) {
    if (previousId === nextId) return;
    const next = this.tabs.find(t => t.id === nextId);
    if (next?.autoPictureInPicture && next.webview) {
      next.autoPictureInPicture = false;
      void mediaControl(next.webview, 'exit-auto-pip');
    }
    const previous = this.tabs.find(t => t.id === previousId);
    if (!previous?.webview || this.splitPair?.includes(previousId) || !this.isAutoPipEnabled(previous)) return;
    if (!previous.isPlayingAudio && previous.mediaState?.paused !== false) return;
    const view = previous.webview;
    mediaControl(view, 'auto-pip').then(opened => {
      if (!opened) return;
      if (previous.webview !== view || this.activeTabId === previousId || this.splitPair?.includes(previousId)) void mediaControl(view, 'exit-auto-pip');
      else previous.autoPictureInPicture = true;
    }).catch(() => {});
  },
  async capturePage(mode = 'visible', rect, tabId = this.activeTabId, destination = 'save') {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab?.webview) { this.setStatus('Open a page to capture it.', 2000); return; }
    try {
      const result = await window.shiiraAPI.pageTools.capture(tab.webview.getWebContentsId(), { mode, rect, destination });
      if (result?.error) this.showError(result.error, 'Capture failed');
      else if (!result?.canceled) this.setStatus(result.copied ? 'Capture copied to clipboard' : 'Capture saved', 2500);
      return result;
    } catch (error) { this.showError(error.message, 'Capture failed'); }
  },
  startAreaCapture() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab?.webview) { this.setStatus('Open a page to capture it.', 2000); return; }
    this.hideCommandBar?.();
    this.cancelAreaCapture?.();
    const bounds = tab.webview.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'page-capture-overlay';
    overlay.tabIndex = -1;
    Object.assign(overlay.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    overlay.innerHTML = '<p>Drag an area to copy it · Enter copies the visible page · Esc cancels</p><div class="page-capture-selection"></div>';
    document.body.appendChild(overlay);
    let start;
    const point = e => ({ x: Math.max(0, Math.min(bounds.width, e.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, e.clientY - bounds.top)) });
    const region = p => ({ x: Math.round(Math.min(start.x, p.x)), y: Math.round(Math.min(start.y, p.y)), width: Math.round(Math.abs(p.x - start.x)), height: Math.round(Math.abs(p.y - start.y)) });
    const finish = async rect => {
      this.cancelAreaCapture();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await this.capturePage(rect ? 'area' : 'visible', rect, tab.id, 'copy');
    };
    this.cancelAreaCapture = () => { overlay.remove(); this.cancelAreaCapture = null; };
    overlay.onpointerdown = e => { if (e.button !== 0) return; start = point(e); overlay.setPointerCapture(e.pointerId); };
    overlay.onpointermove = e => {
      if (!start) return;
      const r = region(point(e));
      Object.assign(overlay.lastElementChild.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    overlay.onpointerup = e => {
      if (!start) return;
      const r = region(point(e));
      if (r.width > 2 && r.height > 2) finish(r);
      else start = null;
    };
    overlay.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelAreaCapture?.(); }
    };
    overlay.focus();
  }
};
