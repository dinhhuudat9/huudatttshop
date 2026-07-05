const crypto = require('crypto');
const db = require('../config/database');
const { shortenWithLink4m, resolvePublicBaseUrl } = require('../services/linkShortenerService');

const MISSION_REWARD = 400;
const APP_TIMEZONE = 'Asia/Bangkok';

function getDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const pick = (type) => parts.find(part => part.type === type)?.value;
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function buildPublicContext(req) {
    return {
        origin: req.get('origin') || '',
        baseUrl: process.env.APP_URL || '',
        host: req.get('host') || '',
        protocol: req.protocol || 'https',
        forwardedHost: req.get('x-forwarded-host') || '',
        forwardedProto: req.get('x-forwarded-proto') || ''
    };
}

class MissionController {
    async getStatus(req, res) {
        try {
            const today = getDateKey();
            const [rows] = await db.execute(
                `SELECT id, key_string, is_used, used_at, created_at
                 FROM bypass_keys
                 WHERE user_id = ? AND mission_date = ?
                 LIMIT 1`,
                [req.user.id, today]
            );
            const mission = rows[0] || null;
            res.json({
                success: true,
                data: {
                    reward: MISSION_REWARD,
                    missionDate: today,
                    completedToday: Boolean(mission?.is_used),
                    hasKey: Boolean(mission),
                    usedAt: mission?.used_at || null
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async generateKey(req, res) {
        try {
            const userId = req.user.id;
            const today = getDateKey();
            const [existing] = await db.execute(
                `SELECT key_string, is_used
                 FROM bypass_keys
                 WHERE user_id = ? AND mission_date = ?
                 LIMIT 1`,
                [userId, today]
            );

            let key = existing[0]?.key_string;
            if (!key) {
                key = 'SD-NHIEMVU-' + crypto.randomBytes(18).toString('hex');
                await db.execute(
                    `INSERT INTO bypass_keys (key_string, user_id, mission_date, is_used)
                     VALUES (?, ?, ?, 0)`,
                    [key, userId, today]
                );
            }

            const publicBaseUrl = resolvePublicBaseUrl(buildPublicContext(req));
            const destinationUrl = new URL(`/vuot-link.html?token=${encodeURIComponent(key)}`, `${publicBaseUrl || process.env.APP_URL || 'http://localhost:3000'}/`).toString();

            let shortLink = destinationUrl;
            let provider = 'direct';
            let shortLinkError = '';

            try {
                const shortResult = await shortenWithLink4m(destinationUrl);
                shortLink = shortResult.shortUrl || destinationUrl;
                provider = shortResult.provider || 'link4m';
            } catch (error) {
                shortLinkError = error.message || 'Không thể tạo link Link4m';
            }

            res.json({
                success: true,
                data: {
                    link: shortLink,
                    shortLink,
                    provider,
                    shortLinkError,
                    completedToday: Boolean(existing[0]?.is_used),
                    message: 'Vượt link để lấy key độc quyền. Key chỉ dùng được 1 lần.'
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async claimReward(req, res) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const userId = req.user.id;
            const today = getDateKey();
            const key = String(req.body?.key || '').trim();
            if (!key) {
                const error = new Error('Vui lòng nhập key.');
                error.statusCode = 400;
                throw error;
            }

            const [records] = await connection.execute(
                `SELECT id, is_used
                 FROM bypass_keys
                 WHERE key_string = ? AND user_id = ? AND mission_date = ?
                 LIMIT 1`,
                [key, userId, today]
            );
            if (records.length === 0 || Number(records[0].is_used) === 1) {
                const error = new Error('Key không hợp lệ hoặc đã được sử dụng.');
                error.statusCode = 400;
                throw error;
            }

            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [userId]
            );
            if (users.length === 0) {
                throw new Error('User not found');
            }

            const before = Number(users[0].balance || 0);
            const after = before + MISSION_REWARD;
            await connection.execute(
                'UPDATE bypass_keys SET is_used = 1, used_at = CURRENT_TIMESTAMP WHERE id = ? AND is_used = 0',
                [records[0].id]
            );
            await connection.execute('UPDATE users SET balance = ? WHERE id = ?', [after, userId]);
            await connection.execute(
                `INSERT INTO transactions
                 (user_id, type, amount, balance_before, balance_after, description)
                 VALUES (?, 'mission_reward', ?, ?, ?, ?)`,
                [userId, MISSION_REWARD, before, after, `Thưởng nhiệm vụ vượt link ${today}`]
            );

            await connection.commit();

            res.json({
                success: true,
                message: `Đã cộng ${MISSION_REWARD}đ vào tài khoản.`,
                data: {
                    rewardAmount: MISSION_REWARD,
                    newBalance: after
                }
            });
        } catch (error) {
            await connection.rollback();
            res.status(error.statusCode || 500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    }
}

module.exports = new MissionController();
