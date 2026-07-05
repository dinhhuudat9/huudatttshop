const db = require('../backend/config/database');

async function run() {
    try {
        console.log('Adding platform column to mxh_categories...');
        await db.execute('ALTER TABLE mxh_categories ADD COLUMN platform TEXT');
        console.log('Successfully added platform column.');
        
        // Update platforms based on slugs for existing ones
        const mapping = {
            'facebook': 'facebook',
            'tiktok': 'tiktok',
            'instagram': 'instagram',
            'youtube': 'youtube',
            'x': 'twitter',
            'email': 'other'
        };
        
        for (const [slug, platform] of Object.entries(mapping)) {
            await db.execute('UPDATE mxh_categories SET platform = ? WHERE slug = ?', [platform, slug]);
        }
        console.log('Updated existing platforms.');
        
        process.exit(0);
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log('Column already exists.');
            process.exit(0);
        }
        console.error('Error:', e);
        process.exit(1);
    }
}

run();
