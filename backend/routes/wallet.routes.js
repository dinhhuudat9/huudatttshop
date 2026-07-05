// ============================================
// WALLET ROUTES
// File: backend/routes/wallet.routes.js
// ============================================

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const walletController = require('../controllers/walletController');
const { featureGuard } = require('../middleware/featureGuard');

router.get('/balance', authenticate, async (req, res) => {
    res.json({
        success: true,
        data: { balance: req.user.balance }
    });
});

router.get('/transactions', authenticate, walletController.getTransactions.bind(walletController));
router.get('/deposit-requests', authenticate, walletController.getDepositRequests.bind(walletController));
router.post('/deposit-request', authenticate, featureGuard('deposit'), walletController.createDepositRequest.bind(walletController));
router.get('/purchases', authenticate, walletController.getPurchases.bind(walletController));
router.get('/lucky-spin', authenticate, walletController.getLuckySpinStatus.bind(walletController));
router.post('/lucky-spin/play', authenticate, featureGuard('spin'), walletController.playLuckySpin.bind(walletController));
router.post('/lucky-spin/free-link', authenticate, walletController.createLuckySpinBonusLink.bind(walletController));
router.post('/lucky-spin/free-link/reveal', authenticate, walletController.revealLuckySpinBonusCode.bind(walletController));
router.get('/daily-checkin', authenticate, walletController.getDailyCheckinStatus.bind(walletController));
router.post('/daily-checkin/claim', authenticate, featureGuard('checkin'), walletController.claimDailyCheckin.bind(walletController));

module.exports = router;
