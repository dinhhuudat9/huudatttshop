// ============================================
// DATABASE MIGRATION: UPDATE FOOTER LINKS SETTING
// File: backend/scripts/update-footer-links-setting.js
// ============================================

const db = require('../config/database');

async function migrate() {
    console.log('Starting migration to update footer links in system_settings...');
    try {
        const newValue = [
            'Trang chủ | /',
            'Bài đăng | /baidang',
            'Chính sách bảo mật | /privacy',
            'Điều khoản dịch vụ | /terms'
        ].join('\n');

        const [rows] = await db.execute('SELECT id FROM system_settings WHERE setting_key = "footer_links"');
        if (rows.length > 0) {
            await db.execute(
                'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = "footer_links"',
                [newValue]
            );
            console.log('Updated footer_links setting in database.');
        } else {
            await db.execute(
                'INSERT INTO system_settings (setting_key, setting_value, description) VALUES ("footer_links", ?, "Danh sách liên kết footer (mỗi dòng: text | link)")',
                [newValue]
            );
            console.log('Inserted footer_links setting in database.');
        }

        console.log('Footer links update completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
