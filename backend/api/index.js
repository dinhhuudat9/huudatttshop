// Vercel Serverless Function entry
const app = require('../app');
const { ensureBootstrapped } = require('../bootstrap');

module.exports = async (req, res) => {
    try {
        await ensureBootstrapped();
        return app(req, res);
    } catch (error) {
        console.error('Bootstrap error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server bootstrap failed'
        });
    }
};
