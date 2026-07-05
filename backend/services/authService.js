// ============================================
// AUTHENTICATION SERVICE
// File: backend/services/authService.js
// ============================================

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');
const loginProtectionService = require('./loginProtectionService');
const ipAccountSecurityService = require('./ipAccountSecurityService');
const emailDeliveryService = require('./emailDeliveryService');

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const parsedRegistrationCooldownMs = Number.parseInt(process.env.REGISTRATION_COOLDOWN_MS || '30000', 10);
const REGISTRATION_COOLDOWN_MS = Number.isFinite(parsedRegistrationCooldownMs)
    ? Math.max(parsedRegistrationCooldownMs, 0)
    : 30000;
const REGISTRATION_COOLDOWN_SECONDS = Math.ceil(REGISTRATION_COOLDOWN_MS / 1000);
const REGISTRATION_COOLDOWN_SETTING_KEY = 'internal_registration_next_allowed_at';
const REGISTRATION_COOLDOWN_SETTING_DESCRIPTION = 'Internal security setting for global registration cooldown';
const parsedOtpExpiresMs = Number.parseInt(process.env.REGISTRATION_OTP_EXPIRES_MS || '600000', 10);
const REGISTRATION_OTP_EXPIRES_MS = Number.isFinite(parsedOtpExpiresMs)
    ? Math.max(parsedOtpExpiresMs, 60000)
    : 600000;
const parsedOtpResendMs = Number.parseInt(process.env.REGISTRATION_OTP_RESEND_MS || '60000', 10);
const REGISTRATION_OTP_RESEND_MS = Number.isFinite(parsedOtpResendMs)
    ? Math.max(parsedOtpResendMs, 10000)
    : 60000;
const parsedOtpLength = Number.parseInt(process.env.REGISTRATION_OTP_LENGTH || '6', 10);
const REGISTRATION_OTP_LENGTH = Number.isFinite(parsedOtpLength)
    ? Math.min(Math.max(parsedOtpLength, 4), 8)
    : 6;
const parsedOtpMaxAttempts = Number.parseInt(process.env.REGISTRATION_OTP_MAX_ATTEMPTS || '5', 10);
const REGISTRATION_OTP_MAX_ATTEMPTS = Number.isFinite(parsedOtpMaxAttempts)
    ? Math.max(parsedOtpMaxAttempts, 1)
    : 5;
const REGISTRATION_OTP_SECRET = process.env.REGISTRATION_OTP_SECRET || JWT_SECRET;

function normalizeEmail(value = '') {
    return String(value || '').trim().toLowerCase();
}

function parseDbDateTime(value) {
    if (!value) return 0;
    const text = String(value).trim();
    if (!text) return 0;

    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const parsed = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function toSqliteDateTime(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function getRetryAfterSeconds(untilMs, now = Date.now()) {
    return Math.max(Math.ceil((untilMs - now) / 1000), 1);
}

function buildRegistrationCooldownMessage(untilMs) {
    const retryAfterSeconds = getRetryAfterSeconds(untilMs);
    return `He thong vua co tai khoan moi dang ky. Vui long thu lai sau ${retryAfterSeconds} giay.`;
}

function buildOtpResendMessage(untilMs) {
    const retryAfterSeconds = getRetryAfterSeconds(untilMs);
    return `Ma OTP vua duoc gui. Vui long thu lai sau ${retryAfterSeconds} giay.`;
}

function normalizeGender(value) {
    return ['male', 'female', 'other'].includes(value) ? value : 'male';
}

function sanitizeFullName(value) {
    const text = String(value || '').trim();
    return text || null;
}

function sanitizeOtpCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, REGISTRATION_OTP_LENGTH);
}

function hashRegistrationOtp(email, otpCode) {
    return crypto
        .createHash('sha256')
        .update(`${normalizeEmail(email)}:${sanitizeOtpCode(otpCode)}:${REGISTRATION_OTP_SECRET}`)
        .digest('hex');
}

function generateRegistrationOtp() {
    let otp = '';
    for (let index = 0; index < REGISTRATION_OTP_LENGTH; index += 1) {
        otp += String(crypto.randomInt(0, 10));
    }
    return otp;
}

async function cleanupExpiredRegistrationOtps(connection = db) {
    await connection.execute(
        'DELETE FROM registration_otps WHERE expires_at <= CURRENT_TIMESTAMP'
    );
}

async function getPendingRegistration(connection, email) {
    const [rows] = await connection.execute(
        `SELECT email, otp_hash, password_hash, full_name, gender, request_ip,
                attempt_count, resend_available_at, expires_at
         FROM registration_otps
         WHERE LOWER(email) = LOWER(?)
         LIMIT 1`,
        [normalizeEmail(email)]
    );

    return rows[0] || null;
}

async function claimRegistrationSlot(connection) {
    if (REGISTRATION_COOLDOWN_MS <= 0) {
        return;
    }

    const cooldownOffset = `+${REGISTRATION_COOLDOWN_SECONDS} seconds`;
    const [claimedRows] = await connection.execute(
        `INSERT INTO system_settings (setting_key, setting_value, description, updated_at)
         VALUES (?, datetime('now', ?), ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_key) DO UPDATE SET
             setting_value = datetime('now', ?),
             description = excluded.description,
             updated_at = CURRENT_TIMESTAMP
         WHERE COALESCE(datetime(system_settings.setting_value), datetime('1970-01-01 00:00:00')) <= datetime('now')
         RETURNING setting_value`,
        [
            REGISTRATION_COOLDOWN_SETTING_KEY,
            cooldownOffset,
            REGISTRATION_COOLDOWN_SETTING_DESCRIPTION,
            cooldownOffset
        ]
    );

    if (claimedRows.length > 0) {
        return;
    }

    const [rows] = await connection.execute(
        `SELECT setting_value
         FROM system_settings
         WHERE setting_key = ?
         LIMIT 1`,
        [REGISTRATION_COOLDOWN_SETTING_KEY]
    );

    const untilMs = parseDbDateTime(rows[0]?.setting_value);
    if (untilMs > Date.now()) {
        throw loginProtectionService.createRateLimitError(
            buildRegistrationCooldownMessage(untilMs),
            untilMs
        );
    }

    throw new Error('Khong the tao tai khoan luc nay. Vui long thu lai sau.');
}

class AuthService {
    async register(email, password, fullName, gender, context = {}) {
        const otpCode = sanitizeOtpCode(context.otpCode);

        if (!otpCode) {
            return this.requestRegistrationOtp(email, password, fullName, gender, context);
        }

        return this.completeRegistration(email, otpCode, context);
    }

    async requestRegistrationOtp(email, password, fullName, gender, context = {}) {
        const clientIp = context.ip || '';
        const normalizedEmail = normalizeEmail(email);

        // Anti-spam: Blacklist common disposable email domains
        const DISPOSABLE_EMAIL_DOMAINS = [
            'tempmail.com', '10minutemail.com', 'mailinator.com', 'yopmail.com', 
            'guerrillamail.com', 'dispostable.com', 'temp-mail.org', 'generator.email', 
            'emailondeck.com', 'trashmail.com', 'maildrop.cc', 'tempmailo.com'
        ];
        const emailDomain = normalizedEmail.split('@')[1];
        if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain)) {
            throw new Error('Hệ thống không chấp nhận đăng ký bằng email tạm thời. Vui lòng sử dụng Gmail, Yahoo, Outlook.');
        }

        const safeGender = normalizeGender(gender);
        const safeFullName = sanitizeFullName(fullName);

        await ipAccountSecurityService.assertRegistrationAllowed(clientIp);
        await cleanupExpiredRegistrationOtps();

        const [existing] = await db.execute(
            'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
            [normalizedEmail]
        );

        if (existing.length > 0) {
            throw new Error('Email already exists');
        }

        const pending = await getPendingRegistration(db, normalizedEmail);
        const isResend = !!pending;
        const resendAvailableMs = parseDbDateTime(pending?.resend_available_at);
        if (resendAvailableMs > Date.now()) {
            throw loginProtectionService.createRateLimitError(
                buildOtpResendMessage(resendAvailableMs),
                resendAvailableMs
            );
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const otpCode = generateRegistrationOtp();
        const now = Date.now();
        const expiresAtMs = now + REGISTRATION_OTP_EXPIRES_MS;
        const resendAvailableAtMs = now + REGISTRATION_OTP_RESEND_MS;

        // Generate 25-character bypass code (combination of IP, Browser user-agent, 5-character random string, email, and name)
        const random5 = crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase();
        const userAgent = context.userAgent || '';
        const combinedString = `${clientIp}|${userAgent}|${random5}|${normalizedEmail}|${safeFullName || ''}`;
        const rawHash = crypto.createHash('sha256').update(combinedString).digest('hex').toUpperCase();
        const cleanHash = rawHash.replace(/[^A-Z0-9]/g, '');
        const clean25 = cleanHash.slice(0, 25).padEnd(25, 'X');
        const bypassCode = clean25.match(/.{1,5}/g).join('-');

        await db.execute(
            `INSERT INTO registration_otps (
                email, otp_hash, password_hash, full_name, gender, request_ip,
                attempt_count, resend_available_at, expires_at, bypass_code, raw_otp, last_sent_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(email) DO UPDATE SET
                otp_hash = excluded.otp_hash,
                password_hash = excluded.password_hash,
                full_name = excluded.full_name,
                gender = excluded.gender,
                request_ip = excluded.request_ip,
                attempt_count = 0,
                resend_available_at = excluded.resend_available_at,
                expires_at = excluded.expires_at,
                bypass_code = excluded.bypass_code,
                raw_otp = excluded.raw_otp,
                last_sent_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP`,
            [
                normalizedEmail,
                hashRegistrationOtp(normalizedEmail, otpCode),
                passwordHash,
                safeFullName,
                safeGender,
                clientIp || null,
                toSqliteDateTime(resendAvailableAtMs),
                toSqliteDateTime(expiresAtMs),
                bypassCode,
                otpCode
            ]
        );

        // Send OTP email asynchronously in the background.
        // This prevents the user from waiting for the SMTP network handshake and email delivery.
        // It also keeps the registration record intact so that the bypass code fallback works even if the SMTP service fails.
        emailDeliveryService.sendRegistrationOtp({
            to: normalizedEmail,
            otpCode,
            fullName: safeFullName || normalizedEmail,
            expiresInMinutes: Math.max(Math.ceil(REGISTRATION_OTP_EXPIRES_MS / 60000), 1),
            forceProvider: isResend ? 'resend' : undefined
        }).catch((error) => {
            console.error('[email-background-error] Failed to send registration OTP email to %s:', normalizedEmail, error);
        });

        return {
            otpRequired: true,
            email: normalizedEmail,
            expiresInSeconds: getRetryAfterSeconds(expiresAtMs, now),
            resendAfterSeconds: getRetryAfterSeconds(resendAvailableAtMs, now),
            bypassCode: bypassCode
        };
    }

    async completeRegistration(email, otpCode, context = {}) {
        const clientIp = context.ip || '';
        const normalizedEmail = normalizeEmail(email);
        const normalizedOtp = sanitizeOtpCode(otpCode);

        if (normalizedOtp.length !== REGISTRATION_OTP_LENGTH) {
            throw new Error(`OTP must be ${REGISTRATION_OTP_LENGTH} digits`);
        }

        await ipAccountSecurityService.assertRegistrationAllowed(clientIp);

        const connection = await db.getConnection();
        let committed = false;

        try {
            await connection.beginTransaction();
            await cleanupExpiredRegistrationOtps(connection);

            const [existing] = await connection.execute(
                'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
                [normalizedEmail]
            );

            if (existing.length > 0) {
                throw new Error('Email already exists');
            }

            const pending = await getPendingRegistration(connection, normalizedEmail);
            if (!pending) {
                throw new Error('Khong tim thay OTP dang ky. Vui long gui lai ma OTP.');
            }

            const expiresAtMs = parseDbDateTime(pending.expires_at);
            if (expiresAtMs <= Date.now()) {
                await connection.execute(
                    'DELETE FROM registration_otps WHERE LOWER(email) = LOWER(?)',
                    [normalizedEmail]
                );
                throw new Error('Ma OTP da het han. Vui long gui lai ma moi.');
            }

            if (hashRegistrationOtp(normalizedEmail, normalizedOtp) !== pending.otp_hash) {
                const nextAttemptCount = Number(pending.attempt_count || 0) + 1;

                if (nextAttemptCount >= REGISTRATION_OTP_MAX_ATTEMPTS) {
                    await connection.execute(
                        'DELETE FROM registration_otps WHERE LOWER(email) = LOWER(?)',
                        [normalizedEmail]
                    );
                    throw new Error('Ban da nhap sai OTP qua nhieu lan. Vui long gui lai ma moi.');
                }

                await connection.execute(
                    `UPDATE registration_otps
                     SET attempt_count = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE LOWER(email) = LOWER(?)`,
                    [nextAttemptCount, normalizedEmail]
                );

                const remainingAttempts = REGISTRATION_OTP_MAX_ATTEMPTS - nextAttemptCount;
                throw new Error(`Ma OTP khong dung. Ban con ${remainingAttempts} lan thu.`);
            }

            await claimRegistrationSlot(connection);

            const registerIp = clientIp || pending.request_ip || null;
            const [result] = await connection.execute(
                `INSERT INTO users (
                    email, password_hash, full_name, gender, register_ip, last_login_ip, last_login
                ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                [
                    normalizedEmail,
                    pending.password_hash,
                    pending.full_name || null,
                    normalizeGender(pending.gender),
                    registerIp,
                    registerIp
                ]
            );

            const userId = result.insertId;
            const [users] = await connection.execute(
                `SELECT id, email, full_name, avatar, gender, bio, contact_info, role, balance, is_verified, created_at
                 FROM users
                 WHERE id = ?`,
                [userId]
            );

            await connection.execute(
                'DELETE FROM registration_otps WHERE LOWER(email) = LOWER(?)',
                [normalizedEmail]
            );

            await connection.commit();
            committed = true;

            const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            return {
                token,
                user: users[0]
            };
        } catch (error) {
            if (!committed) {
                try {
                    await connection.rollback();
                } catch (_) {
                    // Ignore rollback errors so the original registration error is preserved.
                }
            }
            throw error;
        } finally {
            await connection.release();
        }
    }

    async login(email, password, context = {}) {
        try {
            const clientIp = context.ip || '';
            const normalizedEmail = normalizeEmail(email);

            await loginProtectionService.assertLoginAllowed({
                email: normalizedEmail,
                ip: clientIp
            });

            const [users] = await db.execute(
                'SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
                [normalizedEmail]
            );

            if (users.length === 0) {
                const enforcement = await loginProtectionService.registerFailedAttempt({
                    email: normalizedEmail,
                    ip: clientIp
                });

                if (enforcement.ipBlockedUntil) {
                    throw loginProtectionService.createRateLimitError(
                        'IP tam thoi bi chan do co qua nhieu lan dang nhap that bai.',
                        enforcement.ipBlockedUntil
                    );
                }

                throw new Error('Invalid email or password');
            }

            const user = users[0];

            if (user.status === 'banned') {
                const [whitelist] = await db.execute(
                    'SELECT id FROM security_whitelist WHERE LOWER(email) = LOWER(?) OR ip = ? OR machine_id = ? LIMIT 1',
                    [normalizedEmail, clientIp, context.machineId || '']
                );
                if (whitelist.length === 0) {
                    throw new Error('Account has been banned');
                }
            }

            const isValid = await bcrypt.compare(password, user.password_hash);

            if (!isValid) {
                const enforcement = await loginProtectionService.registerFailedAttempt({
                    email: normalizedEmail,
                    ip: clientIp
                });

                if (enforcement.accountLockedUntil) {
                    throw loginProtectionService.createRateLimitError(
                        'Tai khoan tam thoi bi khoa dang nhap do co qua nhieu lan sai mat khau.',
                        enforcement.accountLockedUntil
                    );
                }

                if (enforcement.ipBlockedUntil) {
                    throw loginProtectionService.createRateLimitError(
                        'IP tam thoi bi chan do co qua nhieu lan dang nhap that bai.',
                        enforcement.ipBlockedUntil
                    );
                }

                throw new Error('Invalid email or password');
            }

            await loginProtectionService.registerSuccessfulLogin({
                email: normalizedEmail,
                ip: clientIp,
                userId: user.id
            });

            await db.execute(
                "UPDATE users SET last_login = datetime('now') WHERE id = ?",
                [user.id]
            );

            await ipAccountSecurityService.trackUserLoginIp(user.id, clientIp);

            const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
            delete user.password_hash;

            return {
                token,
                user
            };
        } catch (error) {
            throw error;
        }
    }

    async getCurrentUser(userId) {
        try {
            const [users] = await db.execute(
                `SELECT id, email, full_name, avatar, cover_image, frame_url, profile_music_url, profile_music_title,
                        gender, bio, contact_info, phone, role, balance, status, is_verified, created_at, last_login
                 FROM users
                 WHERE id = ?`,
                [userId]
            );

            if (users.length === 0) {
                throw new Error('User not found');
            }

            return users[0];
        } catch (error) {
            throw error;
        }
    }

    async updateProfile(userId, data) {
        try {
            const updates = [];
            const values = [];

            if (data.full_name !== undefined) {
                updates.push('full_name = ?');
                values.push(data.full_name);
            }

            if (data.phone !== undefined) {
                updates.push('phone = ?');
                values.push(data.phone);
            }

            if (data.avatar !== undefined) {
                updates.push('avatar = ?');
                values.push(data.avatar);
            }

            if (data.cover_image !== undefined) {
                updates.push('cover_image = ?');
                values.push(data.cover_image);
            }

            if (data.profile_music_url !== undefined) {
                updates.push('profile_music_url = ?');
                values.push(data.profile_music_url || null);
            }

            if (data.profile_music_title !== undefined) {
                updates.push('profile_music_title = ?');
                values.push(data.profile_music_title || null);
            }

            if (data.gender !== undefined) {
                updates.push('gender = ?');
                values.push(data.gender);
            }

            if (data.bio !== undefined) {
                updates.push('bio = ?');
                values.push(data.bio);
            }

            if (data.contact_info !== undefined) {
                updates.push('contact_info = ?');
                values.push(data.contact_info);
            }

            if (updates.length === 0) {
                throw new Error('No data to update');
            }

            values.push(userId);

            await db.execute(
                `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
                values
            );

            return await this.getCurrentUser(userId);
        } catch (error) {
            throw error;
        }
    }

    async changePassword(userId, oldPassword, newPassword) {
        try {
            const [users] = await db.execute(
                'SELECT password_hash FROM users WHERE id = ?',
                [userId]
            );

            if (users.length === 0) {
                throw new Error('User not found');
            }

            const isValid = await bcrypt.compare(oldPassword, users[0].password_hash);

            if (!isValid) {
                throw new Error('Old password is incorrect');
            }

            const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

            await db.execute(
                'UPDATE users SET password_hash = ? WHERE id = ?',
                [newPasswordHash, userId]
            );

            return true;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new AuthService();
