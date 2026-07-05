// ============================================
// DATABASE CONNECTION (Turso / SQLite)
// File: backend/config/database.js
// ============================================

const { createClient } = require('@libsql/client');
require('dotenv').config();

const dbUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || undefined;

if (!dbUrl) {
    throw new Error(
        'Missing Turso database URL. Set TURSO_DATABASE_URL (or TURSO_URL) in environment.'
    );
}

const client = createClient({
    url: dbUrl,
    authToken,
    rowMode: 'object'
});

function isSelectResult(result) {
    return Array.isArray(result?.columns) && result.columns.length > 0;
}

function normalizeRows(rows = []) {
    return rows.map(row => ({ ...row }));
}

function buildResult(result) {
    return {
        insertId: result?.lastInsertRowid ? Number(result.lastInsertRowid) : undefined,
        affectedRows: Number(result?.rowsAffected || 0)
    };
}

async function execute(sql, params = []) {
    const result = await client.execute({ sql, args: params });
    if (isSelectResult(result)) {
        return [normalizeRows(result.rows || []), result];
    }
    return [buildResult(result), result];
}

async function getConnection() {
    if (typeof client.transaction !== 'function') {
        await execute('BEGIN');
        return {
            execute,
            beginTransaction: async () => {},
            commit: async () => {
                await execute('COMMIT');
            },
            rollback: async () => {
                await execute('ROLLBACK');
            },
            release: async () => {}
        };
    }

    const tx = await client.transaction();
    return {
        execute: async (sql, params = []) => {
            const result = await tx.execute({ sql, args: params });
            if (isSelectResult(result)) {
                return [normalizeRows(result.rows || []), result];
            }
            return [buildResult(result), result];
        },
        beginTransaction: async () => {},
        commit: async () => {
            await tx.commit();
        },
        rollback: async () => {
            await tx.rollback();
        },
        release: async () => {}
    };
}

// Optional startup probe. Keep this off by default so serverless runtimes
// do not perform a network call during module load.
if (String(process.env.DB_HEALTHCHECK_ON_STARTUP || '').trim() === '1') {
    execute('SELECT 1')
        .then(() => {
            console.log('Turso database connected successfully');
        })
        .catch(err => {
            console.error('Turso database connection probe failed:', err.message);
        });
}

module.exports = {
    execute,
    getConnection
};
