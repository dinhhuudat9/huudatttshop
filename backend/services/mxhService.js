const db = require('../config/database');
const notificationService = require('./notificationService');

const SERVICE_PLATFORMS = ['facebook', 'tiktok', 'instagram'];

const DEFAULT_SERVICE_CATEGORIES = [
    {
        name: 'Dá»‹ch vá»¥ Facebook',
        slug: 'facebook-services',
        icon: 'fab fa-facebook',
        color: '#1877f2',
        platform: 'facebook',
        display_order: 1,
        description: 'CÃ¡c gÃ³i tÄƒng tÆ°Æ¡ng tÃ¡c cho Facebook'
    },
    {
        name: 'Dá»‹ch vá»¥ TikTok',
        slug: 'tiktok-services',
        icon: 'fab fa-tiktok',
        color: '#010101',
        platform: 'tiktok',
        display_order: 2,
        description: 'CÃ¡c gÃ³i tÄƒng tÆ°Æ¡ng tÃ¡c cho TikTok'
    },
    {
        name: 'Dá»‹ch vá»¥ Instagram',
        slug: 'instagram-services',
        icon: 'fab fa-instagram',
        color: '#e1306c',
        platform: 'instagram',
        display_order: 3,
        description: 'CÃ¡c gÃ³i tÄƒng tÆ°Æ¡ng tÃ¡c cho Instagram'
    }
];

const DEFAULT_SERVICE_PACKAGES = [
    {
        category_slug: 'facebook-services',
        name: 'TÄƒng 1000 Like bÃ i viáº¿t',
        slug: 'fb-like-1000',
        description: 'TÄƒng like tá»± nhiÃªn cho bÃ i viáº¿t Facebook',
        price: 25000,
        unit_label: 'like',
        quantity_min: 100,
        quantity_max: 10000,
        default_quantity: 1000,
        link_label: 'Link bÃ i viáº¿t',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link bÃ i viáº¿t Facebook Ä‘á»ƒ há»‡ thá»‘ng xá»­ lÃ½',
        display_order: 1
    },
    {
        category_slug: 'facebook-services',
        name: 'TÄƒng 1000 Follow',
        slug: 'fb-follow-1000',
        description: 'TÄƒng follow cho fanpage hoáº·c tÃ i khoáº£n Facebook',
        price: 35000,
        unit_label: 'follow',
        quantity_min: 100,
        quantity_max: 10000,
        default_quantity: 1000,
        link_label: 'Link trang',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link trang cÃ¡ nhÃ¢n hoáº·c fanpage',
        display_order: 2
    },
    {
        category_slug: 'facebook-services',
        name: 'TÄƒng 1000 View video',
        slug: 'fb-view-1000',
        description: 'TÄƒng lÆ°á»£t xem video Facebook',
        price: 18000,
        unit_label: 'view',
        quantity_min: 100,
        quantity_max: 50000,
        default_quantity: 1000,
        link_label: 'Link video',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link video cáº§n tÄƒng view',
        display_order: 3
    },
    {
        category_slug: 'tiktok-services',
        name: 'TÄƒng 1000 Follow',
        slug: 'tiktok-follow-1000',
        description: 'TÄƒng follow TikTok nhanh chÃ³ng',
        price: 30000,
        unit_label: 'follow',
        quantity_min: 100,
        quantity_max: 10000,
        default_quantity: 1000,
        link_label: 'Link profile',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link profile TikTok',
        display_order: 1
    },
    {
        category_slug: 'tiktok-services',
        name: 'TÄƒng 1000 Like',
        slug: 'tiktok-like-1000',
        description: 'TÄƒng like cho video TikTok',
        price: 22000,
        unit_label: 'like',
        quantity_min: 100,
        quantity_max: 50000,
        default_quantity: 1000,
        link_label: 'Link video',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link video TikTok',
        display_order: 2
    },
    {
        category_slug: 'tiktok-services',
        name: 'TÄƒng 1000 View',
        slug: 'tiktok-view-1000',
        description: 'TÄƒng lÆ°á»£t xem cho video TikTok',
        price: 15000,
        unit_label: 'view',
        quantity_min: 100,
        quantity_max: 100000,
        default_quantity: 1000,
        link_label: 'Link video',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link video TikTok cáº§n tÄƒng view',
        display_order: 3
    },
    {
        category_slug: 'instagram-services',
        name: 'TÄƒng 1000 Follow',
        slug: 'ig-follow-1000',
        description: 'TÄƒng follower Instagram',
        price: 32000,
        unit_label: 'follow',
        quantity_min: 100,
        quantity_max: 10000,
        default_quantity: 1000,
        link_label: 'Link profile',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link profile Instagram',
        display_order: 1
    },
    {
        category_slug: 'instagram-services',
        name: 'TÄƒng 1000 Like',
        slug: 'ig-like-1000',
        description: 'TÄƒng like cho bÃ i Ä‘Äƒng Instagram',
        price: 24000,
        unit_label: 'like',
        quantity_min: 100,
        quantity_max: 50000,
        default_quantity: 1000,
        link_label: 'Link bÃ i Ä‘Äƒng',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link bÃ i Ä‘Äƒng Instagram',
        display_order: 2
    },
    {
        category_slug: 'instagram-services',
        name: 'TÄƒng 1000 View Reel',
        slug: 'ig-view-1000',
        description: 'TÄƒng lÆ°á»£t xem cho Reel Instagram',
        price: 19000,
        unit_label: 'view',
        quantity_min: 100,
        quantity_max: 50000,
        default_quantity: 1000,
        link_label: 'Link Reel',
        note_label: 'Ghi chÃº',
        form_hint: 'DÃ¡n link Reel Instagram',
        display_order: 3
    }
];

function normalizeText(value = '', fallback = '') {
    return String(value ?? fallback).trim();
}

function normalizePlatform(value = '') {
    const platform = normalizeText(value, '').toLowerCase();
    return SERVICE_PLATFORMS.includes(platform) ? platform : '';
}

function parsePositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getBaseQuantity(target) {
    if (!target) return 1;
    const name = target.name || '';
    const matches = name.replace(/[,.]/g, '').match(/\d+/g);
    if (matches && matches.length > 0) {
        for (const numStr of matches) {
            const num = parseInt(numStr, 10);
            if (num >= 10) return num;
        }
        const firstNum = parseInt(matches[0], 10);
        if (firstNum > 0) return firstNum;
    }
    const defaultQty = parseInt(target.default_quantity || target.defaultQuantity, 10);
    if (defaultQty > 0) return defaultQty;
    return 1;
}

async function resolveCategoryIdBySlug(slug, kind = 'service') {
    const text = normalizeText(slug);
    if (!text) return 0;

    const [rows] = await db.execute(
        `SELECT id
         FROM mxh_categories
         WHERE slug = ? AND kind = ?
         LIMIT 1`,
        [text, kind]
    );
    return Number(rows[0]?.id || 0);
}

async function ensureDefaultServiceCategories() {
    for (const category of DEFAULT_SERVICE_CATEGORIES) {
        await db.execute(
            `INSERT OR IGNORE INTO mxh_categories
                (name, slug, icon, color, platform, kind, description, display_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'service', ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                category.name,
                category.slug,
                category.icon,
                category.color,
                category.platform,
                category.description,
                category.display_order
            ]
        );
    }
}

async function ensureDefaultServicePackages() {
    for (const pkg of DEFAULT_SERVICE_PACKAGES) {
        const categoryId = await resolveCategoryIdBySlug(pkg.category_slug, 'service');
        if (!categoryId) continue;

        await db.execute(
            `INSERT OR IGNORE INTO mxh_service_packages
                (category_id, name, slug, description, price, unit_label, quantity_min, quantity_max,
                 default_quantity, link_label, note_label, form_hint, display_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                categoryId,
                pkg.name,
                pkg.slug,
                pkg.description,
                pkg.price,
                pkg.unit_label,
                pkg.quantity_min,
                pkg.quantity_max,
                pkg.default_quantity,
                pkg.link_label,
                pkg.note_label,
                pkg.form_hint,
                pkg.display_order
            ]
        );
    }
}

async function ensureServiceDefaults() {
    await ensureDefaultServiceCategories();
    await ensureDefaultServicePackages();
}

function buildPackageWhere(query = {}) {
    const includeInactive = String(query.include_inactive || query.includeInactive || '') === '1';
    const filters = ["c.kind = 'service'"];
    if (!includeInactive) {
        filters.push('c.is_active = 1', 'p.is_active = 1');
    }
    const params = [];

    const platform = normalizePlatform(query.platform || '');
    if (platform) {
        filters.push('c.platform = ?');
        params.push(platform);
    }

    const categoryId = parsePositiveInt(query.category_id || query.service_category_id, 0);
    if (categoryId) {
        filters.push('p.category_id = ?');
        params.push(categoryId);
    }

    const search = normalizeText(query.search || query.keyword || '');
    if (search) {
        filters.push('(p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    return { filters, params };
}

async function listServiceCategories(query = {}) {
    await ensureServiceDefaults();
    const platform = normalizePlatform(query.platform || '');
    const includeInactive = String(query.include_inactive || query.includeInactive || '') === '1';
    const filters = ["kind = 'service'"];
    if (!includeInactive) {
        filters.push('is_active = 1');
    }
    const params = [];

    if (platform) {
        filters.push('platform = ?');
        params.push(platform);
    }

    const [rows] = await db.execute(
        `SELECT
            id,
            name,
            slug,
            icon,
            color,
            platform,
            kind,
            description,
            display_order,
            is_active,
            created_at,
            updated_at,
            (SELECT COUNT(*) FROM mxh_service_packages p WHERE p.category_id = mxh_categories.id AND p.is_active = 1) AS service_count
         FROM mxh_categories
         WHERE ${filters.join(' AND ')}
         ORDER BY display_order ASC, id ASC`,
        params
    );

    return rows;
}

async function listServicePackages(query = {}) {
    await ensureServiceDefaults();
    const { filters, params } = buildPackageWhere(query);
    const page = Math.max(parsePositiveInt(query.page || 1, 1), 1);
    const limit = Math.min(Math.max(parsePositiveInt(query.limit || 24, 24), 1), 100);
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM mxh_service_packages p
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE ${filters.join(' AND ')}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            p.id,
            p.category_id,
            p.name,
            p.slug,
            p.description,
            p.price,
            p.unit_label,
            p.quantity_min,
            p.quantity_max,
            p.default_quantity,
            p.link_label,
            p.note_label,
            p.form_hint,
            p.display_order,
            p.is_active,
            p.created_at,
            p.updated_at,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color,
            (SELECT COUNT(*) FROM mxh_service_items i WHERE i.package_id = p.id AND i.is_active = 1) AS item_count,
            (SELECT COUNT(*) FROM mxh_service_orders o WHERE o.service_id = p.id) AS order_count
         FROM mxh_service_packages p
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE ${filters.join(' AND ')}
         ORDER BY c.display_order ASC, p.display_order ASC, p.id ASC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const totalItems = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(Math.ceil(totalItems / limit), 1);

    return {
        items: rows,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages
        }
    };
}

function buildItemWhere(query = {}) {
    const includeInactive = String(query.include_inactive || query.includeInactive || '') === '1';
    const filters = ['1=1'];
    const params = [];

    const packageId = parsePositiveInt(query.package_id || query.service_id, 0);
    if (packageId) {
        filters.push('i.package_id = ?');
        params.push(packageId);
    }

    const categoryId = parsePositiveInt(query.category_id || query.service_category_id, 0);
    if (categoryId) {
        filters.push('p.category_id = ?');
        params.push(categoryId);
    }

    const platform = normalizePlatform(query.platform || '');
    if (platform) {
        filters.push('c.platform = ?');
        params.push(platform);
    }

    const search = normalizeText(query.search || query.keyword || '');
    if (search) {
        filters.push('(i.name LIKE ? OR i.description LIKE ? OR p.name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (!includeInactive) {
        filters.push('i.is_active = 1', 'p.is_active = 1', 'c.is_active = 1');
    }

    return { filters, params };
}

async function listServiceItems(query = {}) {
    await ensureServiceDefaults();
    const { filters, params } = buildItemWhere(query);
    const page = Math.max(parsePositiveInt(query.page || 1, 1), 1);
    const limit = Math.min(Math.max(parsePositiveInt(query.limit || 24, 24), 1), 100);
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM mxh_service_items i
         JOIN mxh_service_packages p ON p.id = i.package_id
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE ${filters.join(' AND ')}`,
        params
    );

    const [rows] = await db.execute(
        `SELECT
            i.id,
            i.package_id,
            i.name,
            i.slug,
            i.description,
            i.price,
            i.unit_label,
            i.quantity_min,
            i.quantity_max,
            i.default_quantity,
            i.link_label,
            i.note_label,
            i.form_hint,
            i.display_order,
            i.is_active,
            i.created_at,
            i.updated_at,
            p.name AS package_name,
            p.slug AS package_slug,
            p.display_order AS package_order,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color
         FROM mxh_service_items i
         JOIN mxh_service_packages p ON p.id = i.package_id
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE ${filters.join(' AND ')}
         ORDER BY c.display_order ASC, p.display_order ASC, i.display_order ASC, i.id ASC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const totalItems = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(Math.ceil(totalItems / limit), 1);
    return {
        items: rows,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages
        }
    };
}

async function getServiceItemById(id, includeInactive = false) {
    const activeClause = includeInactive ? '' : ' AND i.is_active = 1 AND p.is_active = 1 AND c.is_active = 1';
    const [rows] = await db.execute(
        `SELECT
            i.id,
            i.package_id,
            i.name,
            i.slug,
            i.description,
            i.price,
            i.unit_label,
            i.quantity_min,
            i.quantity_max,
            i.default_quantity,
            i.link_label,
            i.note_label,
            i.form_hint,
            i.display_order,
            i.is_active,
            i.created_at,
            i.updated_at,
            p.name AS package_name,
            p.slug AS package_slug,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform
         FROM mxh_service_items i
         JOIN mxh_service_packages p ON p.id = i.package_id
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE i.id = ?${activeClause}
         LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

async function getServicePackageById(id, includeInactive = false) {
    const activeClause = includeInactive ? '' : ' AND p.is_active = 1 AND c.is_active = 1';
    const [rows] = await db.execute(
        `SELECT
            p.id,
            p.category_id,
            p.name,
            p.slug,
            p.description,
            p.price,
            p.unit_label,
            p.quantity_min,
            p.quantity_max,
            p.default_quantity,
            p.link_label,
            p.note_label,
            p.form_hint,
            p.display_order,
            p.is_active,
            (SELECT COUNT(*) FROM mxh_service_items i WHERE i.package_id = p.id AND i.is_active = 1) AS item_count,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color
         FROM mxh_service_packages p
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE p.id = ? AND c.kind = 'service'${activeClause}
         LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

async function upsertServiceItem(payload = {}) {
    const id = parsePositiveInt(payload.id, 0);
    const packageId = parsePositiveInt(payload.package_id, 0);
    const name = normalizeText(payload.name);
    const slug = normalizeText(payload.slug);
    const description = normalizeText(payload.description);
    const price = Number.parseFloat(payload.price);
    const unitLabel = normalizeText(payload.unit_label || 'luong') || 'luong';
    const quantityMin = Math.max(parsePositiveInt(payload.quantity_min, 1), 1);
    const quantityMax = Math.max(parsePositiveInt(payload.quantity_max, 1000), quantityMin);
    const defaultQuantity = Math.max(parsePositiveInt(payload.default_quantity, quantityMin), quantityMin);
    const linkLabel = normalizeText(payload.link_label || 'Link') || 'Link';
    const noteLabel = normalizeText(payload.note_label || 'Ghi chu') || 'Ghi chu';
    const formHint = normalizeText(payload.form_hint);
    const displayOrder = parseNonNegativeInt(payload.display_order, 0);
    const isActive = payload.is_active === true || payload.is_active === 1 || payload.is_active === '1' ? 1 : 0;

    if (!packageId || !name || !Number.isFinite(price) || price <= 0) {
        return { error: { status: 400, message: 'Thiáº¿u dá»¯ liá»‡u dá»‹ch vá»¥ con' } };
    }

    const [packageRows] = await db.execute(
        `SELECT p.id
         FROM mxh_service_packages p
         JOIN mxh_categories c ON c.id = p.category_id
         WHERE p.id = ? AND c.kind = 'service'
         LIMIT 1`,
        [packageId]
    );
    if (!packageRows.length) {
        return { error: { status: 400, message: 'GÃ³i dá»‹ch vá»¥ khÃ´ng há»£p lá»‡' } };
    }

    if (id) {
        await db.execute(
            `UPDATE mxh_service_items
             SET package_id = ?, name = ?, slug = ?, description = ?, price = ?, unit_label = ?,
                 quantity_min = ?, quantity_max = ?, default_quantity = ?, link_label = ?,
                 note_label = ?, form_hint = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                packageId,
                name,
                slug || null,
                description || null,
                price,
                unitLabel,
                quantityMin,
                quantityMax,
                defaultQuantity,
                linkLabel,
                noteLabel,
                formHint || null,
                displayOrder,
                isActive,
                id
            ]
        );
        return { id };
    }

    const [result] = await db.execute(
        `INSERT INTO mxh_service_items
            (package_id, name, slug, description, price, unit_label, quantity_min, quantity_max,
             default_quantity, link_label, note_label, form_hint, display_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
            packageId,
            name,
            slug || null,
            description || null,
            price,
            unitLabel,
            quantityMin,
            quantityMax,
            defaultQuantity,
            linkLabel,
            noteLabel,
            formHint || null,
            displayOrder,
            isActive
        ]
    );
    return { id: result.insertId };
}

async function deleteServiceItem(id) {
    const [rows] = await db.execute(
        'SELECT id FROM mxh_service_orders WHERE service_item_id = ? LIMIT 1',
        [id]
    );
    if (rows.length > 0) {
        return { error: { status: 400, message: 'KhÃ´ng thá»ƒ xÃ³a dá»‹ch vá»¥ con Ä‘Ã£ cÃ³ Ä‘Æ¡n hÃ ng' } };
    }
    await db.execute('DELETE FROM mxh_service_items WHERE id = ?', [id]);
    return { success: true };
}

async function createServiceOrder(userId, payload = {}) {
    const connection = await db.getConnection();
    try {
        const serviceId = parsePositiveInt(payload.service_id, 0);
        const serviceItemId = parsePositiveInt(payload.service_item_id, 0);
        const link = normalizeText(payload.link || payload.target_link || payload.url || '');
        const userNote = normalizeText(payload.user_note || payload.note || '');
        const quantity = parsePositiveInt(payload.quantity, 0);

        if (!serviceId || !link || !quantity) {
            return { error: { status: 400, message: 'Vui lÃ²ng nháº­p Ä‘á»§ thÃ´ng tin Ä‘áº·t dá»‹ch vá»¥' } };
        }

        await connection.beginTransaction();

        let selected = null;
        let orderServiceId = serviceId;
        let orderServiceItemId = null;

        if (serviceItemId) {
            const [itemRows] = await connection.execute(
                `SELECT
                    i.id AS service_item_id,
                    i.package_id AS service_id,
                    i.name,
                    i.description,
                    i.price,
                    i.unit_label,
                    i.quantity_min,
                    i.quantity_max,
                    i.default_quantity,
                    i.link_label,
                    i.note_label,
                    i.form_hint,
                    p.category_id,
                    c.name AS category_name,
                    c.slug AS category_slug,
                    c.platform AS platform
                 FROM mxh_service_items i
                 JOIN mxh_service_packages p ON p.id = i.package_id
                 JOIN mxh_categories c ON c.id = p.category_id
                 WHERE i.id = ? AND i.is_active = 1 AND p.is_active = 1 AND c.kind = 'service' AND c.is_active = 1
                 LIMIT 1`,
                [serviceItemId]
            );
            selected = itemRows[0] || null;
            if (selected) {
                orderServiceId = Number(selected.service_id);
                orderServiceItemId = Number(selected.service_item_id);
            }
        } else {
            const [serviceRows] = await connection.execute(
                `SELECT
                    p.id AS service_id,
                    p.category_id,
                    p.name,
                    p.description,
                    p.price,
                    p.unit_label,
                    p.quantity_min,
                    p.quantity_max,
                    p.default_quantity,
                    p.link_label,
                    p.note_label,
                    p.form_hint,
                    c.name AS category_name,
                    c.slug AS category_slug,
                    c.platform AS platform
                 FROM mxh_service_packages p
                 JOIN mxh_categories c ON c.id = p.category_id
                 WHERE p.id = ? AND p.is_active = 1 AND c.kind = 'service' AND c.is_active = 1
                 LIMIT 1`,
                [serviceId]
            );
            selected = serviceRows[0] || null;
        }

        if (!selected) {
            await connection.rollback();
            return { error: { status: 404, message: serviceItemId ? 'KhÃ´ng tÃ¬m tháº¥y dá»‹ch vá»¥ con' : 'KhÃ´ng tÃ¬m tháº¥y gÃ³i dá»‹ch vá»¥' } };
        }

        if (quantity < Number(selected.quantity_min || 1) || quantity > Number(selected.quantity_max || quantity)) {
            await connection.rollback();
            return { error: { status: 400, message: 'Sá»‘ lÆ°á»£ng khÃ´ng há»£p lá»‡' } };
        }

        const rawPrice = Number(selected.price || 0);
        const baseQty = getBaseQuantity(selected);
        const unitPrice = rawPrice / baseQty;
        const totalPrice = Math.round(unitPrice * quantity);
        if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
            await connection.rollback();
            return { error: { status: 400, message: 'Giá dịch vụ không hợp lệ' } };
        }

        const [userRows] = await connection.execute(
            'SELECT id, balance, email, full_name FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const user = userRows[0];
        if (!user) {
            await connection.rollback();
            return { error: { status: 404, message: 'KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n ngÆ°á»i dÃ¹ng' } };
        }

        const balanceBefore = Number(user.balance || 0);
        if (balanceBefore < totalPrice) {
            await connection.rollback();
            return { error: { status: 400, message: 'Sá»‘ dÆ° khÃ´ng Ä‘á»§. Vui lÃ²ng náº¡p thÃªm tiá»n.' } };
        }

        const balanceAfter = balanceBefore - totalPrice;
        await connection.execute('UPDATE users SET balance = ? WHERE id = ?', [balanceAfter, userId]);

        await connection.execute(
            `INSERT INTO transactions (
                user_id, type, amount, balance_before, balance_after, description, reference_id
            )
            VALUES (?, 'mxh_service_order', ?, ?, ?, ?, ?)`,
            [
                userId,
                -totalPrice,
                balanceBefore,
                balanceAfter,
                `Äáº·t dá»‹ch vá»¥ MXH: ${selected.name}`,
                orderServiceItemId || orderServiceId
            ]
        );

        const [orderResult] = await connection.execute(
            `INSERT INTO mxh_service_orders (
                user_id, service_id, service_item_id, category_id, platform, link, quantity, unit_price, total_price,
                status, user_note, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                userId,
                orderServiceId,
                orderServiceItemId || null,
                selected.category_id,
                selected.platform,
                link,
                quantity,
                unitPrice,
                totalPrice,
                userNote || null
            ]
        );

        await connection.commit();

        await notificationService.notifyAdmins({
            title: 'ÄÆ¡n dá»‹ch vá»¥ MXH má»›i',
            content: `${user.full_name || user.email || `User ${userId}`} vá»«a táº¡o Ä‘Æ¡n ${selected.name} (${String(selected.platform || '').toUpperCase()}) vá»›i tá»•ng ${totalPrice.toLocaleString('vi-VN')}Ä‘.`,
            target_user_id: null,
            created_by: userId,
            is_important: true
        }, { sendTelegram: false });

        await notificationService.createNotification({
            title: 'ÄÆ¡n dá»‹ch vá»¥ Ä‘Ã£ Ä‘Æ°á»£c gá»­i',
            content: `ÄÆ¡n #${orderResult.insertId} Ä‘ang chá» admin xá»­ lÃ½.`,
            target_user_id: userId,
            created_by: null,
            is_important: false,
            send_telegram: false
        });

        return {
            orderId: orderResult.insertId,
            newBalance: balanceAfter
        };
    } catch (error) {
        await connection.rollback().catch(() => {});
        return { error };
    } finally {
        connection.release();
    }
}

async function getUserServiceOrders(userId, limit = 50) {
    await ensureServiceDefaults();
    const safeLimit = Math.min(Math.max(parsePositiveInt(limit, 50), 1), 200);
    const [rows] = await db.execute(
        `SELECT
            o.*,
            COALESCE(i.name, p.name) AS service_name,
            COALESCE(i.slug, p.slug) AS service_slug,
            COALESCE(i.description, p.description) AS service_description,
            COALESCE(i.link_label, p.link_label) AS link_label,
            COALESCE(i.note_label, p.note_label) AS note_label,
            COALESCE(i.unit_label, p.unit_label) AS unit_label,
            COALESCE(i.quantity_min, p.quantity_min) AS quantity_min,
            COALESCE(i.quantity_max, p.quantity_max) AS quantity_max,
            i.name AS service_item_name,
            i.slug AS service_item_slug,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color
         FROM mxh_service_orders o
         JOIN mxh_service_packages p ON p.id = o.service_id
         LEFT JOIN mxh_service_items i ON i.id = o.service_item_id
         JOIN mxh_categories c ON c.id = o.category_id
         WHERE o.user_id = ?
         ORDER BY o.created_at DESC
         LIMIT ?`,
        [userId, safeLimit]
    );
    return rows;
}

async function getAdminServiceOrders(limit = 100) {
    await ensureServiceDefaults();
    const safeLimit = Math.min(Math.max(parsePositiveInt(limit, 100), 1), 300);
    const [rows] = await db.execute(
        `SELECT
            o.*,
            u.email AS user_email,
            u.full_name AS user_name,
            u.balance AS user_balance,
            COALESCE(i.name, p.name) AS service_name,
            COALESCE(i.slug, p.slug) AS service_slug,
            COALESCE(i.description, p.description) AS service_description,
            COALESCE(i.link_label, p.link_label) AS link_label,
            COALESCE(i.note_label, p.note_label) AS note_label,
            COALESCE(i.unit_label, p.unit_label) AS unit_label,
            COALESCE(i.quantity_min, p.quantity_min) AS quantity_min,
            COALESCE(i.quantity_max, p.quantity_max) AS quantity_max,
            i.name AS service_item_name,
            i.slug AS service_item_slug,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color
         FROM mxh_service_orders o
         JOIN users u ON u.id = o.user_id
         JOIN mxh_service_packages p ON p.id = o.service_id
         LEFT JOIN mxh_service_items i ON i.id = o.service_item_id
         JOIN mxh_categories c ON c.id = o.category_id
         ORDER BY o.created_at DESC
         LIMIT ?`,
        [safeLimit]
    );
    return rows;
}


async function getUserServiceOrders(userId, limit = 50) {
    await ensureServiceDefaults();
    const safeLimit = Math.min(Math.max(parsePositiveInt(limit, 50), 1), 200);
    const [rows] = await db.execute(
        `SELECT
            o.*,
            p.name AS service_name,
            p.slug AS service_slug,
            p.description AS service_description,
            p.link_label,
            p.note_label,
            p.unit_label,
            p.quantity_min,
            p.quantity_max,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color
         FROM mxh_service_orders o
         JOIN mxh_service_packages p ON p.id = o.service_id
         JOIN mxh_categories c ON c.id = o.category_id
         WHERE o.user_id = ?
         ORDER BY o.created_at DESC
         LIMIT ?`,
        [userId, safeLimit]
    );
    return rows;
}

async function getAdminServiceOrders(limit = 100) {
    await ensureServiceDefaults();
    const safeLimit = Math.min(Math.max(parsePositiveInt(limit, 100), 1), 300);
    const [rows] = await db.execute(
        `SELECT
            o.*,
            u.email AS user_email,
            u.full_name AS user_name,
            u.balance AS user_balance,
            p.name AS service_name,
            p.slug AS service_slug,
            p.description AS service_description,
            p.link_label,
            p.note_label,
            p.unit_label,
            p.quantity_min,
            p.quantity_max,
            c.name AS category_name,
            c.slug AS category_slug,
            c.platform AS platform,
            c.icon AS category_icon,
            c.color AS category_color
         FROM mxh_service_orders o
         JOIN users u ON u.id = o.user_id
         JOIN mxh_service_packages p ON p.id = o.service_id
         JOIN mxh_categories c ON c.id = o.category_id
         ORDER BY o.created_at DESC
         LIMIT ?`,
        [safeLimit]
    );
    return rows;
}

async function updateServiceOrderStatus(orderId, action, adminId, adminNote = '') {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT o.*, u.balance, u.email, u.full_name
             FROM mxh_service_orders o
             JOIN users u ON u.id = o.user_id
             WHERE o.id = ?
             LIMIT 1`,
            [orderId]
        );
        const order = rows[0];
        if (!order) {
            await connection.rollback();
            return { error: { status: 404, message: 'KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng' } };
        }

        const note = normalizeText(adminNote);
        const nowSql = 'CURRENT_TIMESTAMP';

        if (action === 'processing') {
            await connection.execute(
                `UPDATE mxh_service_orders
                 SET status = 'processing',
                     admin_note = COALESCE(?, admin_note),
                     processed_by = ?,
                     processed_at = ${nowSql},
                     updated_at = ${nowSql}
                 WHERE id = ?`,
                [note || null, adminId, orderId]
            );
        } else if (action === 'complete') {
            await connection.execute(
                `UPDATE mxh_service_orders
                 SET status = 'completed',
                     admin_note = COALESCE(?, admin_note),
                     processed_by = ?,
                     processed_at = ${nowSql},
                     completed_at = ${nowSql},
                     updated_at = ${nowSql}
                 WHERE id = ?`,
                [note || null, adminId, orderId]
            );
        } else if (action === 'cancel') {
            if (order.status === 'cancelled') {
                await connection.rollback();
                return { error: { status: 400, message: 'ÄÆ¡n Ä‘Ã£ Ä‘Æ°á»£c há»§y trÆ°á»›c Ä‘Ã³' } };
            }

            const refundAmount = Number(order.total_price || 0);
            const balanceBefore = Number(order.balance || 0);
            const balanceAfter = balanceBefore + refundAmount;

            await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [balanceAfter, order.user_id]
            );

            await connection.execute(
                `INSERT INTO transactions (
                    user_id, type, amount, balance_before, balance_after, description, reference_id
                )
                VALUES (?, 'mxh_service_refund', ?, ?, ?, ?, ?)`,
                [
                    order.user_id,
                    refundAmount,
                    balanceBefore,
                    balanceAfter,
                    `HoÃ n tiá»n Ä‘Æ¡n dá»‹ch vá»¥ MXH: ${order.service_name || order.service_id}`,
                    order.id
                ]
            );

            await connection.execute(
                `UPDATE mxh_service_orders
                 SET status = 'cancelled',
                     admin_note = COALESCE(?, admin_note),
                     processed_by = ?,
                     processed_at = ${nowSql},
                     cancelled_at = ${nowSql},
                     updated_at = ${nowSql}
                 WHERE id = ?`,
                [note || null, adminId, orderId]
            );
        } else if (action === 'test') {
            const message = note || `Há»‡ thá»‘ng Ä‘ang quÃ©t link cá»§a báº¡n, vui lÃ²ng Ä‘á»£i. ÄÆ¡n #${order.id}.`;
            await connection.execute(
                `UPDATE mxh_service_orders
                 SET test_message = ?,
                     last_tested_at = ${nowSql},
                     admin_note = COALESCE(?, admin_note),
                     processed_by = ?,
                     updated_at = ${nowSql}
                 WHERE id = ?`,
                [message, note || null, adminId, orderId]
            );
        } else {
            await connection.rollback();
            return { error: { status: 400, message: 'HÃ nh Ä‘á»™ng khÃ´ng há»£p lá»‡' } };
        }

        await connection.commit();

        if (action === 'cancel') {
            await notificationService.createNotification({
                title: 'ÄÆ¡n dá»‹ch vá»¥ MXH Ä‘Ã£ bá»‹ há»§y',
                content: `ÄÆ¡n #${order.id} Ä‘Ã£ bá»‹ há»§y vÃ  hoÃ n tiá»n ${Number(order.total_price || 0).toLocaleString('vi-VN')}Ä‘.`,
                target_user_id: order.user_id,
                created_by: adminId,
                is_important: true,
                send_telegram: false
            });
        } else if (action === 'processing') {
            await notificationService.createNotification({
                title: 'ÄÆ¡n dá»‹ch vá»¥ MXH Ä‘ang xá»­ lÃ½',
                content: `ÄÆ¡n #${order.id} Ä‘ang Ä‘Æ°á»£c admin xá»­ lÃ½. Vui lÃ²ng chá».`,
                target_user_id: order.user_id,
                created_by: adminId,
                send_telegram: false
            });
        } else if (action === 'complete') {
            await notificationService.createNotification({
                title: 'ÄÆ¡n dá»‹ch vá»¥ MXH hoÃ n táº¥t',
                content: `ÄÆ¡n #${order.id} Ä‘Ã£ Ä‘Æ°á»£c hoÃ n thÃ nh.`,
                target_user_id: order.user_id,
                created_by: adminId,
                is_important: true,
                send_telegram: false
            });
        } else if (action === 'test') {
            await notificationService.createNotification({
                title: 'ThÃ´ng bÃ¡o kiá»ƒm tra Ä‘Æ¡n dá»‹ch vá»¥',
                content: `ÄÆ¡n #${order.id}: ${note || 'Há»‡ thá»‘ng Ä‘ang quÃ©t link cá»§a báº¡n, vui lÃ²ng Ä‘á»£i.'}`,
                target_user_id: order.user_id,
                created_by: adminId,
                send_telegram: false
            });
        }

        return { success: true };
    } catch (error) {
        await connection.rollback().catch(() => {});
        return { error };
    } finally {
        connection.release();
    }
}

async function upsertServicePackage(payload = {}) {
    const id = parsePositiveInt(payload.id, 0);
    const name = normalizeText(payload.name);
    const slug = normalizeText(payload.slug);
    const categoryId = parsePositiveInt(payload.category_id, 0);
    const platform = normalizePlatform(payload.platform || '');
    const description = normalizeText(payload.description);
    const price = Number.parseFloat(payload.price);
    const unitLabel = normalizeText(payload.unit_label || 'luong') || 'luong';
    const quantityMin = Math.max(parsePositiveInt(payload.quantity_min, 1), 1);
    const quantityMax = Math.max(parsePositiveInt(payload.quantity_max, 1000), quantityMin);
    const defaultQuantity = Math.max(parsePositiveInt(payload.default_quantity, quantityMin), quantityMin);
    const linkLabel = normalizeText(payload.link_label || 'Link') || 'Link';
    const noteLabel = normalizeText(payload.note_label || 'Ghi chu') || 'Ghi chu';
    const formHint = normalizeText(payload.form_hint);
    const displayOrder = parseNonNegativeInt(payload.display_order, 0);
    const isActive = payload.is_active === true || payload.is_active === 1 || payload.is_active === '1' ? 1 : 0;

    if (!name || !categoryId || !Number.isFinite(price) || price <= 0) {
        return { error: { status: 400, message: 'Thiáº¿u dá»¯ liá»‡u gÃ³i dá»‹ch vá»¥' } };
    }

    const [categoryRows] = await db.execute(
        `SELECT id FROM mxh_categories WHERE id = ? AND kind = 'service' LIMIT 1`,
        [categoryId]
    );
    if (!categoryRows.length) {
        return { error: { status: 400, message: 'Danh má»¥c dá»‹ch vá»¥ khÃ´ng há»£p lá»‡' } };
    }

    if (id) {
        await db.execute(
            `UPDATE mxh_service_packages
             SET category_id = ?, name = ?, slug = ?, description = ?, price = ?, unit_label = ?,
                 quantity_min = ?, quantity_max = ?, default_quantity = ?, link_label = ?,
                 note_label = ?, form_hint = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                categoryId,
                name,
                slug || null,
                description || null,
                price,
                unitLabel,
                quantityMin,
                quantityMax,
                defaultQuantity,
                linkLabel,
                noteLabel,
                formHint || null,
                displayOrder,
                isActive,
                id
            ]
        );
        return { id };
    }

    const [result] = await db.execute(
        `INSERT INTO mxh_service_packages
            (category_id, name, slug, description, price, unit_label, quantity_min, quantity_max,
             default_quantity, link_label, note_label, form_hint, display_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
            categoryId,
            name,
            slug || null,
            description || null,
            price,
            unitLabel,
            quantityMin,
            quantityMax,
            defaultQuantity,
            linkLabel,
            noteLabel,
            formHint || null,
            displayOrder,
            isActive
        ]
    );
    return { id: result.insertId };
}

module.exports = {
    SERVICE_PLATFORMS,
    ensureServiceDefaults,
    listServiceCategories,
    listServicePackages,
    listServiceItems,
    getServicePackageById,
    getServiceItemById,
    createServiceOrder,
    getUserServiceOrders,
    getAdminServiceOrders,
    updateServiceOrderStatus,
    upsertServicePackage,
    upsertServiceItem,
    deleteServiceItem,
    resolveCategoryIdBySlug
};

