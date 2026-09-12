// Shiira Browser - Vault Manager Module (Safe Folder)
// Adapted from Silver Browser (github.com/nichin-labs/silver) by Hitroo Labs — Apache License 2.0.
// See THIRD_PARTY_NOTICES/silver-browser-APACHE-2.0.txt. Ghost AI agent not included.

import { escapeHtml } from './utils.js';

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Vault Manager Mixin
 * Adds Safe Folder (encrypted arbitrary file storage) functionality to ShiiraBrowser,
 * gated behind a PIN (with an optional Touch ID attempt first on macOS).
 */
export const VaultManagerMixin = {
  _vaultUnlocked: false,
  _vaultFiles: [],

  /**
   * Show the Safe Folder panel, prompting to unlock (or create a PIN) first.
   */
  async showVault() {
    const authed = await this.unlockVault();
    if (!authed) return;

    this.vaultPanel?.classList.remove('hidden');
    await this.renderVaultFileList();
  },

  hideVaultPanel() {
    this.vaultPanel?.classList.add('hidden');
  },

  /**
   * Try Touch ID (macOS only, no-op elsewhere) then fall back to a PIN prompt.
   * @returns {Promise<boolean>} true if unlocked
   */
  async unlockVault() {
    if (this._vaultUnlocked) return true;

    const hasPin = await window.shiiraAPI.vault.hasPin();

    if (!hasPin) {
      const pin = await this.promptForPin(
        'Set Up Safe Folder',
        'Create a PIN to protect your Safe Folder:'
      );
      if (!pin) return false;
      await window.shiiraAPI.vault.setupPin(pin);
      this._vaultUnlocked = true;
      return true;
    }

    const biometricOk = await window.shiiraAPI.vault.tryBiometric('unlock your Safe Folder');
    if (biometricOk) {
      this._vaultUnlocked = true;
      return true;
    }

    const pin = await this.promptForPin('Safe Folder Locked', 'Enter your PIN to continue:');
    if (!pin) return false;

    const verified = await window.shiiraAPI.vault.verifyPin(pin);
    if (!verified) {
      await this.showError?.('Incorrect PIN.');
      return false;
    }

    this._vaultUnlocked = true;
    return true;
  },

  /**
   * Prompt for a PIN using the existing modal-system prompt, masked like a password field.
   */
  async promptForPin(title, message) {
    if (this.promptModalInput) this.promptModalInput.type = 'password';
    try {
      const value = await this.showPrompt(title, message, '', { placeholder: 'PIN' });
      return value && value.trim() ? value.trim() : null;
    } finally {
      if (this.promptModalInput) this.promptModalInput.type = 'text';
    }
  },

  async renderVaultFileList() {
    if (!this.vaultFileList) return;

    try {
      this._vaultFiles = await window.shiiraAPI.vault.safeList();
    } catch (e) {
      console.error('[Vault] Failed to list files:', e);
      this._vaultFiles = [];
    }

    if (this._vaultFiles.length === 0) {
      this.vaultFileList.innerHTML = `
        <div class="vault-empty">
          <div class="vault-empty-text">No files in your Safe Folder</div>
          <div class="vault-empty-subtext">Add a file to store it encrypted on this device</div>
        </div>
      `;
      return;
    }

    const html = this._vaultFiles
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((file) => `
        <div class="vault-item" data-id="${file.id}">
          <img class="vault-item-icon" src="shiira-asset://ui-icons/lock.svg" alt="">
          <div class="vault-item-content">
            <div class="vault-item-name">${escapeHtml(file.name)}</div>
          </div>
          <div class="vault-item-size">${formatFileSize(file.size)}</div>
          <div class="vault-item-actions">
            <button class="vault-action-btn download" data-id="${file.id}" title="Download">
              <img src="shiira-asset://ui-icons/import.svg" alt="Download">
            </button>
            <button class="vault-action-btn delete" data-id="${file.id}" title="Delete">
              <img src="shiira-asset://ui-icons/delete.svg" alt="Delete">
            </button>
          </div>
        </div>
      `)
      .join('');

    this.vaultFileList.innerHTML = html;

    this.vaultFileList.querySelectorAll('.vault-action-btn.download').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadVaultFile(btn.dataset.id);
      });
    });

    this.vaultFileList.querySelectorAll('.vault-action-btn.delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeVaultFile(btn.dataset.id);
      });
    });
  },

  /**
   * Read a picked file and store it encrypted in the Safe Folder.
   */
  async addVaultFile(fileObj) {
    if (!fileObj) return;

    try {
      const buffer = await fileObj.arrayBuffer();
      const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      await window.shiiraAPI.vault.safeAdd(fileObj.name, base64, fileObj.type || 'application/octet-stream');
      await this.renderVaultFileList();
    } catch (e) {
      console.error('[Vault] Failed to add file:', e);
      await this.showError?.('Failed to add file to Safe Folder.');
    }
  },

  async downloadVaultFile(id) {
    try {
      const result = await window.shiiraAPI.vault.safeGet(id);
      if (!result) return;

      const byteChars = atob(result.data);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: result.file.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = result.file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('[Vault] Failed to download file:', e);
      await this.showError?.('Failed to download file.');
    }
  },

  async removeVaultFile(id) {
    const confirmed = this.showConfirmation
      ? await this.showConfirmation('Delete File', 'Remove this file from your Safe Folder?', { danger: true })
      : true;
    if (!confirmed) return;

    try {
      await window.shiiraAPI.vault.safeRemove(id);
      await this.renderVaultFileList();
    } catch (e) {
      console.error('[Vault] Failed to remove file:', e);
    }
  }
};

export default VaultManagerMixin;
