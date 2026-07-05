const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('./auth');
const { getAdminPortalPath } = require('../services/adminAccessService');
const PRIMARY_ADMIN_EMAIL = String(process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com').trim().toLowerCase();

function normalizePathname(pathname = '') {
    return `/${String(pathname || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`.replace(/\/$/, '') || '/';
}

function isProtectedAdminPath(pathname = '') {
    const normalized = normalizePathname(pathname);
    const adminPortalPath = normalizePathname(getAdminPortalPath());
    return normalized === '/admin' || normalized === adminPortalPath;
}

function readToken(req) {
    const authHeader = String(req.headers.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    return String(req.cookies?.token || '').trim();
}

async function isAuthenticatedAdminRequest(req) {
    const token = readToken(req);
    if (!token) {
        return false;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const [rows] = await db.execute(
            'SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1',
            [decoded.userId]
        );

        if (!rows.length) {
            return false;
        }

        const user = rows[0];
        return user.status === 'active' && user.role === 'admin';
    } catch (_) {
        return false;
    }
}

async function adminPortalGuard(req, res, next) {
    if (!['GET', 'HEAD'].includes(String(req.method || '').toUpperCase())) {
        return next();
    }

    if (!isProtectedAdminPath(req.path)) {
        return next();
    }

    const isAdmin = await isAuthenticatedAdminRequest(req);
    if (!isAdmin) {
        return res.status(404).send('Not found');
    }

    return next();
}

module.exports = {
    adminPortalGuard
};
