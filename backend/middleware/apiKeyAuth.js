// ============================================
// API KEY AUTH MIDDLEWARE
// File: backend/middleware/apiKeyAuth.js
// ============================================

const crypto = require('crypto');
const db = require('../config/database');

module.exports = async function apiKeyAuth(req, res, next) {
    try {
        const apiKey = (req.headers['x-api-key'] || '').toString().trim();
        if (!apiKey) {
            return res.status(401).json({ success: false, message: 'Missing API key' });
        }

        const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const [rows] = await db.execute(
            'SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
            [hash]
        );

        if (!rows.length) {
            return res.status(401).json({ success: false, message: 'Invalid API key' });
        }

        req.apiKeyId = rows[0].id;
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
