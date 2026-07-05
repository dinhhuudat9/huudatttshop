const express = require('express');
const protectedAssetService = require('../services/protectedAssetService');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

function hasAjaxMarker(req) {
    return String(req.get('X-Requested-With') || '') === 'XMLHttpRequest';
}

router.get('/bootstrap', (req, res) => {
    try {
        if (!hasAjaxMarker(req)) {
            return res.status(404).json({
                success: false,
                message: 'Asset bootstrap not found'
            });
        }

        const session = protectedAssetService.issueAssetSession();
        res.cookie(protectedAssetService.ASSET_COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: protectedAssetService.ASSET_SESSION_TTL_MS
        });
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: {
                sessionId: session.sessionId,
                assetKey: session.assetKey,
                expiresAt: session.expiresAt
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/text', optionalAuth, (req, res) => {
    try {
        if (!hasAjaxMarker(req)) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        const sessionId = String(req.get('X-Asset-Session-Id') || req.cookies?.[protectedAssetService.ASSET_COOKIE_NAME] || '').trim();
        const asset = protectedAssetService.getProtectedAsset(req.query.path || '', sessionId, req.user || null);
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: asset
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
