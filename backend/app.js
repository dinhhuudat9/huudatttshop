// ============================================
// EXPRESS APP (NO LISTEN)
// File: backend/app.js
// ============================================

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const logService = require('./services/logService');
const { ipGuard } = require('./middleware/ipGuard');
const humanGateService = require('./services/humanGateService');
const recaptchaService = require('./services/recaptchaService');
function isCronRequest(req) {
    const configuredSecret = String(process.env.CRON_JOB_SECRET || process.env.CRON_SECRET || '').trim();
    if (!configuredSecret) {
        return false;
    }
    const headerValue = String(req.headers['x-cron-secret'] || '').trim();
    const queryValue = String(req.query?.cron_secret || '').trim();
    const providedValue = headerValue || queryValue;
    return providedValue && providedValue === configuredSecret;
}

const { apiLimiter, isAdminIdentityRequest } = require('./middleware/apiRateLimit');
app.use('/api', async (req, res, next) => {
    try {
        if (isCronRequest(req) || await isAdminIdentityRequest(req)) {
            return next();
        }
    } catch (_) {
        // Fall through to limiter on inspection errors
    }

    return apiLimiter(req, res, next);
});

function parseTrustProxy(value) {
    if (value === undefined || value === null || value === '') {
        return false;
    }

    if (typeof value === 'number') {
        return value;
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (['true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
        return numeric;
    }

    return value;
}

const trustProxyOverride = process.env.TRUST_PROXY;
const defaultTrustProxy = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
app.set(
    'trust proxy',
    trustProxyOverride === undefined ? defaultTrustProxy : parseTrustProxy(trustProxyOverride)
);

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
    .map(s => s.trim())
    .filter(Boolean);
const DEFAULT_SUFFIXES = ['.workers.dev'];
const envSuffixes = (process.env.CORS_ORIGIN_SUFFIXES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
const allowedOrigins = [...DEFAULT_ALLOWED, ...envAllowed];

function normalizeOrigin(origin = '') {
    try {
        const parsed = new URL(origin);
        return `${parsed.protocol}//${parsed.host}`.toLowerCase();
    } catch (_) {
        return '';
    }
}

function getRequestOrigin(req) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0]
        .trim()
        .toLowerCase();

    if (!forwardedHost) {
        return '';
    }

    return `${forwardedProto}://${forwardedHost}`;
}

function isAllowedOrigin(req, origin = '') {
    if (!origin) {
        return true;
    }

    if (allowedOrigins.includes(origin)) {
        return true;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const requestOrigin = getRequestOrigin(req);
    if (normalizedOrigin && requestOrigin && normalizedOrigin === requestOrigin) {
        return true;
    }

    try {
        const hostname = new URL(origin).hostname.toLowerCase();
        return [...DEFAULT_SUFFIXES, ...envSuffixes].some(suffix => {
            const clean = suffix.replace(/^\./, '');
            return hostname === clean || hostname.endsWith(`.${clean}`);
        });
    } catch (_) {
        return false;
    }
}

// ANSI colors for pretty logs (no extra deps)
const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m'
};
const colorByStatus = (status) => {
    if (status >= 500) return COLORS.red;
    if (status >= 400) return COLORS.yellow;
    return COLORS.green;
};

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors((req, cb) => {
    const origin = String(req.headers.origin || '').trim();
    if (!origin || isAllowedOrigin(req, origin)) {
        return cb(null, {
            origin: true,
            credentials: true
        });
    }

    return cb(new Error(`Not allowed by CORS: ${origin}`), {
        origin: false,
        credentials: true
    });
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(ipGuard);

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; img-src 'self' * data: blob:; media-src 'self' * data: blob:; connect-src 'self' *; frame-src 'self' *;");
    next();
});

const { secondaryServerGuard } = require('./middleware/secondaryServerGuard');
app.use(secondaryServerGuard);

const apiCrypto = require('./utils/apiCrypto');

// API Traffic Encryption/Decryption Middleware
app.use((req, res, next) => {
    // 1. Decrypt request body if client encrypted it
    if (req.headers['x-encrypted-payload'] === '1' && req.body && req.body.data) {
        try {
            const decryptedString = apiCrypto.decrypt(req.body.data);
            if (decryptedString) {
                req.body = JSON.parse(decryptedString);
            }
        } catch (err) {
            console.error('Error decrypting request body:', err);
            return res.status(400).json({ success: false, message: 'Invalid encrypted payload' });
        }
    }

    // 2. Intercept response to encrypt outgoing JSON payloads
    if (req.headers['x-encrypted-payload'] === '1') {
        const originalJson = res.json;
        const originalSend = res.send;

        res.json = function (obj) {
            try {
                if (obj && obj.data && typeof obj.data === 'string' && obj.data.includes(':')) {
                    return originalJson.call(this, obj);
                }
                const plainText = JSON.stringify(obj);
                const encrypted = apiCrypto.encrypt(plainText);
                return originalJson.call(this, { data: encrypted });
            } catch (err) {
                console.error('Error encrypting JSON response:', err);
                return originalJson.call(this, obj);
            }
        };

        res.send = function (body) {
            try {
                if (typeof body === 'string') {
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed && parsed.data && typeof parsed.data === 'string' && parsed.data.includes(':')) {
                            return originalSend.call(this, body);
                        }
                    } catch (_) {}

                    const encrypted = apiCrypto.encrypt(body);
                    res.setHeader('Content-Type', 'application/json');
                    return originalSend.call(this, JSON.stringify({ data: encrypted }));
                } else if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
                    const plainText = JSON.stringify(body);
                    const encrypted = apiCrypto.encrypt(plainText);
                    res.setHeader('Content-Type', 'application/json');
                    return originalSend.call(this, JSON.stringify({ data: encrypted }));
                }
            } catch (err) {
                console.error('Error encrypting send response:', err);
            }
            return originalSend.call(this, body);
        };
    }

    next();
});

// Logging middleware (color + response time)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        const status = res.statusCode;
        const method = `${COLORS.cyan}${req.method.padEnd(6)}${COLORS.reset}`;
        const line = `${method} ${req.originalUrl} ${colorByStatus(status)}${status}${COLORS.reset} ${COLORS.dim}${ms}ms${COLORS.reset}`;
        console.log(line);
        logService.recordRequest({
            method: req.method,
            path: req.originalUrl,
            status,
            durationMs: ms,
            userId: req.user?.id || null,
            email: req.user?.email || null,
            ip: req.clientIp || req.ip || req.socket?.remoteAddress || ''
        });
    });
    next();
});

function isHumanGateExemptApiPath(pathname = '') {
    const value = String(pathname || '').trim();
    return (
        value === '/health' ||
        value.startsWith('/integration/') ||
        value === '/security/human-gate-config' ||
        value === '/security/human-gate-verify' ||
        value === '/security/block-status' ||
        value === '/support/unblock-request'
    );
}

app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS' || isHumanGateExemptApiPath(req.path) || isCronRequest(req)) {
        return next();
    }

    if (humanGateService.hasClearance(req) || !recaptchaService.isEnabled(req)) {
        return next();
    }

    return res.status(403).json({
        success: false,
        code: 'HUMAN_GATE_REQUIRED',
        message: 'Vui long xac nhan ban la nguoi that truoc khi vao website.'
    });
});

// ============================================
// API ROUTES
// ============================================
const authRoutes = require('./routes/auth.routes');
const productRoutes = require('./routes/products.routes');
const categoryRoutes = require('./routes/categories.routes');
const userRoutes = require('./routes/users.routes');
const walletRoutes = require('./routes/wallet.routes');
const postRoutes = require('./routes/posts.routes');
const messageRoutes = require('./routes/messages.routes');
const adminRoutes = require('./routes/admin.routes');
const uploadRoutes = require('./routes/uploads.routes');
const settingsRoutes = require('./routes/settings.routes');
const supportRoutes = require('./routes/support.routes');
const communityRoutes = require('./routes/community.routes');
const notificationRoutes = require('./routes/notifications.routes');
const integrationRoutes = require('./routes/integration.routes');
const aiRoutes = require('./routes/ai.routes');
const protectedAssetRoutes = require('./routes/protectedAssets.routes');
const securityRoutes = require('./routes/security.routes');
const missionRoutes = require('./routes/mission.routes');
const withdrawRoutes = require('./routes/withdraw.routes');

app.use('/api/auth', authRoutes);
app.use('/api/assets', protectedAssetRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/integration', integrationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/mission', missionRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/mxh', require('./routes/mxh'));
app.use('/api/tempmail', require('./routes/tempmail.routes'));
app.use('/api/cronjobs', require('./routes/cronjobs.routes'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

module.exports = app;
