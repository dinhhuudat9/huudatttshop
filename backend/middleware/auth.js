// ============================================
// AUTHENTICATION MIDDLEWARE
// File: backend/middleware/auth.js
// ============================================

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const PRIMARY_ADMIN_EMAIL = String(process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com').trim().toLowerCase();

function decorateUser(user = {}) {
    const primaryAdmin = String(user.email || '').trim().toLowerCase() === PRIMARY_ADMIN_EMAIL
        && String(user.role || '').trim().toLowerCase() === 'admin';
    return {
        ...user,
        is_primary_admin: primaryAdmin
    };
}

function getCronSecret(req) {
    const configuredSecret = String(process.env.CRON_JOB_SECRET || process.env.CRON_SECRET || '').trim();
    if (!configuredSecret) {
        return null;
    }

    const headerValue = String(req.headers['x-cron-secret'] || '').trim();
    const queryValue = String(req.query?.cron_secret || '').trim();
    const providedValue = headerValue || queryValue;

    return providedValue && providedValue === configuredSecret ? configuredSecret : null;
}

// Verify JWT token
async function authenticate(req, res, next) {
    try {
        if (getCronSecret(req)) {
            req.user = decorateUser({
                id: 0,
                email: 'cron@system',
                role: 'admin',
                status: 'active',
                balance: 0
            });
            return next();
        }

        const authHeader = req.headers.authorization;
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - No token provided'
            });
        }
        
        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Get user from database
        const [users] = await db.execute(
            'SELECT id, email, full_name, avatar, role, status, balance FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Check if user is banned
        if (user.status === 'banned') {
            const [whitelist] = await db.execute(
                'SELECT id FROM security_whitelist WHERE LOWER(email) = LOWER(?) OR ip = ? OR machine_id = ? LIMIT 1',
                [user.email, req.clientIp || '', req.headers?.['x-machine-id'] || '']
            );
            if (whitelist.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Account has been banned'
                });
            }
        }

        // Attach user to request
        req.user = decorateUser(user);
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }

        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed'
        });
    }
}

// Check role
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden - Insufficient permissions'
            });
        }

        next();
    };
}

// Optional authentication (không bắt buộc đăng nhập)
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return next();
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const [users] = await db.execute(
            'SELECT id, email, full_name, avatar, role, status, balance FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length > 0 && users[0].status === 'active') {
            req.user = decorateUser(users[0]);
        }

        next();
    } catch (error) {
        next();
    }
}

module.exports = { authenticate, authorize, optionalAuth, JWT_SECRET };
