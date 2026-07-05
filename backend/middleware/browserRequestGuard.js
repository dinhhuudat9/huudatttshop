const logService = require('../services/logService');
const geoIpPolicyService = require('../services/geoIpPolicyService');

const ENABLED = !['0', 'false', 'no', 'off'].includes(
    String(process.env.BROWSER_WRITE_GUARD_ENABLED || '1').trim().toLowerCase()
);
const REQUIRE_APP_HEADER = !['0', 'false', 'no', 'off'].includes(
    String(process.env.BROWSER_WRITE_GUARD_REQUIRE_HEADER || '1').trim().toLowerCase()
);

const SUSPICIOUS_USER_AGENT_PATTERN = /\b(python|python-requests|curl|wget|aiohttp|httpx|libwww|postmanruntime|insomnia|powershell|go-http-client|okhttp|java\/|axios|node-fetch|undici)\b/i;
const BROWSER_LIKE_USER_AGENT_PATTERN = /(mozilla\/|applewebkit\/|chrome\/|safari\/|firefox\/|edg\/|opr\/)/i;
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);
const DEFAULT_ALLOWED = [
    'http://localhost:3000',
    'http://localhost:4173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4173',
    'https://sangdev.onrender.com',
    'https://shopbanmanguon.duongthithuyhangkupee.workers.dev',
    'https://sangdev.duongthithuyhangkupee.workers.dev'
];
const envAllowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
const DEFAULT_SUFFIXES = ['.workers.dev'];
const envSuffixes = (process.env.CORS_ORIGIN_SUFFIXES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
const allowedOrigins = [...DEFAULT_ALLOWED, ...envAllowed].map((value) => value.toLowerCase());
const EXEMPT_PATH_PREFIXES = ['/integration/'];
const EXEMPT_PATHS = new Set([
    '/health',
    '/security/human-gate-config',
    '/security/human-gate-verify',
    '/security/client-violation',
    '/security/visitor-entry'
]);

function normalizeOrigin(value = '') {
    const input = String(value || '').trim();
    if (!input) {
        return '';
    }

    try {
        const parsed = new URL(input);
        return `${parsed.protocol}//${parsed.host}`.toLowerCase();
    } catch (_) {
        return '';
    }
}

function getRequestOrigin(req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0]
        .trim()
        .toLowerCase();

    if (!host) {
        return '';
    }

    return `${proto}://${host}`;
}

function readCallerOrigin(req) {
    const origin = normalizeOrigin(req.headers.origin || '');
    if (origin) {
        return {
            value: origin,
            source: 'origin'
        };
    }

    const referer = String(req.headers.referer || '').trim();
    const refererOrigin = normalizeOrigin(referer);
    if (refererOrigin) {
        return {
            value: refererOrigin,
            source: 'referer'
        };
    }

    return {
        value: '',
        source: ''
    };
}

function isAllowedOrigin(origin = '', requestOrigin = '') {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
        return false;
    }

    if (requestOrigin && normalizedOrigin === requestOrigin) {
        return true;
    }

    if (allowedOrigins.includes(normalizedOrigin)) {
        return true;
    }

    try {
        const hostname = new URL(normalizedOrigin).hostname.toLowerCase();
        return [...DEFAULT_SUFFIXES, ...envSuffixes].some((suffix) => {
            const clean = suffix.replace(/^\./, '');
            return hostname === clean || hostname.endsWith(`.${clean}`);
        });
    } catch (_) {
        return false;
    }
}

function isExemptPath(pathname = '') {
    const value = String(pathname || '').trim();
    if (!value) {
        return false;
    }

    if (EXEMPT_PATHS.has(value)) {
        return true;
    }

    return EXEMPT_PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function buildViolationReasons(req) {
    const reasons = [];
    const requestOrigin = getRequestOrigin(req);
    const callerOrigin = readCallerOrigin(req);
    const fetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
    const userAgent = String(req.headers['user-agent'] || '').trim();
    const appClient = String(req.headers['x-app-client'] || '').trim().toLowerCase();
    const requestedWith = String(req.headers['x-requested-with'] || '').trim().toLowerCase();

    if (!callerOrigin.value) {
        reasons.push('missing_origin');
    } else if (!isAllowedOrigin(callerOrigin.value, requestOrigin)) {
        reasons.push(`${callerOrigin.source}_mismatch`);
    }

    if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
        reasons.push(`fetch_site_${fetchSite}`);
    }

    if (!userAgent) {
        reasons.push('missing_user_agent');
    } else {
        if (SUSPICIOUS_USER_AGENT_PATTERN.test(userAgent)) {
            reasons.push('automation_user_agent');
        } else if (!BROWSER_LIKE_USER_AGENT_PATTERN.test(userAgent)) {
            reasons.push('non_browser_user_agent');
        }
    }

    if (REQUIRE_APP_HEADER && appClient !== 'web' && requestedWith !== 'xmlhttprequest') {
        reasons.push('missing_app_header');
    }

    return reasons;
}

async function browserRequestGuard(req, res, next) {
    if (!ENABLED) {
        return next();
    }

    const method = String(req.method || '').toUpperCase();
    if (method === 'OPTIONS' || isExemptPath(req.path)) {
        return next();
    }

    if (String(req.headers['x-api-key'] || '').trim()) {
        return next();
    }

    try {
        await geoIpPolicyService.assertVietnamAuthIpAllowed({
            ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
            action: 'api_request',
            req
        });
    } catch (error) {
        if (error.redirectToBlockedIp) {
            if (error.retryAfterSeconds) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }
            return res.status(403).json({
                success: false,
                code: 'FOREIGN_IP_BLOCKED',
                message: error.message
            });
        }
        return res.status(error.statusCode || 403).json({
            success: false,
            message: error.message
        });
    }

    const reasons = buildViolationReasons(req);
    if (!reasons.length) {
        return next();
    }

    logService.recordSecurity({
        action: 'browser_write_guard_block',
        ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
        reason: reasons.join('|'),
        detail: [
            `path=${req.originalUrl || req.path || ''}`,
            `origin=${String(req.headers.origin || '').trim() || 'none'}`,
            `referer=${String(req.headers.referer || '').trim() || 'none'}`,
            `sec_fetch_site=${String(req.headers['sec-fetch-site'] || '').trim() || 'none'}`,
            `x_app_client=${String(req.headers['x-app-client'] || '').trim() || 'none'}`,
            `user_agent=${String(req.headers['user-agent'] || '').trim() || 'none'}`
        ].join('; '),
        path: req.originalUrl || req.path || '',
        method
    });

    return res.status(403).json({
        success: false,
        code: 'BROWSER_REQUEST_BLOCKED',
        message: 'Yeu cau bi tu choi. Vui long thao tac truc tiep tren website.'
    });
}

module.exports = {
    browserRequestGuard
};
