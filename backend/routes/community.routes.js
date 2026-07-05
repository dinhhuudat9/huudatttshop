// ============================================
// COMMUNITY ROUTES
// File: backend/routes/community.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../config/database');
const spamProtectionService = require('../services/spamProtectionService');
const { featureGuard } = require('../middleware/featureGuard');

const COMMUNITY_RETENTION_SQL = "DELETE FROM community_messages WHERE created_at < datetime('now', '-7 days')";
const COMMUNITY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let lastCommunityCleanupAt = 0;
let communityCleanupPromise = null;

function isTransientDbError(error) {
    const message = (error && error.message ? error.message : '').toLowerCase();
    return message.includes('fetch failed') || message.includes('network');
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function queueCommunityCleanup() {
    const now = Date.now();
    if (communityCleanupPromise) return communityCleanupPromise;
    if (now - lastCommunityCleanupAt < COMMUNITY_CLEANUP_INTERVAL_MS) {
        return Promise.resolve();
    }

    communityCleanupPromise = db.execute(COMMUNITY_RETENTION_SQL)
        .then(() => {
            lastCommunityCleanupAt = Date.now();
        })
        .catch((error) => {
            console.warn('Community cleanup failed:', error.message);
        })
        .finally(() => {
            communityCleanupPromise = null;
        });

    return communityCleanupPromise;
}

async function fetchCommunityMessages(limit) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const [rows] = await db.execute(
                `SELECT cm.*, u.full_name, u.email, u.avatar, u.frame_url, u.gender, u.is_verified
                 FROM community_messages cm
                 JOIN users u ON u.id = cm.user_id
                 ORDER BY cm.created_at DESC
                 LIMIT ?`,
                [limit]
            );
            return rows;
        } catch (error) {
            lastError = error;
            if (!isTransientDbError(error) || attempt === 1) {
                throw error;
            }
            await wait(250);
        }
    }

    throw lastError || new Error('Failed to load community messages');
}

// GET /api/community/messages
router.get('/messages', authenticate, featureGuard('community'), async (req, res) => {
    try {
        queueCommunityCleanup();
        const parsedLimit = parseInt(req.query.limit || '50', 10);
        const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 100));
        const rows = await fetchCommunityMessages(limit);
        res.json({ success: true, data: rows.reverse() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/community/messages
router.post('/messages', authenticate, featureGuard('community'), async (req, res) => {
    let connection = null;
    try {
        const { content = '', message_type = 'text', media_url = null } = req.body;
        queueCommunityCleanup();
        if (!content.trim() && !media_url) {
            return res.status(400).json({ success: false, message: 'Content or media is required' });
        }
        if (!['text', 'image', 'video'].includes(message_type)) {
            return res.status(400).json({ success: false, message: 'Invalid message type' });
        }

        // Frontend handles escaping when rendering - store raw content in DB
        const safeContent = content.trim();

        connection = await db.getConnection();
        await connection.beginTransaction();

        await spamProtectionService.guardMessageSend(connection, {
            userId: req.user.id,
            ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
            receiverId: 'community_room',
            actionType: 'community_message_send',
            messageType: message_type,
            content: safeContent,
            mediaUrl: media_url || '',
            recaptchaToken: req.body?.recaptcha_token || '',
            req
        });

        const [result] = await connection.execute(
            `INSERT INTO community_messages (user_id, content, message_type, media_url)
             VALUES (?, ?, ?, ?)`,
            [req.user.id, safeContent, message_type, media_url]
        );

        await connection.commit();

        res.json({ success: true, data: { id: result.insertId } });
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }
        if (error.retryAfterSeconds) {
            res.set('Retry-After', String(error.retryAfterSeconds));
        }
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message,
            code: error.code || undefined,
            data: error.data || undefined
        });
    } finally {
        if (connection) {
            await connection.release();
        }
    }
});

// DELETE /api/community/messages/:id
router.delete('/messages/:id', authenticate, async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT id, user_id FROM community_messages WHERE id = ? LIMIT 1',
            [req.params.id]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        const message = rows[0];
        if (req.user.role !== 'admin' && Number(message.user_id) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'Không đủ quyền xóa tin nhắn này' });
        }

        await db.execute('DELETE FROM community_messages WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
