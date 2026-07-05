const db = require('../config/database');

async function migrate() {
    console.log('Starting migration for new features...');
    try {
        // 1. Create withdraw_requests
        await db.execute(`
            CREATE TABLE IF NOT EXISTS withdraw_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                fee REAL NOT NULL,
                bank_info TEXT,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                admin_note TEXT,
                approved_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed_at DATETIME
            );
        `);
        console.log('Created withdraw_requests table.');

        // 2. Create bypass_keys
        await db.execute(`
            CREATE TABLE IF NOT EXISTS bypass_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_string TEXT UNIQUE NOT NULL,
                is_used INTEGER DEFAULT 0,
                used_by INTEGER,
                used_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Created bypass_keys table.');

        // 3. Recreate users table to remove CHECK constraint on role
        await db.execute(`
            CREATE TABLE IF NOT EXISTS users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT,
                avatar TEXT,
                cover_image TEXT,
                frame_url TEXT,
                profile_music_url TEXT,
                profile_music_title TEXT,
                gender TEXT DEFAULT 'male',
                bio TEXT,
                contact_info TEXT,
                phone TEXT,
                balance REAL DEFAULT 0,
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'active',
                is_verified INTEGER DEFAULT 0,
                failed_login_count INTEGER DEFAULT 0,
                last_failed_login_at DATETIME,
                last_failed_login_ip TEXT,
                login_locked_until DATETIME,
                register_ip TEXT,
                last_login_ip TEXT,
                security_lock_reason TEXT,
                security_locked_ip TEXT,
                security_locked_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME
            );
        `);
        await db.execute(`INSERT OR IGNORE INTO users_new SELECT * FROM users;`);
        await db.execute(`DROP TABLE users;`);
        await db.execute(`ALTER TABLE users_new RENAME TO users;`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);`);
        console.log('Recreated users table.');

        // 4. Recreate transactions table to remove CHECK constraint on type
        await db.execute(`
            CREATE TABLE IF NOT EXISTS transactions_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                balance_before REAL NOT NULL,
                balance_after REAL NOT NULL,
                description TEXT,
                reference_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await db.execute(`INSERT OR IGNORE INTO transactions_new SELECT * FROM transactions;`);
        await db.execute(`DROP TABLE transactions;`);
        await db.execute(`ALTER TABLE transactions_new RENAME TO transactions;`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id);`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at);`);
        console.log('Recreated transactions table.');

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
