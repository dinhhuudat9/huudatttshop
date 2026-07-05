// ============================================
// BASIC ROUTES PLACEHOLDERS
// Các file này sẽ được mở rộng theo nhu cầu
// ============================================

// File: backend/routes/users.routes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');

router.get('/search', userController.searchUsers.bind(userController));
router.get('/frames/list', userController.listFrames.bind(userController));
router.put('/me/frame', authenticate, userController.updateFrame.bind(userController));
router.get('/:id', userController.getProfile.bind(userController));

module.exports = router;
