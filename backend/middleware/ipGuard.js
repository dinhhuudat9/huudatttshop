// ============================================
// IP GUARD MIDDLEWARE
// Stronger auth endpoint rate limiting + IP blocking
// ============================================

const jwt = require('jsonwebtoken');
const db = require('../config/database');
const logService = require('../services/logService');
const { JWT_SECRET } = require('./auth');

const REQUEST_WINDOW_MS = parseInt(process.env.IP_GUARD_WINDOW_MS || '10000', 10);
const MAX_REQUESTS_PER_WINDOW = parseInt(process.env.IP_GUARD_MAX_REQUESTS || '250', 10);
const STRIKE_WINDOW_MS = parseInt(process.env.IP_GUARD_STRIKE_WINDOW_MS || '60000', 10);
const MAX_STRIKES_PER_WINDOW = parseInt(process.env.IP_GUARD_MAX_STRIKES || '40', 10);
const PAGE_VISIT_WINDOW_MS = parseInt(process.env.IP_GUARD_PAGE_VISIT_WINDOW_MS || '10000', 10);
const MAX_PAGE_VISITS = parseInt(process.env.IP_GUARD_MAX_PAGE_VISITS || '45', 10);
const PAGE_VISIT_BLOCK_MS = parseInt(process.env.IP_GUARD_PAGE_VISIT_BLOCK_MS || '1800000', 10);
const AUTH_WINDOW_MS = parseInt(process.env.IP_GUARD_AUTH_WINDOW_MS || '10000', 10);
const MAX_AUTH_FAILURES = parseInt(process.env.IP_GUARD_MAX_AUTH_FAILURES || '20', 10);
const AUTH_ROUTE_WINDOW_MS = parseInt(process.env.IP_GUARD_AUTH_ROUTE_WINDOW_MS || '10000', 10);
const MAX_AUTH_ROUTE_REQUESTS = parseInt(process.env.IP_GUARD_MAX_AUTH_ROUTE_REQUESTS || '30', 10);
const AUTH_ROUTE_BLOCK_MS = parseInt(process.env.IP_GUARD_AUTH_ROUTE_BLOCK_MS || '1800000', 10);
const BLOCK_DURATION_MS = parseInt(process.env.IP_GUARD_BLOCK_MS || '900000', 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.IP_GUARD_CLEANUP_INTERVAL_MS || '60000', 10);
const BLOCK_STATUS_CODE = 429;
const MAX_TRACKED_IPS = parseInt(process.env.IP_GUARD_MAX_TRACKED_IPS || '5000', 10);
const BLOCK_REDIRECT_URL = process.env.IP_GUARD_BLOCK_REDIRECT_URL || '/blocked-ip.html';
const BLOCK_STATUS_PATH = '/api/security/block-status';
const PERSISTENT_CACHE_MS = parseInt(process.env.IP_GUARD_PERSISTENT_CACHE_MS || '15000', 10);
const MANUAL_ADMIN_BLOCK_REASON = 'manual_admin_block';

const ipState = new Map();
const persistentBlockCache = new Map();
let lastCleanupAt = 0;
let protectedIpCache = {
    key: '',
    ips: new Set()
};

function normalizeIp(rawValue = '') {
    const value = String(rawValue || '')
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/i, '');

    if (!value) return '';
    if (value === '::1') return '127.0.0.1';
    return value;
}

function extractIpCandidate(value = '') {
    const input = String(value || '').trim();
    if (!input) return '';

    try {
        const parsed = new URL(input.includes('://') ? input : `http://${input}`);
        return normalizeIp(parsed.hostname || '');
    } catch (_) {
        return normalizeIp(input.replace(/^\[|\]$/g, '').split(':')[0].trim());
    }
}

function getClientIp(req) {
    const requestIp = normalizeIp(
        req.ip ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        ''
    );

    if (requestIp && !isLocalOrPrivateIp(requestIp)) {
        return requestIp;
    }

    const headerIp = normalizeIp(req.headers?.['x-client-public-ip'] || '');
    if (headerIp && !isLocalOrPrivateIp(headerIp)) {
        return headerIp;
    }

    const bodyIp = normalizeIp(req.body?.client_public_ip || '');
    if (bodyIp && !isLocalOrPrivateIp(bodyIp)) {
        return bodyIp;
    }

    return requestIp;
}

function normalizeEmail(value = '') {
    return String(value || '').trim().toLowerCase();
}

function getTokenFromRequest(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    if (req.cookies?.token) {
        return req.cookies.token;
    }

    return '';
}

function isLocalOrPrivateIp(ip) {
    if (!ip) return true;
    if (ip === '127.0.0.1' || ip === 'localhost') return true;
    if (ip === '10.0.0.1' || ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
}

function readProtectedIpSet() {
    const rawKey = [
        process.env.SECURITY_NEVER_BLOCK_IPS || '',
        process.env.SERVER_IP || '',
        process.env.SERVER_PUBLIC_IP || '',
        process.env.SERVER_PUBLIC_IPS || '',
        process.env.APP_URL || '',
        process.env.BASE_URL || '',
        process.env.SITE_URL || '',
        process.env.PUBLIC_URL || '',
        process.env.RENDER_EXTERNAL_URL || ''
    ].join('|');

    if (protectedIpCache.key === rawKey) {
        return protectedIpCache.ips;
    }

    const next = new Set();
    rawKey
        .split(/[,\s|]+/)
        .map(extractIpCandidate)
        .filter(Boolean)
        .forEach((ip) => {
            next.add(ip);
        });

    protectedIpCache = {
        key: rawKey,
        ips: next
    };

    return next;
}

function isProtectedIp(ip = '') {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        return false;
    }

    if (isLocalOrPrivateIp(normalizedIp)) {
        return true;
    }

    return readProtectedIpSet().has(normalizedIp);
}

function resolveRedirectPath(target = '') {
    if (!target) return '';
    if (target.startsWith('/')) return target;

    try {
        return new URL(target).pathname;
    } catch (_) {
        return '';
    }
}

const BLOCK_REDIRECT_PATH = resolveRedirectPath(BLOCK_REDIRECT_URL);

function hasActiveBlockForIp(ip, now = Date.now()) {
    if (!ip) return false;
    if (isProtectedIp(ip)) return false;

    const state = ipState.get(ip);
    if (state?.blockUntil > now) {
        return true;
    }

    const cached = persistentBlockCache.get(ip);
    return !!(cached?.blockUntil > now);
}

function shouldSkipGuard(req, ip, now = Date.now()) {
    // Always skip guard for local / private IPs to avoid locking out dev/admin environments
    if (ip && isLocalOrPrivateIp(ip)) return true;

    if ((process.env.IP_GUARD_ENABLED || '1') !== '1') return true;
    if (!ip) return true;
    if (isProtectedIp(ip)) return true;
    if ((process.env.IP_GUARD_SKIP_PRIVATE || '1') === '1' && isLocalOrPrivateIp(ip) && !hasActiveBlockForIp(ip, now)) return true;
    if (req.path === '/api/health') return true;
    if (req.path === BLOCK_STATUS_PATH) return true;
    if (req.path === '/api/support/unblock-request') return true;
    if (BLOCK_REDIRECT_PATH && req.path === BLOCK_REDIRECT_PATH) return true;
    return false;
}

function hasStaticExtension(path = '') {
    return /\.[a-z0-9]+$/i.test(path);
}

function isTrackedPageVisit(req) {
    const method = (req.method || '').toUpperCase();
    const path = req.path || req.originalUrl || '';
    const accept = String(req.headers.accept || '').toLowerCase();

    if (method !== 'GET') return false;
    if (!path || path.startsWith('/api/')) return false;
    if (BLOCK_REDIRECT_PATH && path === BLOCK_REDIRECT_PATH) return false;
    if (hasStaticExtension(path)) return false;

    return accept.includes('text/html');
}

function isManualAdminBlock(reason = '') {
    return String(reason || '').trim() === MANUAL_ADMIN_BLOCK_REASON;
}

async function isAdminIdentityRequest(req) {
    const path = req.path || req.originalUrl || '';

    if (path === '/api/auth/login') {
        const email = normalizeEmail(req.body?.email);
        if (!email) {
            return false;
        }

        const [rows] = await db.execute(
            `SELECT role
             FROM users
             WHERE LOWER(email) = LOWER(?)
             LIMIT 1`,
            [email]
        );

        return rows[0]?.role === 'admin';
    }

    const token = getTokenFromRequest(req);
    if (!token) {
        return false;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const [rows] = await db.execute(
            `SELECT role, status
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [decoded.userId]
        );

        if (!rows.length) {
            return false;
        }

        return rows[0].role === 'admin' && rows[0].status !== 'banned';
    } catch (_) {
        return false;
    }
}

function pruneList(values, threshold) {
    return values.filter(item => item.ts >= threshold);
}

function toSqliteDateTime(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function parseDbDateTime(value) {
    if (!value) return 0;
    const text = String(value).trim();
    if (!text) return 0;
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const parsed = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function isSensitiveAuthRoute(path = '') {
    return path === '/api/auth/login' || path === '/api/auth/register';
}

function ensureState(ip) {
    const existing = ipState.get(ip);
    if (existing) return existing;

    if (ipState.size >= MAX_TRACKED_IPS) {
        cleanupState(Date.now(), true);
    }

    const state = {
        requestHits: [],
        strikes: [],
        pageVisitHits: [],
        authFailures: [],
        authRouteHits: [],
        blockUntil: 0,
        blockedReason: '',
        lastSeenAt: 0,
        lastBlockedResponseAt: 0
    };

    ipState.set(ip, state);
    return state;
}

function cleanupPersistentCache(now = Date.now()) {
    persistentBlockCache.forEach((state, ip) => {
        const isExpired = !state.blockUntil || state.blockUntil <= now;
        const isStale = now - state.checkedAt > Math.max(PERSISTENT_CACHE_MS, AUTH_ROUTE_BLOCK_MS);
        if (isExpired || isStale) {
            persistentBlockCache.delete(ip);
        }
    });
}

function cleanupState(now = Date.now(), aggressive = false) {
    if (!aggressive && now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
        return;
    }

    lastCleanupAt = now;
    cleanupPersistentCache(now);

    ipState.forEach((state, ip) => {
        state.requestHits = pruneList(state.requestHits, now - REQUEST_WINDOW_MS);
        state.strikes = pruneList(state.strikes, now - STRIKE_WINDOW_MS);
        state.pageVisitHits = pruneList(state.pageVisitHits, now - PAGE_VISIT_WINDOW_MS);
        state.authFailures = pruneList(state.authFailures, now - AUTH_WINDOW_MS);
        state.authRouteHits = pruneList(state.authRouteHits, now - AUTH_ROUTE_WINDOW_MS);

        const isIdle = state.lastSeenAt && now - state.lastSeenAt > Math.max(PAGE_VISIT_BLOCK_MS, AUTH_ROUTE_BLOCK_MS, STRIKE_WINDOW_MS);
        const blockExpired = !state.blockUntil || state.blockUntil <= now;
        const hasSignals = state.requestHits.length || state.strikes.length || state.pageVisitHits.length || state.authFailures.length || state.authRouteHits.length;

        if (blockExpired && !hasSignals && isIdle) {
            ipState.delete(ip);
        }
    });
}

function addStrike(state, now, points, reason, path) {
    for (let index = 0; index < points; index += 1) {
        state.strikes.push({ ts: now, reason, path });
    }
}

async function persistIpBlock(ip, reason, detail, blockUntilMs) {
    if (isProtectedIp(ip)) {
        persistentBlockCache.delete(normalizeIp(ip));
        return;
    }

    await db.execute(
        `INSERT INTO security_ip_blocks (ip, reason, detail, block_until, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(ip) DO UPDATE SET
             reason = excluded.reason,
             detail = excluded.detail,
             block_until = excluded.block_until,
             updated_at = CURRENT_TIMESTAMP`,
        [ip, reason, detail, toSqliteDateTime(blockUntilMs)]
    );

    persistentBlockCache.set(ip, {
        checkedAt: Date.now(),
        blockUntil: blockUntilMs,
        reason,
        detail
    });
}

async function getPersistentIpBlock(ip, now = Date.now()) {
    if (isProtectedIp(ip)) {
        const normalizedIp = normalizeIp(ip);
        if (normalizedIp) {
            persistentBlockCache.delete(normalizedIp);
            await db.execute('DELETE FROM security_ip_blocks WHERE ip = ?', [normalizedIp]).catch(() => {});
        }
        return null;
    }

    const cached = persistentBlockCache.get(ip);
    if (cached && now - cached.checkedAt <= PERSISTENT_CACHE_MS) {
        if (cached.blockUntil > now) {
            return cached;
        }

        if (!cached.blockUntil) {
            return null;
        }
    }

    const [rows] = await db.execute(
        `SELECT reason, detail, block_until
         FROM security_ip_blocks
         WHERE ip = ?
         LIMIT 1`,
        [ip]
    );

    if (!rows.length) {
        persistentBlockCache.set(ip, {
            checkedAt: now,
            blockUntil: 0,
            reason: '',
            detail: ''
        });
        return null;
    }

    const blockUntil = parseDbDateTime(rows[0].block_until);
    if (!blockUntil || blockUntil <= now) {
        await db.execute('DELETE FROM security_ip_blocks WHERE ip = ?', [ip]);
        persistentBlockCache.set(ip, {
            checkedAt: now,
            blockUntil: 0,
            reason: '',
            detail: ''
        });
        return null;
    }

    const persistent = {
        checkedAt: now,
        blockUntil,
        reason: rows[0].reason || 'persistent_block',
        detail: rows[0].detail || ''
    };

    persistentBlockCache.set(ip, persistent);
    return persistent;
}

async function getMachineBlockStatus(machineId, now = Date.now()) {
    if (!machineId) return null;
    const cleanId = String(machineId).trim();
    if (!cleanId) return null;

    const [whitelist] = await db.execute(
        'SELECT id FROM security_whitelist WHERE machine_id = ? LIMIT 1',
        [cleanId]
    );
    if (whitelist.length > 0) {
        return null;
    }

    const [rows] = await db.execute(
        `SELECT reason, detail, block_until
         FROM security_machine_blocks
         WHERE machine_id = ?
         LIMIT 1`,
        [cleanId]
    );

    if (!rows.length) {
        return null;
    }

    const blockUntil = parseDbDateTime(rows[0].block_until);
    if (!blockUntil || blockUntil <= now) {
        await db.execute('DELETE FROM security_machine_blocks WHERE machine_id = ?', [cleanId]);
        return null;
    }

    return {
        blockUntil,
        reason: rows[0].reason || 'machine_block',
        detail: rows[0].detail || ''
    };
}

async function blockMachineId(machineId, reason = 'manual_block', detail = '', durationMs = BLOCK_DURATION_MS) {
    if (!machineId) return;
    const cleanId = String(machineId).trim();
    if (!cleanId) return;

    const [whitelist] = await db.execute(
        'SELECT id FROM security_whitelist WHERE machine_id = ? LIMIT 1',
        [cleanId]
    );
    if (whitelist.length > 0) {
        return;
    }

    const now = Date.now();
    const blockUntilMs = now + durationMs;

    await db.execute(
        `INSERT INTO security_machine_blocks (machine_id, reason, detail, block_until, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(machine_id) DO UPDATE SET
             reason = excluded.reason,
             detail = excluded.detail,
             block_until = excluded.block_until,
             updated_at = CURRENT_TIMESTAMP`,
        [cleanId, reason, detail || '', toSqliteDateTime(blockUntilMs)]
    );
}

async function blockIp(ip, state, now, reason, meta = {}) {
    if (isProtectedIp(ip)) {
        if (state) {
            state.requestHits = [];
            state.strikes = [];
            state.pageVisitHits = [];
            state.authFailures = [];
            state.authRouteHits = [];
            state.blockUntil = 0;
            state.blockedReason = '';
            state.lastSeenAt = now;
        }
        return;
    }

    const durationMs = Number.isFinite(meta.durationMs) ? meta.durationMs : BLOCK_DURATION_MS;
    state.blockUntil = now + durationMs;
    state.blockedReason = reason;
    state.lastSeenAt = now;

    if (meta.persist) {
        await persistIpBlock(ip, reason, meta.detail || '', state.blockUntil);
    }

    logService.recordSecurity({
        action: 'ip_blocked',
        ip,
        reason,
        detail: meta.detail || '',
        path: meta.path || '',
        method: meta.method || '',
        blockUntil: new Date(state.blockUntil).toISOString()
    });
}

function blockIpTemporarily(ip, reason = 'manual_block', detail = '', durationMs = BLOCK_DURATION_MS) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) return 0;
    if (isProtectedIp(normalizedIp)) return 0;

    const now = Date.now();
    const state = ensureState(normalizedIp);
    state.requestHits = [];
    state.strikes = [];
    state.pageVisitHits = [];
    state.authFailures = [];
    state.authRouteHits = [];
    state.blockUntil = now + durationMs;
    state.blockedReason = reason;
    state.lastSeenAt = now;

    return state.blockUntil;
}

function clearIpBlockState(ip) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) return;

    persistentBlockCache.delete(normalizedIp);

    const state = ipState.get(normalizedIp);
    if (state) {
        state.requestHits = [];
        state.strikes = [];
        state.pageVisitHits = [];
        state.authFailures = [];
        state.authRouteHits = [];
        state.blockUntil = 0;
        state.blockedReason = '';
        state.lastSeenAt = Date.now();
    }

    db.execute('DELETE FROM security_ip_blocks WHERE ip = ?', [normalizedIp]).catch(() => {});
}

async function maybeBlockByThreshold(ip, state, now, req) {
    if (state.pageVisitHits.length >= MAX_PAGE_VISITS) {
        await blockIp(ip, state, now, 'page_visit_rate_limit', {
            method: req.method,
            path: req.originalUrl,
            detail: `${state.pageVisitHits.length} page visits / ${PAGE_VISIT_WINDOW_MS}ms`,
            durationMs: PAGE_VISIT_BLOCK_MS,
            persist: true
        });
        return true;
    }

    if (state.authRouteHits.length >= MAX_AUTH_ROUTE_REQUESTS) {
        await blockIp(ip, state, now, 'auth_route_rate_limit', {
            method: req.method,
            path: req.originalUrl,
            detail: `${state.authRouteHits.length} auth requests / ${AUTH_ROUTE_WINDOW_MS}ms`,
            durationMs: AUTH_ROUTE_BLOCK_MS,
            persist: true
        });
        return true;
    }

    if (state.requestHits.length > MAX_REQUESTS_PER_WINDOW) {
        await blockIp(ip, state, now, 'burst_requests', {
            method: req.method,
            path: req.originalUrl,
            detail: `${state.requestHits.length} requests / ${REQUEST_WINDOW_MS}ms`
        });
        return true;
    }

    if (state.authFailures.length >= MAX_AUTH_FAILURES) {
        await blockIp(ip, state, now, 'auth_failures', {
            method: req.method,
            path: req.originalUrl,
            detail: `${state.authFailures.length} auth failures / ${AUTH_WINDOW_MS}ms`,
            durationMs: AUTH_ROUTE_BLOCK_MS,
            persist: true
        });
        return true;
    }

    if (state.strikes.length >= MAX_STRIKES_PER_WINDOW) {
        await blockIp(ip, state, now, 'suspicious_activity', {
            method: req.method,
            path: req.originalUrl,
            detail: `${state.strikes.length} strikes / ${STRIKE_WINDOW_MS}ms`
        });
        return true;
    }

    return false;
}

function sendBlockedResponse(req, res, ip, state, now) {
    if (now - state.lastBlockedResponseAt > 30000) {
        const method = String(req.method || 'GET').toUpperCase();
        const path = String(req.path || req.originalUrl || '').split('?')[0] || '/';
        const targetKey = `${method} ${path}`.trim();

        logService.recordSecurity({
            action: 'blocked_request',
            ip,
            reason: state.blockedReason || 'temporary_block',
            detail: `retry_after_ms=${Math.max(state.blockUntil - now, 0)}`,
            path,
            method
        });

        db.execute(
            `INSERT INTO security_action_logs (action_type, actor_ip, target_key)
             VALUES (?, ?, ?)`,
            ['blocked_request', ip || null, targetKey || null]
        ).catch(() => {});

        state.lastBlockedResponseAt = now;
    }

    const retryAfterSeconds = Math.max(Math.ceil((state.blockUntil - now) / 1000), 1);
    res.set('Retry-After', String(retryAfterSeconds));

    if (BLOCK_REDIRECT_URL) {
        return res.redirect(302, BLOCK_REDIRECT_URL);
    }

    return res.status(BLOCK_STATUS_CODE).json({
        success: false,
        message: 'IP tam thoi bi khoa do hoat dong bat thuong. Vui long thu lai sau.'
    });
}

async function classifyResponse(req, res, ip, state, startedAt) {
    const now = Date.now();
    const status = res.statusCode || 0;
    const path = req.originalUrl || req.path || '';
    const isAuthPath = path.startsWith('/api/auth');
    const isAdminPath = path.startsWith('/api/admin');

    if (status === 401 || status === 403) {
        const points = isAuthPath ? 4 : (isAdminPath ? 3 : 2);
        addStrike(state, now, points, 'unauthorized', path);
        if (isAuthPath) {
            state.authFailures.push({ ts: now, path });
        }
    } else if (status === 404 && path.startsWith('/api/')) {
        addStrike(state, now, 1, 'not_found_scan', path);
    } else if (status === 429) {
        addStrike(state, now, 2, 'rate_limited', path);
    } else if (status >= 500) {
        addStrike(state, now, 1, 'server_error', path);
    }

    state.requestHits = pruneList(state.requestHits, now - REQUEST_WINDOW_MS);
    state.strikes = pruneList(state.strikes, now - STRIKE_WINDOW_MS);
    state.pageVisitHits = pruneList(state.pageVisitHits, now - PAGE_VISIT_WINDOW_MS);
    state.authFailures = pruneList(state.authFailures, now - AUTH_WINDOW_MS);
    state.authRouteHits = pruneList(state.authRouteHits, now - AUTH_ROUTE_WINDOW_MS);
    state.lastSeenAt = now;

    if (await maybeBlockByThreshold(ip, state, now, req)) {
        logService.recordSecurity({
            action: 'ip_suspicion',
            ip,
            reason: state.blockedReason,
            method: req.method,
            path,
            detail: `status=${status}; duration_ms=${now - startedAt}`
        });
    }
}

async function applyPersistentBlockIfNeeded(ip, state, now) {
    const persistent = await getPersistentIpBlock(ip, now);
    if (!persistent) {
        return;
    }

    state.blockUntil = persistent.blockUntil;
    state.blockedReason = persistent.reason || 'persistent_block';
    state.lastSeenAt = now;
}

async function getIpBlockStatus(ip, now = Date.now()) {
    const normalizedIp = normalizeIp(ip);
    cleanupState(now);

    if (!normalizedIp) {
        return {
            active: false,
            ip: '',
            reason: '',
            detail: '',
            blockUntil: 0,
            retryAfterSeconds: 0
        };
    }

    if (isProtectedIp(normalizedIp)) {
        return {
            active: false,
            ip: normalizedIp,
            reason: '',
            detail: 'protected_ip',
            blockUntil: 0,
            retryAfterSeconds: 0
        };
    }

    const state = ipState.get(normalizedIp);
    if (state?.blockUntil > now) {
        return {
            active: true,
            ip: normalizedIp,
            reason: state.blockedReason || 'temporary_block',
            detail: '',
            blockUntil: state.blockUntil,
            retryAfterSeconds: Math.max(Math.ceil((state.blockUntil - now) / 1000), 1)
        };
    }

    const persistent = await getPersistentIpBlock(normalizedIp, now);
    if (persistent?.blockUntil > now) {
        return {
            active: true,
            ip: normalizedIp,
            reason: persistent.reason || 'persistent_block',
            detail: persistent.detail || '',
            blockUntil: persistent.blockUntil,
            retryAfterSeconds: Math.max(Math.ceil((persistent.blockUntil - now) / 1000), 1)
        };
    }

    return {
        active: false,
        ip: normalizedIp,
        reason: '',
        detail: '',
        blockUntil: 0,
        retryAfterSeconds: 0
    };
}

async function isRequestWhitelisted(req, ip) {
    if (!ip) return false;
    const machineId = req.headers?.['x-machine-id'] || req.query?.machine_id || '';
    
    // Get email from token
    let email = '';
    const token = getTokenFromRequest(req);
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const [rows] = await db.execute(
                'SELECT email FROM users WHERE id = ? LIMIT 1',
                [decoded.userId]
            );
            if (rows.length > 0) {
                email = rows[0].email;
            }
        } catch (_) {}
    }
    
    if (req.path === '/api/auth/login' && req.body?.email) {
        email = req.body.email;
    }
    
    const queryParts = [];
    const queryParams = [];
    if (ip) {
        queryParts.push('ip = ?');
        queryParams.push(ip);
    }
    if (machineId) {
        queryParts.push('machine_id = ?');
        queryParams.push(machineId);
    }
    if (email) {
        queryParts.push('LOWER(email) = LOWER(?)');
        queryParams.push(email.trim().toLowerCase());
    }
    
    if (queryParts.length === 0) return false;
    
    const [rows] = await db.execute(
        `SELECT id FROM security_whitelist WHERE ${queryParts.join(' OR ')} LIMIT 1`,
        queryParams
    );
    return rows.length > 0;
}

async function ipGuard(req, res, next) {
    const now = Date.now();
    cleanupState(now);

    const ip = getClientIp(req);
    req.clientIp = ip;

    if (shouldSkipGuard(req, ip, now)) {
        return next();
    }

    // Bypass check if IP guard is disabled in admin settings
    const cache = global.systemSettingsCache || {};
    const ipCheckEnabled = cache['ip_check_enabled'] !== 'false' && cache['ip_check_enabled'] !== '0';
    if (!ipCheckEnabled) {
        return next();
    }

    try {
        if (await isRequestWhitelisted(req, ip)) {
            clearIpBlockState(ip);
            return next();
        }

        const state = ensureState(ip);
        state.requestHits = pruneList(state.requestHits, now - REQUEST_WINDOW_MS);
        state.strikes = pruneList(state.strikes, now - STRIKE_WINDOW_MS);
        state.pageVisitHits = pruneList(state.pageVisitHits, now - PAGE_VISIT_WINDOW_MS);
        state.authFailures = pruneList(state.authFailures, now - AUTH_WINDOW_MS);
        state.authRouteHits = pruneList(state.authRouteHits, now - AUTH_ROUTE_WINDOW_MS);
        state.lastSeenAt = now;

        if (state.blockUntil <= now) {
            await applyPersistentBlockIfNeeded(ip, state, now);
        }

        if (state.blockUntil > now && isManualAdminBlock(state.blockedReason)) {
            return sendBlockedResponse(req, res, ip, state, now);
        }

        if (await isAdminIdentityRequest(req)) {
            return next();
        }

        const machineId = req.headers?.['x-machine-id'] || req.query?.machine_id || '';
        if (machineId && String(machineId).trim()) {
            const machineBlock = await getMachineBlockStatus(machineId, now);
            if (machineBlock) {
                blockIpTemporarily(ip, 'associated_machine_block', `Machine ID ${machineId} is blocked: ${machineBlock.reason}`, machineBlock.blockUntil - now);
                state.blockUntil = machineBlock.blockUntil;
                state.blockedReason = machineBlock.reason;
                return sendBlockedResponse(req, res, ip, state, now);
            }
        }

        if (state.blockUntil > now) {
            return sendBlockedResponse(req, res, ip, state, now);
        }

        const path = req.originalUrl || req.path || '';
        state.requestHits.push({ ts: now, path });

        if (isTrackedPageVisit(req)) {
            state.pageVisitHits.push({ ts: now, path });
        }

        if (isSensitiveAuthRoute(path)) {
            state.authRouteHits.push({ ts: now, path });
        }

        if (await maybeBlockByThreshold(ip, state, now, req)) {
            return sendBlockedResponse(req, res, ip, state, now);
        }

        res.on('finish', () => {
            void classifyResponse(req, res, ip, state, now).catch(() => {
                // Ignore guard logging errors
            });
        });

        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = {
    ipGuard,
    getClientIp,
    getIpBlockStatus,
    isProtectedIp,
    normalizeIp,
    blockIpTemporarily,
    clearIpBlockState,
    isRequestWhitelisted,
    MANUAL_ADMIN_BLOCK_REASON,
    blockMachineId
};
