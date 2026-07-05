const crypto = require('crypto');

// Use a fallback key if not provided in env, but ensure it's exactly 32 bytes for aes-256-cbc
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ? 
    crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32) : 
    crypto.scryptSync('default_secret_key_source_market', 'salt', 32);

const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
    if (!text) return '';
    try {
        let iv = crypto.randomBytes(IV_LENGTH);
        let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error('Encryption error:', e);
        return text; // Fallback to plain text if error
    }
}

function decrypt(text) {
    if (!text || !text.includes(':')) return text;
    try {
        let textParts = text.split(':');
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error('Decryption error:', e);
        return text; // Fallback to plain text if error
    }
}

module.exports = { encrypt, decrypt };
