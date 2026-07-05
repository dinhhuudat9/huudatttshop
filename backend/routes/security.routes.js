const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { getIpBlockStatus, normalizeIp } = require('../middleware/ipGuard');
const anonymousVisitorService = require('../services/anonymousVisitorService');
const { enforceClientViolation } = require('../services/ipAccountSecurityService');
const recaptchaService = require('../services/recaptchaService');
const humanGateService = require('../services/humanGateService');

router.get('/human-gate-config', (req, res) => {
    return res.json({
        success: true,
        data: recaptchaService.getPublicConfig(req, { forceEnforce: true })
    });
});

router.post('/human-gate-verify', async (req, res) => {
    try {
        const clientIp = normalizeIp(
            req.clientIp ||
            req.ip ||
            req.socket?.remoteAddress ||
            ''
        );

        await recaptchaService.assertVerified({
    token:
        req.body?.recaptcha_token ||
        req.body?.['cf-turnstile-response'] ||
        req.body?.token,
    ip: clientIp,
    req,
    action: 'human_gate',
    forceEnforce: true
});

        const clearance = humanGateService.grantClearance(req, res);
        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            data: {
                expiresAt: clearance.expiresAt
            }
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message,
            code: error.code || undefined,
            data: error.data || undefined
        });
    }
});

router.get('/block-status', optionalAuth, async (req, res) => {
    try {
        const normalizedIp = normalizeIp(
            req.clientIp ||
            req.ip ||
            req.socket?.remoteAddress ||
            ''
        );

        if (!normalizedIp) {
            return res.status(400).json({ success: false, message: 'Invalid IP' });
        }

        const status = await getIpBlockStatus(normalizedIp);
        const { encodeIpToUnlockCode } = require('../utils/ipCodec');
        const clientMachineId = String(req.query.machine_id || '').trim();
        const unlockCode = encodeIpToUnlockCode(normalizedIp, clientMachineId);

        return res.json({
            success: true,
            data: {
                ...status,
                unlockCode,
                serverNowMs: Date.now()
            }
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/client-violation', optionalAuth, async (req, res) => {
    try {
        if (req.user?.role === 'admin') {
            return res.json({ success: true, data: { ignored: true } });
        }

        const normalizedIp = normalizeIp(
            req.clientIp ||
            req.ip ||
            req.socket?.remoteAddress ||
            ''
        );

        if (!normalizedIp) {
            return res.status(400).json({ success: false, message: 'Invalid IP' });
        }

        const result = await enforceClientViolation({
            ip: normalizedIp,
            reason: req.body?.reason || 'client_violation',
            detail: req.body?.detail || '',
            userId: req.user?.id || null,
            email: req.user?.email || '',
            userAgent: req.headers['user-agent'] || '',
            machineId: req.headers['x-machine-id'] || req.query?.machine_id || req.body?.machine_id || ''
        });

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/visitor-entry', optionalAuth, async (req, res) => {
    try {
        const result = await anonymousVisitorService.registerEntry(req, res);
        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
