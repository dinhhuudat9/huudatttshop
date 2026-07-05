const express = require('express');
const router = express.Router();
const db = require('../config/database');

const SENSITIVE_KEY_PATTERN = /(api_key|token|secret|password)/i;

// GET /api/settings?keys=contact_button_text,contact_button_link
router.get('/', async (req, res) => {
    try {
        const keysParam = (req.query.keys || '').toString().trim();
        if (!keysParam) {
            return res.json({ success: true, data: {} });
        }
        const keys = keysParam
            .split(',')
            .map(k => k.trim())
            .filter(Boolean)
            .filter(k => !SENSITIVE_KEY_PATTERN.test(k));
        if (!keys.length) {
            return res.json({ success: true, data: {} });
        }

        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await db.execute(
            `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${placeholders})`,
            keys
        );

        const data = {};
        rows.forEach(r => {
            data[r.setting_key] = r.setting_value;
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
