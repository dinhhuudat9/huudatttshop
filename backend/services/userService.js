// ============================================
// USER SERVICE
// File: backend/services/userService.js
// ============================================

const db = require('../config/database');
const { getArchive, purgeArchivedUsers } = require('./archiveService');

class UserService {
    async searchUsers({ keyword = '', page = 1, limit = 20 }) {
        const archive = await getArchive();
        const archivedUsers = Array.isArray(archive.users) ? archive.users : [];
        await purgeArchivedUsers(archivedUsers.map(u => u.id).filter(Boolean));

        const offset = (page - 1) * limit;
        const params = [];
        let where = '';

        if (keyword) {
            where = 'WHERE (email LIKE ? OR full_name LIKE ?)';
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        const [users] = await db.execute(
            `SELECT id, email, full_name, avatar, gender, role, status, is_verified, created_at, last_login
             FROM users
             ${where}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit, 10), offset]
        );

        const [count] = await db.execute(
            `SELECT COUNT(*) as total FROM users ${where}`,
            params
        );

        return {
            users,
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total: count[0].total,
                totalPages: Math.ceil(count[0].total / limit)
            }
        };
    }

    async getProfile(userId) {
        const archive = await getArchive();
        const archivedUsers = Array.isArray(archive.users) ? archive.users : [];
        await purgeArchivedUsers(archivedUsers.map(u => u.id).filter(Boolean));

        const archivedMatch = archivedUsers.find(u => String(u.id) === String(userId));
        if (archivedMatch) {
            const archivedUser = { ...archivedMatch, is_archived: true };
            const postCount = Array.isArray(archive.posts)
                ? archive.posts.filter(p => String(p.user_id) === String(userId)).length
                : 0;
            const productCount = Array.isArray(archive.products)
                ? archive.products.filter(p => String(p.seller_id) === String(userId)).length
                : 0;
            return {
                ...archivedUser,
                stats: {
                    posts: postCount,
                    products: productCount
                }
            };
        }

        const [users] = await db.execute(
            `SELECT id, email, full_name, avatar, cover_image, frame_url, profile_music_url, profile_music_title,
                    gender, bio, contact_info, phone, role, status, balance, is_verified, created_at, last_login
             FROM users WHERE id = ?`,
            [userId]
        );

        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];

        const [postCount] = await db.execute(
            "SELECT COUNT(*) as total FROM posts WHERE user_id = ? AND status = 'active'",
            [userId]
        );

        const [productCount] = await db.execute(
            'SELECT COUNT(*) as total FROM products WHERE seller_id = ?',
            [userId]
        );

        return {
            ...user,
            stats: {
                posts: postCount[0].total,
                products: productCount[0].total
            }
        };
    }

    async updateFrame(userId, frameUrl = '') {
        await db.execute(
            'UPDATE users SET frame_url = ? WHERE id = ?',
            [frameUrl || null, userId]
        );
        const [users] = await db.execute(
            `SELECT id, email, full_name, avatar, cover_image, frame_url, profile_music_url, profile_music_title,
                    gender, bio, contact_info, phone, role, status, balance, is_verified, created_at, last_login
             FROM users WHERE id = ?`,
            [userId]
        );
        return users[0];
    }
}

module.exports = new UserService();
