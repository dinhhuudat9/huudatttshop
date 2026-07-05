// ============================================
// NOTIFICATIONS ROUTES
// File: backend/routes/notifications.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const db = require('../config/database');

// GET /api/notifications/important
// Public: guests see global important notifications; logged users see global + targeted.
router.get('/important', optionalAuth, async (req, res) => {
    try {
        await db.execute(
            "DELETE FROM notifications WHERE created_at < datetime('now', '-12 hours')"
        );

        const userId = req.user ? req.user.id : null;
        let rows = [];

        if (userId) {
            [rows] = await db.execute(
                `SELECT n.*
                 FROM notifications n
                 WHERE n.is_important = 1
                   AND (n.target_user_id IS NULL OR n.target_user_id = ?)
                 ORDER BY n.created_at DESC
                 LIMIT 1`,
                [userId]
            );
        } else {
            [rows] = await db.execute(
                `SELECT n.*
                 FROM notifications n
                 WHERE n.is_important = 1
                   AND n.target_user_id IS NULL
                 ORDER BY n.created_at DESC
                 LIMIT 1`
            );
        }

        res.json({
            success: true,
            data: rows[0] || null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.use(authenticate);

// GET /api/notifications
router.get('/', async (req, res) => {
    try {
        await db.execute(
            "DELETE FROM notifications WHERE created_at < datetime('now', '-12 hours')"
        );
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
        const userId = req.user.id;

        const [rows] = await db.execute(
            `SELECT n.*, 
                    CASE WHEN nr.id IS NULL THEN 0 ELSE 1 END AS is_read
             FROM notifications n
             LEFT JOIN notification_reads nr
                ON nr.notification_id = n.id AND nr.user_id = ?
             WHERE n.target_user_id IS NULL OR n.target_user_id = ?
             ORDER BY n.created_at DESC
             LIMIT ?`,
            [userId, userId, limit]
        );

        const [unreadRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM notifications n
             LEFT JOIN notification_reads nr
                ON nr.notification_id = n.id AND nr.user_id = ?
             WHERE (n.target_user_id IS NULL OR n.target_user_id = ?)
               AND nr.id IS NULL`,
            [userId, userId]
        );

        res.json({
            success: true,
            data: rows,
            unread: unreadRows[0]?.total || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
    try {
        await db.execute(
            "DELETE FROM notifications WHERE created_at < datetime('now', '-12 hours')"
        );
        const userId = req.user.id;
        await db.execute(
            `INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at)
             SELECT n.id, ?, datetime('now')
             FROM notifications n
             LEFT JOIN notification_reads nr
                ON nr.notification_id = n.id AND nr.user_id = ?
             WHERE (n.target_user_id IS NULL OR n.target_user_id = ?)
               AND nr.id IS NULL`,
            [userId, userId, userId]
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
