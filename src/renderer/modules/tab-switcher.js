import { escapeHtml } from './utils.js';
import { recentTabs } from './page-tools-model.js';

// Orbe's MRU workflow: snapshot the order, preview with Ctrl+Tab, commit on release.
export const TabSwitcherMixin = {
  initTabSwitcher() {
    const overlay = document.createElement('div');
    overlay.id = 'tab-switcher';
    overlay.className = 'tab-switcher hidden';
    overlay.tabIndex = -1;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Recent tabs');
    document.body.appendChild(overlay);
    this.tabSwitcherElement = overlay;
    overlay.addEventListener('click', event => {
      const button = event.target.closest('[data-switch-tab]');
      if (!button) return;
      this.tabSwitcher.index = this.tabSwitcher.ids.indexOf(button.dataset.switchTab);
      this.commitTabSwitcher();
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelTabSwitcher(); }
      else if (event.key === 'Enter') { event.preventDefault(); this.commitTabSwitcher(); }
    });
    window.addEventListener('blur', () => this.cancelTabSwitcher());
  },
  stepTabSwitcher(delta) {
    if (!this.tabSwitcher) {
      const ids = recentTabs(this.getCycleOrder(), this.activeTabId);
      if (ids.length < 2) return;
      this.tabSwitcher = { ids, index: 0 };
    }
    const state = this.tabSwitcher;
    state.ids = state.ids.filter(id => this.tabs.some(t => t.id === id && !t.element?.classList.contains('closing')));
    if (state.ids.length < 2) { this.cancelTabSwitcher(); return; }
    state.index = (state.index + delta + state.ids.length) % state.ids.length;
    this.tabSwitcherElement.innerHTML = '<p>Recent tabs <span>Release Ctrl to switch · Esc to cancel</span></p>' + state.ids.map((id, index) => {
      const tab = this.tabs.find(t => t.id === id);
      const title = tab.customTitle || tab.title || tab.url;
      return `<button role="option" aria-selected="${index === state.index}" class="${index === state.index ? 'selected' : ''}" data-switch-tab="${escapeHtml(id)}"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(tab.privateMode ? 'Private tab' : tab.url)}</small></button>`;
    }).join('');
    this.tabSwitcherElement.classList.remove('hidden');
    this.tabSwitcherElement.focus();
  },
  commitTabSwitcher() {
    if (!this.tabSwitcher) return;
    const id = this.tabSwitcher.ids[this.tabSwitcher.index];
    this.cancelTabSwitcher();
    if (id) { this.switchTab(id); this.tabs.find(t => t.id === id)?.webview?.focus(); }
  },
  cancelTabSwitcher() {
    this.tabSwitcher = null;
    this.tabSwitcherElement?.classList.add('hidden');
  }
};
