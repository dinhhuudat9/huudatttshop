// ============================================
// TELEGRAM BACKUP SERVICE
// File: backend/services/telegramBackupService.js
// ============================================

const TelegramBot = require('node-telegram-bot-api');
const db = require('../config/database');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const notificationService = require('./notificationService');
const { processDepositApproval } = require('./depositApprovalService');
const { getArchive } = require('./archiveService');

const PRIMARY_ADMIN_EMAIL = String(process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com').trim().toLowerCase();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || ADMIN_CHAT_ID)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

let bot = null;
let backupRunning = false;
let backupQueued = false;
let depositReminderTimer = null;
const pendingActions = new Map();
const pendingComposerStates = new Map();
const pendingAdminLoginStates = new Map();
const telegramAdminSessions = new Map();
const CONFIRM_TTL_MS = 5 * 60 * 1000;
const ADMIN_LOGIN_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
const COMPOSER_TTL_MS = 15 * 60 * 1000;
const DEPOSIT_REMINDER_INTERVAL_MS = 60 * 1000;

const MENU_ITEMS = [
    { label: 'Nguoi dung', command: '/nguoidung', table: 'users' },
    { label: 'San pham', command: '/sanpham', table: 'products' },
    { label: 'Danh muc', command: '/danhmuc', table: 'categories' },
    { label: 'Don hang', command: '/donhang', table: 'purchases' },
    { label: 'Giao dich', command: '/giaodich', table: 'transactions' },
    { label: 'Nap tien', command: '/naptiendu', table: 'deposit_requests' },
    { label: 'Bai dang', command: '/baidang', table: 'posts' },
    { label: 'Tin nhan', command: '/tinnhan', table: 'messages' },
    { label: 'Cai dat', command: '/caidat', table: 'system_settings' },
    { label: 'Cong dong', command: '/congdong', table: 'community_messages' },
    { label: 'Ho tro', command: '/hotro', table: 'support_requests' }
];

function isEnabled() {
    return !!BOT_TOKEN && ALLOWED_CHAT_IDS.length > 0;
}

function isAllowedChat(chatId) {
    return ALLOWED_CHAT_IDS.includes(String(chatId));
}

function makeToken() {
    return crypto.randomBytes(16).toString('hex');
}

function formatMoney(amount) {
    const numeric = Number(amount || 0);
    return `${new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: 0
    }).format(Number.isFinite(numeric) ? numeric : 0)}đ`;
}

function buildDepositKeyboard(requestId) {
    return {
        inline_keyboard: [
            [
                { text: `Duyet #${requestId}`, callback_data: `deposit_approve:${requestId}` },
                { text: `Tu choi #${requestId}`, callback_data: `deposit_reject:${requestId}` }
            ]
        ]
    };
}

function buildDepositReminderText(rows) {
    const lines = rows.map((row, index) => {
        const who = row.email || row.full_name || `user:${row.user_id}`;
        const method = row.payment_method || '-';
        return `${index + 1}. #${row.id} | ${formatMoney(row.amount)} | ${who} | ${method}`;
    });

    return [
        `Can duyet ${rows.length} yeu cau nap tien dang pending`,
        ...lines,
        'Bam nut ben duoi de duyet nhanh ngay trong Telegram.'
    ].join('\n');
}

function formatMoneyDisplay(amount) {
    const numeric = Number(amount || 0);
    const formatted = new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: 0
    }).format(Number.isFinite(numeric) ? numeric : 0);
    return `${formatted} đ`;
}

function buildDepositRequestCard(row, index = 0) {
    return [
        `[#${index + 1}] Yeu cau nap tien #${row.id}`,
        `- Ho ten: ${row.full_name || '-'}`,
        `- Email: ${row.email || '-'}`,
        `- User ID: ${row.user_id || '-'}`,
        `- So tien: ${formatMoneyDisplay(row.amount)}`,
        `- Phuong thuc: ${row.payment_method || '-'}`,
        `- Thoi gian: ${row.created_at || '-'}`,
        `- Trang thai: ${row.status || 'pending'}`
    ].join('\n');
}

function buildDepositReminderPanel(rows) {
    return [
        `CO ${rows.length} YEU CAU NAP TIEN DANG CHO DUYET`,
        '------------------------------------------------',
        ...rows.map((row, index) => buildDepositRequestCard(row, index)),
        '',
        'Ban co the bam nut ben duoi tung yeu cau de xu ly ngay.'
    ].join('\n\n');
}

async function getPendingDepositRequests(limit = 10) {
    const [rows] = await db.execute(
        `SELECT dr.id, dr.user_id, dr.amount, dr.payment_method, dr.created_at, u.email, u.full_name
         FROM deposit_requests dr
         JOIN users u ON u.id = dr.user_id
         WHERE dr.status = 'pending'
         ORDER BY dr.created_at ASC
         LIMIT ?`,
        [limit]
    );
    return rows;
}

async function sendPendingDepositReminder() {
    if (!bot || !ADMIN_CHAT_ID) return;

    const rows = await getPendingDepositRequests(10);
    if (!rows.length) return;

    const keyboardRows = rows.map(row => buildDepositKeyboard(row.id).inline_keyboard[0]);

    await bot.sendMessage(ADMIN_CHAT_ID, buildDepositReminderPanel(rows), {
        reply_markup: {
            inline_keyboard: keyboardRows
        },
        disable_notification: false
    });
}

function startDepositReminderScheduler() {
    if (depositReminderTimer) return;

    const run = async () => {
        try {
            await sendPendingDepositReminder();
        } catch (error) {
            console.error('Deposit reminder scheduler error:', error.message);
        }
    };

    run();
    depositReminderTimer = setInterval(run, DEPOSIT_REMINDER_INTERVAL_MS);
}

function addPendingAction(action) {
    const token = makeToken();
    pendingActions.set(token, {
        ...action,
        expires: Date.now() + CONFIRM_TTL_MS
    });
    setTimeout(() => {
        pendingActions.delete(token);
    }, CONFIRM_TTL_MS);
    return token;
}

function getPendingAction(token) {
    const item = pendingActions.get(token);
    if (!item) return null;
    if (Date.now() > item.expires) {
        pendingActions.delete(token);
        return null;
    }
    return item;
}

async function sendConfirm(chatId, title, token) {
    if (!bot) return;
    await bot.sendMessage(chatId, title, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Duyet', callback_data: `confirm:${token}` },
                    { text: 'Huy', callback_data: `cancel:${token}` }
                ]
            ]
        }
    });
}

function buildMenuText() {
    const lines = MENU_ITEMS.map(item => `- ${item.command}  |  ${item.label}`);
    lines.push('- /tatca  |  Xuat toan bo data.json');
    return [
        'TELEGRAM ADMIN MENU',
        '-------------------',
        ...lines,
        '',
        'Tip: bam nut ben duoi de tai nhanh tung file du lieu.'
    ].join('\n');
}

function buildInlineKeyboard() {
    const buttons = MENU_ITEMS.map(item => ({
        text: item.label,
        callback_data: `data:${item.table}`
    }));

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    rows.push([{ text: 'Tat ca (data.json)', callback_data: 'data:all' }]);

    return { inline_keyboard: rows };
}

function buildHomeKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: 'Nap tien pending', callback_data: 'home:pending' },
                { text: 'Huong dan', callback_data: 'home:help' }
            ],
            [
                { text: 'Xuat data', callback_data: 'home:data' },
                { text: 'Backup', callback_data: 'home:backup' }
            ]
        ]
    };
}

function buildHomeText() {
    return [
        'TELEGRAM ADMIN HUB',
        '',
        '1. Bam "Nap tien pending" de xem yeu cau can duyet',
        '2. Bam "Huong dan" neu ban quyen lệnh',
        '3. Bam "Xuat data" de tai file du lieu',
        '4. Bam "Backup" de gui full backup'
    ].join('\n');
}

function buildAdminHelp() {
    return [
        'ADMIN COMMANDS',
        '',
        '[User]',
        '/users <keyword?> <page?>',
        '/user <id>',
        '/ban <user_id>',
        '/unban <user_id>',
        '/role <user_id> <user|seller|admin>',
        '/delete_user <user_id>',
        '',
        '[Product / Post]',
        '/products <status?> <page?>',
        '/product <id>',
        '/product_status <id> <active|inactive|banned>',
        '/delete_product <id>',
        '/posts <page?>',
        '/delete_post <id>',
        '',
        '[Wallet]',
        '/deposits <status?> <page?>',
        '/deposit_approve <id> <note?>',
        '/deposit_reject <id> <note?>',
        '/balance_adjust <user_id> <amount> <description?>',
        '',
        '[System]',
        '/notify <title> | <content> | <target_email?>',
        '/setting <key> <value>',
        '/revenue_reset',
        '/storage',
        '/share_categories',
        '/share_data <key>',
        '/backup_export',
        '/backup_telegram',
        '',
        '[Content]',
        '/start - mo menu nut bam',
        'nut "Dang bai" - tao bai viet',
        'nut "Dang san pham" - tao san pham'
    ].join('\n');
}

function buildStartKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: 'Nap tien pending', callback_data: 'home:pending' },
                { text: 'Dang bai', callback_data: 'compose:post' }
            ],
            [
                { text: 'Dang san pham', callback_data: 'compose:product' },
                { text: 'Huong dan', callback_data: 'home:help' }
            ],
            [
                { text: 'Xuat data', callback_data: 'home:data' },
                { text: 'Backup', callback_data: 'home:backup' }
            ]
        ]
    };
}

function buildStartText() {
    return [
        'TELEGRAM ADMIN HUB',
        '',
        '1. Bam "Nap tien pending" de xem yeu cau can duyet',
        '2. Bam "Dang bai" de tao bai viet moi',
        '3. Bam "Dang san pham" de tao san pham moi',
        '4. Bam "Xuat data" de tai file du lieu',
        '5. Bam "Backup" de gui full backup'
    ].join('\n');
}

function buildLoginPrompt() {
    return [
        'DANG NHAP ADMIN',
        '',
        'Nhap gmail admin truoc.',
        'Sau do bot se hoi mat khau.'
    ].join('\n');
}

function buildLoginHelpEmail() {
    return 'Vui long nhap email admin cua ban.';
}

function buildLoginHelpPassword(email) {
    return [
        `Da nhan email: ${email}`,
        'Bay gio nhap mat khau admin.'
    ].join('\n');
}

async function getPrimaryAdminUserId() {
    const [rows] = await db.execute(
        'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
        [PRIMARY_ADMIN_EMAIL]
    );
    if (rows.length) {
        return rows[0].id;
    }

    const [adminRows] = await db.execute(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
    );
    return adminRows[0]?.id || null;
}

function getPostService() {
    return require('./postService');
}

function getProductService() {
    return require('./productService');
}

function buildComposerSummary(type, draft) {
    if (type === 'post') {
        return [
            'XAC NHAN TAO BAI VIET',
            `Noi dung: ${(draft.content || '').slice(0, 120)}`,
            `Media: ${(parseCsvUrls(draft.mediaText || '')).length} file`
        ].join('\n');
    }

    return [
        'XAC NHAN TAO SAN PHAM',
        `Ten: ${draft.title || '-'}`,
        `Gia: ${formatMoneyDisplay(draft.price)}`,
        `Category: ${draft.category_id || '-'}`,
        `Main image: ${draft.main_image || '-'}`,
        `Gallery: ${(parseCsvUrls(draft.galleryText || '')).length} file`
    ].join('\n');
}

function getComposerKey(chatId) {
    return String(chatId);
}

function getComposerState(chatId) {
    return pendingComposerStates.get(getComposerKey(chatId)) || null;
}

function clearComposerState(chatId) {
    pendingComposerStates.delete(getComposerKey(chatId));
}

function getAdminSessionKey(chatId) {
    return String(chatId);
}

function getTelegramAdminSession(chatId) {
    const session = telegramAdminSessions.get(getAdminSessionKey(chatId)) || null;
    if (!session) return null;
    if (Date.now() > session.expires) {
        telegramAdminSessions.delete(getAdminSessionKey(chatId));
        return null;
    }
    return session;
}

function setTelegramAdminSession(chatId, user) {
    telegramAdminSessions.set(getAdminSessionKey(chatId), {
        userId: user.id,
        email: user.email,
        fullName: user.full_name || user.email,
        role: user.role,
        expires: Date.now() + TELEGRAM_ADMIN_SESSION_TTL_MS
    });
}

function clearTelegramAdminSession(chatId) {
    telegramAdminSessions.delete(getAdminSessionKey(chatId));
}

function isTelegramAdminAuthenticated(chatId) {
    return !!getTelegramAdminSession(chatId);
}

async function ensureTelegramAdminAccess(chatId) {
    if (isTelegramAdminAuthenticated(chatId)) {
        return true;
    }

    await startAdminLogin(chatId);
    return false;
}

function getAdminLoginState(chatId) {
    const state = pendingAdminLoginStates.get(getAdminSessionKey(chatId)) || null;
    if (!state) return null;
    if (Date.now() > state.expires) {
        pendingAdminLoginStates.delete(getAdminSessionKey(chatId));
        return null;
    }
    return state;
}

function setAdminLoginState(chatId, state) {
    pendingAdminLoginStates.set(getAdminSessionKey(chatId), {
        ...state,
        expires: Date.now() + ADMIN_LOGIN_TTL_MS
    });
}

function clearAdminLoginState(chatId) {
    pendingAdminLoginStates.delete(getAdminSessionKey(chatId));
}

async function authenticateTelegramAdmin(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
        throw new Error('Email va mat khau khong duoc de trong');
    }

    const [rows] = await db.execute(
        'SELECT id, email, full_name, password_hash, role, status FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
        [normalizedEmail]
    );

    if (!rows.length) {
        throw new Error('Sai email hoac mat khau');
    }

    const user = rows[0];
    if (user.status === 'banned') {
        throw new Error('Tai khoan da bi khoa');
    }
    if (user.role !== 'admin') {
        throw new Error('Tai khoan khong co quyen admin');
    }

    const isValid = await bcrypt.compare(String(password), user.password_hash || '');
    if (!isValid) {
        throw new Error('Sai email hoac mat khau');
    }

    return user;
}

function startComposer(chatId, type) {
    const state = {
        type,
        step: type === 'post' ? 'content' : 'title',
        draft: {},
        expires: Date.now() + COMPOSER_TTL_MS
    };
    pendingComposerStates.set(getComposerKey(chatId), state);
    setTimeout(() => {
        const current = pendingComposerStates.get(getComposerKey(chatId));
        if (current && current.expires <= Date.now()) {
            pendingComposerStates.delete(getComposerKey(chatId));
        }
    }, COMPOSER_TTL_MS);
    return state;
}

function parseCsvUrls(text) {
    return String(text || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

async function finalizeComposer(chatId) {
    const state = getComposerState(chatId);
    if (!state) return false;

    const ownerId = await getPrimaryAdminUserId();
    if (!ownerId) {
        await bot.sendMessage(chatId, 'Khong tim thay admin owner de tao noi dung.');
        clearComposerState(chatId);
        return true;
    }

    if (state.type === 'post') {
        const media = parseCsvUrls(state.draft.mediaText || '').map((url, index) => ({
            media_type: 'image',
            media_url: url,
            thumbnail_url: null,
            display_order: index
        }));
        const post = await getPostService().createPost(ownerId, {
            content: state.draft.content,
            media
        }, { ip: 'telegram' });
        await bot.sendMessage(chatId, `Da tao bai viet #${post.id}.`);
        clearComposerState(chatId);
        return true;
    }

    const gallery = parseCsvUrls(state.draft.galleryText || '');
    const product = await getProductService().createProduct(ownerId, {
        title: state.draft.title,
        price: state.draft.price,
        category_id: state.draft.category_id,
        main_image: state.draft.main_image,
        description: state.draft.description || '',
        content: state.draft.content || '',
        demo_url: state.draft.demo_url || '',
        download_url: state.draft.download_url || '',
        gallery
    });
    await bot.sendMessage(chatId, `Da tao san pham #${product.id}.`);
    clearComposerState(chatId);
    return true;
}

async function startAdminLogin(chatId) {
    setAdminLoginState(chatId, { step: 'email', email: '' });
    await bot.sendMessage(chatId, buildLoginPrompt());
    await bot.sendMessage(chatId, buildLoginHelpEmail());
}

async function getTableNames() {
    const [rows] = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    return rows.map(row => row.name);
}

async function exportTable(table) {
    const [rows] = await db.execute(`SELECT * FROM ${table}`);
    return rows;
}

async function exportAll() {
    const tables = await getTableNames();
    const data = {};
    for (const table of tables) {
        data[table] = await exportTable(table);
    }
    return {
        exported_at: new Date().toISOString(),
        primary_admin: PRIMARY_ADMIN_EMAIL,
        data
    };
}

async function sendJson(chatId, filename, payload, options = {}) {
    if (!bot) return;
    const buffer = Buffer.from(JSON.stringify(payload, null, 2));
    await bot.sendDocument(
        chatId,
        buffer,
        { caption: options.caption || filename, disable_notification: !!options.silent },
        { filename, contentType: 'application/json' }
    );
}

async function handleAdminCommand(msg) {
    if (!isAllowedChat(msg.chat.id)) return;
    const text = (msg.text || '').trim();
    const [command, ...rest] = text.split(' ');
    const args = rest.filter(Boolean);
    const chatId = msg.chat.id;

    try {
        if (command === '/logout') {
            clearTelegramAdminSession(chatId);
            clearAdminLoginState(chatId);
            clearComposerState(chatId);
            await bot.sendMessage(chatId, 'Da dang xuat. Go /admin de dang nhap lai.');
            return;
        }

        if (command === '/admin') {
            if (!(await ensureTelegramAdminAccess(chatId))) {
                return;
            }
            await bot.sendMessage(chatId, `${buildStartText()}\n\n${buildAdminHelp()}`, {
                reply_markup: buildStartKeyboard()
            });
            return;
        }

        if (!isTelegramAdminAuthenticated(chatId)) {
            await bot.sendMessage(chatId, 'Ban can dang nhap bang /admin truoc khi dung lenh nay.');
            return;
        }

        if (command === '/users') {
            const keyword = args[0] && !/^\d+$/.test(args[0]) ? args[0] : '';
            const page = args[1] ? parseInt(args[1], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const params = [];
            let where = '';
            if (keyword) {
                where = 'WHERE (email LIKE ? OR full_name LIKE ?)';
                params.push(`%${keyword}%`, `%${keyword}%`);
            }
            const [rows] = await db.execute(
                `SELECT id, email, full_name, role, status, created_at
                 FROM users ${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No users found.');
                return;
            }
            const lines = rows.map(u => `#${u.id} ${u.email} ${u.role} ${u.status}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/user') {
            const userId = parseInt(args[0], 10);
            if (!userId) return bot.sendMessage(chatId, 'Usage: /user <id>');
            const [rows] = await db.execute(
                `SELECT id, email, full_name, role, status, balance, created_at, last_login
                 FROM users WHERE id = ?`,
                [userId]
            );
            if (!rows.length) return bot.sendMessage(chatId, 'User not found.');
            const u = rows[0];
            await bot.sendMessage(chatId, JSON.stringify(u, null, 2));
            return;
        }

        if (command === '/ban' || command === '/unban') {
            const userId = parseInt(args[0], 10);
            if (!userId) return bot.sendMessage(chatId, 'Usage: /ban <user_id>');
            const status = command === '/ban' ? 'banned' : 'active';
            const token = addPendingAction({
                type: 'user_status',
                payload: { userId, status }
            });
            await sendConfirm(chatId, `Set user ${userId} to ${status}?`, token);
            return;
        }

        if (command === '/role') {
            const userId = parseInt(args[0], 10);
            const role = args[1];
            if (!userId || !role) return bot.sendMessage(chatId, 'Usage: /role <user_id> <user|seller|admin>');
            const token = addPendingAction({
                type: 'user_role',
                payload: { userId, role }
            });
            await sendConfirm(chatId, `Change role of ${userId} to ${role}?`, token);
            return;
        }

        if (command === '/delete_user') {
            const userId = parseInt(args[0], 10);
            if (!userId) return bot.sendMessage(chatId, 'Usage: /delete_user <user_id>');
            const token = addPendingAction({
                type: 'delete_user',
                payload: { userId }
            });
            await sendConfirm(chatId, `Delete user ${userId}?`, token);
            return;
        }

        if (command === '/products') {
            const status = args[0] && !/^\d+$/.test(args[0]) ? args[0] : '';
            const page = args[1] ? parseInt(args[1], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const params = [];
            let where = '';
            if (status) {
                where = 'WHERE status = ?';
                params.push(status);
            }
            const [rows] = await db.execute(
                `SELECT id, title, status, seller_id, created_at
                 FROM products ${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No products found.');
                return;
            }
            const lines = rows.map(p => `#${p.id} ${p.title} ${p.status}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/product') {
            const productId = args[0];
            if (!productId) return bot.sendMessage(chatId, 'Usage: /product <id>');
            const [rows] = await db.execute(
                `SELECT * FROM products WHERE id = ?`,
                [productId]
            );
            if (!rows.length) return bot.sendMessage(chatId, 'Product not found.');
            await bot.sendMessage(chatId, JSON.stringify(rows[0], null, 2));
            return;
        }

        if (command === '/product_status') {
            const productId = parseInt(args[0], 10);
            const status = args[1];
            if (!productId || !status) return bot.sendMessage(chatId, 'Usage: /product_status <id> <active|inactive|banned>');
            const token = addPendingAction({
                type: 'product_status',
                payload: { productId, status }
            });
            await sendConfirm(chatId, `Set product ${productId} to ${status}?`, token);
            return;
        }

        if (command === '/delete_product') {
            const productId = parseInt(args[0], 10);
            if (!productId) return bot.sendMessage(chatId, 'Usage: /delete_product <id>');
            const token = addPendingAction({
                type: 'delete_product',
                payload: { productId }
            });
            await sendConfirm(chatId, `Delete product ${productId}?`, token);
            return;
        }

        if (command === '/posts') {
            const page = args[0] ? parseInt(args[0], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const [rows] = await db.execute(
                `SELECT id, user_id, content, created_at
                 FROM posts
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No posts found.');
                return;
            }
            const lines = rows.map(p => `#${p.id} user:${p.user_id} ${String(p.content || '').slice(0, 40)}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/delete_post') {
            const postId = parseInt(args[0], 10);
            if (!postId) return bot.sendMessage(chatId, 'Usage: /delete_post <id>');
            const token = addPendingAction({
                type: 'delete_post',
                payload: { postId }
            });
            await sendConfirm(chatId, `Delete post ${postId}?`, token);
            return;
        }

        if (command === '/deposits') {
            const status = args[0] && !/^\d+$/.test(args[0]) ? args[0] : '';
            const page = args[1] ? parseInt(args[1], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const params = [];
            let where = '';
            if (status) {
                where = 'WHERE dr.status = ?';
                params.push(status);
            }
            const [rows] = await db.execute(
                `SELECT dr.id, dr.user_id, dr.amount, dr.status, dr.created_at
                 FROM deposit_requests dr
                 ${where}
                 ORDER BY dr.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No deposit requests found.');
                return;
            }
            const lines = rows.map(r => `#${r.id} user:${r.user_id} ${r.amount} ${r.status}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/deposit_approve' || command === '/deposit_reject') {
            const requestId = parseInt(args[0], 10);
            if (!requestId) return bot.sendMessage(chatId, 'Usage: /deposit_approve <id> <note?>');
            const note = args.slice(1).join(' ') || '';
            const approve = command === '/deposit_approve';
            await runAdminAction(chatId, {
                type: 'deposit_decision',
                payload: { requestId, approve, note }
            });
            return;
        }

        if (command === '/balance_adjust') {
            const userId = parseInt(args[0], 10);
            const amount = parseFloat(args[1]);
            const description = args.slice(2).join(' ') || '';
            if (!userId || !Number.isFinite(amount)) {
                return bot.sendMessage(chatId, 'Usage: /balance_adjust <user_id> <amount> <description?>');
            }
            const token = addPendingAction({
                type: 'balance_adjust',
                payload: { userId, amount, description }
            });
            await sendConfirm(chatId, `Adjust balance for ${userId} by ${amount}?`, token);
            return;
        }

        if (command === '/notify') {
            const parts = text.replace('/notify', '').split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length < 2) {
                return bot.sendMessage(chatId, 'Usage: /notify <title> | <content> | <target_email?>');
            }
            const [title, content, targetEmail] = parts;
            const token = addPendingAction({
                type: 'notify',
                payload: { title, content, targetEmail }
            });
            await sendConfirm(chatId, 'Send notification?', token);
            return;
        }

        if (command === '/setting') {
            const key = args[0];
            const value = args.slice(1).join(' ');
            if (!key) return bot.sendMessage(chatId, 'Usage: /setting <key> <value>');
            const token = addPendingAction({
                type: 'setting',
                payload: { key, value }
            });
            await sendConfirm(chatId, `Update setting ${key}?`, token);
            return;
        }

        if (command === '/revenue_reset') {
            const token = addPendingAction({ type: 'revenue_reset', payload: {} });
            await sendConfirm(chatId, 'Reset total_revenue to 0?', token);
            return;
        }

        if (command === '/storage') {
            const [userRows] = await db.execute('SELECT COUNT(*) as total FROM users');
            const [productRows] = await db.execute('SELECT COUNT(*) as total FROM products');
            const [postRows] = await db.execute('SELECT COUNT(*) as total FROM posts');
            const [messageRows] = await db.execute('SELECT COUNT(*) as total FROM messages');
            const textOut = [
                `users: ${userRows[0]?.total || 0}`,
                `products: ${productRows[0]?.total || 0}`,
                `posts: ${postRows[0]?.total || 0}`,
                `messages: ${messageRows[0]?.total || 0}`
            ].join('\n');
            await bot.sendMessage(chatId, textOut);
            return;
        }

        if (command === '/share_categories') {
            const archive = await getArchive();
            const categories = [
                { key: 'products_inactive', count: (archive.products || []).length },
                { key: 'users_inactive', count: (archive.users || []).length },
                { key: 'posts_old', count: (archive.posts || []).length }
            ];
            await bot.sendMessage(chatId, JSON.stringify(categories, null, 2));
            return;
        }

        if (command === '/share_data') {
            const key = args[0];
            if (!key) return bot.sendMessage(chatId, 'Usage: /share_data <key>');
            const archive = await getArchive();
            const payload = {
                meta: archive.meta || {},
                products: key === 'products_inactive' ? archive.products || [] : [],
                users: key === 'users_inactive' ? archive.users || [] : [],
                posts: key === 'posts_old' ? archive.posts || [] : []
            };
            return sendJson(chatId, `chiase_${key}.json`, payload, { caption: `chiase_${key}.json` });
        }

        if (command === '/backup_export') {
            const data = await exportAll();
            return sendJson(chatId, 'data.json', data, { caption: 'data.json' });
        }

        if (command === '/backup_telegram') {
            queueFullBackup('telegram', { by: msg.from?.id });
            await bot.sendMessage(chatId, 'Backup queued.');
            return;
        }
    } catch (error) {
        await bot.sendMessage(chatId, `Error: ${error.message}`);
    }
}

async function handleTableRequest(chatId, table) {
    const payload = {
        exported_at: new Date().toISOString(),
        table
    };
    if (table === 'all') {
        payload.data = await exportAll();
        return sendJson(chatId, 'data.json', payload.data, { caption: 'data.json' });
    }

    payload.rows = await exportTable(table);
    return sendJson(chatId, `${table}.json`, payload, { caption: `${table}.json` });
}

function registerCommands() {
    if (!bot) return;

    bot.onText(/\/start|\/data/i, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        if (!(await ensureTelegramAdminAccess(msg.chat.id))) {
            return;
        }
        await bot.sendMessage(msg.chat.id, `${buildStartText()}\n\n${buildMenuText()}`, {
            reply_markup: {
                inline_keyboard: [
                    ...buildStartKeyboard().inline_keyboard,
                    ...buildInlineKeyboard().inline_keyboard
                ]
            }
        });
    });

    bot.on('message', async (msg) => {
        if (!msg || !msg.chat || !isAllowedChat(msg.chat.id)) return;
        const loginState = getAdminLoginState(msg.chat.id);
        if (loginState && msg.text) {
            const text = msg.text.trim();
            if (text.startsWith('/')) {
                return;
            }

            try {
                if (loginState.step === 'email') {
                    loginState.email = text;
                    loginState.step = 'password';
                    setAdminLoginState(msg.chat.id, loginState);
                    await bot.sendMessage(msg.chat.id, buildLoginHelpPassword(text));
                    return;
                }

                if (loginState.step === 'password') {
                    const email = loginState.email;
                    const user = await authenticateTelegramAdmin(email, text);
                    setTelegramAdminSession(msg.chat.id, user);
                    clearAdminLoginState(msg.chat.id);
                    await bot.sendMessage(msg.chat.id, [
                        'Dang nhap thanh cong.',
                        `Xin chao ${user.full_name || user.email || user.id}.`,
                        'Goi /admin de mo menu quan tri.'
                    ].join('\n'), {
                        reply_markup: buildStartKeyboard()
                    });
                    return;
                }
            } catch (error) {
                clearAdminLoginState(msg.chat.id);
                await bot.sendMessage(msg.chat.id, `Dang nhap that bai: ${error.message}`);
                return;
            }
        }

        if (!isTelegramAdminAuthenticated(msg.chat.id)) {
            return;
        }

        const state = getComposerState(msg.chat.id);
        if (!state || !msg.text) return;

        const text = msg.text.trim();
        if (/^\/cancel$/i.test(text)) {
            clearComposerState(msg.chat.id);
            await bot.sendMessage(msg.chat.id, 'Da huy thao tac.');
            return;
        }

        if (text.startsWith('/')) return;

        try {
            if (state.type === 'post') {
                if (state.step === 'content') {
                    state.draft.content = text;
                    state.step = 'media';
                    await bot.sendMessage(msg.chat.id, 'Nhap media URL, cach nhau boi dau phay. Co the bo trong.');
                    return;
                }

                if (state.step === 'media') {
                    state.draft.mediaText = text === '-' ? '' : text;
                    await bot.sendMessage(msg.chat.id, buildComposerSummary('post', state.draft), {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: 'Tao bai viet', callback_data: 'compose:confirm_post' },
                                { text: 'Huy', callback_data: 'compose:cancel' }
                            ]]
                        }
                    });
                    state.step = 'confirm';
                    return;
                }
            }

            if (state.type === 'product') {
                if (state.step === 'title') {
                    state.draft.title = text;
                    state.step = 'price';
                    await bot.sendMessage(msg.chat.id, 'Nhap gia san pham (chi so).');
                    return;
                }

                if (state.step === 'price') {
                    const price = parseFloat(text.replace(/[^\d.]/g, ''));
                    if (!Number.isFinite(price) || price <= 0) {
                        await bot.sendMessage(msg.chat.id, 'Gia khong hop le. Vui long nhap so lon hon 0.');
                        return;
                    }
                    state.draft.price = price;
                    state.step = 'category_id';
                    await bot.sendMessage(msg.chat.id, 'Nhap category_id.');
                    return;
                }

                if (state.step === 'category_id') {
                    const categoryId = parseInt(text, 10);
                    if (!Number.isFinite(categoryId) || categoryId <= 0) {
                        await bot.sendMessage(msg.chat.id, 'Category id khong hop le.');
                        return;
                    }
                    state.draft.category_id = categoryId;
                    state.step = 'main_image';
                    await bot.sendMessage(msg.chat.id, 'Nhap main image URL.');
                    return;
                }

                if (state.step === 'main_image') {
                    state.draft.main_image = text;
                    state.step = 'description';
                    await bot.sendMessage(msg.chat.id, 'Nhap mo ta san pham. Co the nhap "-" de bo qua.');
                    return;
                }

                if (state.step === 'description') {
                    state.draft.description = text === '-' ? '' : text;
                    state.step = 'content';
                    await bot.sendMessage(msg.chat.id, 'Nhap noi dung chi tiet. Co the nhap "-" de bo qua.');
                    return;
                }

                if (state.step === 'content') {
                    state.draft.content = text === '-' ? '' : text;
                    state.step = 'demo_url';
                    await bot.sendMessage(msg.chat.id, 'Nhap demo URL. Co the nhap "-" de bo qua.');
                    return;
                }

                if (state.step === 'demo_url') {
                    state.draft.demo_url = text === '-' ? '' : text;
                    state.step = 'download_url';
                    await bot.sendMessage(msg.chat.id, 'Nhap download URL. Co the nhap "-" de bo qua.');
                    return;
                }

                if (state.step === 'download_url') {
                    state.draft.download_url = text === '-' ? '' : text;
                    state.step = 'gallery';
                    await bot.sendMessage(msg.chat.id, 'Nhap gallery URLs cach nhau boi dau phay. Co the nhap "-" de bo qua.');
                    return;
                }

                if (state.step === 'gallery') {
                    state.draft.galleryText = text === '-' ? '' : text;
                    await bot.sendMessage(msg.chat.id, buildComposerSummary('product', state.draft), {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: 'Tao san pham', callback_data: 'compose:confirm_product' },
                                { text: 'Huy', callback_data: 'compose:cancel' }
                            ]]
                        }
                    });
                    state.step = 'confirm';
                    return;
                }
            }
        } catch (error) {
            await bot.sendMessage(msg.chat.id, `Loi: ${error.message}`);
        }
    });

    bot.on('callback_query', async (query) => {
        if (!query || !query.data) return;
        if (!isAllowedChat(query.message?.chat?.id)) {
            return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
        }

        if (!isTelegramAdminAuthenticated(query.message?.chat?.id)) {
            await bot.answerCallbackQuery(query.id, { text: 'Dang nhap /admin truoc' });
            await startAdminLogin(query.message.chat.id);
            return;
        }

        const [prefix, value] = query.data.split(':');
        if (prefix === 'data') {
            await bot.answerCallbackQuery(query.id, { text: 'Dang tao du lieu...' });
            try {
                await handleTableRequest(query.message.chat.id, value);
            } catch (error) {
                await bot.sendMessage(query.message.chat.id, `Loi: ${error.message}`);
            }
            return;
        }

        if (prefix === 'compose') {
            if (value === 'post') {
                startComposer(query.message.chat.id, 'post');
                await bot.answerCallbackQuery(query.id, { text: 'Bắt đầu tạo bài viết' });
                await bot.sendMessage(query.message.chat.id, 'Nhap noi dung bai viet.', {
                    reply_markup: { inline_keyboard: [[{ text: 'Huy', callback_data: 'compose:cancel' }]] }
                });
                return;
            }

            if (value === 'product') {
                startComposer(query.message.chat.id, 'product');
                await bot.answerCallbackQuery(query.id, { text: 'Bắt đầu tạo sản phẩm' });
                await bot.sendMessage(query.message.chat.id, 'Nhap ten san pham.', {
                    reply_markup: { inline_keyboard: [[{ text: 'Huy', callback_data: 'compose:cancel' }]] }
                });
                return;
            }

            if (value === 'cancel') {
                clearComposerState(query.message.chat.id);
                await bot.answerCallbackQuery(query.id, { text: 'Da huy' });
                await bot.sendMessage(query.message.chat.id, 'Da huy thao tac.');
                return;
            }

            if (value === 'confirm_post' || value === 'confirm_product') {
                const state = getComposerState(query.message.chat.id);
                if (!state) {
                    return bot.answerCallbackQuery(query.id, { text: 'Khong con du lieu dang tao' });
                }
                if (value === 'confirm_post' && state.type !== 'post') {
                    return bot.answerCallbackQuery(query.id, { text: 'Sai loai thao tac' });
                }
                if (value === 'confirm_product' && state.type !== 'product') {
                    return bot.answerCallbackQuery(query.id, { text: 'Sai loai thao tac' });
                }

                await bot.answerCallbackQuery(query.id, { text: 'Dang tao...' });
                try {
                    await finalizeComposer(query.message.chat.id);
                } catch (error) {
                    await bot.sendMessage(query.message.chat.id, `Loi: ${error.message}`);
                }
                return;
            }
        }

        if (prefix === 'home') {
            if (value === 'help') {
                await bot.answerCallbackQuery(query.id, { text: 'Dang mo huong dan...' });
                await bot.sendMessage(query.message.chat.id, buildAdminHelp());
                return;
            }

            if (value === 'data') {
                await bot.answerCallbackQuery(query.id, { text: 'Dang mo danh sach data...' });
                await bot.sendMessage(query.message.chat.id, buildMenuText(), {
                    reply_markup: buildInlineKeyboard()
                });
                return;
            }

            if (value === 'pending') {
                await bot.answerCallbackQuery(query.id, { text: 'Dang lay yeu cau pending...' });
                await sendPendingDepositReminder();
                return;
            }

            if (value === 'backup') {
                await bot.answerCallbackQuery(query.id, { text: 'Dang queue backup...' });
                queueFullBackup('telegram', { by: query.from?.id || query.message?.chat?.id });
                return;
            }
        }

        if (prefix === 'deposit_approve' || prefix === 'deposit_reject') {
            const requestId = parseInt(value, 10);
            if (!requestId) {
                return bot.answerCallbackQuery(query.id, { text: 'Invalid deposit id' });
            }

            const approve = prefix === 'deposit_approve';
            await bot.answerCallbackQuery(query.id, { text: approve ? 'Duyet yeu cau' : 'Tu choi yeu cau' });
            try {
                await runAdminAction(query.message.chat.id, {
                    type: 'deposit_decision',
                    payload: { requestId, approve, note: '' }
                });
            } catch (error) {
                await bot.sendMessage(query.message.chat.id, `Error: ${error.message}`);
            }
            return;
        }

        if (prefix === 'confirm') {
            const action = getPendingAction(value);
            if (!action) {
                return bot.answerCallbackQuery(query.id, { text: 'Action expired' });
            }
            pendingActions.delete(value);
            await bot.answerCallbackQuery(query.id, { text: 'Running...' });
            try {
                await runAdminAction(query.message.chat.id, action);
            } catch (error) {
                await bot.sendMessage(query.message.chat.id, `Error: ${error.message}`);
            }
            return;
        }

        if (prefix === 'cancel') {
            pendingActions.delete(value);
            await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
            return;
        }
    });

    MENU_ITEMS.forEach(item => {
        bot.onText(new RegExp(`\\${item.command}\\b`, 'i'), async (msg) => {
            if (!isAllowedChat(msg.chat.id)) return;
            if (!(await ensureTelegramAdminAccess(msg.chat.id))) {
                return;
            }
            try {
                await handleTableRequest(msg.chat.id, item.table);
            } catch (error) {
                await bot.sendMessage(msg.chat.id, `Loi: ${error.message}`);
            }
        });
    });

    bot.onText(/\/tatca\b/i, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        if (!(await ensureTelegramAdminAccess(msg.chat.id))) {
            return;
        }
        try {
            await handleTableRequest(msg.chat.id, 'all');
        } catch (error) {
            await bot.sendMessage(msg.chat.id, `Loi: ${error.message}`);
        }
    });

    bot.onText(/^\/(admin|users|user|ban|unban|role|delete_user|products|product|product_status|delete_product|posts|delete_post|deposits|deposit_approve|deposit_reject|balance_adjust|notify|setting|revenue_reset|storage|share_categories|share_data|backup_export|backup_telegram)\b/i, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        await handleAdminCommand(msg);
    });
}

function initTelegramBot() {
    if (!isEnabled()) {
        return;
    }

    try {
        bot = new TelegramBot(BOT_TOKEN, { polling: true });
        bot.on('polling_error', (error) => {
            console.error('Telegram bot polling error:', error.message || error);
        });
        bot.on('error', (error) => {
            console.error('Telegram bot error:', error.message || error);
        });
        registerCommands();
        startDepositReminderScheduler();
        console.log('✅ Telegram backup bot started');
    } catch (err) {
        console.error('Failed to initialize Telegram bot:', err.message);
    }
}

async function runAdminAction(chatId, action) {
    const { type, payload } = action;

    if (type === 'user_status') {
        await db.execute('UPDATE users SET status = ? WHERE id = ?', [payload.status, payload.userId]);
        await bot.sendMessage(chatId, 'User status updated.');
        return;
    }

    if (type === 'user_role') {
        await db.execute('UPDATE users SET role = ? WHERE id = ?', [payload.role, payload.userId]);
        await bot.sendMessage(chatId, 'User role updated.');
        return;
    }

    if (type === 'delete_user') {
        await db.execute('DELETE FROM users WHERE id = ?', [payload.userId]);
        await bot.sendMessage(chatId, 'User deleted.');
        return;
    }

    if (type === 'product_status') {
        await db.execute('UPDATE products SET status = ? WHERE id = ?', [payload.status, payload.productId]);
        await bot.sendMessage(chatId, 'Product status updated.');
        return;
    }

    if (type === 'delete_product') {
        await db.execute('DELETE FROM products WHERE id = ?', [payload.productId]);
        await bot.sendMessage(chatId, 'Product deleted.');
        return;
    }

    if (type === 'delete_post') {
        await db.execute('DELETE FROM posts WHERE id = ?', [payload.postId]);
        await bot.sendMessage(chatId, 'Post deleted.');
        return;
    }

    if (type === 'deposit_decision') {
        try {
            const { requestId, approve, note } = payload;
            const result = await processDepositApproval(requestId, {
                approve,
                adminNote: note || null
            });
            const request = result.request;
            try {
                const amountText = formatMoney(request.amount);
                await notificationService.createNotification({
                    title: approve ? 'Nap tien da duyet' : 'Nap tien bi tu choi',
                    content: [
                        `Yeu cau: #${requestId}`,
                        `So tien: ${amountText}`,
                        `Phuong thuc: ${request.payment_method || '-'}`,
                        `Trang thai: ${approve ? 'Da duyet' : 'Bi tu choi'}`,
                        note ? `Ghi chu: ${note}` : null
                    ].filter(Boolean).join('\n'),
                    is_important: 1,
                    target_user_id: request.user_id,
                    created_by: null,
                    send_telegram: false
                });
            } catch (notifyError) {
                console.error('Failed to notify deposit user:', notifyError.message);
            }
            await bot.sendMessage(chatId, `Deposit ${approve ? 'approved' : 'rejected'}.`);
        } catch (error) {
            throw error;
        }
        return;
    }

    if (type === 'balance_adjust') {
        const { userId, amount, description } = payload;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [userId]
            );
            if (!users.length) throw new Error('User not found');
            const before = parseFloat(users[0].balance || 0);
            const after = before + parseFloat(amount);
            await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [after, userId]
            );
            await connection.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
                 VALUES (?, 'admin_adjust', ?, ?, ?, ?)`,
                [userId, amount, before, after, description || 'Admin adjust']
            );
            await connection.commit();
            await bot.sendMessage(chatId, 'Balance updated.');
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return;
    }

    if (type === 'notify') {
        const { title, content, targetEmail } = payload;
        let targetId = null;
        if (targetEmail) {
            const [targets] = await db.execute('SELECT id FROM users WHERE email = ?', [targetEmail]);
            if (!targets.length) throw new Error('Target user not found');
            targetId = targets[0].id;
        }
        await notificationService.createNotification({
            title,
            content,
            target_user_id: targetId,
            created_by: null
        });
        await bot.sendMessage(chatId, 'Notification sent.');
        return;
    }

    if (type === 'setting') {
        const { key, value } = payload;
        const [existing] = await db.execute(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [key]
        );
        if (existing.length) {
            await db.execute(
                'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
                [value, key]
            );
        } else {
            await db.execute(
                'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
                [key, value]
            );
        }
        await bot.sendMessage(chatId, 'Setting updated.');
        return;
    }

    if (type === 'revenue_reset') {
        await db.execute(
            "UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'total_revenue'"
        );
        await bot.sendMessage(chatId, 'Revenue reset.');
        return;
    }

    await bot.sendMessage(chatId, 'Unknown action.');
}

async function sendTelegramNotification(message, options = {}) {
    if (!bot || !ADMIN_CHAT_ID) return;
    try {
        await bot.sendMessage(ADMIN_CHAT_ID, message, {
            disable_notification: false,
            ...(options || {})
        });
    } catch (error) {
        // ignore
    }
}

function queueFullBackup(reason = 'manual', meta = {}) {
    if (!bot || !ADMIN_CHAT_ID) return;

    if (backupRunning) {
        backupQueued = true;
        return;
    }

    backupRunning = true;
    const chatId = ADMIN_CHAT_ID;

    setImmediate(async () => {
        try {
            const payload = await exportAll();
            payload.reason = reason;
            payload.meta = meta;
            await sendJson(chatId, 'data.json', payload, { caption: 'data.json', silent: true });
        } catch (error) {
            try {
                await bot.sendMessage(chatId, `Loi backup: ${error.message}`, { disable_notification: true });
            } catch (err) {
                // ignore
            }
        } finally {
            backupRunning = false;
            if (backupQueued) {
                backupQueued = false;
                queueFullBackup('queued', meta);
            }
        }
    });
}

module.exports = {
    initTelegramBot,
    sendTelegramNotification,
    queueFullBackup,
    exportAll
};
