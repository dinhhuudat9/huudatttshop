// ============================================
// NOTIFICATION SERVICE
// File: backend/services/notificationService.js
// ============================================

const db = require('../config/database');
// const { sendTelegramNotification } = require('./telegramBackupService');

class NotificationService {
    async getAdminIds() {
        const [rows] = await db.execute(
            "SELECT id FROM users WHERE role = 'admin'"
        );
        return rows.map(r => r.id).filter(Boolean);
    }

    async createNotification({
        title,
        content = '',
        image_url = null,
        is_important = false,
        dismiss_hours = 2,
        target_user_id = null,
        created_by = null,
        send_telegram = true,
        telegram_message = null,
        telegram_options = null
    }) {
        const importantFlag = is_important ? 1 : 0;
        const safeDismissHours = Number.isFinite(Number(dismiss_hours))
            ? Math.min(Math.max(parseInt(dismiss_hours, 10), 1), 168)
            : 2;

        const [result] = await db.execute(
            `INSERT INTO notifications (title, content, image_url, is_important, dismiss_hours, target_user_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                title,
                content || null,
                image_url || null,
                importantFlag,
                safeDismissHours,
                target_user_id || null,
                created_by || null
            ]
        );

        if (send_telegram) {
            const targetText = target_user_id ? `User ID: ${target_user_id}` : 'Tat ca user';
            const imageText = image_url ? `Anh: ${image_url}` : '';
            const message = (telegram_message || `\ud83d\udd14 THONG BAO\n${title}\n${content || ''}\n${imageText}\n${targetText}`).trim();
            const { sendTelegramNotification } = require('./telegramBackupService');
            await sendTelegramNotification(message, telegram_options || undefined);
        }

        return result.insertId;
    }

    async notifyAdmins(payload = {}, options = {}) {
        const adminIds = await this.getAdminIds();
        const ids = [];
        const sendTelegram = options.sendTelegram ?? false;
        const telegramOptions = options.telegramOptions ?? null;

        if (!adminIds.length) {
            const id = await this.createNotification({
                ...payload,
                target_user_id: null,
                send_telegram: sendTelegram,
                telegram_message: payload.telegram_message || null,
                telegram_options: telegramOptions
            });
            ids.push(id);
            return ids;
        }

        for (const adminId of adminIds) {
            const id = await this.createNotification({
                ...payload,
                target_user_id: adminId,
                send_telegram: sendTelegram,
                telegram_message: payload.telegram_message || null,
                telegram_options: telegramOptions
            });
            ids.push(id);
        }
        return ids;
    }
}

module.exports = new NotificationService();
