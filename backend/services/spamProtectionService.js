const crypto = require('crypto');
const db = require('../config/database');
const loginProtectionService = require('./loginProtectionService');
const recaptchaService = require('./recaptchaService');
const { normalizeIp } = require('../middleware/ipGuard');

const MESSAGE_COOLDOWN_MS = parseInt(process.env.SPAM_MESSAGE_COOLDOWN_MS || '5000', 10);
const MESSAGE_WINDOW_MS = parseInt(process.env.SPAM_MESSAGE_WINDOW_MS || '60000', 10);
const MESSAGE_MAX_PER_WINDOW = parseInt(process.env.SPAM_MESSAGE_MAX_PER_WINDOW || '8', 10);
const MESSAGE_DUPLICATE_WINDOW_MS = parseInt(process.env.SPAM_MESSAGE_DUPLICATE_WINDOW_MS || '120000', 10);
const MESSAGE_CAPTCHA_THRESHOLD = parseInt(
    process.env.SPAM_MESSAGE_CAPTCHA_THRESHOLD || process.env.SPAM_MESSAGE_MAX_PER_WINDOW || '8',
    10
);
const MESSAGE_CAPTCHA_GRACE_MS = parseInt(process.env.SPAM_MESSAGE_CAPTCHA_GRACE_MS || '300000', 10);

const COMMENT_COOLDOWN_MS = parseInt(process.env.SPAM_COMMENT_COOLDOWN_MS || '10000', 10);
const COMMENT_WINDOW_MS = parseInt(process.env.SPAM_COMMENT_WINDOW_MS || '60000', 10);
const COMMENT_MAX_PER_WINDOW = parseInt(process.env.SPAM_COMMENT_MAX_PER_WINDOW || '6', 10);
const COMMENT_DUPLICATE_WINDOW_MS = parseInt(process.env.SPAM_COMMENT_DUPLICATE_WINDOW_MS || '300000', 10);

const POST_COOLDOWN_MS = parseInt(process.env.SPAM_POST_COOLDOWN_MS || '30000', 10);
const POST_WINDOW_MS = parseInt(process.env.SPAM_POST_WINDOW_MS || '600000', 10);
const POST_MAX_PER_WINDOW = parseInt(process.env.SPAM_POST_MAX_PER_WINDOW || '6', 10);
const POST_DUPLICATE_WINDOW_MS = parseInt(process.env.SPAM_POST_DUPLICATE_WINDOW_MS || '86400000', 10);

const FREE_PURCHASE_COOLDOWN_MS = parseInt(process.env.SPAM_FREE_PURCHASE_COOLDOWN_MS || '15000', 10);
const FREE_PURCHASE_WINDOW_MS = parseInt(process.env.SPAM_FREE_PURCHASE_WINDOW_MS || '600000', 10);
const FREE_PURCHASE_MAX_PER_WINDOW = parseInt(process.env.SPAM_FREE_PURCHASE_MAX_PER_WINDOW || '5', 10);
const FREE_PURCHASE_IP_WINDOW_MS = parseInt(process.env.SPAM_FREE_PURCHASE_IP_WINDOW_MS || '600000', 10);
const FREE_PURCHASE_IP_MAX_PER_WINDOW = parseInt(process.env.SPAM_FREE_PURCHASE_IP_MAX_PER_WINDOW || '12', 10);

const ACTION_LOG_RETENTION_DAYS = parseInt(process.env.SPAM_ACTION_LOG_RETENTION_DAYS || '7', 10);
const ACTION_LOG_CLEANUP_MS = parseInt(process.env.SPAM_ACTION_LOG_CLEANUP_MS || '3600000', 10);

let lastCleanupAt = 0;
const humanCheckGrace = new Map();

function parseDbDateTime(value) {
    if (!value) return 0;
    const text = String(value).trim();
    if (!text) return 0;

    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const parsed = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function toWindowOffset(ms) {
    return `-${Math.max(Math.ceil(ms / 1000), 1)} seconds`;
}

function normalizeText(value = '') {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function hashContent(value = '') {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function createSpamError(prefix, untilMs) {
    const retryAfterSeconds = Math.max(Math.ceil((untilMs - Date.now()) / 1000), 1);
    return loginProtectionService.createRateLimitError(
        `${prefix} Vui long thu lai sau ${retryAfterSeconds} giay.`,
        untilMs
    );
}

function createHumanCheckError(message, data = {}) {
    const error = new Error(message);
    error.statusCode = 403;
    error.code = 'MESSAGE_HUMAN_CHECK_REQUIRED';
    error.data = {
        captchaRequired: true,
        ...data
    };
    return error;
}

function buildHumanCheckKey(actionType, userId = null, ip = '') {
    return [String(actionType || '').trim(), userId === null || userId === undefined ? 'guest' : String(userId), String(ip || '').trim()].join(':');
}

function cleanupHumanCheckGrace(now = Date.now()) {
    humanCheckGrace.forEach((untilMs, key) => {
        if (!untilMs || untilMs <= now) {
            humanCheckGrace.delete(key);
        }
    });
}

function isHumanCheckGraceActive(actionType, userId = null, ip = '', now = Date.now()) {
    const key = buildHumanCheckKey(actionType, userId, ip);
    const untilMs = humanCheckGrace.get(key);
    if (!untilMs) {
        return false;
    }
    if (untilMs <= now) {
        humanCheckGrace.delete(key);
        return false;
    }
    return true;
}

function activateHumanCheckGrace(actionType, userId = null, ip = '', graceMs = MESSAGE_CAPTCHA_GRACE_MS, now = Date.now()) {
    if (graceMs <= 0) {
        return;
    }
    humanCheckGrace.set(buildHumanCheckKey(actionType, userId, ip), now + graceMs);
}

async function cleanupActionLogs(executor = db) {
    const now = Date.now();
    cleanupHumanCheckGrace(now);
    if (now - lastCleanupAt < ACTION_LOG_CLEANUP_MS) {
        return;
    }

    lastCleanupAt = now;
    await executor.execute(
        `DELETE FROM security_action_logs
         WHERE created_at < datetime('now', ?)`,
        [`-${Math.max(ACTION_LOG_RETENTION_DAYS, 1)} days`]
    );
}

async function getActionStats(executor, { actionType, userId = null, ip = '', contentHash = '' }, windowMs) {
    const conditions = ['action_type = ?', "created_at >= datetime('now', ?)"];
    const params = [actionType, toWindowOffset(windowMs)];

    if (userId !== null && userId !== undefined) {
        conditions.push('actor_user_id = ?');
        params.push(userId);
    }

    if (ip) {
        conditions.push('actor_ip = ?');
        params.push(ip);
    }

    if (contentHash) {
        conditions.push('content_hash = ?');
        params.push(contentHash);
    }

    const [rows] = await executor.execute(
        `SELECT COUNT(*) as total,
                MIN(created_at) as oldest_at,
                MAX(created_at) as latest_at
         FROM security_action_logs
         WHERE ${conditions.join(' AND ')}`,
        params
    );

    return rows[0] || { total: 0, oldest_at: null, latest_at: null };
}

async function assertCooldown(executor, { actionType, userId, ip, cooldownMs, message }) {
    if (!cooldownMs) {
        return;
    }

    const stats = await getActionStats(executor, { actionType, userId, ip }, cooldownMs);
    const latestAtMs = parseDbDateTime(stats.latest_at);
    if (!latestAtMs) {
        return;
    }

    const untilMs = latestAtMs + cooldownMs;
    if (untilMs > Date.now()) {
        throw createSpamError(message, untilMs);
    }
}

async function assertWindowLimit(executor, { actionType, userId, ip, windowMs, maxPerWindow, message }) {
    if (!windowMs || !maxPerWindow) {
        return;
    }

    const stats = await getActionStats(executor, { actionType, userId, ip }, windowMs);
    const total = Number(stats.total || 0);
    if (total < maxPerWindow) {
        return;
    }

    const oldestAtMs = parseDbDateTime(stats.oldest_at);
    const untilMs = oldestAtMs ? oldestAtMs + windowMs : Date.now() + windowMs;
    throw createSpamError(message, untilMs);
}

async function assertDuplicate(executor, { actionType, userId, ip, contentHash, windowMs, message }) {
    if (!contentHash || !windowMs) {
        return;
    }

    const stats = await getActionStats(executor, { actionType, userId, ip, contentHash }, windowMs);
    const total = Number(stats.total || 0);
    if (total <= 0) {
        return;
    }

    const latestAtMs = parseDbDateTime(stats.latest_at);
    const untilMs = latestAtMs ? latestAtMs + windowMs : Date.now() + windowMs;
    throw createSpamError(message, untilMs);
}

async function recordAction(executor, { actionType, userId = null, ip = '', targetKey = null, contentHash = null }) {
    await executor.execute(
        `INSERT INTO security_action_logs (
            action_type, actor_user_id, actor_ip, target_key, content_hash
        ) VALUES (?, ?, ?, ?, ?)`,
        [actionType, userId || null, ip || null, targetKey || null, contentHash || null]
    );
}

async function assertHumanCheck(executor, {
    actionType,
    userId = null,
    ip = '',
    req = null,
    recaptchaToken = '',
    targetKey = '',
    cooldownMs = MESSAGE_COOLDOWN_MS,
    windowMs = MESSAGE_WINDOW_MS,
    captchaThreshold = MESSAGE_CAPTCHA_THRESHOLD,
    graceMs = MESSAGE_CAPTCHA_GRACE_MS,
    message = 'Ban dang gui tin nhan qua nhanh. Vui long xac nhan reCAPTCHA de tiep tuc.'
}) {
    const normalizedIp = normalizeIp(ip);
    const safeActionType = String(actionType || '').trim() || 'message_send';
    const now = Date.now();

    if (isHumanCheckGraceActive(safeActionType, userId, normalizedIp, now)) {
        return;
    }

    const stats = await getActionStats(
        executor,
        { actionType: safeActionType, userId },
        Math.max(windowMs, 0)
    );
    const total = Number(stats.total || 0);
    const latestAtMs = parseDbDateTime(stats.latest_at);
    const rapidFire = Boolean(cooldownMs && latestAtMs && latestAtMs + cooldownMs > now);
    const thresholdReached = Boolean(captchaThreshold && total >= captchaThreshold);

    if (!rapidFire && !thresholdReached) {
        return;
    }

    const safeToken = String(recaptchaToken || '').trim();
    if (!safeToken) {
        throw createHumanCheckError(message, {
            actionType: safeActionType,
            threshold: Math.max(captchaThreshold, 0),
            currentCount: total,
            nextCount: total + 1,
            windowMs: Math.max(windowMs, 0),
            cooldownMs: Math.max(cooldownMs, 0),
            reason: rapidFire ? 'rapid_fire' : 'window_limit',
            targetKey
        });
    }

    await recaptchaService.assertVerified({
        token: safeToken,
        ip: normalizedIp,
        req,
        action: `${safeActionType}_human_check`
    });

    activateHumanCheckGrace(safeActionType, userId, normalizedIp, Math.max(graceMs, 0), now);
    await recordAction(executor, {
        actionType: `${safeActionType}_captcha_verified`,
        userId,
        ip: normalizedIp,
        targetKey
    });
}

async function guardMessageSend(executor, {
    userId,
    ip = '',
    receiverId,
    messageType = 'text',
    content = '',
    mediaUrl = '',
    actionType = 'message_send',
    recaptchaToken = '',
    req = null
}) {
    const safeActionType = String(actionType || '').trim() || 'message_send';
    const normalizedIp = normalizeIp(ip);
    const targetKey = `receiver:${receiverId}`;
    const contentHash = hashContent([
        targetKey,
        `type:${String(messageType || '').trim().toLowerCase()}`,
        `content:${normalizeText(content)}`,
        `media:${normalizeText(mediaUrl)}`
    ].join('|'));

    await cleanupActionLogs(executor);
    await assertHumanCheck(executor, {
        actionType: safeActionType,
        userId,
        ip: normalizedIp,
        req,
        recaptchaToken,
        targetKey,
        cooldownMs: Math.max(MESSAGE_COOLDOWN_MS, 0),
        windowMs: Math.max(MESSAGE_WINDOW_MS, 0),
        captchaThreshold: Math.max(MESSAGE_CAPTCHA_THRESHOLD, 0),
        graceMs: Math.max(MESSAGE_CAPTCHA_GRACE_MS, 0),
        message: 'Ban dang gui tin nhan qua nhanh. Vui long xac nhan reCAPTCHA de tiep tuc.'
    });
    await assertDuplicate(executor, {
        actionType: safeActionType,
        userId,
        contentHash,
        windowMs: Math.max(MESSAGE_DUPLICATE_WINDOW_MS, 0),
        message: 'Ban vua gui noi dung tin nhan nay.'
    });

    await recordAction(executor, {
        actionType: safeActionType,
        userId,
        ip: normalizedIp,
        targetKey,
        contentHash
    });
}

async function guardCommentCreate(executor, { userId, ip = '', postId, content = '' }) {
    const actionType = 'post_comment';
    const normalizedIp = normalizeIp(ip);
    const contentHash = hashContent([
        `post:${postId}`,
        `content:${normalizeText(content)}`
    ].join('|'));

    await cleanupActionLogs(executor);
    await assertCooldown(executor, {
        actionType,
        userId,
        cooldownMs: Math.max(COMMENT_COOLDOWN_MS, 0),
        message: 'Ban dang binh luan qua nhanh.'
    });
    await assertWindowLimit(executor, {
        actionType,
        userId,
        windowMs: Math.max(COMMENT_WINDOW_MS, 0),
        maxPerWindow: Math.max(COMMENT_MAX_PER_WINDOW, 0),
        message: 'Ban da binh luan qua nhieu trong thoi gian ngan.'
    });
    await assertDuplicate(executor, {
        actionType,
        userId,
        contentHash,
        windowMs: Math.max(COMMENT_DUPLICATE_WINDOW_MS, 0),
        message: 'Ban vua gui binh luan trung noi dung nay.'
    });

    await recordAction(executor, {
        actionType,
        userId,
        ip: normalizedIp,
        targetKey: `post:${postId}`,
        contentHash
    });
}

async function guardPostCreate(executor, { userId, ip = '', content = '', media = [] }) {
    const actionType = 'post_create';
    const normalizedIp = normalizeIp(ip);
    const mediaKey = Array.isArray(media)
        ? media
            .map((item) => [
                String(item?.media_type || '').trim().toLowerCase(),
                normalizeText(item?.media_url || ''),
                normalizeText(item?.thumbnail_url || '')
            ].join(':'))
            .join('|')
        : '';
    const contentHash = hashContent([
        `content:${normalizeText(content)}`,
        `media:${mediaKey}`
    ].join('|'));

    await cleanupActionLogs(executor);
    await assertCooldown(executor, {
        actionType,
        userId,
        cooldownMs: Math.max(POST_COOLDOWN_MS, 0),
        message: 'Ban dang dang bai qua nhanh.'
    });
    await assertWindowLimit(executor, {
        actionType,
        userId,
        windowMs: Math.max(POST_WINDOW_MS, 0),
        maxPerWindow: Math.max(POST_MAX_PER_WINDOW, 0),
        message: 'Ban da dang qua nhieu bai trong thoi gian ngan.'
    });
    await assertDuplicate(executor, {
        actionType,
        userId,
        contentHash,
        windowMs: Math.max(POST_DUPLICATE_WINDOW_MS, 0),
        message: 'Ban vua dang bai trung noi dung nay.'
    });

    await recordAction(executor, {
        actionType,
        userId,
        ip: normalizedIp,
        targetKey: `media_count:${Array.isArray(media) ? media.length : 0}`,
        contentHash
    });
}

async function guardFreePurchase(executor, { userId, ip = '', productId }) {
    const actionType = 'free_product_purchase';
    const normalizedIp = normalizeIp(ip);

    await cleanupActionLogs(executor);
    await assertCooldown(executor, {
        actionType,
        userId,
        cooldownMs: Math.max(FREE_PURCHASE_COOLDOWN_MS, 0),
        message: 'Ban dang nhan san pham mien phi qua nhanh.'
    });
    await assertWindowLimit(executor, {
        actionType,
        userId,
        windowMs: Math.max(FREE_PURCHASE_WINDOW_MS, 0),
        maxPerWindow: Math.max(FREE_PURCHASE_MAX_PER_WINDOW, 0),
        message: 'Ban da nhan qua nhieu san pham mien phi trong thoi gian ngan.'
    });

    if (normalizedIp) {
        await assertWindowLimit(executor, {
            actionType,
            ip: normalizedIp,
            windowMs: Math.max(FREE_PURCHASE_IP_WINDOW_MS, 0),
            maxPerWindow: Math.max(FREE_PURCHASE_IP_MAX_PER_WINDOW, 0),
            message: 'IP nay dang nhan qua nhieu san pham mien phi trong thoi gian ngan.'
        });
    }

    await recordAction(executor, {
        actionType,
        userId,
        ip: normalizedIp,
        targetKey: `product:${productId}`
    });
}

module.exports = {
    guardPostCreate,
    guardCommentCreate,
    guardFreePurchase,
    guardMessageSend
};
