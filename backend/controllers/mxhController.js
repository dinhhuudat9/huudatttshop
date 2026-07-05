const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/crypto');
const { ensureServiceDefaults } = require('../services/mxhService');

function parseJsonArray(value, fallback = []) {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return fallback;
    }

    const text = value.trim();
    if (!text) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function parsePositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function normalizeCategoryKind(value = 'account') {
    const kind = normalizeText(value, 'account').toLowerCase();
    return kind === 'service' ? 'service' : 'account';
}

function parseCategoryFilter(query = {}) {
    const raw = normalizeText(
        query.mxh_category_id ?? query.category_id ?? query.category ?? ''
    );

    if (!raw) {
        return null;
    }

    const numeric = Number.parseInt(raw, 10);
    if (Number.isFinite(numeric) && String(numeric) === raw) {
        return { clause: 'a.category_id = ?', value: numeric };
    }

    return { clause: '(c.slug = ? OR c.platform = ?)', value: raw };
}

function buildStatusOrderSql(alias = 'a') {
    return `CASE
        WHEN ${alias}.status = 'active' THEN 0
        WHEN ${alias}.status = 'sold' THEN 1
        ELSE 2
    END`;
}

function toAccountPayload(row = {}) {
    const images = parseJsonArray(row.images, []);
    const availableCount = Number(row.available_count ?? (row.status === 'active' ? 1 : 0));

    return {
        ...row,
        available_count: Number.isFinite(availableCount) ? availableCount : 0,
        images,
        main_image: images[0] || null
    };
}

function buildAccountListQuery(query = {}) {
    const filters = ['a.status != ?', "c.kind = 'account'"];
    const params = ['hidden'];

    const categoryFilter = parseCategoryFilter(query);
    if (categoryFilter) {
        filters.push(categoryFilter.clause);
        if (Array.isArray(categoryFilter.value)) {
            params.push(...categoryFilter.value);
        } else {
            params.push(categoryFilter.value);
            if (categoryFilter.clause.includes('OR')) {
                params.push(categoryFilter.value);
            }
        }
    }

    const platform = normalizeText(query.platform || '');
    if (platform && platform !== 'all') {
        filters.push('COALESCE(c.platform, c.slug) = ?');
        params.push(platform);
    }

    const keyword = normalizeText(query.search || query.keyword || '');
    if (keyword) {
        filters.push('(a.title LIKE ? OR a.description LIKE ? OR c.name LIKE ?)');
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    return { filters, params };
}

const DEFAULT_MXH_CATEGORIES = [
    { name: 'FB Via Cổ', slug: 'fb-via-co', icon: 'fab fa-facebook', display_order: 1, color: '#1877f2', platform: 'facebook' },
    { name: 'FB Clone', slug: 'fb-clone', icon: 'fab fa-facebook', display_order: 2, color: '#1877f2', platform: 'facebook' },
    { name: 'FB Checkpoint', slug: 'fb-checkpoint', icon: 'fab fa-facebook', display_order: 3, color: '#1877f2', platform: 'facebook' },
    { name: 'TikTok Clone', slug: 'tiktok-clone', icon: 'fab fa-tiktok', display_order: 1, color: '#010101', platform: 'tiktok' },
    { name: 'TikTok Via', slug: 'tiktok-via', icon: 'fab fa-tiktok', display_order: 2, color: '#010101', platform: 'tiktok' },
    { name: 'TikTok Verify', slug: 'tiktok-verify', icon: 'fab fa-tiktok', display_order: 3, color: '#010101', platform: 'tiktok' },
    { name: 'IG Via', slug: 'ig-via', icon: 'fab fa-instagram', display_order: 1, color: '#e1306c', platform: 'instagram' },
    { name: 'IG Clone', slug: 'ig-clone', icon: 'fab fa-instagram', display_order: 2, color: '#e1306c', platform: 'instagram' },
    { name: 'IG Checkpoint', slug: 'ig-checkpoint', icon: 'fab fa-instagram', display_order: 3, color: '#e1306c', platform: 'instagram' },
    { name: 'YouTube', slug: 'youtube-account', icon: 'fab fa-youtube', display_order: 1, color: '#ff0000', platform: 'youtube' },
    { name: 'X / Twitter', slug: 'x-twitter', icon: 'fab fa-x-twitter', display_order: 1, color: '#000000', platform: 'twitter' },
    { name: 'Zalo', slug: 'zalo-account', icon: 'fas fa-comment-dots', display_order: 1, color: '#0068ff', platform: 'zalo' },
    { name: 'Telegram', slug: 'telegram-account', icon: 'fab fa-telegram', display_order: 1, color: '#26a5e4', platform: 'telegram' },
    { name: 'Khác', slug: 'other-account', icon: 'fas fa-ellipsis', display_order: 1, color: '#64748b', platform: 'other' }
];

async function ensureDefaultMxhCategories(kind = 'account') {
    const normalizedKind = normalizeCategoryKind(kind);
    if (normalizedKind === 'service') {
        await ensureServiceDefaults();
        return;
    }

    for (const cat of DEFAULT_MXH_CATEGORIES) {
        await db.execute(
            `
                INSERT OR IGNORE INTO mxh_categories (
                    name, slug, icon, display_order, color, platform, kind, is_active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'account', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            [cat.name, cat.slug, cat.icon, cat.display_order, cat.color, cat.platform]
        );
    }
}

async function resolveMxhCategoryId(rawValue, kind = 'account') {
    const text = normalizeText(rawValue);
    if (!text) return 0;
    const normalizedKind = normalizeCategoryKind(kind);

    const numeric = Number.parseInt(text, 10);
    if (Number.isFinite(numeric) && String(numeric) === text) {
        return numeric;
    }

    const [rows] = await db.execute(
        'SELECT id FROM mxh_categories WHERE kind = ? AND (slug = ? OR platform = ?) LIMIT 1',
        [normalizedKind, text, text]
    );
    return Number(rows[0]?.id || 0);
}

exports.getStats = async (req, res) => {
    try {
        const [[rows]] = await Promise.all([
            db.execute(`
                SELECT
                    (SELECT COUNT(*) FROM mxh_accounts) AS created_accounts,
                    (SELECT COUNT(*) FROM mxh_accounts WHERE status = 'sold') AS sold_accounts,
                    (SELECT COUNT(DISTINCT buyer_id) FROM mxh_accounts WHERE buyer_id IS NOT NULL AND status = 'sold') AS buyer_count
            `)
        ]);

        const data = rows || {};
        res.json({
            success: true,
            data: {
                created_accounts: Number(data.created_accounts || 0),
                sold_accounts: Number(data.sold_accounts || 0),
                buyer_count: Number(data.buyer_count || 0)
            }
        });
    } catch (error) {
        console.error('Error in getStats:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy thống kê MXH' });
    }
};

// Get categories
exports.getCategories = async (req, res) => {
    try {
        const kind = normalizeCategoryKind(req.query?.kind || 'account');
        await ensureDefaultMxhCategories(kind);
        const includeInactive = req.user?.role === 'admin';
        const activeClause = includeInactive ? '' : ' AND is_active = 1';
        const [rows] = await db.execute(
            `SELECT * FROM mxh_categories WHERE kind = ?${activeClause} ORDER BY display_order ASC, id ASC`,
            [kind]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error in getCategories:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh mục MXH' });
    }
};

// Create account
exports.createAccount = async (req, res) => {
    try {
        const {
            mxh_category_id,
            price,
            description,
            title,
            images,
            quantity,
            account_email,
            account_password,
            backup_email,
            backup_email_password,
            cookie,
            extra_info
        } = req.body || {};

        const sellerId = req.user.id;
        const categoryId = await resolveMxhCategoryId(mxh_category_id, 'account');
        const normalizedTitle = normalizeText(title);
        const normalizedDescription = normalizeText(description);
        const normalizedEmail = normalizeText(account_email);
        const normalizedPassword = normalizeText(account_password);
        const parsedPrice = Number.parseFloat(price);
        const qty = parsePositiveInt(quantity, 1);
        const imageList = parseJsonArray(images, [])
            .map((item) => normalizeText(item))
            .filter(Boolean);

        if (!categoryId || !normalizedTitle || !normalizedEmail || !normalizedPassword) {
            return res.status(400).json({
                success: false,
                message: 'Vui long dien du thong tin bat buoc'
            });
        }

        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Gia ban phai lon hon 0'
            });
        }

        if (!normalizedDescription || normalizedDescription.length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Mo ta phai co it nhat 10 ky tu'
            });
        }

        if (!imageList.length) {
            return res.status(400).json({
                success: false,
                message: 'Vui long them it nhat 1 anh'
            });
        }

        if (qty !== 1) {
            return res.status(400).json({
                success: false,
                message: 'He thong MXH hien chi ho tro dang 1 tai khoan moi lan'
            });
        }

        const [categories] = await db.execute(
            "SELECT id FROM mxh_categories WHERE id = ? AND kind = 'account' AND is_active = 1",
            [categoryId]
        );

        if (!categories.length) {
            return res.status(400).json({
                success: false,
                message: 'Danh mục MXH không tồn tại hoặc đã bị ẩn'
            });
        }

        const credentials = {
            account_email: normalizedEmail,
            account_password: normalizedPassword,
            backup_email: normalizeText(backup_email),
            backup_email_password: normalizeText(backup_email_password),
            cookie: normalizeText(cookie),
            extra_info: normalizeText(extra_info)
        };

        const encryptedCredentials = encrypt(JSON.stringify(credentials));

        await db.execute(
            `
                INSERT INTO mxh_accounts (
                    category_id, seller_id, title, price, description, images, credentials, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
            `,
            [
                categoryId,
                sellerId,
                normalizedTitle,
                parsedPrice,
                normalizedDescription,
                JSON.stringify(imageList),
                encryptedCredentials
            ]
        );

        res.json({ success: true, message: 'Đã đăng bán tài khoản thành công' });
    } catch (error) {
        console.error('Error in createAccount:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo tài khoản' });
    }
};

// Get accounts
exports.getAccounts = async (req, res) => {
    try {
        const page = Math.max(parsePositiveInt(req.query.page, 1), 1);
        const limit = Math.min(Math.max(parsePositiveInt(req.query.limit, 12), 1), 48);
        const offset = (page - 1) * limit;
        const sort = normalizeText(req.query.sort || 'newest');

        const { filters, params } = buildAccountListQuery(req.query);
        const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        const [countRows] = await db.execute(
            `
                SELECT COUNT(*) AS total
                FROM mxh_accounts a
                JOIN mxh_categories c ON a.category_id = c.id AND c.kind = 'account'
                ${whereSql}
            `,
            params
        );

        let orderSql = `${buildStatusOrderSql('a')}, a.created_at DESC, a.id DESC`;
        if (sort === 'price_asc') {
            orderSql = `${buildStatusOrderSql('a')}, a.price ASC, a.created_at DESC, a.id DESC`;
        } else if (sort === 'price_desc') {
            orderSql = `${buildStatusOrderSql('a')}, a.price DESC, a.created_at DESC, a.id DESC`;
        } else if (sort === 'popular') {
            orderSql = `${buildStatusOrderSql('a')}, a.created_at DESC, a.id DESC`;
        }

        const [rows] = await db.execute(
            `
                SELECT
                    a.id,
                    a.category_id,
                    a.seller_id,
                    a.title,
                    a.price,
                    a.description,
                    a.images,
                    a.status,
                    a.created_at,
                    a.purchased_at,
                    c.name AS category_name,
                    c.icon AS category_icon,
                    c.slug AS category_slug,
                    c.platform AS category_platform,
                    c.color AS category_color,
                    u.full_name AS seller_name,
                    u.avatar AS seller_avatar,
                    CASE WHEN a.status = 'active' THEN 1 ELSE 0 END AS available_count
                FROM mxh_accounts a
                JOIN mxh_categories c ON a.category_id = c.id AND c.kind = 'account'
                LEFT JOIN users u ON a.seller_id = u.id
                ${whereSql}
                ORDER BY ${orderSql}
                LIMIT ? OFFSET ?
            `,
            [...params, limit, offset]
        );

        const totalItems = Number(countRows[0]?.total || 0);
        const totalPages = Math.max(Math.ceil(totalItems / limit), 1);

        res.json({
            success: true,
            data: {
                accounts: rows.map(toAccountPayload),
                pagination: {
                    page,
                    limit,
                    totalItems,
                    totalPages,
                    hasPrev: page > 1,
                    hasNext: page < totalPages
                }
            }
        });
    } catch (error) {
        console.error('Error in getAccounts:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách' });
    }
};

// Get account detail
exports.getAccountDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.execute(
            `
                SELECT
                    a.id,
                    a.category_id,
                    a.seller_id,
                    a.title,
                    a.price,
                    a.description,
                    a.images,
                    a.status,
                    a.created_at,
                a.purchased_at,
                    a.buyer_id,
                    c.name AS category_name,
                    c.icon AS category_icon,
                    c.slug AS category_slug,
                    c.platform AS category_platform,
                    c.color AS category_color,
                    u.full_name AS seller_name,
                    u.avatar AS seller_avatar,
                    CASE WHEN a.status = 'active' THEN 1 ELSE 0 END AS available_count
                FROM mxh_accounts a
                JOIN mxh_categories c ON a.category_id = c.id AND c.kind = 'account'
                LEFT JOIN users u ON a.seller_id = u.id
                WHERE a.id = ? AND a.status != 'hidden'
            `,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }

        const acc = toAccountPayload(rows[0]);

        const [sellerStats] = await db.execute(
            `
                SELECT COUNT(*) AS total_mxh
                FROM mxh_accounts
                WHERE seller_id = ?
            `,
            [acc.seller_id]
        );

        acc.seller_total_products = Number(sellerStats[0]?.total_mxh || 0);

        if (req.user?.id) {
            // First try to get credentials from mxh_accounts (if account still exists)
            const [buyerRows] = await db.execute(
                'SELECT buyer_id, credentials FROM mxh_accounts WHERE id = ?',
                [id]
            );

            if (buyerRows.length > 0 && Number(buyerRows[0].buyer_id) === Number(req.user.id)) {
                try {
                    acc.credentials = JSON.parse(decrypt(buyerRows[0].credentials));
                } catch (e) {
                    acc.credentials = {
                        account_email: '',
                        account_password: '',
                        backup_email: '',
                        backup_email_password: '',
                        cookie: '',
                        extra_info: ''
                    };
                }
            } else {
                // If not found in mxh_accounts, try to get from purchase history
                const [purchaseHistoryRows] = await db.execute(
                    'SELECT buyer_id, credentials FROM mxh_purchase_history WHERE account_id = ? ORDER BY purchased_at DESC LIMIT 1',
                    [id]
                );

                if (purchaseHistoryRows.length > 0 && Number(purchaseHistoryRows[0].buyer_id) === Number(req.user.id)) {
                    try {
                        acc.credentials = JSON.parse(decrypt(purchaseHistoryRows[0].credentials));
                    } catch (e) {
                        acc.credentials = {
                            account_email: '',
                            account_password: '',
                            backup_email: '',
                            backup_email_password: '',
                            cookie: '',
                            extra_info: ''
                        };
                    }
                }
            }
        }

        res.json({ success: true, data: acc });
    } catch (error) {
        console.error('Error in getAccountDetail:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy chi tiết' });
    }
};

// Purchase account
exports.purchaseAccount = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { id } = req.params;
        const buyerId = req.user.id;

        await connection.beginTransaction();

        const [accounts] = await connection.execute(
            'SELECT * FROM mxh_accounts WHERE id = ?',
            [id]
        );

        if (accounts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại' });
        }

        const acc = accounts[0];
        if (acc.status !== 'active') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Tài khoản này đã bị mua hoặc không còn bán'
            });
        }

        if (Number(acc.seller_id) === Number(buyerId)) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Bạn không thể tự mua tài khoản của mình'
            });
        }

        const [buyers] = await connection.execute(
            'SELECT balance FROM users WHERE id = ?',
            [buyerId]
        );
        const buyer = buyers[0];

        if (!buyer) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản người mua' });
        }

        if (Number(buyer.balance || 0) < Number(acc.price || 0)) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Số dư không đủ. Vui lòng nạp thêm tiền.'
            });
        }

        const [sellers] = await connection.execute(
            'SELECT balance FROM users WHERE id = ?',
            [acc.seller_id]
        );
        const seller = sellers[0];

        if (!seller) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Không tìm thấy tài khoản người bán' });
        }

        const buyerBefore = Number(buyer.balance || 0);
        const sellerBefore = Number(seller.balance || 0);
        const price = Number(acc.price || 0);
        const buyerAfter = buyerBefore - price;
        const sellerAfter = sellerBefore + price;

        await connection.execute(
            'UPDATE users SET balance = ? WHERE id = ?',
            [buyerAfter, buyerId]
        );
        await connection.execute(
            'UPDATE users SET balance = ? WHERE id = ?',
            [sellerAfter, acc.seller_id]
        );

        await connection.execute(
            `
                INSERT INTO transactions (
                    user_id, type, amount, balance_before, balance_after, description, reference_id
                )
                VALUES (?, 'buy_mxh', ?, ?, ?, ?, ?)
            `,
            [buyerId, -price, buyerBefore, buyerAfter, `Mua tai khoan MXH: ${acc.title}`, acc.id]
        );

        await connection.execute(
            `
                INSERT INTO transactions (
                    user_id, type, amount, balance_before, balance_after, description, reference_id
                )
                VALUES (?, 'sell_mxh', ?, ?, ?, ?, ?)
            `,
            [acc.seller_id, price, sellerBefore, sellerAfter, `Ban tai khoan MXH: ${acc.title}`, acc.id]
        );

        await connection.execute(
            `
                UPDATE mxh_accounts
                SET status = 'sold', buyer_id = ?, purchased_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
            [buyerId, id]
        );

        // Store purchase snapshot in history
        await connection.execute(
            `
                INSERT INTO mxh_purchase_history (
                    account_id, buyer_id, seller_id, category_id, title, price, 
                    description, images, credentials, purchased_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `,
            [
                id,
                buyerId,
                acc.seller_id,
                acc.category_id,
                acc.title,
                acc.price,
                acc.description || null,
                acc.images || null,
                acc.credentials,
                new Date().toISOString()
            ]
        );

        await connection.commit();

        let credentials;
        try {
            credentials = JSON.parse(decrypt(acc.credentials));
        } catch (e) {
            credentials = {
                account_email: '',
                account_password: '',
                backup_email: '',
                backup_email_password: '',
                cookie: '',
                extra_info: ''
            };
        }

        res.json({
            success: true,
            message: 'Mua tai khoan thanh cong',
            data: {
                newBalance: buyerAfter,
                credentials
            }
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error in purchaseAccount:', error);
        res.status(500).json({ success: false, message: 'Loi server khi mua tai khoan' });
    }
};

// Admin: Create category
exports.adminCreateCategory = async (req, res) => {
    try {
        const { name, slug, icon, sort_order, color, platform, kind, description } = req.body || {};
        const normalizedName = normalizeText(name);
        const normalizedSlug = normalizeText(slug);
        const normalizedKind = normalizeCategoryKind(kind);
        const normalizedPlatform = normalizeText(platform) || normalizedSlug;

        if (!normalizedName || !normalizedSlug) {
            return res.status(400).json({ success: false, message: 'Thieu ten hoac slug' });
        }

        if (normalizedKind === 'service' && !['facebook', 'tiktok', 'instagram'].includes(normalizedPlatform)) {
            return res.status(400).json({ success: false, message: 'Danh mục dịch vụ chỉ hỗ trợ Facebook, TikTok và Instagram' });
        }

        await db.execute(
            `
                INSERT INTO mxh_categories (name, slug, icon, display_order, color, platform, kind, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            [
                normalizedName,
                normalizedSlug,
                normalizeText(icon) || 'fas fa-share-nodes',
                parsePositiveInt(sort_order, 0),
                normalizeText(color) || '#6366f1',
                normalizedPlatform,
                normalizedKind,
                normalizeText(description) || null
            ]
        );

        res.json({ success: true, message: 'Them danh muc thanh cong' });
    } catch (error) {
        console.error('Error in adminCreateCategory:', error);
        res.status(500).json({ success: false, message: 'Loi khi tao danh muc' });
    }
};

// Admin: Update category
exports.adminUpdateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, slug, icon, sort_order, color, platform, kind, description } = req.body || {};
        const normalizedKind = normalizeCategoryKind(kind);
        const normalizedPlatform = normalizeText(platform) || normalizeText(slug);

        if (normalizedKind === 'service' && !['facebook', 'tiktok', 'instagram'].includes(normalizedPlatform)) {
            return res.status(400).json({ success: false, message: 'Danh mục dịch vụ chỉ hỗ trợ Facebook, TikTok và Instagram' });
        }

        await db.execute(
            `
                UPDATE mxh_categories
                SET name = ?, slug = ?, icon = ?, display_order = ?, color = ?, platform = ?, kind = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
            [
                normalizeText(name),
                normalizeText(slug),
                normalizeText(icon) || 'fas fa-share-nodes',
                parsePositiveInt(sort_order, 0),
                normalizeText(color) || '#6366f1',
                normalizedPlatform,
                normalizedKind,
                normalizeText(description) || null,
                id
            ]
        );

        res.json({ success: true, message: 'Cap nhat danh muc thanh cong' });
    } catch (error) {
        console.error('Error in adminUpdateCategory:', error);
        res.status(500).json({ success: false, message: 'Loi khi cap nhat danh muc' });
    }
};

// Admin: Delete category
exports.adminDeleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const [categoryRows] = await db.execute('SELECT kind FROM mxh_categories WHERE id = ? LIMIT 1', [id]);
        const categoryKind = normalizeCategoryKind(categoryRows[0]?.kind || 'account');

        if (categoryKind === 'service') {
            const [packages] = await db.execute(
                'SELECT id FROM mxh_service_packages WHERE category_id = ? LIMIT 1',
                [id]
            );
            if (packages.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Không thể xóa danh mục đang có gói dịch vụ'
                });
            }
        } else {
            const [accounts] = await db.execute(
                'SELECT id FROM mxh_accounts WHERE category_id = ? LIMIT 1',
                [id]
            );
            if (accounts.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Khong the xoa danh muc dang co tai khoan dang ban'
                });
            }
        }

        await db.execute('DELETE FROM mxh_categories WHERE id = ?', [id]);
        res.json({ success: true, message: 'Xoa danh muc thanh cong' });
    } catch (error) {
        console.error('Error in adminDeleteCategory:', error);
        res.status(500).json({ success: false, message: 'Loi khi xoa danh muc' });
    }
};
