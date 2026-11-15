import { escapeHtml } from './utils.js';
import { NavigationMixin } from './navigation.js';
import { parseSearchUrl } from './search-model.js';

export function littleAddress(input, engine = 'brave') {
  let value = String(input || '').trim();
  if (!value) return null;
  const search = parseSearchUrl(value);
  if (search) { value = search.query; engine = search.provider; }
  else {
    if (/^(localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|\[::1\](?::\d+)?)(\/|$)/i.test(value)) value = 'http://' + value;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && /^[\w-]+(?:\.[\w-]+)+(?:[/:]|$)/.test(value) && !/\s/.test(value)) value = 'https://' + value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null; }
      catch { return null; }
    }
  }
  const endpoints = { brave: 'https://search.brave.com/search', scira: 'https://scira.ai/', duckduckgo: 'https://duckduckgo.com/' };
  const url = new URL(endpoints[engine] || endpoints.brave);
  url.searchParams.set('q', value);
  return url.href;
}

function destinations(config, selected) {
  const choices = [['main', 'Current Space in Shiira'], ['little', 'Little Shiira window'], ...(config?.spaces || []).map(s => [`space:${s.id}`, `${s.icon || ''} ${s.title}`.trim()])];
  if (selected && !choices.some(([id]) => id === selected)) choices.push([selected, 'Unavailable Space — choose another destination']);
  return choices.map(([id, title]) => `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(title)}</option>`).join('');
}

export const ExternalLinksMixin = {
  initExternalLinks() {
    window.shiiraAPI.externalLinks.onOpen(async request => {
      if (this.isLittle) return;
      try {
        if (request.spaceId && !this.spaces.some(s => s.id === request.spaceId)) {
          if (request.fallbackToCurrent) request.spaceId = null;
          else throw new Error('The destination Space is no longer available.');
        }
        if (request.url) {
          const safe = new URL(request.url);
          if (!/^https?:$/.test(safe.protocol)) throw new Error('Unsupported link.');
          this.createTab(request.url, { spaceId: request.spaceId || this.focusedSpaceId });
          await this.saveSession();
        }
        if (request.command) this.handleKeyboardShortcut(request.command);
        window.shiiraAPI.externalLinks.acknowledge(request.requestId, { success: true });
      } catch (error) { window.shiiraAPI.externalLinks.acknowledge(request.requestId, { error: error.message }); }
    });
    if (this.isLittle) { this.initLittleWindow(); return; }
    const nav = document.createElement('button');
    nav.type = 'button'; nav.dataset.settingsSection = 'links'; nav.textContent = 'Link Routing';
    nav.onclick = () => this.selectSettingsSection('links');
    document.querySelector('.settings-nav').appendChild(nav);
    const page = document.createElement('section');
    page.className = 'settings-page hidden'; page.dataset.settingsPage = 'links';
    page.innerHTML = `<h4>Link Routing</h4><p>Choose where links opened by other apps go. Set Shiira as your web browser in your operating system’s default-app settings to use these rules.</p>
      <div class="settings-group"><label for="link-default">When no rule matches, open in</label><select id="link-default"></select></div>
      <div class="settings-group"><h5>Site rules</h5><p>The first matching rule wins. A site includes its subdomains; paths match whole segments and preserve capitalization. Example: github.com/MyOrg or localhost:3000.</p><div id="link-rules"></div>
      <div class="settings-inline"><button id="link-add" class="settings-action">Add rule</button><button id="link-save" class="settings-action">Save routing</button><button id="link-refresh" class="settings-action">Refresh Spaces</button></div></div>
      <p id="link-status" role="status" aria-live="polite"></p>
      <div class="settings-group"><h5>Try a saved rule</h5><div class="settings-inline"><input id="link-test-url" type="url" placeholder="https://example.com/path" aria-label="URL to test"><button id="link-test" class="settings-action">Preview destination</button></div><p id="link-preview" role="status"></p></div>`;
    document.querySelector('.settings-pages').appendChild(page);
    document.getElementById('link-add').onclick = () => {
      if (!this.routingDraft || this.routingBusy) return;
      this.readRoutingDraft();
      if (this.routingDraft.rules.length >= 100) return;
      this.routingDraft.rules.push({ match: '', to: 'main' });
      this.renderRoutingSettings();
      document.querySelector('#link-rules .link-rule-row:last-child input')?.focus();
    };
    document.getElementById('link-save').onclick = () => this.saveRoutingSettings();
    document.getElementById('link-refresh').onclick = () => this.loadRoutingSettings(true);
    document.getElementById('link-test').onclick = async () => {
      if (!this.routingConfig || this.routingBusy) return;
      const result = await window.shiiraAPI.externalLinks.preview(document.getElementById('link-test-url').value);
      const space = this.routingConfig.spaces.find(s => `space:${s.id}` === result.to);
      document.getElementById('link-preview').textContent = result.error || `${result.match ? `Rule: ${result.match}. ` : 'No site rule matched. '}Destination: ${space?.title || (result.to === 'little' ? 'Little Shiira' : 'current Space in Shiira')}.`;
    };
  },
  async openLittleWindow(url = '') {
    if (!this.isLittle) await this.saveSpacesNow?.();
    const result = await window.shiiraAPI.externalLinks.openLittle(url);
    if (result.error) this.setStatus(result.error, 3000);
    return result;
  },
  setRoutingBusy(busy) {
    this.routingBusy = busy;
    document.querySelectorAll('[data-settings-page="links"] button,[data-settings-page="links"] select,[data-settings-page="links"] input').forEach(el => {
      if (busy) { el.dataset.routingDisabled = String(el.disabled); el.disabled = true; }
      else if (el.dataset.routingDisabled !== undefined) { el.disabled = el.dataset.routingDisabled === 'true'; delete el.dataset.routingDisabled; }
    });
  },
  loadRoutingSettings(preserve = false) {
    if (this.isLittle) return;
    if (this.routingLoad) return this.routingLoad;
    this.routingLoad = this.fetchRoutingSettings(preserve).finally(() => { this.routingLoad = null; });
    return this.routingLoad;
  },
  async fetchRoutingSettings(preserve) {
    if (preserve && this.routingDraft) this.readRoutingDraft();
    this.setRoutingBusy(true);
    try {
    await this.saveSpacesNow?.();
    const result = await window.shiiraAPI.externalLinks.get();
    if (result.error) { document.getElementById('link-status').textContent = result.error; return; }
    this.routingConfig = result;
    if (!preserve || !this.routingDraft) this.routingDraft = { defaultDestination: result.defaultDestination, rules: result.rules.map(r => ({ match: r.match, to: r.to })) };
    this.renderRoutingSettings();
    } catch (error) { document.getElementById('link-status').textContent = error.message; }
    finally { this.setRoutingBusy(false); }
  },
  readRoutingDraft() {
    if (!this.routingDraft) return;
    this.routingDraft = { defaultDestination: document.getElementById('link-default').value,
      rules: [...document.querySelectorAll('#link-rules .link-rule-row')].map(row => ({ match: row.querySelector('input').value, to: row.querySelector('select').value })) };
  },
  renderRoutingSettings() {
    document.getElementById('link-default').innerHTML = destinations(this.routingConfig, this.routingDraft.defaultDestination);
    const host = document.getElementById('link-rules');
    host.innerHTML = this.routingDraft.rules.map((r, i) => `<div class="link-rule-row" data-rule-index="${i}"><input value="${escapeHtml(r.match)}" aria-label="Site or site/path for rule ${i + 1}" placeholder="example.com/path"><select aria-label="Destination for rule ${i + 1}">${destinations(this.routingConfig, r.to)}</select><div class="link-rule-actions"><button class="settings-action" data-rule-action="up" aria-label="Move rule up"${i === 0 ? ' disabled' : ''}>↑</button><button class="settings-action" data-rule-action="down" aria-label="Move rule down"${i === this.routingDraft.rules.length - 1 ? ' disabled' : ''}>↓</button><button class="settings-action" data-rule-action="remove">Remove</button></div></div>`).join('') || '<p>No site rules. All external links use the destination above.</p>';
    host.querySelectorAll('[data-rule-action]').forEach(button => { button.onclick = () => {
      this.readRoutingDraft();
      const i = Number(button.closest('[data-rule-index]').dataset.ruleIndex);
      const action = button.dataset.ruleAction;
      if (action === 'remove') this.routingDraft.rules.splice(i, 1);
      else { const j = i + (action === 'up' ? -1 : 1); [this.routingDraft.rules[i], this.routingDraft.rules[j]] = [this.routingDraft.rules[j], this.routingDraft.rules[i]]; }
      this.renderRoutingSettings();
    }; });
  },
  async saveRoutingSettings() {
    if (!this.routingDraft || this.routingBusy) return;
    this.readRoutingDraft();
    this.setRoutingBusy(true);
    try {
    const result = await window.shiiraAPI.externalLinks.save(this.routingDraft);
    if (result.success) { this.routingConfig = result; this.routingDraft = { defaultDestination: result.defaultDestination, rules: result.rules.map(r => ({ match: r.match, to: r.to })) }; this.renderRoutingSettings(); }
    document.getElementById('link-status').textContent = result.error || 'Link routing saved.';
    return result;
    } catch (error) { document.getElementById('link-status').textContent = error.message; return { error: error.message }; }
    finally { this.setRoutingBusy(false); }
  },
  initLittleWindow() {
    document.documentElement.classList.add('little-window');
    const controls = document.createElement('div');
    controls.className = 'little-actions';
    controls.innerHTML = '<button id="little-promote" title="Open in Shiira (Ctrl+O)">Open in Shiira</button><button id="little-choose-space" title="Choose a destination Space" aria-label="Choose a destination Space">⌄</button>';
    this.navbar.insertBefore(controls, this.windowControls);
    const picker = document.createElement('div');
    picker.id = 'little-spaces'; picker.className = 'little-spaces hidden';
    picker.setAttribute('role', 'dialog'); picker.setAttribute('aria-label', 'Open in a Space');
    picker.innerHTML = '<input id="little-space-search" type="search" placeholder="Find a Space" aria-label="Find a Space"><div id="little-space-list"></div>';
    document.body.appendChild(picker);
    const empty = document.createElement('div'); empty.id = 'little-empty'; empty.className = 'little-empty';
    empty.innerHTML = '<h2>Little Shiira</h2><p>A quick window for a page or search.<br>Type in the address bar to begin.</p>';
    this.browserContent.appendChild(empty);
    document.getElementById('little-promote').onclick = () => this.promoteLittleWindow();
    document.getElementById('little-choose-space').onclick = () => this.showLittleSpaces();
    document.getElementById('little-space-search').oninput = () => this.renderLittleSpaces();
    window.shiiraAPI.externalLinks.onLittleOpen(url => {
      if (url) this.navigate(url);
      else { this.urlInput.focus(); this.urlInput.select(); }
      this.updateLittleWindow();
    });
    window.shiiraAPI.externalLinks.onFocusAddress(() => { this.urlInput.focus(); this.urlInput.select(); });
    window.shiiraAPI.externalLinks.onError(error => this.setStatus(error, 5000));
  },
  processUrl(input) {
    if (!this.isLittle) return NavigationMixin.processUrl.call(this, input);
    const url = littleAddress(input, this.currentSearchEngine);
    if (url) return url;
    this.setStatus?.('Little Shiira opens web addresses and searches.');
    return this.currentTabUrl?.(this.tabs.find(t => t.id === this.activeTabId)) || 'about:blank';
  },
  updateLittleWindow() {
    if (!this.isLittle) return;
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    const hasPage = tab && !tab.isHome && /^https?:/i.test(this.currentTabUrl(tab) || '');
    document.getElementById('little-empty')?.classList.toggle('hidden', !!hasPage);
    for (const id of ['little-promote', 'little-choose-space']) { const button = document.getElementById(id); if (button) button.disabled = !hasPage || this.promotingLittle; }
  },
  async showLittleSpaces() {
    const picker = document.getElementById('little-spaces');
    if (!picker.classList.contains('hidden')) { picker.classList.add('hidden'); return; }
    const config = await window.shiiraAPI.externalLinks.get();
    this.littleSpaces = config.spaces || [];
    document.getElementById('little-space-search').value = '';
    this.renderLittleSpaces();
    picker.classList.remove('hidden');
    document.getElementById('little-space-search').focus();
  },
  renderLittleSpaces() {
    const query = document.getElementById('little-space-search').value.trim().toLowerCase();
    const host = document.getElementById('little-space-list');
    host.innerHTML = (this.littleSpaces || []).filter(s => s.title.toLowerCase().includes(query)).map(s => `<button data-little-space="${escapeHtml(s.id)}">${escapeHtml(`${s.icon || ''} ${s.title}`)}</button>`).join('') || '<p>No matching Spaces.</p>';
    host.querySelectorAll('[data-little-space]').forEach(button => { button.onclick = () => this.promoteLittleWindow(button.dataset.littleSpace); });
  },
  async promoteLittleWindow(spaceId = null) {
    if (!this.isLittle || this.promotingLittle) return;
    this.promotingLittle = true; this.updateLittleWindow();
    try {
      const result = await window.shiiraAPI.externalLinks.promote(spaceId);
      if (result.error) this.setStatus(result.error, 5000);
      return result;
    } finally { this.promotingLittle = false; this.updateLittleWindow(); }
  }
};
