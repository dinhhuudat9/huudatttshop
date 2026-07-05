const crypto = require('crypto');

const HUMAN_GATE_COOKIE_NAME = String(process.env.HUMAN_GATE_COOKIE_NAME || 'human_gate_clearance').trim() || 'human_gate_clearance';
const HUMAN_GATE_TTL_MS = parseInt(process.env.HUMAN_GATE_TTL_MS || '43200000', 10);
const HUMAN_GATE_BIND_USER_AGENT = !['0', 'false', 'no', 'off'].includes(
    String(process.env.HUMAN_GATE_BIND_USER_AGENT || '1').trim().toLowerCase()
);

function getSecret() {
    return String(process.env.HUMAN_GATE_SECRET || process.env.JWT_SECRET || 'human-gate-dev-secret').trim();
}

function hashUserAgent(req) {
    const userAgent = String(req?.headers?.['user-agent'] || '').trim();
    if (!userAgent || !HUMAN_GATE_BIND_USER_AGENT) {
        return '';
    }

    return crypto.createHash('sha256').update(userAgent).digest('base64url');
}

function getCookieOptions(req) {
    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();

    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: Boolean(req?.secure || forwardedProto === 'https'),
        path: '/',
        maxAge: Math.max(HUMAN_GATE_TTL_MS, 1000)
    };
}

function encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(payload) {
    try {
        return JSON.parse(Buffer.from(String(payload || ''), 'base64url').toString('utf8'));
    } catch (_) {
        return null;
    }
}

function signPayload(encodedPayload) {
    return crypto.createHmac('sha256', getSecret()).update(String(encodedPayload || '')).digest('base64url');
}

function buildClearanceToken(req) {
    const payload = {
        exp: Date.now() + Math.max(HUMAN_GATE_TTL_MS, 1000),
        ua: hashUserAgent(req)
    };
    const encodedPayload = encodePayload(payload);
    return {
        token: `${encodedPayload}.${signPayload(encodedPayload)}`,
        expiresAt: payload.exp
    };
}

function verifyClearanceToken(token, req) {
    const [encodedPayload, signature] = String(token || '').split('.');
    if (!encodedPayload || !signature) {
        return false;
    }

    const expectedSignature = signPayload(encodedPayload);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (providedBuffer.length !== expectedBuffer.length) {
        return false;
    }
    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        return false;
    }

    const payload = decodePayload(encodedPayload);
    if (!payload?.exp || Number(payload.exp) <= Date.now()) {
        return false;
    }

    if (HUMAN_GATE_BIND_USER_AGENT && payload.ua !== hashUserAgent(req)) {
        return false;
    }

    return true;
}

function hasClearance(req) {
    const token = req?.cookies?.[HUMAN_GATE_COOKIE_NAME] || '';
    return verifyClearanceToken(token, req);
}

function grantClearance(req, res) {
    const clearance = buildClearanceToken(req);
    res.cookie(HUMAN_GATE_COOKIE_NAME, clearance.token, getCookieOptions(req));
    return clearance;
}

module.exports = {
    HUMAN_GATE_COOKIE_NAME,
    hasClearance,
    grantClearance
};
