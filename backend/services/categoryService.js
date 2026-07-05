// ============================================
// CATEGORY SERVICE
// File: backend/services/categoryService.js
// ============================================

const db = require('../config/database');

class CategoryService {
    async getCategories({ activeOnly = true } = {}) {
        const conditions = [];
        const params = [];

        if (activeOnly) {
            conditions.push('is_active = TRUE');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [rows] = await db.execute(
            `SELECT id, name, slug, description, icon, parent_id, display_order, is_active, created_at
             FROM categories
             ${whereClause}
             ORDER BY display_order ASC, id ASC`,
            params
        );

        return rows;
    }
}

module.exports = new CategoryService();
