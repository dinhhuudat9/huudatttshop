// ============================================
// ARCHIVE (chiase.json) SERVICE
// File: backend/services/archiveService.js
// ============================================

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const ARCHIVE_PATH = path.join(__dirname, '..', '..', 'chiase.json');
let cachedArchive = null;
let cachedMtime = 0;

const purged = {
    products: new Set(),
    posts: new Set(),
    users: new Set()
};

function normalizeArchive(raw = {}) {
    return {
        meta: raw.meta || {},
        products: Array.isArray(raw.products) ? raw.products : [],
        posts: Array.isArray(raw.posts) ? raw.posts : [],
        users: Array.isArray(raw.users) ? raw.users : []
    };
}

async function loadArchive() {
    try {
        const stat = await fs.promises.stat(ARCHIVE_PATH);
        const mtime = stat.mtimeMs || stat.mtime.getTime();
        if (cachedArchive && cachedMtime === mtime) {
            return cachedArchive;
        }
        const content = await fs.promises.readFile(ARCHIVE_PATH, 'utf8');
        const parsed = JSON.parse(content || '{}');
        cachedArchive = normalizeArchive(parsed);
        cachedMtime = mtime;
        return cachedArchive;
    } catch (error) {
        cachedArchive = normalizeArchive({});
        cachedMtime = 0;
        return cachedArchive;
    }
}

async function getArchive() {
    return loadArchive();
}

function buildPlaceholders(count) {
    return Array.from({ length: count }).map(() => '?').join(',');
}

async function purgeArchivedProducts(ids = []) {
    const uniqueIds = [...new Set(ids.map(id => parseInt(id, 10)).filter(Number.isFinite))]
        .filter(id => !purged.products.has(id));

    if (!uniqueIds.length) return;

    const placeholders = buildPlaceholders(uniqueIds.length);

    await db.execute(`DELETE FROM product_images WHERE product_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM product_categories WHERE product_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM products WHERE id IN (${placeholders})`, uniqueIds);

    uniqueIds.forEach(id => purged.products.add(id));
}

async function purgeArchivedPosts(ids = []) {
    const uniqueIds = [...new Set(ids.map(id => parseInt(id, 10)).filter(Number.isFinite))]
        .filter(id => !purged.posts.has(id));

    if (!uniqueIds.length) return;

    const placeholders = buildPlaceholders(uniqueIds.length);

    await db.execute(`DELETE FROM post_likes WHERE post_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM post_comments WHERE post_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM post_media WHERE post_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM posts WHERE id IN (${placeholders})`, uniqueIds);

    uniqueIds.forEach(id => purged.posts.add(id));
}

async function purgeArchivedUsers(ids = []) {
    const uniqueIds = [...new Set(ids.map(id => parseInt(id, 10)).filter(Number.isFinite))]
        .filter(id => !purged.users.has(id));

    if (!uniqueIds.length) return;

    const placeholders = buildPlaceholders(uniqueIds.length);

    const [postRows] = await db.execute(
        `SELECT id FROM posts WHERE user_id IN (${placeholders})`,
        uniqueIds
    );
    const postIds = postRows.map(row => row.id);
    if (postIds.length) {
        const postPlaceholders = buildPlaceholders(postIds.length);
        await db.execute(`DELETE FROM post_likes WHERE post_id IN (${postPlaceholders})`, postIds);
        await db.execute(`DELETE FROM post_comments WHERE post_id IN (${postPlaceholders})`, postIds);
        await db.execute(`DELETE FROM post_media WHERE post_id IN (${postPlaceholders})`, postIds);
        await db.execute(`DELETE FROM posts WHERE id IN (${postPlaceholders})`, postIds);
    }

    await db.execute(
        `DELETE FROM messages WHERE sender_id IN (${placeholders}) OR receiver_id IN (${placeholders})`,
        [...uniqueIds, ...uniqueIds]
    );
    await db.execute(`DELETE FROM community_messages WHERE user_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM support_requests WHERE user_id IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM api_keys WHERE created_by IN (${placeholders})`, uniqueIds);
    await db.execute(`DELETE FROM notification_reads WHERE user_id IN (${placeholders})`, uniqueIds);
    await db.execute(
        `DELETE FROM notifications WHERE target_user_id IN (${placeholders}) OR created_by IN (${placeholders})`,
        [...uniqueIds, ...uniqueIds]
    );
    await db.execute(`DELETE FROM users WHERE id IN (${placeholders})`, uniqueIds);

    uniqueIds.forEach(id => purged.users.add(id));
}

module.exports = {
    ARCHIVE_PATH,
    getArchive,
    purgeArchivedProducts,
    purgeArchivedPosts,
    purgeArchivedUsers
};
