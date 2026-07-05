// ============================================
// DATABASE INITIALIZER
// Reads database.sql and bootstrap schema when missing
// ============================================

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

function splitStatements(sql) {
    const statements = [];
    const buffer = [];

    sql.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('--')) return;
        buffer.push(line);
        if (trimmed.endsWith(';')) {
            statements.push(buffer.join('\n'));
            buffer.length = 0;
        }
    });

    return statements
        .map(s => s.trim())
        .filter(Boolean);
}

async function ensureDatabase() {
    // If the users table exists we assume the schema is already created.
    const [tables] = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    );
    if (tables.length > 0) {
        return { created: false };
    }

    const schemaPath = path.join(__dirname, '../../database.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = splitStatements(sql);

    let executed = 0;
    for (const statement of statements) {
        // Prevent duplicate seed rows when this runs more than once.
        const safeStmt = statement.replace(/^INSERT\s+INTO\s+/i, 'INSERT OR IGNORE INTO ');
        await db.execute(safeStmt);
        executed += 1;
    }

    return { created: true, statements: executed };
}

async function ensureUserFrameColumn() {
    const [columns] = await db.execute("PRAGMA table_info('users')");
    const hasFrame = columns.some(col => col.name === 'frame_url');
    if (!hasFrame) {
        await db.execute("ALTER TABLE users ADD COLUMN frame_url TEXT");
    }
    const hasCover = columns.some(col => col.name === 'cover_image');
    if (!hasCover) {
        await db.execute("ALTER TABLE users ADD COLUMN cover_image TEXT");
    }
}

async function ensureUserSecurityColumns() {
    const [columns] = await db.execute("PRAGMA table_info('users')");
    const hasIsVerified = columns.some(col => col.name === 'is_verified');
    const hasFailedLoginCount = columns.some(col => col.name === 'failed_login_count');
    const hasLastFailedLoginAt = columns.some(col => col.name === 'last_failed_login_at');
    const hasLastFailedLoginIp = columns.some(col => col.name === 'last_failed_login_ip');
    const hasLoginLockedUntil = columns.some(col => col.name === 'login_locked_until');
    const hasRegisterIp = columns.some(col => col.name === 'register_ip');
    const hasLastLoginIp = columns.some(col => col.name === 'last_login_ip');
    const hasSecurityLockReason = columns.some(col => col.name === 'security_lock_reason');
    const hasSecurityLockedIp = columns.some(col => col.name === 'security_locked_ip');
    const hasSecurityLockedAt = columns.some(col => col.name === 'security_locked_at');

    if (!hasIsVerified) {
        await db.execute('ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0');
    }
    if (!hasFailedLoginCount) {
        await db.execute('ALTER TABLE users ADD COLUMN failed_login_count INTEGER DEFAULT 0');
    }
    if (!hasLastFailedLoginAt) {
        await db.execute('ALTER TABLE users ADD COLUMN last_failed_login_at DATETIME');
    }
    if (!hasLastFailedLoginIp) {
        await db.execute('ALTER TABLE users ADD COLUMN last_failed_login_ip TEXT');
    }
    if (!hasLoginLockedUntil) {
        await db.execute('ALTER TABLE users ADD COLUMN login_locked_until DATETIME');
    }
    if (!hasRegisterIp) {
        await db.execute('ALTER TABLE users ADD COLUMN register_ip TEXT');
    }
    if (!hasLastLoginIp) {
        await db.execute('ALTER TABLE users ADD COLUMN last_login_ip TEXT');
    }
    if (!hasSecurityLockReason) {
        await db.execute('ALTER TABLE users ADD COLUMN security_lock_reason TEXT');
    }
    if (!hasSecurityLockedIp) {
        await db.execute('ALTER TABLE users ADD COLUMN security_locked_ip TEXT');
    }
    if (!hasSecurityLockedAt) {
        await db.execute('ALTER TABLE users ADD COLUMN security_locked_at DATETIME');
    }

    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_login_locked_until ON users (login_locked_until)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_register_ip ON users (register_ip)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_last_login_ip ON users (last_login_ip)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_security_locked_ip ON users (security_locked_ip)');
}

async function ensureProductReviewsTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS product_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews (user_id)');
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_reviews_unique ON product_reviews (product_id, user_id)');

    const [columns] = await db.execute("PRAGMA table_info('product_reviews')");
    const hasRating = columns.some(col => col.name === 'rating');
    const hasComment = columns.some(col => col.name === 'comment');
    const hasCreatedAt = columns.some(col => col.name === 'created_at');
    const hasUpdatedAt = columns.some(col => col.name === 'updated_at');

    if (!hasRating) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN rating INTEGER NOT NULL DEFAULT 5');
    }
    if (!hasComment) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN comment TEXT NOT NULL DEFAULT ""');
    }
    if (!hasCreatedAt) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN created_at DATETIME');
    }
    if (!hasUpdatedAt) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN updated_at DATETIME');
    }

    await db.execute('UPDATE product_reviews SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)');
    await db.execute('UPDATE product_reviews SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)');
}

async function ensureNotificationColumns() {
    const [columns] = await db.execute("PRAGMA table_info('notifications')");
    const hasImportant = columns.some(col => col.name === 'is_important');
    const hasDismissHours = columns.some(col => col.name === 'dismiss_hours');

    if (!hasImportant) {
        await db.execute('ALTER TABLE notifications ADD COLUMN is_important INTEGER DEFAULT 0');
    }
    if (!hasDismissHours) {
        await db.execute('ALTER TABLE notifications ADD COLUMN dismiss_hours INTEGER DEFAULT 2');
    }
}

async function ensureSecurityTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS security_ip_blocks (
            ip TEXT PRIMARY KEY,
            reason TEXT,
            detail TEXT,
            block_until DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_security_ip_blocks_until ON security_ip_blocks (block_until)');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS security_machine_blocks (
            machine_id TEXT PRIMARY KEY,
            reason TEXT,
            detail TEXT,
            block_until DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_security_machine_blocks_until ON security_machine_blocks (block_until)');
}

async function ensureSecurityActionLogsTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS security_action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            actor_user_id INTEGER,
            actor_ip TEXT,
            target_key TEXT,
            content_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_security_action_logs_user ON security_action_logs (action_type, actor_user_id, created_at)'
    );
    await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_security_action_logs_ip ON security_action_logs (action_type, actor_ip, created_at)'
    );
    await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_security_action_logs_hash ON security_action_logs (action_type, actor_user_id, content_hash, created_at)'
    );
}

async function ensureMxhTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS mxh_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            icon TEXT,
            color TEXT,
            platform TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'account',
            description TEXT,
            display_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const [categoryColumns] = await db.execute("PRAGMA table_info('mxh_categories')");
    const hasCategoryKind = categoryColumns.some(col => col.name === 'kind');
    const hasCategoryDescription = categoryColumns.some(col => col.name === 'description');
    const hasCategoryCreatedAt = categoryColumns.some(col => col.name === 'created_at');
    const hasCategoryUpdatedAt = categoryColumns.some(col => col.name === 'updated_at');

    if (!hasCategoryKind) {
        await db.execute("ALTER TABLE mxh_categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'account'");
    }
    if (!hasCategoryDescription) {
        await db.execute('ALTER TABLE mxh_categories ADD COLUMN description TEXT');
    }
    if (!hasCategoryUpdatedAt) {
        await db.execute('ALTER TABLE mxh_categories ADD COLUMN updated_at DATETIME');
    }

    if (hasCategoryCreatedAt) {
        await db.execute('UPDATE mxh_categories SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)');
    } else {
        await db.execute('UPDATE mxh_categories SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)');
    }

    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_categories_kind ON mxh_categories (kind, platform, display_order, id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_categories_platform ON mxh_categories (platform, display_order, id)');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS mxh_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            seller_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            description TEXT,
            images TEXT,
            credentials TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            buyer_id INTEGER,
            purchased_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_accounts_category ON mxh_accounts (category_id, status, created_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_accounts_seller ON mxh_accounts (seller_id, created_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_accounts_buyer ON mxh_accounts (buyer_id, purchased_at DESC)');

    // ============================================
    // TABLE: MXH_PURCHASE_HISTORY
    // Store snapshots of account details at purchase time
    // ============================================
    await db.execute(`
        CREATE TABLE IF NOT EXISTS mxh_purchase_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            buyer_id INTEGER NOT NULL,
            seller_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            price REAL NOT NULL,
            description TEXT,
            images TEXT,
            credentials TEXT NOT NULL,
            purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_purchase_history_buyer ON mxh_purchase_history (buyer_id, purchased_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_purchase_history_account ON mxh_purchase_history (account_id)');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS mxh_service_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            slug TEXT UNIQUE,
            description TEXT,
            price REAL NOT NULL DEFAULT 0,
            unit_label TEXT DEFAULT 'luong',
            quantity_min INTEGER NOT NULL DEFAULT 1,
            quantity_max INTEGER NOT NULL DEFAULT 1000,
            default_quantity INTEGER NOT NULL DEFAULT 100,
            link_label TEXT DEFAULT 'Link',
            note_label TEXT DEFAULT 'Ghi chu',
            form_hint TEXT,
            display_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_packages_category ON mxh_service_packages (category_id, display_order, id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_packages_active ON mxh_service_packages (is_active, display_order, id)');

    const [servicePackageColumns] = await db.execute("PRAGMA table_info('mxh_service_packages')");
    const servicePackageAdditions = [
        ['slug', 'TEXT'],
        ['description', 'TEXT'],
        ['unit_label', "TEXT DEFAULT 'luong'"],
        ['quantity_min', 'INTEGER NOT NULL DEFAULT 1'],
        ['quantity_max', 'INTEGER NOT NULL DEFAULT 1000'],
        ['default_quantity', 'INTEGER NOT NULL DEFAULT 100'],
        ['link_label', "TEXT DEFAULT 'Link'"],
        ['note_label', "TEXT DEFAULT 'Ghi chu'"],
        ['form_hint', 'TEXT'],
        ['updated_at', 'DATETIME']
    ];
    for (const [column, definition] of servicePackageAdditions) {
        if (!servicePackageColumns.some(col => col.name === column)) {
            await db.execute(`ALTER TABLE mxh_service_packages ADD COLUMN ${column} ${definition}`);
        }
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS mxh_service_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            package_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            slug TEXT,
            description TEXT,
            price REAL NOT NULL DEFAULT 0,
            unit_label TEXT DEFAULT 'luong',
            quantity_min INTEGER NOT NULL DEFAULT 1,
            quantity_max INTEGER NOT NULL DEFAULT 1000,
            default_quantity INTEGER NOT NULL DEFAULT 100,
            link_label TEXT DEFAULT 'Link',
            note_label TEXT DEFAULT 'Ghi chu',
            form_hint TEXT,
            display_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_items_package ON mxh_service_items (package_id, display_order, id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_items_active ON mxh_service_items (is_active, display_order, id)');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS mxh_service_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            service_item_id INTEGER,
            category_id INTEGER NOT NULL,
            platform TEXT NOT NULL,
            link TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_price REAL NOT NULL DEFAULT 0,
            total_price REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
            admin_note TEXT,
            user_note TEXT,
            test_message TEXT,
            last_tested_at DATETIME,
            processed_by INTEGER,
            processed_at DATETIME,
            completed_at DATETIME,
            cancelled_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_orders_user ON mxh_service_orders (user_id, created_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_orders_status ON mxh_service_orders (status, created_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_mxh_service_orders_service ON mxh_service_orders (service_id, created_at DESC)');

    const [serviceOrderColumns] = await db.execute("PRAGMA table_info('mxh_service_orders')");
    const serviceOrderAdditions = [
        ['admin_note', 'TEXT'],
        ['user_note', 'TEXT'],
        ['test_message', 'TEXT'],
        ['last_tested_at', 'DATETIME'],
        ['processed_by', 'INTEGER'],
        ['processed_at', 'DATETIME'],
        ['completed_at', 'DATETIME'],
        ['cancelled_at', 'DATETIME'],
        ['updated_at', 'DATETIME']
    ];
    for (const [column, definition] of serviceOrderAdditions) {
        if (!serviceOrderColumns.some(col => col.name === column)) {
            await db.execute(`ALTER TABLE mxh_service_orders ADD COLUMN ${column} ${definition}`);
        }
    }

    if (!serviceOrderColumns.some(col => col.name === 'service_item_id')) {
        await db.execute('ALTER TABLE mxh_service_orders ADD COLUMN service_item_id INTEGER');
    }
}

async function ensureRegistrationOtpTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS registration_otps (
            email TEXT PRIMARY KEY,
            otp_hash TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            gender TEXT DEFAULT 'male' CHECK (gender IN ('male', 'female', 'other')),
            request_ip TEXT,
            attempt_count INTEGER DEFAULT 0,
            resend_available_at DATETIME,
            expires_at DATETIME NOT NULL,
            bypass_code TEXT,
            raw_otp TEXT,
            last_sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_registration_otps_expires ON registration_otps (expires_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_registration_otps_resend ON registration_otps (resend_available_at)');

    const [otpColumns] = await db.execute("PRAGMA table_info('registration_otps')");
    if (!otpColumns.some(col => col.name === 'bypass_code')) {
        await db.execute("ALTER TABLE registration_otps ADD COLUMN bypass_code TEXT");
    }
    if (!otpColumns.some(col => col.name === 'raw_otp')) {
        await db.execute("ALTER TABLE registration_otps ADD COLUMN raw_otp TEXT");
    }
}

async function ensureGamificationTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS lucky_spin_state (
            user_id INTEGER PRIMARY KEY,
            last_spin_at TEXT,
            next_spin_at TEXT,
            last_spin_event_key TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS lucky_spin_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            reward_id TEXT,
            reward_label TEXT NOT NULL,
            reward_amount REAL DEFAULT 0,
            reward_snapshot TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_lucky_spin_attempts_user ON lucky_spin_attempts (user_id, created_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_lucky_spin_attempts_created ON lucky_spin_attempts (created_at DESC)');

    const [spinColumns] = await db.execute("PRAGMA table_info('lucky_spin_attempts')");
    const hasRewardSnapshot = spinColumns.some(col => col.name === 'reward_snapshot');
    const hasIpAddress = spinColumns.some(col => col.name === 'ip_address');
    const hasUserAgent = spinColumns.some(col => col.name === 'user_agent');
    const hasSpinSource = spinColumns.some(col => col.name === 'spin_source');
    const hasBonusCodeId = spinColumns.some(col => col.name === 'bonus_code_id');

    if (!hasRewardSnapshot) {
        await db.execute('ALTER TABLE lucky_spin_attempts ADD COLUMN reward_snapshot TEXT');
    }
    if (!hasIpAddress) {
        await db.execute('ALTER TABLE lucky_spin_attempts ADD COLUMN ip_address TEXT');
    }
    if (!hasUserAgent) {
        await db.execute('ALTER TABLE lucky_spin_attempts ADD COLUMN user_agent TEXT');
    }
    if (!hasSpinSource) {
        await db.execute("ALTER TABLE lucky_spin_attempts ADD COLUMN spin_source TEXT NOT NULL DEFAULT 'scheduled'");
    }
    if (!hasBonusCodeId) {
        await db.execute('ALTER TABLE lucky_spin_attempts ADD COLUMN bonus_code_id INTEGER');
    }

    const [spinStateColumns] = await db.execute("PRAGMA table_info('lucky_spin_state')");
    const hasLastSpinEventKey = spinStateColumns.some(col => col.name === 'last_spin_event_key');
    if (!hasLastSpinEventKey) {
        await db.execute('ALTER TABLE lucky_spin_state ADD COLUMN last_spin_event_key TEXT');
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS lucky_spin_week_schedule (
            week_key TEXT PRIMARY KEY,
            event_date TEXT NOT NULL,
            event_weekday INTEGER NOT NULL DEFAULT 1,
            source TEXT NOT NULL DEFAULT 'auto',
            announcement_sent_at TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_lucky_spin_week_schedule_event_date ON lucky_spin_week_schedule (event_date)');

    const [spinScheduleColumns] = await db.execute("PRAGMA table_info('lucky_spin_week_schedule')");
    const hasEventWeekday = spinScheduleColumns.some(col => col.name === 'event_weekday');
    const hasScheduleSource = spinScheduleColumns.some(col => col.name === 'source');
    const hasAnnouncementSentAt = spinScheduleColumns.some(col => col.name === 'announcement_sent_at');

    if (!hasEventWeekday) {
        await db.execute('ALTER TABLE lucky_spin_week_schedule ADD COLUMN event_weekday INTEGER NOT NULL DEFAULT 1');
    }
    if (!hasScheduleSource) {
        await db.execute("ALTER TABLE lucky_spin_week_schedule ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'");
    }
    if (!hasAnnouncementSentAt) {
        await db.execute('ALTER TABLE lucky_spin_week_schedule ADD COLUMN announcement_sent_at TEXT');
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS lucky_spin_bonus_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL UNIQUE,
            claim_token TEXT NOT NULL UNIQUE,
            short_url TEXT,
            destination_url TEXT,
            revealed_at TEXT,
            used_at TEXT,
            used_by_user_id INTEGER,
            expires_at TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_lucky_spin_bonus_codes_code ON lucky_spin_bonus_codes (code)');
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_lucky_spin_bonus_codes_token ON lucky_spin_bonus_codes (claim_token)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_lucky_spin_bonus_codes_user ON lucky_spin_bonus_codes (user_id, created_at DESC)');

    const [bonusCodeColumns] = await db.execute("PRAGMA table_info('lucky_spin_bonus_codes')");
    const hasShortUrl = bonusCodeColumns.some(col => col.name === 'short_url');
    const hasDestinationUrl = bonusCodeColumns.some(col => col.name === 'destination_url');
    const hasRevealedAt = bonusCodeColumns.some(col => col.name === 'revealed_at');
    const hasUsedAt = bonusCodeColumns.some(col => col.name === 'used_at');
    const hasUsedByUserId = bonusCodeColumns.some(col => col.name === 'used_by_user_id');
    const hasExpiresAt = bonusCodeColumns.some(col => col.name === 'expires_at');

    if (!hasShortUrl) {
        await db.execute('ALTER TABLE lucky_spin_bonus_codes ADD COLUMN short_url TEXT');
    }
    if (!hasDestinationUrl) {
        await db.execute('ALTER TABLE lucky_spin_bonus_codes ADD COLUMN destination_url TEXT');
    }
    if (!hasRevealedAt) {
        await db.execute('ALTER TABLE lucky_spin_bonus_codes ADD COLUMN revealed_at TEXT');
    }
    if (!hasUsedAt) {
        await db.execute('ALTER TABLE lucky_spin_bonus_codes ADD COLUMN used_at TEXT');
    }
    if (!hasUsedByUserId) {
        await db.execute('ALTER TABLE lucky_spin_bonus_codes ADD COLUMN used_by_user_id INTEGER');
    }
    if (!hasExpiresAt) {
        await db.execute('ALTER TABLE lucky_spin_bonus_codes ADD COLUMN expires_at TEXT');
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS daily_checkin_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            claim_date TEXT NOT NULL,
            reward_day INTEGER NOT NULL,
            consecutive_days INTEGER NOT NULL DEFAULT 1,
            reward_amount REAL DEFAULT 0,
            reward_label TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_checkin_claim_unique ON daily_checkin_claims (user_id, claim_date)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_daily_checkin_claims_user ON daily_checkin_claims (user_id, claim_date DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_daily_checkin_claims_created ON daily_checkin_claims (created_at DESC)');

    const [checkinColumns] = await db.execute("PRAGMA table_info('daily_checkin_claims')");
    const hasRewardDay = checkinColumns.some(col => col.name === 'reward_day');
    const hasConsecutiveDays = checkinColumns.some(col => col.name === 'consecutive_days');
    const hasRewardAmount = checkinColumns.some(col => col.name === 'reward_amount');
    const hasRewardLabel = checkinColumns.some(col => col.name === 'reward_label');
    const hasClaimIp = checkinColumns.some(col => col.name === 'ip_address');
    const hasClaimUserAgent = checkinColumns.some(col => col.name === 'user_agent');

    if (!hasRewardDay) {
        await db.execute('ALTER TABLE daily_checkin_claims ADD COLUMN reward_day INTEGER NOT NULL DEFAULT 1');
    }
    if (!hasConsecutiveDays) {
        await db.execute('ALTER TABLE daily_checkin_claims ADD COLUMN consecutive_days INTEGER NOT NULL DEFAULT 1');
    }
    if (!hasRewardAmount) {
        await db.execute('ALTER TABLE daily_checkin_claims ADD COLUMN reward_amount REAL DEFAULT 0');
    }
    if (!hasRewardLabel) {
        await db.execute('ALTER TABLE daily_checkin_claims ADD COLUMN reward_label TEXT');
    }
    if (!hasClaimIp) {
        await db.execute('ALTER TABLE daily_checkin_claims ADD COLUMN ip_address TEXT');
    }
    if (!hasClaimUserAgent) {
        await db.execute('ALTER TABLE daily_checkin_claims ADD COLUMN user_agent TEXT');
    }
}

async function ensureFinanceTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS withdraw_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            fee REAL NOT NULL DEFAULT 0,
            net_amount REAL NOT NULL DEFAULT 0,
            bank_info TEXT,
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
            admin_note TEXT,
            approved_by INTEGER,
            expected_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            processed_at DATETIME
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_withdraw_requests_user ON withdraw_requests (user_id, created_at DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status ON withdraw_requests (status, created_at DESC)');

    const [withdrawColumns] = await db.execute("PRAGMA table_info('withdraw_requests')");
    const hasNetAmount = withdrawColumns.some(col => col.name === 'net_amount');
    const hasExpectedAt = withdrawColumns.some(col => col.name === 'expected_at');
    if (!hasNetAmount) {
        await db.execute('ALTER TABLE withdraw_requests ADD COLUMN net_amount REAL NOT NULL DEFAULT 0');
    }
    if (!hasExpectedAt) {
        await db.execute("ALTER TABLE withdraw_requests ADD COLUMN expected_at DATETIME");
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS bypass_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_string TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            mission_date TEXT NOT NULL,
            is_used INTEGER DEFAULT 0,
            used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id, mission_date)
        )
    `);

    const [keyColumns] = await db.execute("PRAGMA table_info('bypass_keys')");
    const hasKeyUserId = keyColumns.some(col => col.name === 'user_id');
    const hasMissionDate = keyColumns.some(col => col.name === 'mission_date');
    const hasUsedBy = keyColumns.some(col => col.name === 'used_by');
    if (!hasKeyUserId) {
        await db.execute('ALTER TABLE bypass_keys ADD COLUMN user_id INTEGER');
        if (hasUsedBy) {
            await db.execute('UPDATE bypass_keys SET user_id = used_by WHERE user_id IS NULL');
        }
    }
    if (!hasMissionDate) {
        await db.execute("ALTER TABLE bypass_keys ADD COLUMN mission_date TEXT");
        await db.execute("UPDATE bypass_keys SET mission_date = date(created_at) WHERE mission_date IS NULL");
    }
    await db.execute('CREATE INDEX IF NOT EXISTS idx_bypass_keys_user ON bypass_keys (user_id, mission_date DESC)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_bypass_keys_key ON bypass_keys (key_string)');

    const [schemaRows] = await db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'"
    );
    const transactionSql = String(schemaRows[0]?.sql || '');
    if (/CHECK\s*\(\s*type\s+IN/i.test(transactionSql)) {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS transactions_unrestricted (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                balance_before REAL NOT NULL,
                balance_after REAL NOT NULL,
                description TEXT,
                reference_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.execute(`
            INSERT OR IGNORE INTO transactions_unrestricted
            (id, user_id, type, amount, balance_before, balance_after, description, reference_id, created_at)
            SELECT id, user_id, type, amount, balance_before, balance_after, description, reference_id, created_at
            FROM transactions
        `);
        await db.execute('DROP TABLE transactions');
        await db.execute('ALTER TABLE transactions_unrestricted RENAME TO transactions');
        await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id)');
        await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type)');
        await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at)');
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
            discount_value REAL NOT NULL,
            max_uses INTEGER DEFAULT NULL,
            used_count INTEGER DEFAULT 0,
            expires_at DATETIME DEFAULT NULL,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS coupon_usages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coupon_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            product_id INTEGER,
            used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (coupon_id, user_id)
        )
    `);
}

async function ensureCronTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS cron_execution_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT,
            duration_ms INTEGER,
            executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON cron_execution_logs (job_name)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_cron_logs_executed ON cron_execution_logs (executed_at DESC)');
}

async function ensureSystemSettingsKeys() {
    const keysToCheck = [
        { key: 'cron_job_token', val: '', desc: 'API Token của cron-job.org' },
        { key: 'ip_check_enabled', val: '1', desc: 'Bat/tat kiem tra IP bảo mật (1=Bật, 0=Tắt)' },
        { key: 'bot_check_enabled', val: '1', desc: 'Bat/tat kiem tra Bot human-check (1=Bật, 0=Tắt)' }
    ];
    
    for (const item of keysToCheck) {
        const [rows] = await db.execute(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [item.key]
        );
        if (rows.length === 0) {
            await db.execute(
                'INSERT INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
                [item.key, item.val, item.desc]
            );
            console.log(`Bootstrapped missing system setting: ${item.key}`);
        }
    }
}

async function ensureSecurityWhitelistTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS security_whitelist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT,
            machine_id TEXT,
            email TEXT,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_security_whitelist_machine_id ON security_whitelist (machine_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_security_whitelist_ip ON security_whitelist (ip)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_security_whitelist_email ON security_whitelist (email)');
}

module.exports = {
    ensureDatabase,
    ensureUserFrameColumn,
    ensureUserSecurityColumns,
    ensureProductReviewsTable,
    ensureNotificationColumns,
    ensureSecurityTables,
    ensureSecurityActionLogsTable,
    ensureMxhTables,
    ensureRegistrationOtpTable,
    ensureGamificationTables,
    ensureFinanceTables,
    ensureCronTables,
    ensureSystemSettingsKeys,
    ensureSecurityWhitelistTable
};
