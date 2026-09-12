// Adapted from Silver Browser (github.com/nichin-labs/silver) by Hitroo Labs — Apache License 2.0.
// See THIRD_PARTY_NOTICES/silver-browser-APACHE-2.0.txt. Ghost AI agent not included.
//
// Shiira Vault - Encrypted Safe Folder (arbitrary file storage) with PIN / Touch ID unlock.
// Reuses the OS-keychain-backed encryption key already derived by PasswordService instead of
// deriving a second, separate key (Silver derives its own machine-fingerprint key per vault).

const { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';

class VaultService {
  constructor(encryptionKey, userDataPath) {
    this.key = encryptionKey;
    this.vaultDir = path.join(userDataPath, 'vault');
    this.safeDir = path.join(this.vaultDir, 'files');
    this.indexFile = path.join(this.vaultDir, 'safe-index.enc');
    this.pinFile = path.join(this.vaultDir, 'pin.hash');

    this.files = [];
    this.loadIndex();
  }

  // --- AES-256-GCM buffer encryption: [iv(16)][tag(16)][ciphertext] ---

  encryptBuffer(data) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  decryptBuffer(data) {
    const iv = data.subarray(0, 16);
    const tag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  // --- Safe Folder ---

  addFile(name, data, mimeType) {
    const id = randomBytes(16).toString('hex');

    if (!existsSync(this.safeDir)) mkdirSync(this.safeDir, { recursive: true, mode: 0o700 });
    const encrypted = this.encryptBuffer(data);
    writeFileSync(path.join(this.safeDir, id), encrypted, { mode: 0o600 });

    const entry = {
      id,
      name,
      mimeType,
      size: data.length,
      createdAt: Date.now()
    };
    this.files.push(entry);
    this.persistIndex();
    return entry;
  }

  getFile(id) {
    const file = this.files.find((f) => f.id === id);
    if (!file) return null;

    const filePath = path.join(this.safeDir, id);
    if (!existsSync(filePath)) return null;

    const encrypted = readFileSync(filePath);
    const data = this.decryptBuffer(encrypted);
    return { data, file };
  }

  list() {
    return this.files.map((f) => ({ ...f }));
  }

  removeFile(id) {
    const filePath = path.join(this.safeDir, id);
    if (existsSync(filePath)) unlinkSync(filePath);
    this.files = this.files.filter((f) => f.id !== id);
    this.persistIndex();
  }

  loadIndex() {
    try {
      if (existsSync(this.indexFile)) {
        const encrypted = readFileSync(this.indexFile);
        const json = this.decryptBuffer(encrypted).toString('utf8');
        this.files = JSON.parse(json);
      }
    } catch (err) {
      console.error('[Vault] Failed to load safe folder index:', err.message);
      this.files = [];
    }
  }

  persistIndex() {
    try {
      if (!existsSync(this.vaultDir)) mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
      const json = JSON.stringify(this.files);
      const encrypted = this.encryptBuffer(Buffer.from(json, 'utf8'));
      writeFileSync(this.indexFile, encrypted, { mode: 0o600 });
    } catch (err) {
      console.error('[Vault] Failed to save safe folder index:', err.message);
    }
  }

  // --- PIN auth ---

  hasPIN() {
    return existsSync(this.pinFile);
  }

  setupPIN(pin) {
    if (!existsSync(this.vaultDir)) mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    const salt = randomBytes(32);
    const hash = scryptSync(pin, salt, 64);
    writeFileSync(this.pinFile, Buffer.concat([salt, hash]), { mode: 0o600 });
  }

  verifyPIN(pin) {
    if (!existsSync(this.pinFile)) return false;
    const data = readFileSync(this.pinFile);
    const salt = data.subarray(0, 32);
    const storedHash = data.subarray(32);
    const hash = scryptSync(pin, salt, 64);
    return timingSafeEqual(hash, storedHash);
  }

  // --- Biometric (Touch ID, macOS only) ---

  async tryBiometric(reason) {
    try {
      const { systemPreferences } = require('electron');
      if (typeof systemPreferences.canPromptTouchID !== 'function' || !systemPreferences.canPromptTouchID()) {
        return false;
      }
      await systemPreferences.promptTouchID(reason || 'unlock your Safe Folder');
      return true;
    } catch (e) {
      // Touch ID unavailable, cancelled, or failed - caller falls back to PIN
      return false;
    }
  }
}

module.exports = VaultService;
