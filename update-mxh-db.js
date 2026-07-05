const db = require('./backend/config/database');

async function run() {
    try {
        console.log('Creating mxh_categories table...');
        await db.execute(`
            CREATE TABLE IF NOT EXISTS mxh_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                icon TEXT,
                display_order INTEGER DEFAULT 0,
                color TEXT DEFAULT '#6366f1',
                platform TEXT,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Creating mxh_accounts table...');
        await db.execute(`
            CREATE TABLE IF NOT EXISTS mxh_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                seller_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                price REAL NOT NULL,
                description TEXT,
                images TEXT,
                credentials TEXT NOT NULL,
                buyer_id INTEGER,
                purchased_at DATETIME,
                status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'hidden')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Inserting seed data for mxh_categories...');
        await db.execute(`
            INSERT OR IGNORE INTO mxh_categories (name, slug, icon, display_order, color, platform, is_active) VALUES
            ('FB Via Cổ', 'fb-via-co', 'fab fa-facebook', 1, '#1877f2', 'facebook', 1),
            ('FB Clone', 'fb-clone', 'fab fa-facebook', 2, '#1877f2', 'facebook', 1),
            ('FB Checkpoint', 'fb-checkpoint', 'fab fa-facebook', 3, '#1877f2', 'facebook', 1),
            ('TikTok Clone', 'tiktok-clone', 'fab fa-tiktok', 1, '#010101', 'tiktok', 1),
            ('TikTok Via', 'tiktok-via', 'fab fa-tiktok', 2, '#010101', 'tiktok', 1),
            ('TikTok Verify', 'tiktok-verify', 'fab fa-tiktok', 3, '#010101', 'tiktok', 1),
            ('IG Via', 'ig-via', 'fab fa-instagram', 1, '#e1306c', 'instagram', 1),
            ('IG Clone', 'ig-clone', 'fab fa-instagram', 2, '#e1306c', 'instagram', 1),
            ('IG Checkpoint', 'ig-checkpoint', 'fab fa-instagram', 3, '#e1306c', 'instagram', 1),
            ('YouTube', 'youtube-account', 'fab fa-youtube', 1, '#ff0000', 'youtube', 1),
            ('X / Twitter', 'x-twitter', 'fab fa-x-twitter', 1, '#000000', 'twitter', 1),
            ('Zalo', 'zalo-account', 'fas fa-comment-dots', 1, '#0068ff', 'zalo', 1),
            ('Telegram', 'telegram-account', 'fab fa-telegram', 1, '#26a5e4', 'telegram', 1),
            ('Khác', 'other-account', 'fas fa-ellipsis', 1, '#64748b', 'other', 1)
        `);

        console.log('Database update completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

run();
