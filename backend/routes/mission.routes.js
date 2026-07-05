const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const missionController = require('../controllers/missionController');
const { featureGuard } = require('../middleware/featureGuard');

router.post('/generate-link', authenticate, featureGuard('mission'), missionController.generateKey);
router.post('/claim', authenticate, featureGuard('mission'), missionController.claimReward);
router.get('/status', authenticate, missionController.getStatus);

module.exports = router;
