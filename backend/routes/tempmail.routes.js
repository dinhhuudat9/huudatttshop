// ============================================
// TEMPORARY EMAIL ROUTES (WITH DUP & LIMIT RULES)
// File: backend/routes/tempmail.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

const GUERRILLA_BASE = 'https://api.guerrillamail.com/ajax.php';

// List of available domains
const AVAILABLE_DOMAINS = [
    'grr.la',
    'guerrillamail.com',
    'guerrillamail.net',
    'guerrillamail.org',
    'guerrillamail.info',
    'guerrillamail.biz',
    'guerrillamailblock.com',
    'sharklasers.com',
    'pokemail.net',
    'spam4.me'
];

// In-memory maps for session tracking & general rate limits
const activeSessions = new Map(); // ip -> { email, sid_token, expiresAt, changeCount }
const rateLimits = new Map();     // key -> { count, resetAt }

/**
 * Custom rate limiter utility
 */
function isRateLimitAllowed(ip, action, limit, windowMs) {
    const key = `${ip}:${action}`;
    const now = Date.now();
    const record = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
        record.count = 1;
        record.resetAt = now + windowMs;
    } else {
        record.count++;
    }

    rateLimits.set(key, record);
    return record.count <= limit;
}

/**
 * Periodically purge expired sessions & rate limit records
 */
setInterval(() => {
    const now = Date.now();
    for (const [ip, session] of activeSessions.entries()) {
        if (now >= session.expiresAt) {
            activeSessions.delete(ip);
        }
    }
    for (const [key, val] of rateLimits.entries()) {
        if (now > val.resetAt) {
            rateLimits.delete(key);
        }
    }
}, 300000); // Every 5 minutes

// Proxy helper to request Guerrilla Mail API
async function requestGuerrilla(func, params = {}, req) {
    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const agent = req.headers['user-agent'] || 'Mozilla/5.0';

    const urlParams = new URLSearchParams({
        f: func,
        ip: ip,
        agent: agent,
        ...params
    });

    const response = await fetch(`${GUERRILLA_BASE}?${urlParams.toString()}`);
    if (!response.ok) {
        throw new Error(`Guerrilla Mail API responded with status ${response.status}`);
    }

    return await response.json();
}

/**
 * Checks for duplication against other active (unexpired) sessions.
 * Appends incremental suffix counters if the desired address is already taken.
 */
function getUniqueEmailAddress(desiredPrefix, desiredDomain, clientIp) {
    let prefix = desiredPrefix;
    let counter = 0;

    while (true) {
        const checkEmail = `${prefix}@${desiredDomain}`;
        let duplicated = false;

        for (const [sessionIp, session] of activeSessions.entries()) {
            if (sessionIp !== clientIp && session.email === checkEmail && Date.now() < session.expiresAt) {
                duplicated = true;
                break;
            }
        }

        if (!duplicated) {
            return prefix;
        }

        counter++;
        prefix = `${desiredPrefix}${counter}`;
    }
}

// 1. Initialize session or restore existing one
// GET /api/tempmail/session
router.get('/session', async (req, res) => {
    try {
        const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
        const now = Date.now();

        // Rate limit check
        if (!isRateLimitAllowed(clientIp, 'session', 20, 60000)) {
            return res.status(429).json({
                success: false,
                message: 'Bạn đang thao tác quá nhanh. Vui lòng đợi 1 phút.'
            });
        }

        let session = activeSessions.get(clientIp);

        // Rule 4.1: Return existing email session if active (expires after 60 minutes)
        if (session && now < session.expiresAt) {
            return res.json({
                success: true,
                data: {
                    email: session.email,
                    sid_token: session.sid_token,
                    expiresAt: session.expiresAt,
                    changeCount: session.changeCount
                }
            });
        }

        // Restoring session if browser provides a valid client sid_token (re-sync on server restart)
        const clientSid = req.query.sid_token;
        if (clientSid) {
            try {
                const data = await requestGuerrilla('get_email_address', { sid_token: clientSid }, req);
                if (data && data.email_addr) {
                    session = {
                        email: data.email_addr,
                        sid_token: data.sid_token,
                        expiresAt: now + 60 * 60 * 1000,
                        changeCount: 0
                    };
                    activeSessions.set(clientIp, session);
                    return res.json({
                        success: true,
                        data: {
                            email: session.email,
                            sid_token: session.sid_token,
                            expiresAt: session.expiresAt,
                            changeCount: session.changeCount
                        }
                    });
                }
            } catch (_) {
                // Restoration failed, proceed to initialize brand-new
            }
        }

        // Initialize brand-new session
        // Default Configuration: "sangdevshop" + "@grr.la"
        const uniquePrefix = getUniqueEmailAddress('sangdevshop', 'grr.la', clientIp);

        // Fetch new session sid from Guerrilla Mail
        const initData = await requestGuerrilla('get_email_address', {}, req);

        // Set to desired formatted address
        const customData = await requestGuerrilla('set_email_user', {
            sid_token: initData.sid_token,
            email_user: uniquePrefix,
            site: 'grr.la'
        }, req);

        session = {
            email: customData.email_addr,
            sid_token: customData.sid_token,
            expiresAt: now + 60 * 60 * 1000, // 60 minutes lifespan
            changeCount: 0
        };

        activeSessions.set(clientIp, session);

        res.json({
            success: true,
            data: {
                email: session.email,
                sid_token: session.sid_token,
                expiresAt: session.expiresAt,
                changeCount: session.changeCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Customize email address (username and domain)
// POST /api/tempmail/customize
router.post('/customize', async (req, res) => {
    try {
        const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
        const session = activeSessions.get(clientIp);
        const now = Date.now();

        if (!session || now >= session.expiresAt) {
            return res.status(400).json({
                success: false,
                message: 'Không tìm thấy phiên hoạt động. Vui lòng làm mới trang.'
            });
        }

        // Rule 4.2: MAXIMUM of 2 manual changes per IP session. Once reached, freeze the address.
        if (session.changeCount >= 2) {
            return res.status(403).json({
                success: false,
                message: 'Bạn đã đạt giới hạn tối đa 2 lần thay đổi email. Địa chỉ này đã bị đóng băng cho đến khi hết hạn.'
            });
        }

        let { prefix, domain } = req.body;
        prefix = String(prefix || '').trim().toLowerCase();
        domain = String(domain || '').trim().toLowerCase();

        // Strip @ if present in prefix
        if (prefix.includes('@')) {
            const parts = prefix.split('@');
            prefix = parts[0];
            if (!domain) domain = parts[1];
        }

        if (!prefix) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên email mong muốn.' });
        }

        if (!domain || !AVAILABLE_DOMAINS.includes(domain)) {
            domain = 'grr.la';
        }

        // Validate prefix format
        if (!/^[a-z0-9._-]{3,30}$/.test(prefix)) {
            return res.status(400).json({
                success: false,
                message: 'Tên email tùy chỉnh chỉ được chứa chữ cái, số, dấu chấm, gạch ngang, gạch dưới và có độ dài từ 3 đến 30 ký tự.'
            });
        }

        // Rule 3: customization logic must still support appending numbers if the choice matches an existing active address.
        const uniquePrefix = getUniqueEmailAddress(prefix, domain, clientIp);

        const data = await requestGuerrilla('set_email_user', {
            sid_token: session.sid_token,
            email_user: uniquePrefix,
            site: domain
        }, req);

        // Update session state
        session.email = data.email_addr;
        session.changeCount++;
        // NOTE: session.expiresAt is NOT refreshed, maintaining the lifespan of the original session.

        res.json({
            success: true,
            data: {
                email: session.email,
                sid_token: session.sid_token,
                expiresAt: session.expiresAt,
                changeCount: session.changeCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Get list of incoming emails (Check Inbox)
router.get('/inbox', async (req, res) => {
    try {
        const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

        // Rate limit: 20 requests per minute
        if (!isRateLimitAllowed(clientIp, 'inbox', 20, 60000)) {
            return res.status(429).json({
                success: false,
                message: 'Vui lòng không gửi yêu cầu làm mới quá nhanh (giới hạn 3 giây/lần).'
            });
        }

        const { sid_token, seq = '0' } = req.query;
        if (!sid_token) {
            return res.status(400).json({ success: false, message: 'Thiếu sid_token.' });
        }

        const data = await requestGuerrilla('check_email', {
            sid_token: sid_token,
            seq: seq
        }, req);

        res.json({
            success: true,
            data: {
                list: data.list || [],
                count: data.count,
                sid_token: data.sid_token
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. Fetch details of a single email
router.get('/message/:id', async (req, res) => {
    try {
        const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

        if (!isRateLimitAllowed(clientIp, 'message', 30, 60000)) {
            return res.status(429).json({ success: false, message: 'Thao tác quá nhanh.' });
        }

        const messageId = req.params.id;
        const { sid_token } = req.query;
        if (!sid_token) {
            return res.status(400).json({ success: false, message: 'Thiếu sid_token.' });
        }

        const data = await requestGuerrilla('fetch_email', {
            sid_token: sid_token,
            email_id: messageId
        }, req);

        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 5. Delete emails
router.post('/delete', async (req, res) => {
    try {
        const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

        if (!isRateLimitAllowed(clientIp, 'delete', 15, 60000)) {
            return res.status(429).json({ success: false, message: 'Thao tác quá nhanh.' });
        }

        const { sid_token, email_ids } = req.body;
        if (!sid_token || !Array.isArray(email_ids) || !email_ids.length) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin yêu cầu.' });
        }

        const params = { sid_token: sid_token };
        email_ids.forEach((id, index) => {
            params[`email_ids[${index}]`] = id;
        });

        const data = await requestGuerrilla('del_email', params, req);

        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Extra: Expose available domains list
router.get('/domains', (req, res) => {
    res.json({
        success: true,
        data: AVAILABLE_DOMAINS
    });
});

module.exports = router;
