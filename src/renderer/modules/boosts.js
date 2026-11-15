import { escapeHtml } from './utils.js';

export const BoostsMixin = {
  initBoosts() {
    const overlay = document.createElement('div');
    overlay.id = 'boost-dialog';
    overlay.className = 'shiira-modal hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'boost-title');
    overlay.innerHTML = `<div class="shiira-modal-content browser-import-card"><div class="shiira-modal-header"><h3 id="boost-title">Boost this site</h3><button id="boost-close" class="panel-close-btn" aria-label="Close Boosts">×</button></div>
      <div class="browser-import-body boost-body"><p id="boost-origin"></p><label><input type="checkbox" id="boost-enabled"> Enable this Boost</label><label for="boost-css">Custom CSS</label>
      <textarea id="boost-css" rows="10" maxlength="50000" spellcheck="false" placeholder="body { font-size: 18px; }"></textarea>
      <p>CSS applies only to this site. Zap hides an element each time you visit.</p><div class="settings-inline"><button id="boost-zap" class="settings-action">Zap an element…</button><button id="boost-reset" class="settings-action">Reset this site</button></div>
      <div id="boost-zaps"></div><div id="boost-status" role="status"></div><button id="boost-save" class="setup-primary">Save Boost</button></div></div>`;
    document.body.appendChild(overlay);
    this.boostDialog = overlay;
    document.getElementById('boost-close').onclick = () => this.hideBoosts();
    document.getElementById('boost-save').onclick = () => this.saveBoost();
    document.getElementById('boost-zap').onclick = () => this.startZap();
    document.getElementById('boost-reset').onclick = () => {
      this.boostDraft.zaps = [];
      document.getElementById('boost-css').value = '';
      this.renderBoostZaps();
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) this.hideBoosts(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hideBoosts(); }
      if (e.key === 'Tab') {
        const fields = [...overlay.querySelectorAll('button,input,textarea')];
        if (e.shiftKey && document.activeElement === fields[0]) { e.preventDefault(); fields.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === fields.at(-1)) { e.preventDefault(); fields[0].focus(); }
      }
    });
  },
  async showBoosts() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab?.webview || tab.privateMode) { this.setStatus('Open a regular website tab to customize it.', 2500); return; }
    try {
      const id = tab.webview.getWebContentsId();
      const result = await window.shiiraAPI.boosts.get(id);
      if (result.error) throw new Error(result.error);
      this.boostReturnFocus = document.activeElement;
      this.boostDraft = { ...result.boost, id, origin: result.origin, tabId: tab.id };
      document.getElementById('boost-origin').textContent = result.origin;
      document.getElementById('boost-css').value = result.boost.css;
      document.getElementById('boost-enabled').checked = result.boost.enabled;
      document.getElementById('boost-status').textContent = '';
      this.renderBoostZaps();
      this.boostDialog.classList.remove('hidden');
      document.getElementById('boost-css').focus();
    } catch (error) { this.setStatus(error.message, 3000); }
  },
  hideBoosts() {
    if (this.boostDialog?.classList.contains('hidden')) return;
    this.boostDialog?.classList.add('hidden');
    this.boostReturnFocus?.focus?.();
  },
  renderBoostZaps() {
    const list = document.getElementById('boost-zaps');
    list.innerHTML = this.boostDraft.zaps.map((s, index) => `<div class="boost-zap-row"><code>${escapeHtml(s)}</code><button data-remove-zap="${index}" class="settings-action" aria-label="Stop hiding ${escapeHtml(s)}">Remove</button></div>`).join('');
    list.querySelectorAll('[data-remove-zap]').forEach(button => { button.onclick = () => { this.boostDraft.zaps.splice(Number(button.dataset.removeZap), 1); this.renderBoostZaps(); }; });
  },
  async saveBoost() {
    if (!this.boostDraft) return;
    const draft = this.boostDraft;
    draft.css = document.getElementById('boost-css').value;
    draft.enabled = document.getElementById('boost-enabled').checked;
    const result = await window.shiiraAPI.boosts.save(draft.id, draft.origin, { css: draft.css, enabled: draft.enabled, zaps: draft.zaps });
    document.getElementById('boost-status').textContent = result.error || 'Boost saved. This site has been updated.';
    if (result.boost) { draft.zaps = result.boost.zaps; this.renderBoostZaps(); }
    return result;
  },
  async startZap() {
    const draft = this.boostDraft;
    const tab = this.tabs.find(t => t.id === draft?.tabId);
    if (!tab?.webview || draft.origin !== new URL(tab.url).origin) return;
    draft.css = document.getElementById('boost-css').value;
    draft.enabled = document.getElementById('boost-enabled').checked;
    this.hideBoosts();
    this.setStatus('Zap: click an element to hide. Press Esc to cancel.', 15000);
    this.cancelActiveZap = () => tab.webview?.executeJavaScript("document.dispatchEvent(new Event('shiira-cancel-zap'))").catch(() => {});
    try {
      const selector = await tab.webview.executeJavaScript(`new Promise(resolve => {
        const style = document.createElement('style');
        style.textContent = '* { cursor: crosshair !important; } [data-shiira-zap-target] { outline: 2px solid #a78bfa !important; }';
        document.documentElement.appendChild(style);
        let marked;
        const clean = () => { clearTimeout(timer); marked?.removeAttribute('data-shiira-zap-target'); style.remove(); document.removeEventListener('pointerover', hover, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); document.removeEventListener('shiira-cancel-zap', cancel); };
        const cancel = () => { clean(); resolve(null); };
        const allowed = el => el && !['HTML', 'BODY', 'HEAD'].includes(el.tagName) && !el.closest('#shiira-youtube-player') && !el.querySelector('#shiira-youtube-player');
        const hover = e => { marked?.removeAttribute('data-shiira-zap-target'); marked = allowed(e.target) ? e.target : null; marked?.setAttribute('data-shiira-zap-target', ''); };
        const click = e => {
          e.preventDefault(); e.stopImmediatePropagation();
          if (!allowed(e.target)) return;
          const parts = []; let el = e.target;
          for (let depth = 0; el && el !== document.body && depth < 12; depth++, el = el.parentElement) {
            if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
            const index = [...el.parentElement.children].indexOf(el) + 1;
            parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + index + ')');
          }
          clean(); resolve(parts.join(' > '));
        };
        const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); clean(); resolve(null); } };
        const timer = setTimeout(() => { clean(); resolve(null); }, 30000);
        document.addEventListener('shiira-cancel-zap', cancel, { once: true });
        document.addEventListener('pointerover', hover, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
      })`, true);
      if (selector && selector.length <= 500) draft.zaps = [...new Set([...draft.zaps, selector])];
      if (!this.tabs.includes(tab)) return;
      this.boostDraft = draft;
      document.getElementById('boost-css').value = draft.css;
      document.getElementById('boost-enabled').checked = draft.enabled;
      this.renderBoostZaps();
      this.boostDialog.classList.remove('hidden');
      document.getElementById('boost-save').focus();
      this.setStatus('Ready', 1000);
    } catch { this.setStatus('Zap cancelled because the page changed.', 2500); }
    finally { this.cancelActiveZap = null; }
  }
};
