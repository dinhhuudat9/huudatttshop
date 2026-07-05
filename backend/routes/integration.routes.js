// ============================================
// INTEGRATION ROUTES (API KEY)
// File: backend/routes/integration.routes.js
// ============================================

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const db = require('../config/database');
const productService = require('../services/productService');

router.use(apiKeyAuth);

// POST /api/integration/users
router.post('/users', async (req, res) => {
    try {
        const { email, password, full_name, role = 'user' } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }
        if (!['user', 'seller'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        const [exists] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (exists.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }

        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            'INSERT INTO users (email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?)',
            [email, hash, full_name || null, role, 'active']
        );

        res.json({ success: true, data: { id: result.insertId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/integration/products
router.post('/products', async (req, res) => {
    try {
        const {
            title,
            description,
            content,
            price,
            category_id,
            category_ids,
            seller_id,
            main_image,
            background_image,
            video_url,
            demo_url,
            download_url,
            gallery
        } = req.body;
        const hasGallery = Array.isArray(gallery) && gallery.some(item => String(item || '').trim());

        if (!title || !price || !category_id || !seller_id || (!main_image && !hasGallery) || !download_url) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const [seller] = await db.execute('SELECT id, role FROM users WHERE id = ?', [seller_id]);
        if (!seller.length) {
            return res.status(400).json({ success: false, message: 'Seller not found' });
        }

        const product = await productService.createProduct(seller_id, {
            title,
            description,
            content,
            price,
            category_id,
            category_ids,
            main_image,
            background_image,
            video_url,
            demo_url,
            download_url,
            gallery
        });

        res.json({ success: true, data: product });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
