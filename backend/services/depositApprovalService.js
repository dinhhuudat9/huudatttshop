const db = require('../config/database');

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function getRequestById(connection, requestId) {
    const [rows] = await connection.execute(
        'SELECT * FROM deposit_requests WHERE id = ? LIMIT 1',
        [requestId]
    );

    if (!rows.length) {
        throw createError('Deposit request not found', 404);
    }

    return rows[0];
}

async function processDepositApproval(requestId, {
    approve = true,
    adminNote = null,
    approvedBy = null
} = {}) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const request = await getRequestById(connection, requestId);
        const newStatus = approve ? 'approved' : 'rejected';

        console.log(`[DEBUG] Deposit Approval: Processing request ${requestId}. Current status: ${request.status}, New status: ${newStatus}`);
        console.log(`[DEBUG] Deposit Approval: Request details: `, request);

        const [updateResult] = await connection.execute(
            `UPDATE deposit_requests
             SET status = ?, admin_note = ?, approved_by = COALESCE(?, approved_by), processed_at = datetime('now')
             WHERE id = ? AND status = 'pending'`,
            [newStatus, adminNote || null, approvedBy || null, requestId]
        );

        if (updateResult.affectedRows === 0) {
            throw createError('Request already processed', 409);
        }

        if (approve) {
            const amount = parseFloat(request.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw createError('Invalid deposit amount');
            }

            const [existingTransactions] = await connection.execute(
                `SELECT id
                 FROM transactions
                 WHERE type = 'deposit' AND reference_id = ? AND description = 'Deposit approved'
                 LIMIT 1`,
                [requestId]
            );

            if (existingTransactions.length) {
                throw createError('Deposit already credited', 409);
            }

            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ? LIMIT 1',
                [request.user_id]
            );

            if (!users.length) {
                throw createError('User not found', 404);
            }

            const before = parseFloat(users[0].balance || 0);
            const after = before + amount;

            const [balanceUpdate] = await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [after, request.user_id]
            );

            if (balanceUpdate.affectedRows === 0) {
                throw createError('Failed to update user balance');
            }

            await connection.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id)
                 VALUES (?, 'deposit', ?, ?, ?, ?, ?)`,
                [request.user_id, amount, before, after, 'Deposit approved', requestId]
            );

            request.balance_before = before;
            request.balance_after = after;
        }

        await connection.commit();

        return {
            request: {
                ...request,
                status: newStatus,
                admin_note: adminNote || null,
                approved_by: approvedBy || request.approved_by || null
            },
            status: newStatus
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.release();
    }
}

module.exports = {
    processDepositApproval
};
