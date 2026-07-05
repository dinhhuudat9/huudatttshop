// ============================================
// PRODUCT ROUTES
// File: backend/routes/products.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');

// Public routes (with optional auth)
router.get('/', optionalAuth, productController.getProducts.bind(productController));
router.get('/:id', optionalAuth, productController.getProductById.bind(productController));
router.get('/:id/reviews', optionalAuth, productController.getProductReviews.bind(productController));

// Protected routes - Seller & Admin only
router.post('/', authenticate, authorize('seller', 'admin'), productController.createProduct.bind(productController));
router.put('/:id', authenticate, productController.updateProduct.bind(productController));
router.delete('/:id', authenticate, productController.deleteProduct.bind(productController));
router.delete('/:id/reviews/:reviewId', authenticate, productController.deleteProductReview.bind(productController));

// Purchase
router.post('/:id/purchase', authenticate, productController.purchaseProduct.bind(productController));
router.post('/:id/validate-coupon', authenticate, productController.validateCoupon.bind(productController));
router.post('/:id/reviews', authenticate, productController.upsertProductReview.bind(productController));
router.post('/:id/assistant-ai', optionalAuth, productController.askProductAssistant.bind(productController));

module.exports = router;
