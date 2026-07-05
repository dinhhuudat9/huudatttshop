const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const messageService = require('../services/messageService');

async function getAdminId() {
    const [rows] = await db.execute(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
    );
    return rows.length ? rows[0].id : null;
}

// POST /api/support
router.post('/', authenticate, async (req, res) => {
    try {
        const { type = 'support', subject, content } = req.body;
        const normalizedType = ['support', 'report'].includes(type) ? type : 'support';
        if (!subject || !content) {
            return res.status(400).json({ success: false, message: 'Subject and content are required' });
        }

        const [result] = await db.execute(
            `INSERT INTO support_requests (user_id, type, subject, content)
             VALUES (?, ?, ?, ?)`,
            [req.user.id, normalizedType, subject.trim(), content.trim()]
        );

        res.json({ success: true, data: { id: result.insertId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/support/my
router.get('/my', authenticate, async (req, res) => {
    try {
        const { type } = req.query;
        const params = [req.user.id];
        let where = 'WHERE user_id = ?';
        if (type) {
            where += ' AND type = ?';
            params.push(type);
        }

        const [rows] = await db.execute(
            `SELECT *
             FROM support_requests
             ${where}
             ORDER BY created_at DESC`,
            params
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/support/thread
router.get('/thread', authenticate, async (req, res) => {
    try {
        const adminId = await getAdminId();
        if (!adminId) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const [rows] = await db.execute(
            `SELECT * FROM messages
             WHERE (sender_id = ? AND receiver_id = ?)
                OR (sender_id = ? AND receiver_id = ?)
             ORDER BY created_at ASC`,
            [req.user.id, adminId, adminId, req.user.id]
        );
        await db.execute(
            `UPDATE messages
             SET is_read = 1
             WHERE sender_id = ? AND receiver_id = ? AND is_read = 0`,
            [adminId, req.user.id]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/support/thread
router.post('/thread', authenticate, async (req, res) => {
    try {
        const adminId = await getAdminId();
        if (!adminId) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const { type = 'support', content } = req.body;
        if (!content) {
            return res.status(400).json({ success: false, message: 'Content is required' });
        }
        const label = type === 'report' ? '[Tố cáo] ' : '[Hỗ trợ] ';
        const message = await messageService.sendMessage(
            req.user.id,
            {
                receiver_id: adminId,
                message_type: 'text',
                content: label + String(content || '').trim()
            },
            {
                ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
                req,
                recaptchaToken: req.body?.recaptcha_token || '',
                actionType: 'support_message_send'
            }
        );
        res.json({ success: true, data: { id: message?.id || null } });
    } catch (error) {
        if (error.retryAfterSeconds) {
            res.set('Retry-After', String(error.retryAfterSeconds));
        }
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message,
            code: error.code || undefined,
            data: error.data || undefined
        });
    }
});

// POST /api/support/unblock-request
// Public endpoint (ipGuard is bypassed for this path)
router.post('/unblock-request', async (req, res) => {
    try {
        const { unlockCode } = req.body;
        if (!unlockCode) {
            return res.status(400).json({ success: false, message: 'Mã mở khóa là bắt buộc' });
        }

        const { decodeIpFromUnlockCode } = require('../utils/ipCodec');
        const ip = decodeIpFromUnlockCode(unlockCode);
        if (!ip) {
            return res.status(400).json({ success: false, message: 'Mã mở khóa không hợp lệ hoặc đã hết hạn' });
        }

        // Get or create dummy user representing blocked guests
        let userId = 0;
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('../middleware/auth');
        
        // Attempt to extract user ID if they are logged in but blocked
        let token = '';
        const authHeader = req.headers.authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7);
        } else if (req.cookies?.token) {
            token = req.cookies.token;
        }

        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                if (decoded && decoded.userId) {
                    userId = decoded.userId;
                }
            } catch (_) {}
        }

        if (userId === 0) {
            // Check if there is guest support user
            const [guestRows] = await db.execute(
                "SELECT id FROM users WHERE email = 'guest_support@mmoshop.com' LIMIT 1"
            );
            if (guestRows.length > 0) {
                userId = guestRows[0].id;
            } else {
                const [result] = await db.execute(
                    `INSERT INTO users (email, password_hash, full_name, role, status, is_verified)
                     VALUES ('guest_support@mmoshop.com', 'no-password', 'Khách Hàng Bị Khóa IP', 'user', 'active', 1)`
                );
                userId = result.insertId;
            }
        }

        const adminId = await getAdminId();
        if (!adminId) {
            return res.status(500).json({ success: false, message: 'Không tìm thấy Admin trên hệ thống' });
        }

        const messageContent = `[Yêu cầu gỡ chặn IP tự động]
- Địa chỉ IP: ${ip}
- Mã mở khóa: ${unlockCode}
Vui lòng kiểm tra và mở chặn cho địa chỉ IP này.`;

        // Insert request as a chat message into messages table
        const [msgResult] = await db.execute(
            'INSERT INTO messages (sender_id, receiver_id, message_type, content) VALUES (?, ?, ?, ?)',
            [userId, adminId, 'text', messageContent]
        );

        res.json({ 
            success: true, 
            message: 'Yêu cầu mở chặn đã được gửi thành công!',
            data: { messageId: msgResult.insertId, ip }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
