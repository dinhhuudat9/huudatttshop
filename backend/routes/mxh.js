const express = require('express');
const router = express.Router();
const mxhController = require('../controllers/mxhController');
const mxhServiceController = require('../controllers/mxhServiceController');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');
const { featureGuard } = require('../middleware/featureGuard');

// Public routes
router.get('/stats', mxhController.getStats);
router.get('/categories', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhController.getCategories);
router.get('/accounts', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhController.getAccounts);
router.get('/accounts/:id', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhController.getAccountDetail);
router.get('/service-categories', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.getServiceCategories);
router.get('/services', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.getServicePackages);
router.get('/services/:id', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.getServicePackageDetail);
router.get('/service-items', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.getServiceItems);
router.get('/service-items/:id', optionalAuth, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.getServiceItemDetail);

// Protected routes (Admin & Seller)
router.post('/accounts', authenticate, featureGuard('mxh', { allowAdminBypass: true }), authorize('admin', 'seller'), mxhController.createAccount);
router.post('/service-orders', authenticate, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.createServiceOrder);

// Protected routes (Any logged in user)
router.post('/accounts/:id/purchase', authenticate, featureGuard('mxh', { allowAdminBypass: true }), mxhController.purchaseAccount);
router.get('/service-orders/me', authenticate, featureGuard('mxh', { allowAdminBypass: true }), mxhServiceController.getMyServiceOrders);

// Admin only routes
router.get('/service-orders', authenticate, authorize('admin'), mxhServiceController.adminGetServiceOrders);
router.post('/services', authenticate, authorize('admin'), mxhServiceController.adminCreateServicePackage);
router.put('/services/:id', authenticate, authorize('admin'), mxhServiceController.adminUpdateServicePackage);
router.delete('/services/:id', authenticate, authorize('admin'), mxhServiceController.adminDeleteServicePackage);
router.post('/service-items', authenticate, authorize('admin'), mxhServiceController.adminCreateServiceItem);
router.put('/service-items/:id', authenticate, authorize('admin'), mxhServiceController.adminUpdateServiceItem);
router.delete('/service-items/:id', authenticate, authorize('admin'), mxhServiceController.adminDeleteServiceItem);
router.post('/service-orders/:id/processing', authenticate, authorize('admin'), mxhServiceController.adminProcessServiceOrder);
router.post('/service-orders/:id/complete', authenticate, authorize('admin'), mxhServiceController.adminCompleteServiceOrder);
router.post('/service-orders/:id/cancel', authenticate, authorize('admin'), mxhServiceController.adminCancelServiceOrder);
router.post('/service-orders/:id/test', authenticate, authorize('admin'), mxhServiceController.adminTestServiceOrder);
router.post('/categories', authenticate, authorize('admin'), mxhController.adminCreateCategory);
router.put('/categories/:id', authenticate, authorize('admin'), mxhController.adminUpdateCategory);
router.delete('/categories/:id', authenticate, authorize('admin'), mxhController.adminDeleteCategory);

module.exports = router;
