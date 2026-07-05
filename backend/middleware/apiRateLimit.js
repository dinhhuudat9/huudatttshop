// ============================================
// API RATE LIMITING MIDDLEWARE
// File: backend/middleware/apiRateLimit.js
// ============================================

const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('./auth');

function getRequestToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return String(req.cookies?.token || '');
}

async function isAdminIdentityRequest(req) {
  const path = String(req.path || req.originalUrl || '');

  if (path === '/api/auth/login') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return false;
    }

    const [rows] = await db.execute(
      `SELECT role
       FROM users
       WHERE LOWER(email) = LOWER(?)
       LIMIT 1`,
      [email]
    );

    return rows[0]?.role === 'admin';
  }

  const token = getRequestToken(req);
  if (!token) {
    return false;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await db.execute(
      `SELECT role, status
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [decoded.userId]
    );

    return rows[0]?.role === 'admin' && rows[0]?.status !== 'banned';
  } catch (_) {
    return false;
  }
}

// Basic limiter: max 300 requests per 5 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 300,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Only count successful responses (status < 400) to avoid penalizing attackers on error responses
  skipSuccessfulRequests: false
});

// Strict rate limit for auth endpoints (register, login): max 15 requests per 10 minutes per IP
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Bạn đã thực hiện quá nhiều yêu cầu xác thực. Vui lòng thử lại sau 10 phút.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: async (req) => {
    try {
      return await isAdminIdentityRequest(req);
    } catch (_) {
      return false;
    }
  }
});

module.exports = { apiLimiter, authLimiter, isAdminIdentityRequest };
