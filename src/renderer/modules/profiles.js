import { escapeHtml } from './utils.js';
import { uid } from './spaces-model.js';
export const ProfilesMixin = {
  async loadProfiles() {
    this.profiles = await window.shiiraAPI.profiles.list();
    if (!this.profiles?.length) this.profiles = [{ id: 'default', name: 'Default', partition: 'persist:main' }];
    window.shiiraAPI.profiles.onChanged(profiles => { this.profiles = profiles; this.renderProfileChoices(); });
    if (this.isLittle) return;
    const name = document.getElementById('space-name');
    const label = document.createElement('label'); label.htmlFor = 'space-profile'; label.textContent = 'Browser profile';
    const select = document.createElement('select'); select.id = 'space-profile';
    const hint = document.createElement('p'); hint.textContent = 'Spaces using the same profile share logins, history and favorites. A different profile starts with separate site data.';
    const create = document.createElement('button'); create.type = 'button'; create.className = 'settings-action'; create.textContent = 'Create profile';
    create.onclick = async () => {
      const profileName = await this.showPrompt('Create browser profile', 'Profile name', '');
      if (!profileName) return;
      const result = await window.shiiraAPI.profiles.create(profileName);
      if (result.error) { this.setStatus(result.error, 3000); return; }
      this.profiles = result.profiles; this.renderProfileChoices(); select.value = result.profile.id;
    };
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'settings-action'; rename.textContent = 'Rename profile';
    rename.onclick = async () => {
      const profile = this.profiles.find(p => p.id === select.value); if (!profile || profile.id === 'default') { this.setStatus('The Default profile keeps its name.', 2000); return; }
      const value = await this.showPrompt('Rename browser profile', 'Profile name', profile.name); if (!value) return;
      const result = await window.shiiraAPI.profiles.rename(profile.id, value);
      if (result.error) this.setStatus(result.error, 3000); else { this.profiles = result.profiles; this.renderProfileChoices(); }
    };
    const vault = document.createElement('p'); vault.textContent = 'Password Anvil and the bookmarks bar are shared app tools. Password autofill is enabled only in the Default profile.';
    const field = document.createElement('div'); field.className = 'space-editor-field space-profile-field';
    const actions = document.createElement('div'); actions.className = 'space-profile-actions'; actions.append(create, rename);
    field.append(label, select, hint, actions, vault); name.closest('.space-editor-body').appendChild(field);
    this.renderProfileChoices();
  },
  renderProfileChoices() {
    const select = document.getElementById('space-profile'); if (!select) return;
    const value = select.value;
    select.innerHTML = (this.profiles || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    select.value = this.profiles.some(p => p.id === value) ? value : 'default';
  },
  profileForSpace(spaceId = this.focusedSpaceId) { return this.spaces?.find(s => s.id === spaceId)?.profileId || 'default'; },
  spaceForProfile(profileId, preferred = this.focusedSpaceId) {
    const matching = this.spaces.filter(s => (s.profileId || 'default') === profileId);
    return matching.find(s => s.id === preferred) || matching.find(s => s.id === this.focusedSpaceId) || matching[0];
  },
  profileForTab(tab) { return tab?.section === 'favorites' ? tab.profileId || 'default' : this.profileForSpace(tab?.spaceId); },
  partitionForProfile(id = 'default') {
    if (id === 'default') return 'persist:main';
    // A catalog update may arrive after a shared Space. Never fall back to
    // Default's logins while waiting for that update.
    if (/^p-[a-f0-9]{32}$/.test(id)) return `persist:shiira-${id}`;
    throw new Error('This browser profile is unavailable.');
  },
  favoriteVisible(tab, spaceId = this.focusedSpaceId) { return tab.section !== 'favorites' || (tab.profileId || 'default') === this.profileForSpace(spaceId); },
  resetTabProfile(tab) {
    const address = tab.pendingUrl || this.currentTabUrl(tab) || tab.pinnedUrl || tab.url;
    tab.webview?.remove(); tab.webview = null;
    tab.mediaState = null; tab.isPlayingAudio = false; tab.isPictureInPicture = false; tab.hasUserInput = false;
    tab.pendingUrl = address;
    tab.profileId = this.profileForTab(tab);
    tab.element.classList.add('tab-suspended');
    if (tab.id === this.activeTabId && !tab.isHome) { this.ensureWebview(tab); tab.webview.src = address; tab.pendingUrl = null; tab.webview.classList.add('active'); }
    this.renderMiniPlayers?.();
  },
  reconcileProfiles() {
    for (const tab of this.tabs) {
      const expected = this.profileForTab(tab);
      const actual = tab.webview?.getAttribute('partition');
      if ((tab.profileId || 'default') !== expected || (actual && !tab.privateMode && actual !== this.partitionForProfile(expected))) this.resetTabProfile(tab);
    }
    this.updateExtensionToolbar?.();
  },
  async changeSpaceProfile(spaceId, profileId) {
    const space = this.spaces.find(s => s.id === spaceId);
    if (!space || !this.profiles.some(p => p.id === profileId) || (space.profileId || 'default') === profileId) return true;
    const tabs = this.tabs.filter(t => t.spaceId === spaceId && t.webview);
    if (!await this.showConfirmation('Switch browser profile?', 'Pages in this Space in all windows will reload with separate logins and site data. Save any unfinished forms first.', { confirmText: 'Switch profile' })) return false;
    if (this.splitPair) this.exitSplitView();
    space.profileId = profileId; this.reconcileProfiles(); this.placeTabElements();
    const active = this.tabs.find(t => t.id === this.activeTabId);
    if (active?.section === 'favorites' && !this.favoriteVisible(active)) this.createTab();
    await this.saveSpacesNow(); return true;
  },
  privatePartition(tabId) { return `private:${this.privateWindowId ||= uid('w-')}:${tabId}`; }
};
