// Shiira Browser - Shield Module (Encrypted DNS)
// Adapted from Silver Browser (github.com/nichin-labs/silver) by Hitroo Labs — Apache License 2.0.
// See THIRD_PARTY_NOTICES/silver-browser-APACHE-2.0.txt. Ghost AI agent not included.

/**
 * Shield Mixin
 * Adds encrypted-DNS (DNS-over-HTTPS) toggle functionality to ShiiraBrowser
 */
export const ShieldMixin = {
  /**
   * Initialize Shield status on startup
   */
  async initShield() {
    try {
      const status = await window.shiiraAPI.shield.getStatus();
      this.shieldEnabled = !!status.enabled;
      this.updateShieldUI();
    } catch (e) {
      console.error('[Shield] Failed to initialize:', e);
      this.shieldEnabled = false;
      this.updateShieldUI();
    }
  },

  /**
   * Update Shield toggle UI state
   */
  updateShieldUI() {
    if (this.shieldToggle) {
      if (this.shieldEnabled) {
        this.shieldToggle.classList.add('active');
      } else {
        this.shieldToggle.classList.remove('active');
      }
    }
    if (this.shieldStatus) {
      this.shieldStatus.textContent = this.shieldEnabled ? 'On' : '';
    }
  },

  /**
   * Toggle Shield (encrypted DNS) on/off
   */
  async toggleShield() {
    this.shieldEnabled = !this.shieldEnabled;
    this.updateShieldUI();

    try {
      await window.shiiraAPI.shield.setEnabled(this.shieldEnabled);
    } catch (e) {
      console.error('[Shield] Failed to toggle:', e);
    }
  }
};

export default ShieldMixin;
