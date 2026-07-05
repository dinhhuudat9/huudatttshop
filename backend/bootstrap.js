// ============================================
// BACKEND BOOTSTRAP
// Shared initialization for local server and serverless runtimes
// ============================================

const bcrypt = require('bcryptjs');
const db = require('./config/database');
const { initTelegramBot } = require('./services/telegramBackupService');
const walletService = require('./services/walletService');
const {
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
    ensureSecurityWhitelistTable
} = require('./utils/initDatabase');

let bootstrapPromise = null;
let telegramBotStarted = false;

async function createDefaultAdmin() {
    try {
        const primaryAdminEmail = process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com';
        const adminEmail = process.env.ADMIN_EMAIL || primaryAdminEmail;
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';

        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [adminEmail]
        );

        if (existing.length === 0) {
            const passwordHash = await bcrypt.hash(adminPassword, 10);
            await db.execute(
                'INSERT INTO users (email, password_hash, full_name, role, is_verified) VALUES (?, ?, ?, ?, ?)',
                [adminEmail, passwordHash, 'System Admin', 'admin', 1]
            );
            console.log('Default admin account created');
            console.log(`   Email: ${adminEmail}`);
            console.log(`   Password: ${adminPassword}`);
            return;
        }

        await db.execute(
            "UPDATE users SET role = 'admin', status = 'active', is_verified = 1 WHERE LOWER(email) = LOWER(?)",
            [adminEmail]
        );

        if (primaryAdminEmail && primaryAdminEmail !== adminEmail) {
            await db.execute(
                "UPDATE users SET role = 'admin', status = 'active', is_verified = 1 WHERE LOWER(email) = LOWER(?)",
                [primaryAdminEmail]
            );
        }
        console.log('Admin account already exists');
    } catch (error) {
        console.error('Error creating admin account:', error.message);
    }
}

async function runBootstrap() {
    const initResult = await ensureDatabase();
    if (initResult.created) {
        console.log(`Database initialized (${initResult.statements} statements applied)`);
    }

    await ensureUserFrameColumn();
    await ensureUserSecurityColumns();
    await ensureProductReviewsTable();
    await ensureNotificationColumns();
    await ensureSecurityTables();
    await ensureSecurityActionLogsTable();
    await ensureMxhTables();
    await ensureRegistrationOtpTable();
    await ensureGamificationTables();
    await ensureFinanceTables();
    await ensureCronTables();
    await ensureSecurityWhitelistTable();
    const { ensureSystemSettingsKeys } = require('./utils/initDatabase');
    await ensureSystemSettingsKeys();
    await createDefaultAdmin();

    // Load settings cache
    try {
        const [rows] = await db.execute('SELECT setting_key, setting_value FROM system_settings');
        global.systemSettingsCache = {};
        rows.forEach(row => {
            global.systemSettingsCache[row.setting_key] = row.setting_value;
        });
        console.log('System settings memory cache loaded successfully');
    } catch (err) {
        console.error('Failed to load system settings cache:', err);
    }

    return initResult;
}

const cronService = require('./services/cronService');

async function ensureBootstrapped(options = {}) {
    const { startTelegramBot = false } = options;

    if (!bootstrapPromise) {
        bootstrapPromise = runBootstrap().catch((error) => {
            bootstrapPromise = null;
            throw error;
        });
    }

    const result = await bootstrapPromise;

    if (startTelegramBot && !telegramBotStarted) {
        initTelegramBot();
        telegramBotStarted = true;
        walletService.startLuckySpinScheduler();
        cronService.startSchedulers();
    }

    return result;
}

module.exports = {
    ensureBootstrapped
};
