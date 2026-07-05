// ============================================
// MESSAGE SERVICE
// File: backend/services/messageService.js
// ============================================

const db = require('../config/database');
const spamProtectionService = require('./spamProtectionService');

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '26214400', 10);

function createStatusError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

class MessageService {
    async getConversations(userId) {
        const [lastMessages] = await db.execute(
            `
            SELECT m.*, u.id as partner_id, u.full_name, u.avatar, u.email
            FROM messages m
            JOIN (
                SELECT 
                    CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS partner_id,
                    MAX(created_at) AS last_time
                FROM messages
                WHERE sender_id = ? OR receiver_id = ?
                GROUP BY partner_id
            ) t
              ON (
                  ((m.sender_id = ? AND m.receiver_id = t.partner_id) 
                  OR (m.sender_id = t.partner_id AND m.receiver_id = ?))
                  AND m.created_at = t.last_time
              )
            JOIN users u ON u.id = t.partner_id
            ORDER BY m.created_at DESC
            `,
            [userId, userId, userId, userId, userId]
        );

        const [unreadCounts] = await db.execute(
            `SELECT sender_id as partner_id, COUNT(*) as unread
             FROM messages
             WHERE receiver_id = ? AND is_read = 0
             GROUP BY sender_id`,
            [userId]
        );

        const unreadMap = {};
        unreadCounts.forEach(row => {
            unreadMap[row.partner_id] = row.unread;
        });

        return lastMessages.map(msg => ({
            partner_id: msg.partner_id,
            partner_name: msg.full_name,
            partner_avatar: msg.avatar,
            partner_email: msg.email,
            last_message: {
                id: msg.id,
                sender_id: msg.sender_id,
                receiver_id: msg.receiver_id,
                message_type: msg.message_type,
                content: msg.content,
                media_url: msg.media_url,
                created_at: msg.created_at
            },
            unread: unreadMap[msg.partner_id] || 0
        }));
    }

    async getMessages(userId, otherUserId, { page = 1, limit = 30 } = {}) {
        const offset = (page - 1) * limit;

        const [messages] = await db.execute(
            `SELECT * FROM messages
             WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, otherUserId, otherUserId, userId, parseInt(limit, 10), offset]
        );

        await db.execute(
            'UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?',
            [otherUserId, userId]
        );

        return messages.reverse();
    }

    async sendMessage(senderId, { receiver_id, message_type = 'text', content, media_url, file_size }, context = {}) {
        if (!receiver_id) {
            throw new Error('Receiver is required');
        }

        if (['text', 'image', 'video', 'file'].indexOf(message_type) === -1) {
            throw new Error('Invalid message type');
        }

        if (message_type === 'text' && (!content || !content.trim())) {
            throw new Error('Content is required');
        }

        if (message_type !== 'text' && !media_url) {
            throw new Error('Media URL is required');
        }

        if (file_size && file_size > MAX_FILE_SIZE) {
            throw new Error('File size exceeds limit');
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            await spamProtectionService.guardMessageSend(connection, {
                userId: senderId,
                ip: context.ip || '',
                receiverId: receiver_id,
                actionType: context.actionType || 'message_send',
                messageType: message_type,
                content: content || '',
                mediaUrl: media_url || '',
                recaptchaToken: context.recaptchaToken || '',
                req: context.req || null
            });

            const [result] = await connection.execute(
                `INSERT INTO messages (sender_id, receiver_id, message_type, content, media_url, file_size)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [senderId, receiver_id, message_type, content || null, media_url || null, file_size || null]
            );

            const [rows] = await connection.execute('SELECT * FROM messages WHERE id = ?', [result.insertId]);
            await connection.commit();
            return rows[0];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            await connection.release();
        }
    }

    async deleteMessage(messageId, requesterId, requesterRole = 'user') {
        const [rows] = await db.execute(
            'SELECT id, sender_id, receiver_id FROM messages WHERE id = ? LIMIT 1',
            [messageId]
        );

        if (!rows.length) {
            throw createStatusError('Message not found', 404);
        }

        const message = rows[0];
        const isParticipant = Number(message.sender_id) === Number(requesterId)
            || Number(message.receiver_id) === Number(requesterId);

        if (requesterRole !== 'admin' && !isParticipant) {
            throw createStatusError('You do not have permission to delete this message', 403);
        }

        await db.execute('DELETE FROM messages WHERE id = ?', [messageId]);
        return true;
    }
}

module.exports = new MessageService();
