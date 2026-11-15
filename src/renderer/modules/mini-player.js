import { escapeHtml } from './utils.js';
import { mediaControl } from './page-tools.js';

// Sidebar transport controls supplement Shiira's existing in-page player.
export const MiniPlayerMixin = {
  initMiniPlayers() {
    const host = document.createElement('div');
    host.id = 'sidebar-mini-players';
    host.className = 'sidebar-mini-players hidden';
    host.setAttribute('aria-label', 'Background media');
    this.sidebar?.querySelector('.sb-foot')?.before(host);
    this.miniPlayersHost = host;
    host.addEventListener('focusout', () => queueMicrotask(() => this.renderMiniPlayers()));
    host.addEventListener('click', event => {
      const button = event.target.closest('[data-media-action]');
      if (!button) return;
      const tab = this.tabs.find(t => t.id === button.closest('[data-media-tab]').dataset.mediaTab);
      if (!tab) return;
      const action = button.dataset.mediaAction;
      if (action === 'open') { this.switchTab(tab.id); return; }
      if (action === 'dismiss') { tab.mediaDismissed = true; this.renderMiniPlayers(); this.controlBackgroundMedia(tab, 'pause'); return; }
      this.controlBackgroundMedia(tab, action);
    });
    host.addEventListener('change', event => {
      if (!event.target.matches('[data-media-seek]')) return;
      const tab = this.tabs.find(t => t.id === event.target.closest('[data-media-tab]').dataset.mediaTab);
      this.controlBackgroundMedia(tab, 'seek', Number(event.target.value));
    });
  },
  renderMiniPlayers() {
    if (!this.miniPlayersHost) return;
    if (this.miniPlayersHost.contains(document.activeElement) && document.activeElement?.matches('[data-media-seek]')) return;
    const tabs = this.tabs.filter(t => t.mediaState && !t.mediaDismissed && t.id !== this.activeTabId && !this.splitPair?.includes(t.id) && t.webview && !t.element?.classList.contains('closing')).slice(-3);
    this.miniPlayersHost.classList.toggle('hidden', !tabs.length);
    this.miniPlayersHost.innerHTML = tabs.map(tab => {
      const state = tab.mediaState;
      const title = tab.privateMode ? 'Private media' : tab.customTitle || tab.title || 'Playing media';
      return `<section class="sidebar-mini-player" data-media-tab="${escapeHtml(tab.id)}"><div class="mini-player-heading"><button data-media-action="open" title="Return to media tab">${escapeHtml(title)}</button><button data-media-action="dismiss" aria-label="Pause and dismiss media">×</button></div>
        <div class="mini-player-transport"><button data-media-action="back" aria-label="Back 10 seconds">−10</button><button data-media-action="toggle" aria-label="${state.paused ? 'Play' : 'Pause'}">${state.paused ? '▶' : 'Ⅱ'}</button><button data-media-action="forward" aria-label="Forward 10 seconds">+10</button><button data-media-action="mute" aria-label="${state.muted ? 'Unmute' : 'Mute'}">${state.muted ? 'Unmute' : 'Mute'}</button></div>
        ${state.duration > 0 ? `<input type="range" min="0" max="${state.duration}" step="1" value="${Math.min(state.time, state.duration)}" data-media-seek aria-label="Playback position">` : ''}</section>`;
    }).join('');
  },
  async controlBackgroundMedia(tab, action, value = 0) {
    if (!tab?.webview || !['toggle', 'pause', 'mute', 'seek', 'back', 'forward'].includes(action)) return;
    const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
    try {
      const controlled = await mediaControl(tab.webview, action, seconds);
      if (!controlled) this.setStatus?.('This page’s media controls are unavailable.', 2000);
    } catch { this.setStatus?.('This page’s media controls are unavailable.', 2000); }
  },
  updateMiniPlayerProgress(tab) {
    const row = this.miniPlayersHost?.querySelector(`[data-media-tab="${tab.id}"]`);
    const seek = row?.querySelector('[data-media-seek]');
    if (seek && seek !== document.activeElement) seek.value = String(tab.mediaState.time);
  }
};
