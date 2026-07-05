const crypto = require('crypto');

// Use SHA-256 to hash the key so it is exactly 32 bytes (256 bits) and compatible with Web Crypto API
const SECRET_KEY = process.env.ENCRYPTION_KEY || 'default_secret_key_source_market';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(SECRET_KEY).digest();
const IV_LENGTH = 16;

function encrypt(text) {
    if (!text) return '';
    try {
        let iv = crypto.randomBytes(IV_LENGTH);
        let cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (e) {
        console.error('API Encryption error:', e);
        return text;
    }
}

function decrypt(text) {
    if (!text || !text.includes(':')) return text;
    try {
        let textParts = text.split(':');
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('API Decryption error:', e);
        return text;
    }
}

module.exports = { encrypt, decrypt };
