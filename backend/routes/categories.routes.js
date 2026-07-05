// ============================================
// CATEGORY ROUTES
// File: backend/routes/categories.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

router.get('/', categoryController.getCategories.bind(categoryController));

module.exports = router;
