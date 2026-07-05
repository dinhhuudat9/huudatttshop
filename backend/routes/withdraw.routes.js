const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const withdrawController = require('../controllers/withdrawController');
const { featureGuard } = require('../middleware/featureGuard');

router.post('/request', authenticate, featureGuard('withdraw'), withdrawController.requestWithdraw);
router.get('/history', authenticate, withdrawController.getHistory);
router.get('/dashboard', authenticate, withdrawController.getDashboard);

// Admin routes
router.get('/admin/requests', authenticate, withdrawController.adminGetAllRequests);
router.post('/admin/approve/:id', authenticate, withdrawController.adminApprove);
router.post('/admin/reject/:id', authenticate, withdrawController.adminReject);

module.exports = router;
