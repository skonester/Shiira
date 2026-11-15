import { mergeSidebar } from '../../shared/sidebar-merge.mjs';
import { sortByPosition } from './spaces-model.js';

export const SidebarSyncMixin = {
  initSidebarSync(doc) {
    this.spacesRevision = doc?.revision || 0;
    this.spacesBase = doc || this.serializeSpaces();
    window.shiiraAPI.spaces.onChanged(remote => {
      if (this.isLittle || !this.spacesLoaded || remote.revision <= this.spacesRevision) return;
      if (this.spacesSaving) { this.pendingSharedSpaces = remote; return; }
      this.receiveSharedSpaces(remote);
    });
  },
  receiveSharedSpaces(remote) {
    if (!remote || remote.revision <= this.spacesRevision) return;
    const local = this.serializeSpaces();
    const merged = mergeSidebar(this.spacesBase, local, remote);
    this.spacesBase = remote;
    this.spacesRevision = remote.revision;
    this.applySharedSpaces(merged);
  },
  applySharedSpaces(doc) {
    const focused = this.focusedSpaceId;
    this.withSidebarBatch(() => {
      this.spaces = doc.spaces;
      this.sidebarFolders = doc.folders;
      this.archive = doc.archive;
      const wanted = new Map(doc.items.map(item => [item.id, item]));
      for (const tab of [...this.tabs]) {
        if (!['pinned', 'favorites'].includes(tab.section) || tab.privateMode || tab.isHome) continue;
        const item = wanted.get(tab.itemId);
        if (!item) { this.removeSharedTab(tab); continue; }
        wanted.delete(tab.itemId);
        const oldProfile = tab.profileId || 'default';
        Object.assign(tab, { section: item.section, spaceId: item.spaceId, parentId: item.parentId, position: item.position,
          pinnedUrl: item.pinnedUrl, customTitle: item.customTitle, sharedTitle: item.title, sharedFavicon: item.favicon, profileId: item.profileId || this.profileForSpace?.(item.spaceId) || 'default' });
        tab.element.querySelector('.tab-title').textContent = tab.customTitle || tab.title;
        if (oldProfile !== this.profileForTab?.(tab)) this.resetTabProfile?.(tab);
      }
      for (const item of sortByPosition([...wanted.values()])) this.createTab(item.url, { ...item, itemId: item.id, deferLoad: true, background: true });
      const known = new Set(this.spaces.map(s => s.id));
      this.focusedSpaceId = known.has(focused) ? focused : this.spaces[0].id;
      for (const tab of this.tabs) if (tab.spaceId && !known.has(tab.spaceId)) tab.spaceId = this.focusedSpaceId;
    });
    this.reconcileProfiles?.();
    this.placeTabElements(); this.renderSpaceChrome();
    if (!this.tabs.some(t => t.id === this.activeTabId)) {
      const next = this.getVisibleTabOrder()[0];
      if (next) this.switchTab(next.id); else this.createTab();
    }
  },
  removeSharedTab(tab) {
    this.onTabClosing?.(tab); this.cancelHomeSearch?.(tab);
    if (this.splitPair?.includes(tab.id)) this.exitSplitView();
    tab.webview?.remove(); tab.element.remove();
    this.tabs = this.tabs.filter(t => t !== tab);
  }
};
