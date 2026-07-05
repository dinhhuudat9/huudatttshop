const db = require('../config/database');
const logService = require('./logService');
const { normalizeIp, blockIpTemporarily, isProtectedIp, MANUAL_ADMIN_BLOCK_REASON } = require('../middleware/ipGuard');
const { SHARED_IP_SECURITY_LOCK_REASON } = require('./ipAccountSecurityService');

const FAILURE_WINDOW_MS = parseInt(process.env.LOGIN_GUARD_WINDOW_MS || '10000', 10);
const MAX_IP_FAILURES = parseInt(process.env.LOGIN_GUARD_IP_MAX_FAILURES || '10', 10);
const MAX_ACCOUNT_FAILURES = parseInt(process.env.LOGIN_GUARD_ACCOUNT_MAX_FAILURES || '0', 10);
const IP_BLOCK_MS = parseInt(process.env.LOGIN_GUARD_IP_BLOCK_MS || '864000000', 10);
const ACCOUNT_LOCK_MS = parseInt(process.env.LOGIN_GUARD_ACCOUNT_LOCK_MS || '43200000', 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.LOGIN_GUARD_CLEANUP_MS || '60000', 10);
const MAX_TRACKED_KEYS = parseInt(process.env.LOGIN_GUARD_MAX_TRACKED_KEYS || '10000', 10);

const ipFailures = new Map();
const accountFailures = new Map();
const unlockGraceIp = new Map();
const unlockGraceEmail = new Map();
let lastCleanupAt = 0;
const MANUAL_UNLOCK_GRACE_MS = parseInt(process.env.LOGIN_GUARD_UNLOCK_GRACE_MS || '120000', 10);

function normalizeEmail(value = '') {
    return String(value || '').trim().toLowerCase();
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

function getRetryAfterSeconds(untilMs, now = Date.now()) {
    return Math.max(Math.ceil((untilMs - now) / 1000), 1);
}

function pruneTimestamps(values, now) {
    const threshold = now - FAILURE_WINDOW_MS;
    return values.filter(timestamp => timestamp >= threshold);
}

function ensureState(map, key) {
    const existing = map.get(key);
    if (existing) return existing;

    if (map.size >= MAX_TRACKED_KEYS) {
        cleanupStates(Date.now(), true);
    }

    const next = {
        failures: [],
        lastSeenAt: 0
    };
    map.set(key, next);
    return next;
}

function cleanupMap(map, now) {
    map.forEach((state, key) => {
        state.failures = pruneTimestamps(state.failures, now);
        const isIdle = state.lastSeenAt && now - state.lastSeenAt > Math.max(FAILURE_WINDOW_MS, ACCOUNT_LOCK_MS, IP_BLOCK_MS);
        if (!state.failures.length && isIdle) {
            map.delete(key);
        }
    });
}

function cleanupGraceMap(map, now) {
    map.forEach((untilMs, key) => {
        if (!untilMs || untilMs <= now) {
            map.delete(key);
        }
    });
}

function cleanupStates(now = Date.now(), force = false) {
    if (!force && now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
        return;
    }

    lastCleanupAt = now;
    cleanupMap(ipFailures, now);
    cleanupMap(accountFailures, now);
    cleanupGraceMap(unlockGraceIp, now);
    cleanupGraceMap(unlockGraceEmail, now);
}

function createRateLimitError(message, untilMs) {
    const error = new Error(message);
    error.statusCode = 429;
    error.retryAfterSeconds = getRetryAfterSeconds(untilMs);
    return error;
}

async function clearAccountLock(userId) {
    await db.execute(
        `UPDATE users
         SET failed_login_count = 0,
             last_failed_login_at = NULL,
             last_failed_login_ip = NULL,
             login_locked_until = NULL
         WHERE id = ?`,
        [userId]
    );
}

function isUnlockGraceActive(map, key, now = Date.now()) {
    if (!key) return false;
    const untilMs = map.get(key);
    if (!untilMs) return false;
    if (untilMs <= now) {
        map.delete(key);
        return false;
    }
    return true;
}

function setUnlockGrace({ ip = '', email = '', durationMs = MANUAL_UNLOCK_GRACE_MS } = {}) {
    const now = Date.now();
    const untilMs = now + Math.max(Number(durationMs) || 0, 0);
    const normalizedIp = normalizeIp(ip);
    const normalizedEmail = normalizeEmail(email);

    if (normalizedIp && durationMs > 0) {
        unlockGraceIp.set(normalizedIp, untilMs);
    }
    if (normalizedEmail && durationMs > 0) {
        unlockGraceEmail.set(normalizedEmail, untilMs);
    }

    return untilMs;
}

async function clearProtectionState({ userId = null, email = '', ip = '', addGrace = false, graceMs = MANUAL_UNLOCK_GRACE_MS } = {}) {
    cleanupStates(Date.now(), true);

    const normalizedIp = normalizeIp(ip);
    const normalizedEmail = normalizeEmail(email);

    if (normalizedIp) {
        ipFailures.delete(normalizedIp);
    }

    if (normalizedEmail) {
        accountFailures.delete(normalizedEmail);
    }

    if (userId) {
        await clearAccountLock(userId);
    }

    if (addGrace) {
        setUnlockGrace({
            ip: normalizedIp,
            email: normalizedEmail,
            durationMs: graceMs
        });
    }
}

async function updateFailureMetadata(email, ip, failureCount, lockUntilMs = 0) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;

    await db.execute(
        `UPDATE users
         SET failed_login_count = ?,
             last_failed_login_at = CURRENT_TIMESTAMP,
             last_failed_login_ip = ?
         WHERE LOWER(email) = LOWER(?)`,
        [failureCount, ip || null, normalizedEmail]
    );

    if (lockUntilMs > 0) {
        await db.execute(
            `UPDATE users
             SET login_locked_until = ?
             WHERE LOWER(email) = LOWER(?)`,
            [toSqliteDateTime(lockUntilMs), normalizedEmail]
        );
    }
}

async function purgeExpiredIpBlock(ip) {
    if (!ip) return;
    await db.execute('DELETE FROM security_ip_blocks WHERE ip = ?', [ip]);
}

async function getActiveIpBlock(ip) {
    const normalized = normalizeIp(ip);
    if (!normalized) return null;
    if (isProtectedIp(normalized)) {
        await purgeExpiredIpBlock(normalized);
        return null;
    }

    const [rows] = await db.execute(
        `SELECT ip, reason, detail, block_until
         FROM security_ip_blocks
         WHERE ip = ?
         LIMIT 1`,
        [normalized]
    );

    if (!rows.length) {
        return null;
    }

    const blockUntilMs = parseDbDateTime(rows[0].block_until);
    if (!blockUntilMs || blockUntilMs <= Date.now()) {
        await purgeExpiredIpBlock(normalized);
        return null;
    }

    return {
        ...rows[0],
        blockUntilMs
    };
}

async function upsertIpBlock(ip, reason, detail, blockUntilMs) {
    const normalized = normalizeIp(ip);
    if (!normalized) return 0;
    if (isProtectedIp(normalized)) return 0;

    const blockUntil = toSqliteDateTime(blockUntilMs);
    await db.execute(
        `INSERT INTO security_ip_blocks (ip, reason, detail, block_until, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(ip) DO UPDATE SET
             reason = excluded.reason,
             detail = excluded.detail,
             block_until = excluded.block_until,
             updated_at = CURRENT_TIMESTAMP`,
        [normalized, reason, detail, blockUntil]
    );

    return blockUntilMs;
}

async function getAccountSecurityState(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;

    const [rows] = await db.execute(
        `SELECT id, email, role, failed_login_count, last_failed_login_at, login_locked_until
         FROM users
         WHERE LOWER(email) = LOWER(?)
         LIMIT 1`,
        [normalizedEmail]
    );

    if (!rows.length) {
        return null;
    }

    const user = rows[0];
    const lockUntilMs = parseDbDateTime(user.login_locked_until);

    if (lockUntilMs && lockUntilMs <= Date.now()) {
        await clearAccountLock(user.id);
        return {
            ...user,
            lockUntilMs: 0
        };
    }

    return {
        ...user,
        lockUntilMs
    };
}

async function assertLoginAllowed({ email, ip }) {
    cleanupStates();
    const normalizedIp = normalizeIp(ip);
    const normalizedEmail = normalizeEmail(email);

    if (isUnlockGraceActive(unlockGraceIp, normalizedIp) || isUnlockGraceActive(unlockGraceEmail, normalizedEmail)) {
        return;
    }

    const [whitelist] = await db.execute(
        'SELECT id FROM security_whitelist WHERE LOWER(email) = LOWER(?) OR ip = ? LIMIT 1',
        [normalizedEmail, normalizedIp]
    );
    if (whitelist.length > 0) {
        return;
    }

    const ipBlock = await getActiveIpBlock(ip);
    if (ipBlock?.reason === MANUAL_ADMIN_BLOCK_REASON) {
        throw createRateLimitError(
            'IP da bi admin chan thu cong.',
            ipBlock.blockUntilMs
        );
    }
    if (ipBlock?.reason === SHARED_IP_SECURITY_LOCK_REASON) {
        throw createRateLimitError(
            'IP va cac tai khoan lien ket da bi khoa do vi pham dieu khoan. Lien he admin de mo khoa.',
            ipBlock.blockUntilMs
        );
    }

    const accountState = await getAccountSecurityState(email);
    if (accountState?.role === 'admin') {
        if (accountState.lockUntilMs) {
            await clearAccountLock(accountState.id);
        }
        return;
    }

    if (ipBlock) {
        throw createRateLimitError(
            'IP tam thoi bi chan do co qua nhieu lan dang nhap that bai.',
            ipBlock.blockUntilMs
        );
    }

    if (MAX_ACCOUNT_FAILURES > 0 && accountState?.lockUntilMs && accountState.lockUntilMs > Date.now()) {
        throw createRateLimitError(
            'Tai khoan tam thoi bi khoa dang nhap do co qua nhieu lan sai mat khau.',
            accountState.lockUntilMs
        );
    }
}

async function registerFailedAttempt({ email, ip }) {
    cleanupStates();

    const now = Date.now();
    const normalizedIp = normalizeIp(ip);
    const normalizedEmail = normalizeEmail(email);
    const result = {
        ipBlockedUntil: 0,
        accountLockedUntil: 0,
        ipFailureCount: 0,
        accountFailureCount: 0
    };

    if (normalizedIp) {
        if (isProtectedIp(normalizedIp)) {
            return result;
        }

        if (isUnlockGraceActive(unlockGraceIp, normalizedIp, now)) {
            return result;
        }

        const ipState = ensureState(ipFailures, normalizedIp);
        ipState.failures = pruneTimestamps(ipState.failures, now);
        ipState.failures.push(now);
        ipState.lastSeenAt = now;
        result.ipFailureCount = ipState.failures.length;

        if (ipState.failures.length >= MAX_IP_FAILURES) {
            const blockUntilMs = now + IP_BLOCK_MS;
            const detail = `${ipState.failures.length} failed logins / ${FAILURE_WINDOW_MS}ms`;
            await upsertIpBlock(normalizedIp, 'login_failures', detail, blockUntilMs);
            blockIpTemporarily(normalizedIp, 'login_failures', detail, IP_BLOCK_MS);
            ipState.failures = [];
            result.ipBlockedUntil = blockUntilMs;
        }
    }

    if (MAX_ACCOUNT_FAILURES > 0 && normalizedEmail) {
        if (isUnlockGraceActive(unlockGraceEmail, normalizedEmail, now)) {
            return result;
        }

        const userState = await getAccountSecurityState(normalizedEmail);
        if (userState?.role === 'admin') {
            return result;
        }

        const accountState = ensureState(accountFailures, normalizedEmail);
        accountState.failures = pruneTimestamps(accountState.failures, now);
        accountState.failures.push(now);
        accountState.lastSeenAt = now;
        result.accountFailureCount = accountState.failures.length;

        const shouldLockAccount = accountState.failures.length >= MAX_ACCOUNT_FAILURES;
        const lockUntilMs = shouldLockAccount ? now + ACCOUNT_LOCK_MS : 0;
        await updateFailureMetadata(normalizedEmail, normalizedIp, accountState.failures.length, lockUntilMs);

        if (shouldLockAccount) {
            accountState.failures = [];
            result.accountLockedUntil = lockUntilMs;

            logService.recordSecurity({
                action: 'account_login_locked',
                ip: normalizedIp,
                reason: 'too_many_failed_logins',
                detail: `email=${normalizedEmail}; failures=${MAX_ACCOUNT_FAILURES}; window_ms=${FAILURE_WINDOW_MS}`,
                blockUntil: new Date(lockUntilMs).toISOString()
            });
        }
    }

    return result;
}

async function registerSuccessfulLogin({ email, ip, userId }) {
    cleanupStates();

    const normalizedIp = normalizeIp(ip);
    const normalizedEmail = normalizeEmail(email);

    if (normalizedIp) {
        ipFailures.delete(normalizedIp);
    }

    if (normalizedEmail) {
        accountFailures.delete(normalizedEmail);
    }

    if (userId) {
        await clearAccountLock(userId);
    }
}

module.exports = {
    assertLoginAllowed,
    clearProtectionState,
    createRateLimitError,
    registerFailedAttempt,
    registerSuccessfulLogin
};
