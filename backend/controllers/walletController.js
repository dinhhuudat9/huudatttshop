// ============================================
// WALLET CONTROLLER
// File: backend/controllers/walletController.js
// ============================================

const walletService = require('../services/walletService');
const recaptchaService = require('../services/recaptchaService');

class WalletController {
    getRequestContext(req) {
        return {
            ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            origin: req.headers.origin || '',
            host: req.headers.host || '',
            forwardedHost: req.headers['x-forwarded-host'] || '',
            protocol: req.protocol || '',
            forwardedProto: req.headers['x-forwarded-proto'] || ''
        };
    }

    // GET /api/wallet/transactions
    async getTransactions(req, res) {
        try {
            const result = await walletService.getTransactions(req.user.id, req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/wallet/deposit-requests
    async getDepositRequests(req, res) {
        try {
            const rows = await walletService.getDepositRequests(req.user.id);
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/wallet/deposit-request
    async createDepositRequest(req, res) {
        try {
            await recaptchaService.assertVerified({
                token: req.body?.recaptcha_token,
                ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
                req,
                action: 'deposit_request_create'
            });
            const result = await walletService.createDepositRequest(req.user.id, req.body, req.user);
            res.status(201).json({ success: true, message: 'Deposit request created', data: result });
        } catch (error) {
            res.status(error.statusCode || 400).json({
                success: false,
                message: error.message,
                code: error.code || undefined,
                data: error.data || undefined
            });
        }
    }

    // GET /api/wallet/purchases
    async getPurchases(req, res) {
        try {
            const result = await walletService.getPurchases(req.user.id, req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/wallet/lucky-spin
    async getLuckySpinStatus(req, res) {
        try {
            const result = await walletService.getLuckySpinStatus(req.user.id);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/wallet/lucky-spin/play
    async playLuckySpin(req, res) {
        try {
            const result = await walletService.playLuckySpin(req.user.id, this.getRequestContext(req), req.body || {});
            res.json({ success: true, message: 'Lucky spin completed', data: result });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message,
                code: error.code || undefined,
                data: {
                    nextSpinAt: error.nextSpinAt || null
                }
            });
        }
    }

    // POST /api/wallet/lucky-spin/free-link
    async createLuckySpinBonusLink(req, res) {
        try {
            const result = await walletService.createLuckySpinBonusLink(req.user.id, this.getRequestContext(req));
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message,
                code: error.code || undefined
            });
        }
    }

    // POST /api/wallet/lucky-spin/free-link/reveal
    async revealLuckySpinBonusCode(req, res) {
        try {
            const result = await walletService.revealLuckySpinBonusCode(req.user.id, req.body?.token || '');
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message,
                code: error.code || undefined
            });
        }
    }

    // GET /api/wallet/daily-checkin
    async getDailyCheckinStatus(req, res) {
        try {
            const result = await walletService.getDailyCheckinStatus(req.user.id);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/wallet/daily-checkin/claim
    async claimDailyCheckin(req, res) {
        try {
            const result = await walletService.claimDailyCheckin(req.user.id, this.getRequestContext(req));
            res.json({ success: true, message: 'Daily check-in completed', data: result });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message,
                code: error.code || undefined,
                data: {
                    claimDate: error.claimDate || null
                }
            });
        }
    }
}

module.exports = new WalletController();
