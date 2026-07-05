const express = require('express');
const router = express.Router();
const { askQuickAssistant } = require('../services/aiService');

// POST /api/ai/quick-chat
router.post('/quick-chat', async (req, res) => {
    try {
        const question = (req.body?.question || '').toString().trim();
        const data = await askQuickAssistant(question);
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message || 'AI chat failed'
        });
    }
});

module.exports = router;
