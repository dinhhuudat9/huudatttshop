const db = require('../config/database');
const notificationService = require('../services/notificationService');

const WITHDRAW_FEE_RATE = 0.10;
const MIN_WITHDRAW_AMOUNT = 100000;
const APP_TIMEZONE = 'Asia/Bangkok';
const PRIMARY_ADMIN_EMAIL = String(process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com').trim().toLowerCase();

function canWithdraw(role = '') {
    return ['admin', 'seller'].includes(String(role || '').toLowerCase());
}

function normalizeBankInfo(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value || {});
    return String(text || '').trim().slice(0, 1000);
}

function normalizeWithdrawBankPayload(input = {}) {
    if (typeof input === 'string') {
        const legacy = normalizeBankInfo(input);
        return {
            raw: legacy,
            bankName: '',
            accountNumber: '',
            accountName: '',
            qrImageUrl: '',
            note: ''
        };
    }

    const payload = input && typeof input === 'object' ? input : {};
    return {
        bankName: String(payload.bankName || payload.bank_name || '').trim().slice(0, 120),
        accountNumber: String(payload.accountNumber || payload.account_number || '').trim().slice(0, 80),
        accountName: String(payload.accountName || payload.account_name || '').trim().slice(0, 120),
        qrImageUrl: String(payload.qrImageUrl || payload.qr_image_url || '').trim().slice(0, 1000),
        note: String(payload.note || '').trim().slice(0, 240),
        raw: ''
    };
}

function serializeWithdrawBankInfo(input = {}) {
    const normalized = normalizeWithdrawBankPayload(input);

    if (normalized.raw) {
        return normalized.raw;
    }

    return JSON.stringify({
        bank_name: normalized.bankName,
        account_number: normalized.accountNumber,
        account_name: normalized.accountName,
        qr_image_url: normalized.qrImageUrl,
        note: normalized.note
    });
}

function isPrimaryAdmin(user = {}) {
    return String(user.email || '').trim().toLowerCase() === PRIMARY_ADMIN_EMAIL
        && String(user.role || '').trim().toLowerCase() === 'admin';
}

async function getPrimaryAdminUser() {
    const [rows] = await db.execute(
        `SELECT id, email, full_name
         FROM users
         WHERE LOWER(email) = LOWER(?) AND role = 'admin'
         LIMIT 1`,
        [PRIMARY_ADMIN_EMAIL]
    );
    return rows[0] || null;
}

function getDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const pick = (type) => parts.find(part => part.type === type)?.value;
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

class WithdrawController {
    async getDashboard(req, res) {
        try {
            if (!canWithdraw(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Chi admin va seller moi co dashboard thu nhap.' });
            }

            const [summaryRows] = await db.execute(
                `SELECT
                    COALESCE(SUM(CASE WHEN type = 'seller_sale_credit' THEN amount ELSE 0 END), 0) AS sales_income,
                    COALESCE(SUM(CASE WHEN type = 'withdraw_pending' THEN ABS(amount) ELSE 0 END), 0) AS withdrawn_pending,
                    COALESCE(SUM(CASE WHEN type = 'mission_reward' THEN amount ELSE 0 END), 0) AS mission_income,
                    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS total_out
                 FROM transactions
                 WHERE user_id = ?`,
                [req.user.id]
            );

            const [productRows] = await db.execute(
                `SELECT p.id, p.title, p.slug, p.price, p.status, p.purchase_count, p.view_count,
                        COALESCE(SUM(CASE WHEN t.type = 'seller_sale_credit' THEN t.amount ELSE 0 END), 0) AS income,
                        COUNT(CASE WHEN t.type = 'seller_sale_credit' THEN 1 END) AS paid_sales
                 FROM products p
                 LEFT JOIN transactions t ON t.reference_id = p.id AND t.user_id = p.seller_id
                 WHERE p.seller_id = ?
                 GROUP BY p.id
                 ORDER BY income DESC, p.purchase_count DESC, p.view_count DESC, p.created_at DESC
                 LIMIT 100`,
                [req.user.id]
            );

            const [withdrawRows] = await db.execute(
                `SELECT id, amount, fee, net_amount, status, expected_at, created_at, processed_at
                 FROM withdraw_requests
                 WHERE user_id = ?
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [req.user.id]
            );

            const [recentRows] = await db.execute(
                `SELECT id, type, amount, balance_before, balance_after, description, reference_id, created_at
                 FROM transactions
                 WHERE user_id = ?
                 ORDER BY created_at DESC
                 LIMIT 20`,
                [req.user.id]
            );

            const today = getDateKey();
            const [missionRows] = await db.execute(
                `SELECT is_used, used_at
                 FROM bypass_keys
                 WHERE user_id = ? AND mission_date = ?
                 LIMIT 1`,
                [req.user.id, today]
            );

            res.json({
                success: true,
                data: {
                    role: req.user.role,
                    balance: req.user.balance,
                    missionToday: {
                        date: today,
                        completed: Boolean(missionRows[0]?.is_used),
                        usedAt: missionRows[0]?.used_at || null
                    },
                    summary: summaryRows[0] || {},
                    products: productRows,
                    withdraws: withdrawRows,
                    recentTransactions: recentRows
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async requestWithdraw(req, res) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const userId = req.user.id;
            const amount = Number(req.body?.amount || 0);
            const bankPayload = req.body?.bankInfo || req.body?.bank_info || req.body || {};
            const normalizedBank = normalizeWithdrawBankPayload(bankPayload);
            const bankInfo = serializeWithdrawBankInfo(bankPayload);

            const [users] = await connection.execute(
                'SELECT id, role, balance FROM users WHERE id = ?',
                [userId]
            );
            if (users.length === 0) {
                throw new Error('User not found');
            }

            const user = users[0];
            if (!canWithdraw(user.role)) {
                const error = new Error('Chi admin va seller moi duoc rut tien.');
                error.statusCode = 403;
                throw error;
            }
            if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_AMOUNT) {
                const error = new Error('So tien rut toi thieu la 100.000d.');
                error.statusCode = 400;
                throw error;
            }
            if (
                !normalizedBank.raw &&
                (!normalizedBank.bankName || !normalizedBank.accountNumber || !normalizedBank.accountName || !normalizedBank.qrImageUrl)
            ) {
                const error = new Error('Vui long nhap day du ngan hang, so tai khoan, ten chu tai khoan va upload ma QR.');
                error.statusCode = 400;
                throw error;
            }

            const currentBalance = Number(user.balance || 0);
            if (currentBalance < amount) {
                const error = new Error('Số dư không đủ.');
                error.statusCode = 400;
                throw error;
            }

            const fee = Math.round(amount * WITHDRAW_FEE_RATE);
            const netAmount = amount - fee;
            const nextBalance = currentBalance - amount;

            await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [nextBalance, userId]
            );
            await connection.execute(
                `INSERT INTO transactions
                 (user_id, type, amount, balance_before, balance_after, description)
                 VALUES (?, 'withdraw_pending', ?, ?, ?, ?)`,
                [userId, -amount, currentBalance, nextBalance, `Yêu cầu rút tiền, phí 10%, thực nhận ${netAmount}đ`]
            );
            const [result] = await connection.execute(
                `INSERT INTO withdraw_requests
                 (user_id, amount, fee, net_amount, bank_info, status, expected_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', datetime('now', '+7 days'))`,
                [userId, amount, fee, netAmount, bankInfo]
            );

            await connection.commit();

            try {
                const primaryAdmin = await getPrimaryAdminUser();
                if (primaryAdmin?.id) {
                    await notificationService.createNotification({
                        title: 'Yêu cầu rút tiền mới',
                        content: `${req.user.full_name || req.user.email || `User #${userId}`} vừa tạo lệnh rút ${amount.toLocaleString('vi-VN')} đ.`,
                        target_user_id: primaryAdmin.id,
                        created_by: userId,
                        send_telegram: false
                    });
                }
            } catch (_) {
                // Ignore notification errors so withdraw flow still succeeds.
            }

            res.status(201).json({
                success: true,
                message: 'Đã gửi yêu cầu rút tiền. Thời gian xử lý dự kiến 5-7 ngày.',
                data: {
                    id: result.insertId,
                    deducted: amount,
                    fee,
                    netReceive: netAmount,
                    newBalance: nextBalance
                }
            });
        } catch (error) {
            await connection.rollback();
            res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Lỗi máy chủ khi rút tiền' });
        } finally {
            connection.release();
        }
    }

    async getHistory(req, res) {
        try {
            const [rows] = await db.execute(
                `SELECT id, amount, fee, net_amount, bank_info, status, admin_note, expected_at, created_at, processed_at
                 FROM withdraw_requests
                 WHERE user_id = ?
                 ORDER BY created_at DESC`,
                [req.user.id]
            );
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async adminGetAllRequests(req, res) {
        try {
            if (!isPrimaryAdmin(req.user)) {
                return res.status(403).json({ success: false, message: 'Chi admin chinh moi duoc quan ly lenh rut.' });
            }
            const [rows] = await db.execute(
                `SELECT w.*, u.email, u.full_name
                 FROM withdraw_requests w
                 JOIN users u ON u.id = w.user_id
                 ORDER BY w.created_at DESC`
            );
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async adminApprove(req, res) {
        try {
            if (!isPrimaryAdmin(req.user)) {
                return res.status(403).json({ success: false, message: 'Chỉ admin chính mới được duyệt lệnh rút.' });
            }
            const [requests] = await db.execute(
                `SELECT w.id, w.user_id, w.amount, w.net_amount, u.full_name, u.email
                 FROM withdraw_requests w
                 JOIN users u ON u.id = w.user_id
                 WHERE w.id = ? AND w.status = 'pending'
                 LIMIT 1`,
                [req.params.id]
            );
            const request = requests[0] || null;
            if (!request) {
                return res.status(400).json({ success: false, message: 'Yêu cầu không tồn tại hoặc đã xử lý.' });
            }
            const [result] = await db.execute(
                `UPDATE withdraw_requests
                 SET status = 'approved', admin_note = ?, approved_by = ?, processed_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'pending'`,
                [req.body?.adminNote || '', req.user.id, req.params.id]
            );
            if (!result.affectedRows) {
                return res.status(400).json({ success: false, message: 'Yêu cầu không tồn tại hoặc đã xử lý.' });
            }

            try {
                await notificationService.createNotification({
                    title: 'Rút tiền thành công',
                    content: `Lệnh rút ${Number(request.net_amount || request.amount || 0).toLocaleString('vi-VN')} đ đã được duyệt. Vui lòng kiểm tra lại tài khoản nhận tiền.`,
                    target_user_id: request.user_id,
                    created_by: req.user.id,
                    send_telegram: false
                });
            } catch (_) {
                // Ignore notification errors.
            }

            res.json({ success: true, message: 'Đã duyệt yêu cầu rút tiền.' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async adminReject(req, res) {
        const connection = await db.getConnection();
        try {
            if (!isPrimaryAdmin(req.user)) {
                return res.status(403).json({ success: false, message: 'Chỉ admin chính mới được từ chối lệnh rút.' });
            }
            await connection.beginTransaction();

            const [requests] = await connection.execute(
                'SELECT * FROM withdraw_requests WHERE id = ?',
                [req.params.id]
            );
            if (requests.length === 0 || requests[0].status !== 'pending') {
                const error = new Error('Yêu cầu không tồn tại hoặc đã xử lý.');
                error.statusCode = 400;
                throw error;
            }

            const request = requests[0];
            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [request.user_id]
            );
            if (users.length === 0) {
                throw new Error('User not found');
            }

            const before = Number(users[0].balance || 0);
            const after = before + Number(request.amount || 0);
            await connection.execute('UPDATE users SET balance = ? WHERE id = ?', [after, request.user_id]);
            await connection.execute(
                `INSERT INTO transactions
                 (user_id, type, amount, balance_before, balance_after, description, reference_id)
                 VALUES (?, 'withdraw_refund', ?, ?, ?, ?, ?)`,
                [request.user_id, request.amount, before, after, 'Hoàn tiền do từ chối lệnh rút', request.id]
            );
            await connection.execute(
                `UPDATE withdraw_requests
                 SET status = 'rejected', admin_note = ?, approved_by = ?, processed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [req.body?.adminNote || '', req.user.id, req.params.id]
            );

            await connection.commit();

            try {
                await notificationService.createNotification({
                    title: 'Lệnh rút tiền bị từ chối',
                    content: 'Yêu cầu rút tiền của bạn đã bị từ chối và số dư đã được hoàn lại. Vui lòng kiểm tra lại thông tin nhận tiền.',
                    target_user_id: request.user_id,
                    created_by: req.user.id,
                    send_telegram: false
                });
            } catch (_) {
                // Ignore notification errors.
            }

            res.json({ success: true, message: 'Đã từ chối và hoàn tiền.' });
        } catch (error) {
            await connection.rollback();
            res.status(error.statusCode || 500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    }
}

module.exports = new WithdrawController();
