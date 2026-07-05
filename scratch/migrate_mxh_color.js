const db = require('../backend/config/database');

async function run() {
    try {
        console.log('Adding color column to mxh_categories...');
        await db.execute('ALTER TABLE mxh_categories ADD COLUMN color TEXT DEFAULT "#6366f1"');
        console.log('Successfully added color column.');
        
        // Update default colors for seeded categories
        const colors = {
            'facebook': '#1877f2',
            'tiktok': '#010101',
            'instagram': '#e1306c',
            'youtube': '#ff0000',
            'x': '#000000',
            'email': '#64748b'
        };
        
        for (const [slug, color] of Object.entries(colors)) {
            await db.execute('UPDATE mxh_categories SET color = ? WHERE slug = ?', [color, slug]);
        }
        console.log('Updated seed colors.');
        
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
