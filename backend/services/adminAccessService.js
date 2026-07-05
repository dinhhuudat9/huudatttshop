const crypto = require('crypto');

function normalizePath(input = '') {
    const value = `/${String(input || '').trim().replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
    return value === '/' ? '' : value;
}

function getDerivedPortalPath() {
    const seed = String(
        process.env.ADMIN_PORTAL_PATH_SECRET ||
        process.env.JWT_SECRET ||
        process.env.SESSION_SECRET ||
        'admin-portal-secret'
    );
    const digest = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20);
    return `/secure-${digest}`;
}

function getAdminPortalPath() {
    const configured = normalizePath(process.env.ADMIN_PORTAL_PATH || '');
    return configured || getDerivedPortalPath();
}

module.exports = {
    getAdminPortalPath
};
