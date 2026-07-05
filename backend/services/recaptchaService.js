const { isIP } = require('node:net');
const fetch = require('node-fetch');
const logService = require('./logService');

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function getSiteKey() {
    // Prefer Turnstile if configured, fallback to reCAPTCHA for backward compatibility
    return String(process.env.TURNSTILE_SITE_KEY || process.env.RECAPTCHA_SITE_KEY || '').trim();
}

function getSecretKey() {
    // Accept both *_SECRET_KEY (backend) and *_SECRET (edge-style naming) for flexibility
    return String(process.env.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET || process.env.RECAPTCHA_SECRET_KEY || '').trim();
}

function isTurnstile() {
    return Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

function hasConfiguredKeys() {
    return Boolean(getSiteKey() && getSecretKey());
}

function isEnabled(req = null) {
    const cache = global.systemSettingsCache || {};
    const botCheckEnabled = cache['bot_check_enabled'] !== 'false' && cache['bot_check_enabled'] !== '0';
    if (!botCheckEnabled) {
        return false;
    }
    return hasConfiguredKeys() && !shouldBypassVerification(req);
}

function shouldEnforceLocal() {
    const value = String(process.env.RECAPTCHA_ENFORCE_LOCAL || '1').trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(value);
}

function shouldSendRemoteIp() {
    return String(process.env.RECAPTCHA_SEND_REMOTE_IP || '').trim() === '1';
}

function createStatusError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeHost(value = '') {
    const input = String(value || '').trim().toLowerCase();
    if (!input) {
        return '';
    }

    try {
        return new URL(input.includes('://') ? input : `http://${input}`).hostname.toLowerCase();
    } catch (_) {
        return input
            .replace(/^\[|\]$/g, '')
            .split(':')[0]
            .trim()
            .toLowerCase();
    }
}

function isPrivateIpv4(hostname) {
    return (
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
        hostname.startsWith('127.')
    );
}

function isLocalHostname(hostname = '') {
    const normalized = normalizeHost(hostname);
    if (!normalized) {
        return false;
    }

    if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.local')) {
        return true;
    }

    if (isIP(normalized) === 4) {
        return isPrivateIpv4(normalized);
    }

    if (isIP(normalized) === 6) {
        return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd');
    }

    return false;
}

function getRequestHostname(req) {
    if (!req) {
        return '';
    }

    const origin = String(req.headers?.origin || '').trim();
    if (origin) {
        try {
            return new URL(origin).hostname.toLowerCase();
        } catch (_) {
            // Ignore invalid Origin header and fall back to Host headers.
        }
    }

    const forwardedHost = String(req.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
    if (forwardedHost) {
        return normalizeHost(forwardedHost);
    }

    return normalizeHost(req.headers?.host || '');
}

function isLocalDevelopmentRequest(req) {
    const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
    if (nodeEnv === 'production' || !req) {
        return false;
    }

    if (isLocalHostname(getRequestHostname(req))) {
        return true;
    }

    const requestIp = String(req.clientIp || req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
    return isLocalHostname(requestIp);
}

function shouldBypassVerification(req, options = {}) {
    if (!hasConfiguredKeys()) {
        return options.forceEnforce !== true;
    }

    if (options.forceEnforce === true) {
        return false;
    }

    if (isLocalDevelopmentRequest(req) && !shouldEnforceLocal()) {
        return true;
    }

    return false;
}

function getPublicConfig(req, options = {}) {
    if (shouldBypassVerification(req, options)) {
        return {
            enabled: false,
            siteKey: ''
        };
    }

    return {
        enabled: true,
        siteKey: getSiteKey(),
        provider: isTurnstile() ? 'turnstile' : 'recaptcha'
    };
}

function buildFailure(errorCodes, provider = 'recaptcha') {
    const label = provider === 'turnstile' ? 'Turnstile' : 'reCAPTCHA';
    const error = createStatusError('', 400);
    error.code = 'captcha_verification_failed';
    error.data = { provider, errorCodes };

    if (errorCodes.includes('missing-input-secret') || errorCodes.includes('invalid-input-secret')) {
        error.message = `Cau hinh ${label} tren may chu khong hop le.`;
        error.statusCode = 500;
        error.code = 'captcha_secret_invalid';
        return error;
    }

    if (errorCodes.includes('missing-input-response')) {
        error.message = `Vui long xac nhan ${label}.`;
        return error;
    }

    if (errorCodes.includes('timeout-or-duplicate')) {
        error.message = `${label} da het han hoac da duoc su dung. Vui long xac nhan lai.`;
        return error;
    }

    if (errorCodes.includes('invalid-input-response')) {
        error.message = `Token ${label} khong hop le hoac key/domain dang khong khop.`;
        return error;
    }

    if (errorCodes.includes('bad-request')) {
        error.message = `Yeu cau xac minh ${label} khong hop le.`;
        return error;
    }

    const detail = errorCodes.length ? ` (${errorCodes.join(', ')})` : '';
    error.message = `Xac minh ${label} that bai${detail}.`;
    return error;
}

function logFailure({ action, ip, req, payload, errorCodes, provider }) {
    const detailParts = [
        `action=${action || 'unknown'}`,
        `request_host=${getRequestHostname(req) || 'unknown'}`,
        `${provider || 'recaptcha'}_host=${String(payload?.hostname || '').trim() || 'unknown'}`,
        `challenge_ts=${String(payload?.challenge_ts || '').trim() || 'unknown'}`,
        `errors=${errorCodes.length ? errorCodes.join('|') : 'none'}`
    ];

    logService.recordSecurity({
        action: 'recaptcha_failed',
        ip: String(ip || '').trim(),
        reason: errorCodes[0] || 'verification_failed',
        detail: detailParts.join('; ')
    });
}

async function assertVerified({ token, ip, req, action = 'unknown', forceEnforce = false }) {
    if (forceEnforce === true && !isEnabled()) {
        throw createStatusError('Captcha chua duoc cau hinh tren may chu.', 503);
    }

    if (shouldBypassVerification(req, { forceEnforce })) {
        return;
    }

    const captchaToken = String(token || '').trim();
    if (!captchaToken) {
        throw createStatusError('Vui long xac nhan reCAPTCHA.', 400);
    }

    const params = new URLSearchParams();
    params.set('secret', getSecretKey());
    params.set('response', captchaToken);

    const remoteIp = String(ip || '').trim();
    if (shouldSendRemoteIp() && remoteIp) {
        params.set('remoteip', remoteIp);
    }

    const useTurnstile = isTurnstile();

    let payload = null;
    try {
        const response = await fetch(useTurnstile ? TURNSTILE_VERIFY_URL : RECAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString(),
            timeout: 10000
        });

        payload = await response.json();
    } catch (_) {
        throw createStatusError('Khong the xac minh reCAPTCHA luc nay. Vui long thu lai.', 502);
    }

    if (payload?.success) {
        return;
    }

    const errorCodes = Array.isArray(payload?.['error-codes']) ? payload['error-codes'] : [];
    logFailure({
        action,
        ip: remoteIp,
        req,
        payload,
        errorCodes,
        provider: useTurnstile ? 'turnstile' : 'recaptcha'
    });

    throw buildFailure(errorCodes, useTurnstile ? 'turnstile' : 'recaptcha');
}

module.exports = {
    assertVerified,
    getPublicConfig,
    isEnabled
};
