// ============================================
// CATEGORY CONTROLLER
// File: backend/controllers/categoryController.js
// ============================================

const categoryService = require('../services/categoryService');

class CategoryController {
    // GET /api/categories
    async getCategories(req, res) {
        try {
            const activeOnly = req.query.all !== 'true';
            const categories = await categoryService.getCategories({ activeOnly });

            res.json({
                success: true,
                data: categories
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
}

module.exports = new CategoryController();
