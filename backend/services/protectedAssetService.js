const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.join(__dirname, '../../frontend');
const ASSET_SESSION_TTL_MS = parseInt(process.env.ASSET_SESSION_TTL_MS || '900000', 10);
const ASSET_COOKIE_NAME = 'asset_guard_sid';
const ASSET_SESSION_SECRET = String(
    process.env.ASSET_SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    'source-market-asset-session'
);
const PRIMARY_ADMIN_EMAIL = String(process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com').trim().toLowerCase();

function normalizeAssetPath(requestedPath = '') {
    const normalized = path.posix.normalize(`/${String(requestedPath || '').replace(/\\/g, '/').replace(/^\/+/, '')}`);
    if (normalized.includes('..')) {
        throw new Error('Invalid asset path');
    }
    return normalized;
}

function isAllowedAssetPath(assetPath) {
    return (
        (assetPath.startsWith('/pages/') && assetPath.endsWith('.html')) ||
        (assetPath.startsWith('/css/') && assetPath.endsWith('.css')) ||
        (assetPath.startsWith('/js/pages/') && assetPath.endsWith('.js'))
    );
}

function resolveAssetPath(assetPath) {
    const relativePath = assetPath.replace(/^\/+/, '');
    return path.join(FRONTEND_ROOT, ...relativePath.split('/'));
}

function ensureAssetAccess(assetPath, user = null) {
    const normalizedRole = String(user?.role || '').trim().toLowerCase();
    const isPrimaryAdmin = normalizedRole === 'admin'
        && String(user?.email || '').trim().toLowerCase() === PRIMARY_ADMIN_EMAIL;
    const protectedRoles = new Map([
        ['/pages/admin.html', ['primary_admin', 'admin']],
        ['/pages/dangban.html', ['admin', 'seller']],
        ['/pages/suasanpham.html', ['admin', 'seller']],
        ['/js/pages/admin.js', ['primary_admin', 'admin']]
    ]);

    const allowedRoles = protectedRoles.get(assetPath);
    if (!allowedRoles) {
        return;
    }

    if (!allowedRoles.includes(normalizedRole) && !(allowedRoles.includes('primary_admin') && isPrimaryAdmin)) {
        const error = new Error('Forbidden asset');
        error.statusCode = user ? 403 : 401;
        throw error;
    }
}

function minifyHtml(html = '') {
    return String(html || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .trim();
}

function minifyCss(css = '') {
    return String(css || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function normalizeJs(js = '') {
    return String(js || '').trim();
}

function encodeContent(content = '', assetKey = '') {
    const source = Buffer.from(String(content || ''), 'utf8');
    const key = Buffer.from(String(assetKey || ''), 'utf8');
    const encoded = Buffer.allocUnsafe(source.length);

    for (let index = 0; index < source.length; index += 1) {
        encoded[index] = source[index] ^ key[index % key.length];
    }

    return encoded.toString('base64');
}

function buildAssetPayload(assetPath, rawContent, assetKey) {
    const isHtml = assetPath.endsWith('.html');
    const isCss = assetPath.endsWith('.css');
    const content = isHtml ? minifyHtml(rawContent) : (isCss ? minifyCss(rawContent) : normalizeJs(rawContent));

    return {
        assetPath,
        mimeType: isHtml ? 'text/html' : (isCss ? 'text/css' : 'application/javascript'),
        payload: encodeContent(content, assetKey)
    };
}

function createSessionSignature(session) {
    return crypto
        .createHmac('sha256', ASSET_SESSION_SECRET)
        .update(JSON.stringify({
            sessionId: session.sessionId,
            assetKey: session.assetKey,
            expiresAt: session.expiresAt
        }))
        .digest('base64url');
}

function encodeSessionToken(session) {
    const payload = {
        sessionId: session.sessionId,
        assetKey: session.assetKey,
        expiresAt: session.expiresAt,
        signature: createSessionSignature(session)
    };

    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function safeCompare(left, right) {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeSessionToken(sessionToken = '') {
    const normalized = String(sessionToken || '').trim();
    if (!normalized) {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(normalized, 'base64url').toString('utf8'));
        const session = {
            sessionId: String(decoded.sessionId || '').trim(),
            assetKey: String(decoded.assetKey || '').trim(),
            expiresAt: Number(decoded.expiresAt || 0)
        };
        const signature = String(decoded.signature || '').trim();

        if (!session.sessionId || !session.assetKey || !Number.isFinite(session.expiresAt) || !signature) {
            return null;
        }

        const expectedSignature = createSessionSignature(session);
        if (!safeCompare(signature, expectedSignature)) {
            return null;
        }

        if (session.expiresAt <= Date.now()) {
            return null;
        }

        return session;
    } catch (_) {
        return null;
    }
}

function issueAssetSession() {
    const session = {
        sessionId: crypto.randomBytes(18).toString('hex'),
        assetKey: crypto.randomBytes(24).toString('base64url'),
        expiresAt: Date.now() + ASSET_SESSION_TTL_MS
    };

    return {
        sessionId: encodeSessionToken(session),
        assetKey: session.assetKey,
        expiresAt: session.expiresAt
    };
}

function getActiveAssetSession(sessionId = '') {
    return decodeSessionToken(sessionId);
}

function getProtectedAsset(requestedPath, sessionId, user = null) {
    const assetPath = normalizeAssetPath(requestedPath);
    if (!isAllowedAssetPath(assetPath)) {
        const error = new Error('Asset is not allowed');
        error.statusCode = 404;
        throw error;
    }

    const filesystemPath = resolveAssetPath(assetPath);
    if (!filesystemPath.startsWith(FRONTEND_ROOT)) {
        const error = new Error('Asset is not allowed');
        error.statusCode = 404;
        throw error;
    }

    if (!fs.existsSync(filesystemPath)) {
        const error = new Error('Asset not found');
        error.statusCode = 404;
        throw error;
    }

    ensureAssetAccess(assetPath, user);

    const session = getActiveAssetSession(sessionId);
    if (!session?.assetKey) {
        const error = new Error('Asset key is required');
        error.statusCode = 403;
        throw error;
    }

    const rawContent = fs.readFileSync(filesystemPath, 'utf8');
    return buildAssetPayload(assetPath, rawContent, session.assetKey);
}

module.exports = {
    ASSET_COOKIE_NAME,
    ASSET_SESSION_TTL_MS,
    getProtectedAsset,
    issueAssetSession
};
