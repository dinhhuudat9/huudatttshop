const db = require('../config/database');
const logService = require('./logService');
const { normalizeIp, blockIpTemporarily, isProtectedIp } = require('../middleware/ipGuard');

const MAX_ACCOUNTS_PER_IP = parseInt(process.env.MAX_ACCOUNTS_PER_IP || '4', 10);
const SHARED_IP_SECURITY_LOCK_REASON = 'shared_ip_terms_lock';
const SHARED_IP_BLOCK_MS = parseInt(process.env.SHARED_IP_BLOCK_MS || '315360000000', 10);
const CLIENT_VIOLATION_BLOCK_REASON = 'client_devtools_lock';
const CLIENT_VIOLATION_BLOCK_MS = parseInt(process.env.CLIENT_VIOLATION_BLOCK_MS || '600000', 10);
const CLIENT_VIOLATION_WINDOW_MS = parseInt(process.env.CLIENT_VIOLATION_WINDOW_MS || '900000', 10);
const CLIENT_VIOLATION_WARNINGS_BEFORE_BLOCK = Math.max(parseInt(process.env.CLIENT_VIOLATION_WARNINGS_BEFORE_BLOCK || '1', 10), 0);

function toSqliteDateTime(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function createStatusError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function toWindowOffset(ms) {
    return `-${Math.max(Math.ceil(ms / 1000), 1)} seconds`;
}

async function countRecentClientViolationWarnings(ip) {
    if (!ip) {
        return 0;
    }

    const [rows] = await db.execute(
        `SELECT COUNT(*) as total
         FROM security_action_logs
         WHERE action_type = 'client_violation_warning'
           AND actor_ip = ?
           AND created_at >= datetime('now', ?)`,
        [ip, toWindowOffset(CLIENT_VIOLATION_WINDOW_MS)]
    );

    return Number(rows[0]?.total || 0);
}

async function recordClientViolationWarning({ ip, userId = null, path = '', source = '' }) {
    await db.execute(
        `INSERT INTO security_action_logs (action_type, actor_user_id, actor_ip, target_key)
         VALUES (?, ?, ?, ?)`,
        ['client_violation_warning', userId || null, ip || null, `${source || 'client_violation'} ${path || ''}`.trim() || null]
    );
}

async function clearClientViolationWarnings(ip) {
    if (!ip) {
        return;
    }

    await db.execute(
        'DELETE FROM security_action_logs WHERE action_type = ? AND actor_ip = ?',
        ['client_violation_warning', ip]
    );
}

async function countAccountsByIp(ip) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        return 0;
    }

    const [rows] = await db.execute(
        `SELECT COUNT(*) as total
         FROM users
         WHERE role <> 'admin' AND register_ip = ?`,
        [normalizedIp]
    );

    return Number(rows[0]?.total || 0);
}

async function assertRegistrationAllowed(ip) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        return;
    }

    const [whitelist] = await db.execute(
        'SELECT id FROM security_whitelist WHERE ip = ? LIMIT 1',
        [normalizedIp]
    );
    if (whitelist.length > 0) {
        return;
    }

    const total = await countAccountsByIp(normalizedIp);
    if (total >= MAX_ACCOUNTS_PER_IP) {
        throw createStatusError(
            `Moi IP chi duoc tao toi da ${MAX_ACCOUNTS_PER_IP} tai khoan.`,
            429
        );
    }
}

async function persistIpBlock(ip, reason, detail, blockUntilMs) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        throw createStatusError('Invalid IP', 400);
    }
    if (isProtectedIp(normalizedIp)) {
        return normalizedIp;
    }

    await db.execute(
        `INSERT INTO security_ip_blocks (ip, reason, detail, block_until, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(ip) DO UPDATE SET
             reason = excluded.reason,
             detail = excluded.detail,
             block_until = excluded.block_until,
             updated_at = CURRENT_TIMESTAMP`,
        [normalizedIp, reason, detail || '', toSqliteDateTime(blockUntilMs)]
    );

    return normalizedIp;
}

async function lockAccountsByIp(ip, reason = SHARED_IP_SECURITY_LOCK_REASON) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        return [];
    }
    if (isProtectedIp(normalizedIp)) {
        return [];
    }

    const [rows] = await db.execute(
        `SELECT id, email
         FROM users
         WHERE role <> 'admin'
           AND status = 'active'
           AND (register_ip = ? OR last_login_ip = ?)`,
        [normalizedIp, normalizedIp]
    );

    if (!rows.length) {
        return [];
    }

    const placeholders = rows.map(() => '?').join(', ');
    await db.execute(
        `UPDATE users
         SET status = 'banned',
             security_lock_reason = ?,
             security_locked_ip = ?,
             security_locked_at = CURRENT_TIMESTAMP
         WHERE id IN (${placeholders})`,
        [reason, normalizedIp, ...rows.map(row => row.id)]
    );

    return rows.map(row => ({
        id: row.id,
        email: row.email || ''
    }));
}

async function unlockAccountsByIp(ip, reason = SHARED_IP_SECURITY_LOCK_REASON) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        return [];
    }

    const [rows] = await db.execute(
        `SELECT id, email
         FROM users
         WHERE role <> 'admin'
           AND status = 'banned'
           AND security_lock_reason = ?
           AND security_locked_ip = ?`,
        [reason, normalizedIp]
    );

    if (!rows.length) {
        return [];
    }

    const placeholders = rows.map(() => '?').join(', ');
    await db.execute(
        `UPDATE users
         SET status = 'active',
             failed_login_count = 0,
             last_failed_login_at = NULL,
             last_failed_login_ip = NULL,
             login_locked_until = NULL,
             security_lock_reason = NULL,
             security_locked_ip = NULL,
             security_locked_at = NULL
         WHERE id IN (${placeholders})`,
        rows.map(row => row.id)
    );

    return rows.map(row => ({
        id: row.id,
        email: row.email || ''
    }));
}

async function clearSecurityLockForUser(userId) {
    await db.execute(
        `UPDATE users
         SET failed_login_count = 0,
             last_failed_login_at = NULL,
             last_failed_login_ip = NULL,
             login_locked_until = NULL,
             security_lock_reason = NULL,
             security_locked_ip = NULL,
             security_locked_at = NULL
         WHERE id = ?`,
        [userId]
    );
}

async function trackUserLoginIp(userId, ip) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp || !userId) {
        return;
    }

    await db.execute(
        'UPDATE users SET last_login_ip = ? WHERE id = ?',
        [normalizedIp, userId]
    );
}

async function enforceClientViolation({ ip, reason = 'client_violation', detail = '', userId = null, email = '', userAgent = '', machineId = '' }) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        throw createStatusError('Invalid IP', 400);
    }

    const queryParts = [];
    const queryParams = [];
    if (normalizedIp) {
        queryParts.push('ip = ?');
        queryParams.push(normalizedIp);
    }
    if (machineId) {
        queryParts.push('machine_id = ?');
        queryParams.push(machineId.trim());
    }
    if (email) {
        queryParts.push('LOWER(email) = LOWER(?)');
        queryParams.push(email.trim().toLowerCase());
    }

    if (queryParts.length > 0) {
        const [whitelist] = await db.execute(
            `SELECT id FROM security_whitelist WHERE ${queryParts.join(' OR ')} LIMIT 1`,
            queryParams
        );
        if (whitelist.length > 0) {
            return {
                ip: normalizedIp,
                reason: CLIENT_VIOLATION_BLOCK_REASON,
                ignored: true,
                blocked: false,
                protected: true,
                lockedUsers: []
            };
        }
    }

    if (isProtectedIp(normalizedIp)) {
        return {
            ip: normalizedIp,
            reason: CLIENT_VIOLATION_BLOCK_REASON,
            ignored: true,
            blocked: false,
            protected: true,
            lockedUsers: []
        };
    }

    const blockUntilMs = Date.now() + CLIENT_VIOLATION_BLOCK_MS;
    const safeReason = String(reason || 'client_violation').trim().slice(0, 80) || 'client_violation';
    const safeDetail = String(detail || '').trim().slice(0, 300);
    const safeUserAgent = String(userAgent || '').trim().slice(0, 200);

    const detailParts = [
        `source=${safeReason}`
    ];
    if (userId) detailParts.push(`user_id=${userId}`);
    if (email) detailParts.push(`email=${email}`);
    if (safeDetail) detailParts.push(`detail=${safeDetail}`);
    if (safeUserAgent) detailParts.push(`ua=${safeUserAgent}`);
    const blockDetail = detailParts.join('; ');

    const recentWarnings = await countRecentClientViolationWarnings(normalizedIp);
    if (recentWarnings < CLIENT_VIOLATION_WARNINGS_BEFORE_BLOCK) {
        await recordClientViolationWarning({
            ip: normalizedIp,
            userId,
            path: safeDetail,
            source: safeReason
        });

        logService.recordSecurity({
            action: 'client_violation_warning',
            ip: normalizedIp,
            reason: CLIENT_VIOLATION_BLOCK_REASON,
            detail: `${blockDetail}; warning=${recentWarnings + 1}/${CLIENT_VIOLATION_WARNINGS_BEFORE_BLOCK + 1}`
        });

        return {
            ip: normalizedIp,
            reason: CLIENT_VIOLATION_BLOCK_REASON,
            warning: true,
            blocked: false,
            warningsUsed: recentWarnings + 1,
            warningsBeforeBlock: CLIENT_VIOLATION_WARNINGS_BEFORE_BLOCK + 1
        };
    }

    await persistIpBlock(normalizedIp, CLIENT_VIOLATION_BLOCK_REASON, blockDetail, blockUntilMs);
    blockIpTemporarily(normalizedIp, CLIENT_VIOLATION_BLOCK_REASON, blockDetail, CLIENT_VIOLATION_BLOCK_MS);

    if (machineId && String(machineId).trim()) {
        try {
            const { blockMachineId } = require('../middleware/ipGuard');
            await blockMachineId(String(machineId).trim(), CLIENT_VIOLATION_BLOCK_REASON, blockDetail, CLIENT_VIOLATION_BLOCK_MS);
        } catch (err) {
            console.error('Failed to block machine ID:', err.message);
        }
    }

    await clearClientViolationWarnings(normalizedIp);

    logService.recordSecurity({
        action: 'client_violation_ip_lock',
        ip: normalizedIp,
        reason: CLIENT_VIOLATION_BLOCK_REASON,
        detail: blockDetail,
        blockUntil: new Date(blockUntilMs).toISOString()
    });

    return {
        ip: normalizedIp,
        reason: CLIENT_VIOLATION_BLOCK_REASON,
        blockUntil: new Date(blockUntilMs).toISOString(),
        lockedUsers: []
    };
}

module.exports = {
    MAX_ACCOUNTS_PER_IP,
    SHARED_IP_SECURITY_LOCK_REASON,
    assertRegistrationAllowed,
    clearSecurityLockForUser,
    countAccountsByIp,
    enforceClientViolation,
    trackUserLoginIp,
    unlockAccountsByIp
};
