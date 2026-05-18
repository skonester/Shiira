const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const keytar = require('keytar');

// Service and account name for OS-level credential storage
const KEYTAR_SERVICE = 'Shiira Browser';
const KEYTAR_ACCOUNT = 'master-encryption-key';

class PasswordService {
    constructor() {
        this.db = null;
        this.encryptionKey = null;
    }

    async initialize() {
        const dbPath = path.join(app.getPath('userData'), 'passwords.db');
        this.db = new Database(dbPath);
        
        // Generate or load encryption key
        await this.initializeEncryption();
        
        // Create passwords table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS passwords (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_passwords_url ON passwords(url);
        `);
    }

    async initializeEncryption() {
        try {
            // Try to get key from OS credential storage (keytar)
            const storedKey = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
            
            if (storedKey) {
                // Key exists in OS storage - use it
                this.encryptionKey = Buffer.from(storedKey, 'hex');
                if (!app.isPackaged) {
                    console.log('[Password Service] Loaded encryption key from OS credential storage');
                }
            } else {
                // No key in OS storage - check for legacy file-based key
                const keyPath = path.join(app.getPath('userData'), 'password.key');
                const fs = require('fs');
                
                if (fs.existsSync(keyPath)) {
                    // Migrate from file-based to OS-level storage
                    this.encryptionKey = fs.readFileSync(keyPath);
                    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, this.encryptionKey.toString('hex'));
                    
                    // Delete the old file after successful migration
                    fs.unlinkSync(keyPath);
                    if (!app.isPackaged) {
                        console.log('[Password Service] Migrated encryption key from file to OS credential storage');
                    }
                } else {
                    // Generate new key and store in OS credential storage
                    this.encryptionKey = crypto.randomBytes(32);
                    await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, this.encryptionKey.toString('hex'));
                    if (!app.isPackaged) {
                        console.log('[Password Service] Generated new encryption key in OS credential storage');
                    }
                }
            }
        } catch (error) {
            // Fallback to file-based storage if keytar fails
            console.error('[Password Service] Failed to use OS credential storage, falling back to file:', error.message);
            const keyPath = path.join(app.getPath('userData'), 'password.key');
            const fs = require('fs');
            
            if (fs.existsSync(keyPath)) {
                this.encryptionKey = fs.readFileSync(keyPath);
            } else {
                this.encryptionKey = crypto.randomBytes(32);
                fs.writeFileSync(keyPath, this.encryptionKey, { mode: 0o600 });
            }
        }
    }

    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return iv.toString('hex') + ':' + encrypted + ':' + authTag;
    }

    decrypt(text) {
        try {
            const parts = text.split(':');
            if (parts.length !== 3) {
                // Legacy format (AES-CBC) - need to handle gracefully
                throw new Error('Invalid encrypted format');
            }
            const iv = Buffer.from(parts[0], 'hex');
            const encryptedText = parts[1];
            const authTag = Buffer.from(parts[2], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            // Security: Don't log decryption errors with sensitive data
            if (!app.isPackaged) {
                console.error('[Password Service] Decryption failed - data may be corrupted');
            }
            throw new Error('Decryption failed');
        }
    }

    addPassword(url, username, password) {
        const encryptedPassword = this.encrypt(password);
        const now = Date.now();
        
        const stmt = this.db.prepare(`
            INSERT INTO passwords (url, username, password, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(url, username, encryptedPassword, now, now);
        return result.lastInsertRowid;
    }

    updatePassword(id, url, username, password) {
        const encryptedPassword = this.encrypt(password);
        const now = Date.now();
        
        const stmt = this.db.prepare(`
            UPDATE passwords
            SET url = ?, username = ?, password = ?, updated_at = ?
            WHERE id = ?
        `);
        
        stmt.run(url, username, encryptedPassword, now, id);
    }

    deletePassword(id) {
        const stmt = this.db.prepare('DELETE FROM passwords WHERE id = ?');
        stmt.run(id);
    }

    /**
     * Extract the base domain from a hostname
     * e.g., "www.amazon.co.uk" -> "amazon"
     * e.g., "login.amazon.com" -> "amazon"
     */
    extractBaseDomain(hostname) {
        // Remove www. prefix
        let domain = hostname.replace(/^www\./, '');
        
        // Known multi-part TLDs
        const multiPartTLDs = ['.co.uk', '.co.jp', '.co.nz', '.com.au', '.com.br', '.co.in', '.org.uk'];
        
        // Check for multi-part TLD
        for (const tld of multiPartTLDs) {
            if (domain.endsWith(tld)) {
                domain = domain.slice(0, -tld.length);
                break;
            }
        }
        
        // Remove single TLD if not already handled
        if (domain.includes('.')) {
            const parts = domain.split('.');
            // If we have subdomains, get the second-to-last part (main domain)
            // e.g., "login.amazon" -> "amazon"
            // e.g., "amazon" -> "amazon"
            if (parts.length >= 2) {
                // Check if it looks like a subdomain situation
                const possibleDomain = parts[parts.length - 2];
                const lastPart = parts[parts.length - 1];
                
                // Common TLDs
                const commonTLDs = ['com', 'org', 'net', 'edu', 'gov', 'io', 'ai', 'app', 'dev', 'uk', 'de', 'fr', 'jp', 'cn', 'au', 'ca'];
                
                if (commonTLDs.includes(lastPart)) {
                    return possibleDomain;
                }
            }
            // Just return the first meaningful part
            return parts[0];
        }
        
        return domain;
    }

    getPasswordsForUrl(url) {
        try {
            const hostname = new URL(url).hostname;
            const baseDomain = this.extractBaseDomain(hostname);
            
            // Security: Only log in development mode, never log decrypted data
            if (!app.isPackaged) {
                console.log('[Password Service] Looking up passwords for domain:', baseDomain);
            }
            
            // Search using the base domain for broader matching
            const stmt = this.db.prepare(`
                SELECT id, url, username, password, created_at, updated_at
                FROM passwords
                WHERE url LIKE ?
                ORDER BY updated_at DESC
            `);
            
            const searchPattern = `%${baseDomain}%`;
            const rows = stmt.all(searchPattern);
            
            if (!app.isPackaged) {
                console.log('[Password Service] Found', rows.length, 'matching entries');
            }
            
            const results = rows.map(row => ({
                id: row.id,
                url: row.url,
                username: row.username,
                password: this.decrypt(row.password),
                created_at: row.created_at,
                updated_at: row.updated_at
            }));
            
            return results;
        } catch (e) {
            if (!app.isPackaged) {
                console.error('[Password Service] Error getting passwords:', e.message);
            }
            return [];
        }
    }

    getAllPasswords() {
        const stmt = this.db.prepare(`
            SELECT id, url, username, password, created_at, updated_at
            FROM passwords
            ORDER BY url, username
        `);
        
        const rows = stmt.all();
        
        // Security: Never log decrypted passwords or usernames
        if (!app.isPackaged) {
            console.log('[Password Service] getAllPasswords called, found', rows.length, 'entries');
        }
        
        return rows.map(row => ({
            id: row.id,
            url: row.url,
            username: row.username,
            password: this.decrypt(row.password),
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
    }

    importFromCSV(csvData) {
        // Security: Limit CSV size to prevent DoS (1MB max)
        const MAX_CSV_SIZE = 1024 * 1024; // 1MB
        if (csvData.length > MAX_CSV_SIZE) {
            return {
                success: false,
                count: 0,
                imported: 0,
                failed: 0,
                failedEntries: [{
                    line: 0,
                    username: 'N/A',
                    url: 'N/A',
                    reason: 'CSV file too large (max 1MB)'
                }]
            };
        }
        
        const lines = csvData.split('\n');
        let imported = 0;
        const failedEntries = [];
        
        // Skip header row (name,url,username,password)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const lineNum = i + 1; // For user-friendly line numbers
            
            try {
                // Parse CSV line (handle quoted fields)
                const fields = this.parseCSVLine(line);
                
                if (fields.length < 4) {
                    failedEntries.push({
                        line: lineNum,
                        username: fields[2] || '(empty)',
                        url: fields[1] || '(empty)',
                        reason: `Incomplete data - expected 4 fields, got ${fields.length}`
                    });
                    continue;
                }
                
                const [name, url, username, password] = fields;
                
                // Validate required fields
                if (!url || !url.trim()) {
                    failedEntries.push({
                        line: lineNum,
                        username: username || '(empty)',
                        url: '(empty)',
                        reason: 'Missing website URL'
                    });
                    continue;
                }
                
                if (!username || !username.trim()) {
                    failedEntries.push({
                        line: lineNum,
                        username: '(empty)',
                        url: url,
                        reason: 'Missing username/email'
                    });
                    continue;
                }
                
                if (!password || !password.trim()) {
                    failedEntries.push({
                        line: lineNum,
                        username: username,
                        url: url,
                        reason: 'Missing password'
                    });
                    continue;
                }
                
                // Validate URL format (basic check)
                if (!url.includes('.') && !url.includes('://')) {
                    failedEntries.push({
                        line: lineNum,
                        username: username,
                        url: url,
                        reason: 'Invalid URL format'
                    });
                    continue;
                }
                
                // Security: Block javascript: and data: URLs
                const urlLower = url.toLowerCase().trim();
                if (urlLower.startsWith('javascript:') || urlLower.startsWith('data:') || 
                    urlLower.startsWith('file:') || urlLower.startsWith('about:')) {
                    failedEntries.push({
                        line: lineNum,
                        username: username,
                        url: url,
                        reason: 'Unsafe URL scheme'
                    });
                    continue;
                }
                
                // All validations passed, add the password
                this.addPassword(url.trim(), username.trim(), password);
                imported++;
                
            } catch (e) {
                if (!app.isPackaged) {
                    console.error('[Password Service] Error importing line:', e.message);
                }
                failedEntries.push({
                    line: lineNum,
                    username: '(unknown)',
                    url: '(unknown)',
                    reason: `Parse error: ${e.message}`
                });
            }
        }
        
        return { 
            success: imported > 0, 
            count: imported, 
            imported,
            failed: failedEntries.length,
            failedEntries
        };
    }

    importSelected(entries) {
        let imported = 0;
        let failed = 0;
        
        entries.forEach(entry => {
            try {
                if (entry.url && entry.username && entry.password) {
                    this.addPassword(entry.url.trim(), entry.username.trim(), entry.password);
                    imported++;
                } else {
                    failed++;
                }
            } catch (e) {
                if (!app.isPackaged) {
                    console.error('[Password Service] Error importing entry:', e.message);
                }
                failed++;
            }
        });
        
        return { 
            success: imported > 0, 
            count: imported, 
            imported,
            failed
        };
    }

    parseCSVLine(line) {
        const fields = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                fields.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        
        fields.push(current);
        return fields;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = PasswordService;
