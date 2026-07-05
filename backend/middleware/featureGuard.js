const db = require('../config/database');

/**
 * Middleware to check if a specific feature is locked by admin.
 * @param {string} featureKey - The key of the feature to check (e.g., 'deposit', 'spin').
 * @param {object} options - Guard behavior options.
 * @param {boolean} options.allowAdminBypass - Allow logged-in admins to bypass the lock.
 */
const featureGuard = (featureKey, options = {}) => {
    const allowAdminBypass = options.allowAdminBypass === true;

    return async (req, res, next) => {
        try {
            if (allowAdminBypass && req.user?.role === 'admin') {
                return next();
            }

            const settingKey = `feature_lock_${featureKey}`;
            const [rows] = await db.execute(
                'SELECT setting_value FROM system_settings WHERE setting_key = ?',
                [settingKey]
            );

            const isLocked = rows.length > 0 && (rows[0].setting_value === 'true' || rows[0].setting_value === '1');

            if (isLocked) {
                return res.status(503).json({
                    success: false,
                    code: 'FEATURE_LOCKED',
                    message: 'Tính năng này đang được bảo trì. Vui lòng quay lại sau!',
                    feature: featureKey
                });
            }

            next();
        } catch (error) {
            console.error(`Feature guard error (${featureKey}):`, error);
            // If DB error, we fail safe and allow access (or block if you prefer strict)
            next();
        }
    };
};

module.exports = { featureGuard };
