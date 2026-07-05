// ============================================
// SECONDARY SERVER GUARD MIDDLEWARE
// File: backend/middleware/secondaryServerGuard.js
// ============================================

const IS_SECONDARY_SERVER = String(process.env.IS_SECONDARY_SERVER || '').trim().toLowerCase() === 'true';
const MAIN_SERVER_URL = String(process.env.MAIN_SERVER_URL || 'https://sangdevshop.netlify.app').trim().replace(/\/+$/, '');

// Paths that are exempt from the write lock on the secondary server
const EXEMPT_PATHS = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/security/human-gate-verify',
    '/api/tempmail/session',
    '/api/tempmail/customize',
    '/api/tempmail/inbox',
    '/api/tempmail/delete',
    '/api/admin/diagnostics/run'
];

function isPathExempt(path) {
    const cleanPath = String(path || '').split('?')[0].replace(/\/$/, '');
    
    // Check direct match or wildcard prefix
    return EXEMPT_PATHS.some(exempt => {
        if (exempt.endsWith('*')) {
            const prefix = exempt.slice(0, -1);
            return cleanPath.startsWith(prefix);
        }
        return cleanPath === exempt;
    }) || cleanPath.startsWith('/api/tempmail/message');
}

/**
 * Middleware to intercept mutating requests if the server is acting as a secondary server
 */
function secondaryServerGuard(req, res, next) {
    // If not secondary server, pass through
    if (!IS_SECONDARY_SERVER) {
        return next();
    }

    // Allow all GET, HEAD, OPTIONS requests (Read-Only)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Check if the endpoint path is exempted (like login or captcha verification)
    if (isPathExempt(req.path)) {
        return next();
    }

    // Otherwise, block the mutating request and suggest the main server
    return res.status(403).json({
        success: false,
        code: 'SECONDARY_SERVER_RESTRICTED',
        message: `Đây là máy chủ phụ (Secondary Server) được cấu hình để giảm tải. Tính năng này đã bị khóa để bảo vệ dữ liệu. Vui lòng thực hiện thao tác này trên máy chủ chính tại: ${MAIN_SERVER_URL}`,
        main_server_url: MAIN_SERVER_URL
    });
}

module.exports = {
    secondaryServerGuard,
    IS_SECONDARY_SERVER,
    MAIN_SERVER_URL
};
