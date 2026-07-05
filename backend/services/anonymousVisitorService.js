const crypto = require('node:crypto');
const db = require('../config/database');
const { normalizeIp } = require('../middleware/ipGuard');
const recaptchaService = require('./recaptchaService');
const notificationService = require('./notificationService');
const logService = require('./logService');

const VISITOR_COOKIE_NAME = 'anon_visitor_id';
const VISITOR_TTL_MS = parseInt(process.env.ANON_VISITOR_TTL_MS || '86400000', 10);
const VISITOR_SESSION_WINDOW_MS = parseInt(process.env.ANON_VISITOR_WINDOW_MS || '1800000', 10);
const VISITOR_PRODUCT_CAPTCHA_THRESHOLD = parseInt(process.env.ANON_VISITOR_PRODUCT_CAPTCHA_THRESHOLD || '10', 10);
const VISITOR_PRODUCT_SPAM_CAPTCHA_THRESHOLD = parseInt(
    process.env.ANON_VISITOR_PRODUCT_SPAM_CAPTCHA_THRESHOLD || process.env.ANON_VISITOR_PRODUCT_CAPTCHA_THRESHOLD || '10',
    10
);
const VISITOR_ALERT_COOLDOWN_MS = parseInt(process.env.ANON_VISITOR_ALERT_COOLDOWN_MS || '600000', 10);
const MAX_TRACKED_VISITORS = parseInt(process.env.ANON_VISITOR_MAX_TRACKED || '5000', 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.ANON_VISITOR_CLEANUP_INTERVAL_MS || '60000', 10);

const visitorSessions = new Map();
let lastCleanupAt = 0;

function isLocalOrPrivateIp(ip) {
    if (!ip) return true;
    if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return true;
    if (ip.startsWith('127.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
}

function sanitizeVisitorId(value = '') {
    const input = String(value || '').trim();
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(input)) {
        return '';
    }
    return input;
}

function makeVisitorId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return crypto.randomBytes(24).toString('hex');
}

function getClientIp(req) {
    return normalizeIp(
        req.clientIp ||
        req.ip ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        ''
    );
}

function getCookieOptions(req) {
    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();

    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || forwardedProto === 'https',
        path: '/',
        maxAge: VISITOR_TTL_MS
    };
}

function ensureCapacity() {
    if (visitorSessions.size < MAX_TRACKED_VISITORS) {
        return;
    }

    const entries = Array.from(visitorSessions.entries());
    const mapped = entries.map(([key, val]) => ({
        key,
        lastSeenAt: Number(val?.lastSeenAt || 0)
    }));

    mapped.sort((a, b) => a.lastSeenAt - b.lastSeenAt);

    const removeCount = Math.max(Math.ceil(MAX_TRACKED_VISITORS * 0.1), 1);
    for (let index = 0; index < removeCount && index < mapped.length; index += 1) {
        visitorSessions.delete(mapped[index].key);
    }
}

function pruneProductViews(session, now) {
    if (!session?.productViews) {
        return;
    }

    session.productViews.forEach((ts, productKey) => {
        if (now - Number(ts || 0) > VISITOR_SESSION_WINDOW_MS) {
            session.productViews.delete(productKey);
        }
    });
}

function pruneViewEvents(session, now) {
    if (!Array.isArray(session?.productViewEvents)) {
        session.productViewEvents = [];
        return;
    }

    session.productViewEvents = session.productViewEvents.filter((ts) => (
        now - Number(ts || 0) <= VISITOR_SESSION_WINDOW_MS
    ));
}

function cleanupSessions(now = Date.now(), force = false) {
    if (!force && now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
        return;
    }

    lastCleanupAt = now;
    visitorSessions.forEach((session, visitorId) => {
        pruneProductViews(session, now);
        pruneViewEvents(session, now);
        if (!session.lastSeenAt || now - session.lastSeenAt > VISITOR_TTL_MS) {
            visitorSessions.delete(visitorId);
        }
    });
}

async function recordSecurityAction(actionType, { userId = null, ip = '', targetKey = '' } = {}) {
    try {
        await db.execute(
            `INSERT INTO security_action_logs (action_type, actor_user_id, actor_ip, target_key)
             VALUES (?, ?, ?, ?)`,
            [actionType, userId || null, ip || null, targetKey || null]
        );
    } catch (_) {
        // Ignore analytics persistence failures.
    }
}

async function notifyThresholdReached({ ip, productId, distinctCount, viewCount, visitorId, reason }) {
    const lines = [
        reason === 'rapid_views'
            ? `Khach chua dang nhap tu IP ${ip || 'khong ro'} đã mở trang sản phẩm ${viewCount} lần trong thời gian ngắn`
            : `Khach chua dang nhap tu IP ${ip || 'khong ro'} đã mở ${distinctCount} sản phẩm khác nhau trong thời gian ngắn`,
        `sản phẩm hiện tại: #${productId}`,
        `Visitor: ${visitorId}`
    ];

    try {
        await notificationService.notifyAdmins({
            title: 'Captcha cho khách ẩn danh',
            content: lines.join('\n'),
            created_by: null
        }, { sendTelegram: true });
    } catch (_) {
        // Ignore alert delivery failures.
    }
}

function getOrCreateSession(req, res) {
    const now = Date.now();
    cleanupSessions(now);

    const ip = getClientIp(req);
    const isLocalIp = isLocalOrPrivateIp(ip);

    let visitorId = sanitizeVisitorId(req.cookies?.[VISITOR_COOKIE_NAME] || '');
    let session = visitorId ? visitorSessions.get(visitorId) : null;

    if (!visitorId || !session || (session.ip && ip && session.ip !== ip)) {
        ensureCapacity();
        visitorId = makeVisitorId();
        session = {
            ip,
            isLocalIp,
            firstSeenAt: now,
            lastSeenAt: now,
            entryLoggedAt: 0,
            lastAlertAt: 0,
            productViews: new Map(),
            productViewEvents: []
        };
        visitorSessions.set(visitorId, session);
        if (res && typeof res.cookie === 'function') {
            res.cookie(VISITOR_COOKIE_NAME, visitorId, getCookieOptions(req));
        }
    }

    session.ip = ip;
    session.isLocalIp = isLocalIp;
    session.lastSeenAt = now;
    pruneProductViews(session, now);
    pruneViewEvents(session, now);

    return {
        tracked: true,
        ip,
        visitorId,
        session,
        isLocalIp
    };
}

async function registerEntry(req, res) {
    if (req.user?.id) {
        return {
            tracked: false,
            reason: 'authenticated'
        };
    }

    const context = getOrCreateSession(req, res);
    if (!context.tracked) {
        return context;
    }

    const now = Date.now();
    const session = context.session;
    const path = String(req.body?.path || req.headers?.referer || '/').slice(0, 500);

    if (!session.entryLoggedAt || now - session.entryLoggedAt > VISITOR_SESSION_WINDOW_MS) {
        session.entryLoggedAt = now;
        logService.recordSecurity({
            action: 'anonymous_site_entry',
            ip: context.ip,
            detail: `visitor=${context.visitorId}; path=${path}`
        });
        await recordSecurityAction('anonymous_site_entry', {
            ip: context.ip,
            targetKey: path
        });
    }

    return {
        tracked: true,
        visitorId: context.visitorId,
        captchaAfterDistinctProducts: VISITOR_PRODUCT_CAPTCHA_THRESHOLD,
        captchaAfterRapidViews: VISITOR_PRODUCT_SPAM_CAPTCHA_THRESHOLD
    };
}

function makeCaptchaRequiredError({ distinctCount, viewCount, productId, visitorId, reason }) {
    const error = new Error('Khách chưa đang nhập đã mở trang sản phẩm quá nhanh. Vui lòng xac nhan reCAPTCHA de tiep tuc.');
    error.statusCode = 403;
    error.code = 'ANON_PRODUCT_CAPTCHA_REQUIRED';
    error.data = {
        captchaRequired: true,
        threshold: VISITOR_PRODUCT_CAPTCHA_THRESHOLD,
        spamThreshold: VISITOR_PRODUCT_SPAM_CAPTCHA_THRESHOLD,
        distinctProductCount: distinctCount,
        viewCount,
        reason: reason || 'rapid_views',
        productId: String(productId || ''),
        visitorId
    };
    return error;
}

async function assertProductViewAllowed(req, res, productIdentifier, recaptchaToken = '') {
    if (req.user?.id) {
        return {
            allowed: true,
            bypass: 'authenticated'
        };
    }

    const context = getOrCreateSession(req, res);
    if (!context.tracked) {
        return {
            allowed: true,
            bypass: context.reason || 'not_tracked'
        };
    }

    const now = Date.now();
    const session = context.session;
    const productKey = String(productIdentifier || '').trim();
    const hasVisited = session.productViews.has(productKey);
    const nextDistinctCount = hasVisited ? session.productViews.size : session.productViews.size + 1;
    const nextViewCount = Array.isArray(session.productViewEvents) ? session.productViewEvents.length + 1 : 1;
    const recaptchaEnabled = Boolean(recaptchaService.getPublicConfig(req)?.enabled);
    const safeToken = String(recaptchaToken || '').trim();
    const reason = nextViewCount >= VISITOR_PRODUCT_SPAM_CAPTCHA_THRESHOLD
        ? 'rapid_views'
        : 'distinct_products';
    const thresholdReached = (
        nextDistinctCount >= VISITOR_PRODUCT_CAPTCHA_THRESHOLD ||
        nextViewCount >= VISITOR_PRODUCT_SPAM_CAPTCHA_THRESHOLD
    );

    if (thresholdReached && recaptchaEnabled) {
        if (!safeToken) {
            if (!context.isLocalIp && (!session.lastAlertAt || now - session.lastAlertAt > VISITOR_ALERT_COOLDOWN_MS)) {
                session.lastAlertAt = now;
                await notifyThresholdReached({
                    ip: context.ip,
                    productId: productKey,
                    distinctCount: nextDistinctCount,
                    viewCount: nextViewCount,
                    visitorId: context.visitorId,
                    reason
                });
            }

            logService.recordSecurity({
                action: 'anonymous_product_captcha_required',
                ip: context.ip,
                detail: `visitor=${context.visitorId}; product=${productKey}; distinct=${nextDistinctCount}; views=${nextViewCount}; reason=${reason}`
            });
            await recordSecurityAction('anonymous_product_captcha_required', {
                ip: context.ip,
                targetKey: `product:${productKey}`
            });

            throw makeCaptchaRequiredError({
                distinctCount: nextDistinctCount,
                viewCount: nextViewCount,
                productId: productKey,
                visitorId: context.visitorId,
                reason
            });
        }

        await recaptchaService.assertVerified({
            token: safeToken,
            ip: context.ip,
            req,
            action: 'anonymous_product_browse'
        });

        session.productViews.clear();
        session.productViews.set(productKey, now);
        session.productViewEvents = [now];
        session.lastSeenAt = now;

        logService.recordSecurity({
            action: 'anonymous_product_captcha_verified',
            ip: context.ip,
            detail: `visitor=${context.visitorId}; product=${productKey}`
        });
        await recordSecurityAction('anonymous_product_captcha_verified', {
            ip: context.ip,
            targetKey: `product:${productKey}`
        });

        return {
            allowed: true,
            verified: true,
            visitorId: context.visitorId,
            distinctProductCount: session.productViews.size
        };
    }

    session.productViews.set(productKey, now);
    session.productViewEvents.push(now);
    session.lastSeenAt = now;

    if (thresholdReached && !recaptchaEnabled) {
        logService.recordSecurity({
            action: 'anonymous_product_threshold_unenforced',
            ip: context.ip,
            detail: `visitor=${context.visitorId}; product=${productKey}; distinct=${nextDistinctCount}; views=${nextViewCount}; reason=${reason}`
        });
    }

    return {
        allowed: true,
        visitorId: context.visitorId,
        distinctProductCount: session.productViews.size,
        viewCount: session.productViewEvents.length
    };
}

module.exports = {
    registerEntry,
    assertProductViewAllowed,
    VISITOR_COOKIE_NAME
};
