const { isIP } = require('node:net');
const fetch = require('node-fetch');
const db = require('../config/database');
const logService = require('./logService');
const { blockIpTemporarily, isProtectedIp, normalizeIp } = require('../middleware/ipGuard');

const GEO_POLICY_ENABLED = !['0', 'false', 'no', 'off'].includes(
    String(
        process.env.AUTH_VN_ONLY_ENABLED || 
        (process.env.NODE_ENV === 'development' ? '0' : '1')
    ).trim().toLowerCase()
);
const GEO_FAIL_CLOSED = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.AUTH_GEO_FAIL_CLOSED || '0').trim().toLowerCase()
);
const GEO_LOOKUP_TIMEOUT_MS = Math.max(parseInt(process.env.AUTH_GEO_TIMEOUT_MS || '5000', 10), 1000);
const GEO_CACHE_MS = Math.max(parseInt(process.env.AUTH_GEO_CACHE_MS || '21600000', 10), 60000);
const FOREIGN_IP_BLOCK_MS = Math.max(parseInt(process.env.AUTH_FOREIGN_IP_BLOCK_MS || '900000', 10), 60000);
const ALLOWED_COUNTRY_CODES = new Set(
    String(process.env.AUTH_ALLOWED_COUNTRY_CODES || 'VN')
        .split(',')
        .map(value => String(value || '').trim().toUpperCase())
        .filter(Boolean)
);
const GEO_IP_BLOCK_REASON = 'foreign_country_ip_block';
const IPAPI_URL = 'https://ipapi.co';
const IPLOCATION_URL = 'https://api.iplocation.net';
const geoCache = new Map();

function createStatusError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function toSqliteDateTime(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function isPrivateIpv4(ip) {
    return (
        ip.startsWith('10.') ||
        ip.startsWith('127.') ||
        ip.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    );
}

function isLocalOrPrivateIp(ip = '') {
    const normalized = normalizeIp(ip);
    if (!normalized) {
        return true;
    }

    if (normalized === 'localhost' || normalized === '::1') {
        return true;
    }

    if (isIP(normalized) === 4) {
        return isPrivateIpv4(normalized);
    }

    if (isIP(normalized) === 6) {
        return normalized.startsWith('fc') || normalized.startsWith('fd');
    }

    return false;
}

function readCache(ip, now = Date.now()) {
    const cached = geoCache.get(ip);
    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= now) {
        geoCache.delete(ip);
        return null;
    }

    return cached.value;
}

function writeCache(ip, value, now = Date.now()) {
    geoCache.set(ip, {
        expiresAt: now + GEO_CACHE_MS,
        value
    });
    return value;
}

async function fetchJson(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        },
        timeout: GEO_LOOKUP_TIMEOUT_MS
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

async function lookupWithIpApi(ip) {
    const payload = await fetchJson(`${IPAPI_URL}/${encodeURIComponent(ip)}/json/`);
    const countryCode = String(payload?.country_code || '').trim().toUpperCase();

    if (!countryCode) {
        throw new Error(payload?.reason || payload?.error || 'ipapi lookup failed');
    }

    return {
        ip,
        countryCode,
        countryName: String(payload?.country_name || '').trim(),
        source: 'ipapi'
    };
}

async function lookupWithIpLocation(ip) {
    const payload = await fetchJson(`${IPLOCATION_URL}/?cmd=ip-country&ip=${encodeURIComponent(ip)}`);
    const countryCode = String(payload?.country_code2 || '').trim().toUpperCase();

    if (!countryCode) {
        throw new Error(payload?.response_message || 'iplocation lookup failed');
    }

    return {
        ip,
        countryCode,
        countryName: String(payload?.country_name || '').trim(),
        source: 'iplocation'
    };
}

async function lookupGeo(ip) {
    const normalizedIp = normalizeIp(ip);
    const cached = readCache(normalizedIp);
    if (cached) {
        return cached;
    }

    try {
        return writeCache(normalizedIp, await lookupWithIpApi(normalizedIp));
    } catch (ipapiError) {
        try {
            return writeCache(normalizedIp, await lookupWithIpLocation(normalizedIp));
        } catch (iplocationError) {
            const error = new Error('geo_lookup_failed');
            error.cause = {
                ipapi: ipapiError.message,
                iplocation: iplocationError.message
            };
            throw error;
        }
    }
}

async function persistIpBlock(ip, reason, detail, blockUntilMs) {
    if (isProtectedIp(ip)) {
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
        [ip, reason, detail || '', toSqliteDateTime(blockUntilMs)]
    );
}

function buildCountryMessage(geo) {
    const countryName = geo.countryName || geo.countryCode || 'Unknown';
    return `IP ngoai Viet Nam khong duoc phep dang ky hoac dang nhap (${countryName}).`;
}

async function blockForeignIp(ip, geo, action) {
    const normalizedIp = normalizeIp(ip);
    if (isProtectedIp(normalizedIp)) {
        return null;
    }

    const blockUntilMs = Date.now() + FOREIGN_IP_BLOCK_MS;
    const detail = [
        `action=${action || 'auth'}`,
        `country=${geo.countryCode || 'unknown'}`,
        `country_name=${geo.countryName || 'unknown'}`,
        `source=${geo.source || 'unknown'}`
    ].join('; ');

    await persistIpBlock(normalizedIp, GEO_IP_BLOCK_REASON, detail, blockUntilMs);
    blockIpTemporarily(normalizedIp, GEO_IP_BLOCK_REASON, detail, FOREIGN_IP_BLOCK_MS);

    logService.recordSecurity({
        action: 'foreign_ip_blocked',
        ip: normalizedIp,
        reason: GEO_IP_BLOCK_REASON,
        detail,
        blockUntil: new Date(blockUntilMs).toISOString()
    });

    const error = createStatusError(buildCountryMessage(geo), 403);
    error.retryAfterSeconds = Math.max(Math.ceil(FOREIGN_IP_BLOCK_MS / 1000), 1);
    error.redirectToBlockedIp = true;
    error.geo = geo;
    return error;
}

async function assertVietnamAuthIpAllowed({ ip, action = 'auth', req = null }) {
    if (!GEO_POLICY_ENABLED) {
        return;
    }

    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp || isLocalOrPrivateIp(normalizedIp) || isProtectedIp(normalizedIp)) {
        return;
    }

    if (req) {
        try {
            const { isRequestWhitelisted } = require('../middleware/ipGuard');
            if (await isRequestWhitelisted(req, normalizedIp)) {
                return;
            }
        } catch (_) {}
    } else {
        try {
            const [rows] = await db.execute(
                'SELECT id FROM security_whitelist WHERE ip = ? LIMIT 1',
                [normalizedIp]
            );
            if (rows.length > 0) {
                return;
            }
        } catch (_) {}
    }

    let geo = null;
    try {
        geo = await lookupGeo(normalizedIp);
    } catch (error) {
        const detail = error?.cause
            ? `ipapi=${error.cause.ipapi || 'unknown'}; iplocation=${error.cause.iplocation || 'unknown'}`
            : String(error.message || 'unknown');

        logService.recordSecurity({
            action: 'geo_lookup_failed',
            ip: normalizedIp,
            reason: 'geo_lookup_failed',
            detail
        });

        if (GEO_FAIL_CLOSED) {
            throw createStatusError('Khong the xac minh quoc gia IP luc nay. Vui long thu lai sau.', 503);
        }

        return;
    }

    if (ALLOWED_COUNTRY_CODES.has(geo.countryCode)) {
        return;
    }

    const error = await blockForeignIp(normalizedIp, geo, action);
    if (error) {
        throw error;
    }
}

module.exports = {
    assertVietnamAuthIpAllowed
};
