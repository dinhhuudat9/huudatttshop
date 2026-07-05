// ============================================
// AUTH ROUTES
// File: backend/routes/auth.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/apiRateLimit');

// Public routes
router.get('/recaptcha-config', authController.getRecaptchaConfig.bind(authController));
router.post('/register', authLimiter, authController.register.bind(authController));
router.post('/login', authLimiter, authController.login.bind(authController));

// Protected routes
router.get('/me', authenticate, authController.getCurrentUser.bind(authController));
router.put('/update-profile', authenticate, authController.updateProfile.bind(authController));
router.put('/change-password', authenticate, authController.changePassword.bind(authController));
router.post('/logout', authenticate, authController.logout.bind(authController));

module.exports = router;
