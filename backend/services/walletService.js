// ============================================
// WALLET SERVICE
// File: backend/services/walletService.js
// ============================================

const crypto = require('crypto');
const db = require('../config/database');
const { getArchive } = require('./archiveService');
const notificationService = require('./notificationService');
const { shortenWithLink4m, resolvePublicBaseUrl } = require('./linkShortenerService');

const APP_TIMEZONE = 'Asia/Bangkok';
const LUCKY_SPIN_SETTING_KEYS = [
    'lucky_spin_enabled',
    'lucky_spin_title',
    'lucky_spin_subtitle',
    'lucky_spin_cooldown_minutes',
    'lucky_spin_rewards_text',
    'lucky_spin_schedule_mode',
    'lucky_spin_manual_weekday'
];
const DAILY_CHECKIN_SETTING_KEYS = [
    'daily_checkin_enabled',
    'daily_checkin_title',
    'daily_checkin_subtitle',
    'daily_checkin_rewards_text'
];
const DEFAULT_LUCKY_SPIN_REWARDS = [
    { id: 'reward-1', label: 'Chúc bạn may mắn', amount: 0, weight: 30, color: '#1f2937' },
    { id: 'reward-2', label: 'Thưởng 1.000d', amount: 1000, weight: 38, color: '#0ea5e9' },
    { id: 'reward-3', label: 'Thưởng 2.000d', amount: 2000, weight: 18, color: '#22c55e' },
    { id: 'reward-4', label: 'Thưởng 5.000d', amount: 5000, weight: 10, color: '#f59e0b' },
    { id: 'reward-5', label: 'Jackpot mini', amount: 10000, weight: 4, color: '#ef4444' }
];
const LUCKY_SPIN_WEEKDAY_LABELS = [
    'Thu 2',
    'Thu 3',
    'Thu 4',
    'Thu 5',
    'Thu 6',
    'Thu 7',
    'Chủ nhật'
];
const LUCKY_SPIN_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const LUCKY_SPIN_BONUS_CODE_TTL_HOURS = 24;
const DEFAULT_DAILY_CHECKIN_REWARDS = [
    { day: 1, amount: 1000, label: 'Bắt đầu' },
    { day: 2, amount: 1500, label: 'Ổn định' },
    { day: 3, amount: 2000, label: 'Tăng tốc' },
    { day: 4, amount: 2500, label: 'Chuyên cần' },
    { day: 5, amount: 3000, label: 'Bền bỉ' },
    { day: 6, amount: 4000, label: 'Gần đích' },
    { day: 7, amount: 5000, label: 'Mốc tuần' }
];
const REWARD_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];
let luckySpinSchedulerTimer = null;

function formatMoneyVnd(amount) {
    const numeric = Number(amount || 0);
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number.isFinite(numeric) ? numeric : 0)} đ`;
}

function resolveProductMainImage(mainImage, gallery = []) {
    const direct = (mainImage || '').toString().trim();
    if (direct) return direct;

    for (const item of gallery) {
        const url = item && typeof item.image_url === 'string'
            ? item.image_url.trim()
            : '';
        if (url) return url;
    }

    return null;
}

function normalizeText(value = '') {
    return String(value || '').trim();
}

function parseBooleanSetting(value, fallback = false) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function parseNumber(value, fallback = 0) {
    const normalized = normalizeText(value).replace(/,/g, '').replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value, fallback = 0) {
    return Math.round(parseNumber(value, fallback));
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizeColor(value = '', index = 0) {
    const normalized = normalizeText(value);
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
        return normalized;
    }
    return REWARD_COLORS[index % REWARD_COLORS.length];
}

function createDateKeyFormatter(timeZone = APP_TIMEZONE) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

const dateKeyFormatter = createDateKeyFormatter();

function toDateKey(date = new Date(), timeZone = APP_TIMEZONE) {
    const formatter = timeZone === APP_TIMEZONE ? dateKeyFormatter : createDateKeyFormatter(timeZone);
    const parts = formatter.formatToParts(date);
    const year = parts.find(part => part.type === 'year')?.value || '1970';
    const month = parts.find(part => part.type === 'month')?.value || '01';
    const day = parts.find(part => part.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map(item => parseInt(item, 10));
    if (!year || !month || !day) {
        return null;
    }
    return new Date(Date.UTC(year, month - 1, day));
}

function diffDays(fromDateKey, toDateKeyValue) {
    const fromDate = parseDateKey(fromDateKey);
    const toDate = parseDateKey(toDateKeyValue);
    if (!fromDate || !toDate) {
        return Number.NaN;
    }
    return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function addDaysToDateKey(dateKey, days = 0) {
    const parsed = parseDateKey(dateKey);
    if (!parsed) {
        return '';
    }
    return toDateKey(new Date(parsed.getTime() + (days * 86400000)));
}

function getWeekdayFromDateKey(dateKey) {
    const parsed = parseDateKey(dateKey);
    if (!parsed) {
        return 1;
    }
    const utcDay = parsed.getUTCDay();
    return utcDay === 0 ? 7 : utcDay;
}

function getWeekStartDateKey(date = new Date(), timeZone = APP_TIMEZONE) {
    const todayKey = toDateKey(date, timeZone);
    const weekday = getWeekdayFromDateKey(todayKey);
    return addDaysToDateKey(todayKey, 1 - weekday);
}

function parseLuckySpinScheduleMode(value, fallback = 'auto') {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'manual') return 'manual';
    if (normalized === 'auto') return 'auto';
    return fallback;
}

function parseLuckySpinWeekday(value, fallback = 6) {
    const parsed = clamp(parseInteger(value, fallback), 1, 7);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatLuckySpinDate(dateKey) {
    const parsed = parseDateKey(dateKey);
    if (!parsed) {
    return 'đang cập nhật';
    }
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const year = parsed.getUTCFullYear();
    return `${day}/${month}/${year}`;
}

function getLuckySpinWeekdayLabel(weekday = 1) {
    return LUCKY_SPIN_WEEKDAY_LABELS[clamp(parseInteger(weekday, 1), 1, 7) - 1] || LUCKY_SPIN_WEEKDAY_LABELS[0];
}

function toLuckySpinScheduleStartIso(dateKey) {
    if (!dateKey) return null;
    return new Date(`${dateKey}T00:00:00+07:00`).toISOString();
}

function toLuckySpinScheduleEndIso(dateKey) {
    if (!dateKey) return null;
    return new Date(`${dateKey}T23:59:59.999+07:00`).toISOString();
}

function buildLuckySpinSchedulePayload(schedule, todayKey) {
    if (!schedule) {
        return null;
    }

    const distanceDays = diffDays(todayKey, schedule.eventDate);
    return {
        weekKey: schedule.weekKey,
        eventDate: schedule.eventDate,
        eventWeekday: schedule.eventWeekday,
        eventLabel: `${getLuckySpinWeekdayLabel(schedule.eventWeekday)}, ${formatLuckySpinDate(schedule.eventDate)}`,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        source: schedule.source,
        announcementSentAt: schedule.announcementSentAt || null,
        distanceDays,
        isToday: distanceDays === 0,
        isTomorrow: distanceDays === 1
    };
}

function addHoursToIso(date = new Date(), hours = 0) {
    return new Date(date.getTime() + (hours * 3600000)).toISOString();
}

function createBonusCodeCandidate(length = 10) {
    return crypto.randomBytes(Math.max(8, length))
        .toString('base64')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, length);
}

function createLuckySpinBonusCode() {
    return `FREE-${createBonusCodeCandidate(10)}`;
}

function createLuckySpinClaimToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function normalizeLuckySpinBonusCode(value = '') {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
}

function isIsoExpired(iso) {
    const timestamp = Date.parse(iso || '');
    if (!Number.isFinite(timestamp)) {
        return false;
    }
    return timestamp <= Date.now();
}

function buildLuckySpinBonusCodePayload(row) {
    if (!row) {
        return null;
    }

    return {
        id: Number(row.id || 0),
        code: row.code || '',
        shortUrl: row.short_url || '',
        destinationUrl: row.destination_url || '',
        revealedAt: row.revealed_at || null,
        usedAt: row.used_at || null,
        expiresAt: row.expires_at || null,
        isExpired: isIsoExpired(row.expires_at),
        isUsed: !!row.used_at
    };
}

function hasUsableLuckySpinBonusLink(row) {
    const url = normalizeText(row?.short_url).toLowerCase();
    return !!url
        && /^https?:\/\//.test(url)
        && !url.includes('challenges.cloudflare.com')
        && !url.includes('/turnstile/');
}

function addMinutesToIso(date = new Date(), minutes = 0) {
    return new Date(date.getTime() + (minutes * 60000)).toISOString();
}

function getRemainingMs(nextIso) {
    const timestamp = Date.parse(nextIso || '');
    if (!Number.isFinite(timestamp)) {
        return 0;
    }
    return Math.max(0, timestamp - Date.now());
}

function isUniqueConstraintError(error) {
    return /unique/i.test(error?.message || '');
}

async function getSettingsMap(keys = [], executor = db) {
    if (!Array.isArray(keys) || !keys.length) {
        return {};
    }

    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await executor.execute(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key IN (${placeholders})`,
        keys
    );

    const settings = {};
    rows.forEach(item => {
        settings[item.setting_key] = item.setting_value;
    });
    return settings;
}

function parseLuckySpinRewards(raw = '') {
    const lines = String(raw || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const parsed = lines.map((line, index) => {
        const parts = line.split('|').map(item => item.trim());
        const label = parts[0] || `Phan thuong ${index + 1}`;
        const amount = Math.max(0, parseNumber(parts[1], 0));
        const weight = Math.max(1, parseInteger(parts[2], 1));
        const color = normalizeColor(parts[3], index);

        return {
            id: `reward-${index + 1}`,
            label,
            amount,
            weight,
            color
        };
    }).filter(item => item.label);

    return (parsed.length ? parsed : DEFAULT_LUCKY_SPIN_REWARDS).map((item, index) => ({
        id: item.id || `reward-${index + 1}`,
        label: item.label,
        amount: Math.max(0, parseNumber(item.amount, 0)),
        weight: Math.max(1, parseInteger(item.weight, 1)),
        color: normalizeColor(item.color, index)
    }));
}

function parseDailyCheckinRewards(raw = '') {
    const lines = String(raw || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const rewardMap = new Map();

    lines.forEach((line, index) => {
        const parts = line.split('|').map(item => item.trim());
        const day = clamp(parseInteger(parts[0], index + 1), 1, 365);
        const amount = Math.max(0, parseNumber(parts[1], 0));
        const label = parts[2] || `Ngay ${day}`;
        if (day <= 7) {
            rewardMap.set(day, { day, amount, label });
        }
    });

    return DEFAULT_DAILY_CHECKIN_REWARDS.map((fallback) => {
        const configured = rewardMap.get(fallback.day);
        return {
            day: fallback.day,
            amount: configured ? configured.amount : fallback.amount,
            label: configured ? configured.label : fallback.label
        };
    });
}

async function loadLuckySpinSettings(executor = db) {
    const settings = await getSettingsMap(LUCKY_SPIN_SETTING_KEYS, executor);
    return {
        enabled: parseBooleanSetting(settings.lucky_spin_enabled, true),
        title: normalizeText(settings.lucky_spin_title) || 'Vòng quay may mắn',
        subtitle: normalizeText(settings.lucky_spin_subtitle) || 'Phần thưởng do hệ thống xử lý tự động.',
        cooldownMinutes: clamp(parseInteger(settings.lucky_spin_cooldown_minutes, 1440), 1, 60 * 24 * 30),
        scheduleMode: parseLuckySpinScheduleMode(settings.lucky_spin_schedule_mode, 'auto'),
        manualWeekday: parseLuckySpinWeekday(settings.lucky_spin_manual_weekday, 6),
        rewards: parseLuckySpinRewards(settings.lucky_spin_rewards_text)
    };
}

async function loadDailyCheckinSettings(executor = db) {
    const settings = await getSettingsMap(DAILY_CHECKIN_SETTING_KEYS, executor);
    return {
        enabled: parseBooleanSetting(settings.daily_checkin_enabled, true),
        title: normalizeText(settings.daily_checkin_title) || 'ĐIỂM DANH HÔM NAY',
        subtitle: normalizeText(settings.daily_checkin_subtitle) || 'SE ĐƯỢC CỘNG SAU VÀI GIÂY',
        rewards: parseDailyCheckinRewards(settings.daily_checkin_rewards_text)
    };
}

function pickLuckySpinReward(rewards = []) {
    if (!Array.isArray(rewards) || !rewards.length) {
        throw new Error('Lucky spin rewards are not configured');
    }

    const totalWeight = rewards.reduce((sum, reward) => sum + Math.max(1, parseInteger(reward.weight, 1)), 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return rewards[0];
    }

    let cursor = crypto.randomInt(totalWeight);
    for (const reward of rewards) {
        cursor -= Math.max(1, parseInteger(reward.weight, 1));
        if (cursor < 0) {
            return reward;
        }
    }

    return rewards[rewards.length - 1];
}

function cycleRewardDay(consecutiveDays, maxDay) {
    if (!maxDay || maxDay <= 0) {
        return 1;
    }
    return ((Math.max(1, consecutiveDays) - 1) % maxDay) + 1;
}

function mapLuckySpinHistory(rows = []) {
    return rows.map(row => ({
        id: row.id,
        rewardId: row.reward_id,
        rewardLabel: row.reward_label,
        rewardAmount: Number(row.reward_amount || 0),
        spinSource: row.spin_source || 'scheduled',
        createdAt: row.created_at
    }));
}

function mapDailyCheckinHistory(rows = []) {
    return rows.map(row => ({
        id: row.id,
        claimDate: row.claim_date,
        rewardDay: Number(row.reward_day || 1),
        consecutiveDays: Number(row.consecutive_days || 1),
        rewardAmount: Number(row.reward_amount || 0),
        rewardLabel: row.reward_label || `Ngay ${row.reward_day || 1}`,
        createdAt: row.created_at
    }));
}

function buildLuckySpinCooldownError(messageOrNextSpinAt, nextSpinAtValue) {
    const hasCustomMessage = nextSpinAtValue !== undefined;
    const error = new Error(
        hasCustomMessage
            ? (normalizeText(messageOrNextSpinAt) || 'Ban chua den luot quay tiep theo')
            : 'Ban chua den luot quay tiep theo'
    );
    error.code = 'LUCKY_SPIN_COOLDOWN';
    error.nextSpinAt = hasCustomMessage
        ? (nextSpinAtValue || null)
        : (messageOrNextSpinAt || null);
    return error;
}

function buildLuckySpinBonusCodeError(message = 'Ma quay free khong hop le') {
    const error = new Error(message);
    error.code = 'LUCKY_SPIN_BONUS_CODE_INVALID';
    return error;
}

function buildDailyCheckinClaimedError(todayKey) {
    const error = new Error('Hôm nay bạn đã điểm danh rồi');
    error.code = 'DAILY_CHECKIN_ALREADY_CLAIMED';
    error.claimDate = todayKey || null;
    return error;
}

async function recordSecurityAction(actionType, { userId = null, ip = '', targetKey = '' } = {}) {
    try {
        await db.execute(
            `INSERT INTO security_action_logs (action_type, actor_user_id, actor_ip, target_key)
             VALUES (?, ?, ?, ?)`,
            [actionType, userId || null, ip || null, targetKey || null]
        );
    } catch (_) {
        // Ignore analytics persistence failures.
    }
}

function mapLuckySpinWeekSchedule(row) {
    if (!row) {
        return null;
    }

    return {
        weekKey: row.week_key,
        eventDate: row.event_date,
        eventWeekday: clamp(parseInteger(row.event_weekday, 1), 1, 7),
        source: row.source === 'manual' ? 'manual' : 'auto',
        announcementSentAt: row.announcement_sent_at || null,
        startsAt: toLuckySpinScheduleStartIso(row.event_date),
        endsAt: toLuckySpinScheduleEndIso(row.event_date)
    };
}

async function getLuckySpinWeekSchedule(weekKey, executor = db) {
    const [rows] = await executor.execute(
        `SELECT week_key, event_date, event_weekday, source, announcement_sent_at
         FROM lucky_spin_week_schedule
         WHERE week_key = ?`,
        [weekKey]
    );
    return mapLuckySpinWeekSchedule(rows[0] || null);
}

async function upsertLuckySpinWeekSchedule(weekKey, eventDate, eventWeekday, source = 'auto', executor = db) {
    const existing = await getLuckySpinWeekSchedule(weekKey, executor);
    const normalizedSource = source === 'manual' ? 'manual' : 'auto';
    const safeWeekday = clamp(parseInteger(eventWeekday, 1), 1, 7);

    if (!existing) {
        await executor.execute(
            `INSERT INTO lucky_spin_week_schedule
             (week_key, event_date, event_weekday, source, announcement_sent_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`,
            [weekKey, eventDate, safeWeekday, normalizedSource]
        );
        return getLuckySpinWeekSchedule(weekKey, executor);
    }

    const scheduleChanged = (
        existing.eventDate !== eventDate
        || Number(existing.eventWeekday || 1) !== safeWeekday
        || existing.source !== normalizedSource
    );

    if (!scheduleChanged) {
        return existing;
    }

    await executor.execute(
        `UPDATE lucky_spin_week_schedule
         SET event_date = ?,
             event_weekday = ?,
             source = ?,
             announcement_sent_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE week_key = ?`,
        [eventDate, safeWeekday, normalizedSource, weekKey]
    );

    return getLuckySpinWeekSchedule(weekKey, executor);
}

async function ensureLuckySpinWeekSchedule(weekKey, settings, executor = db) {
    const scheduleMode = settings?.scheduleMode === 'manual' ? 'manual' : 'auto';
    const existing = await getLuckySpinWeekSchedule(weekKey, executor);

    if (scheduleMode === 'auto' && existing?.source === 'auto') {
        return existing;
    }

    const eventWeekday = scheduleMode === 'manual'
        ? parseLuckySpinWeekday(settings?.manualWeekday, 6)
        : crypto.randomInt(1, 8);
    const eventDate = addDaysToDateKey(weekKey, eventWeekday - 1);

    return upsertLuckySpinWeekSchedule(weekKey, eventDate, eventWeekday, scheduleMode, executor);
}

function resolveLuckySpinWindows(todayKey, currentSchedule, nextSchedule) {
    const currentDistance = currentSchedule ? diffDays(todayKey, currentSchedule.eventDate) : Number.NaN;
    const isCurrentLive = currentDistance === 0;
    const primarySchedule = currentSchedule && currentDistance >= 0
        ? currentSchedule
        : nextSchedule;

    return {
        activeSchedule: isCurrentLive ? currentSchedule : null,
        primarySchedule,
        nextSchedule: isCurrentLive ? nextSchedule : nextSchedule
    };
}

async function maybeSendLuckySpinAnnouncement(schedule, settings, todayKey) {
    if (!settings?.enabled || !schedule) {
        return;
    }

    if (diffDays(todayKey, schedule.eventDate) !== 1) {
        return;
    }

    const [result] = await db.execute(
        `UPDATE lucky_spin_week_schedule
         SET announcement_sent_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE week_key = ?
           AND announcement_sent_at IS NULL`,
        [schedule.weekKey]
    );

    if (!result?.affectedRows) {
        return;
    }

    const title = `${normalizeText(settings.title) || 'Vòng quay may mắn'} sắp mở`;
    const content = `Server sẻ mở vòng quay vào ${getLuckySpinWeekdayLabel(schedule.eventWeekday)}, ${formatLuckySpinDate(schedule.eventDate)}. Moi tai khoan co 1 luot quay trong ngay su kien.`;

    await notificationService.createNotification({
        title,
        content,
        is_important: true,
        dismiss_hours: 24,
        target_user_id: null,
        created_by: null,
        send_telegram: false
    });
}

async function getActiveLuckySpinBonusCodeForUser(userId, executor = db) {
    const [rows] = await executor.execute(
        `SELECT id, code, claim_token, short_url, destination_url, revealed_at, used_at, expires_at
         FROM lucky_spin_bonus_codes
         WHERE user_id = ?
           AND used_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [userId, new Date().toISOString()]
    );

    return rows[0] || null;
}

async function generateUniqueLuckySpinBonusCode(executor = db) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = createLuckySpinBonusCode();
        const [rows] = await executor.execute(
            'SELECT id FROM lucky_spin_bonus_codes WHERE code = ? LIMIT 1',
            [candidate]
        );
        if (!rows.length) {
            return candidate;
        }
    }

    throw new Error('vui lòng thử lại đã lỗi');
}

async function createLuckySpinBonusCodeRecord(userId, context = {}, executor = db) {
    const baseUrl = resolvePublicBaseUrl(context);
    if (!baseUrl) {
        throw new Error('không sác định được domain để tạo link quay free');
    }

    const code = await generateUniqueLuckySpinBonusCode(executor);
    const claimToken = createLuckySpinClaimToken();
    const destinationUrl = new URL(`/vongquay?spin_bonus_token=${encodeURIComponent(claimToken)}`, `${baseUrl}/`).toString();
    const shortLink = await shortenWithLink4m(destinationUrl);
    const expiresAt = addHoursToIso(new Date(), LUCKY_SPIN_BONUS_CODE_TTL_HOURS);

    const [result] = await executor.execute(
        `INSERT INTO lucky_spin_bonus_codes
         (user_id, code, claim_token, short_url, destination_url, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, code, claimToken, shortLink.shortUrl, destinationUrl, expiresAt]
    );

    return {
        id: result.insertId,
        code,
        claimToken,
        shortUrl: shortLink.shortUrl,
        destinationUrl,
        expiresAt,
        provider: shortLink.provider
    };
}

async function consumeLuckySpinBonusCode(userId, bonusCode, nowIso, executor = db) {
    const normalizedCode = normalizeLuckySpinBonusCode(bonusCode);
    if (!normalizedCode) {
        throw buildLuckySpinBonusCodeError('nhập mã đii');
    }

    const [rows] = await executor.execute(
        `SELECT id, user_id, code, used_at, expires_at
         FROM lucky_spin_bonus_codes
         WHERE code = ?
         LIMIT 1`,
        [normalizedCode]
    );
    const codeRow = rows[0] || null;

    if (!codeRow) {
        throw buildLuckySpinBonusCodeError('Mã không tồn tại nha');
    }
    if (Number(codeRow.user_id || 0) !== Number(userId)) {
        throw buildLuckySpinBonusCodeError('MÃ NÀY KHÔNG PHẢI CỦA TÀI KHOẢN BẠN');
    }
    if (codeRow.used_at) {
        throw buildLuckySpinBonusCodeError('Mã quay free nay đã được sử dụng');
    }
    if (isIsoExpired(codeRow.expires_at)) {
        throw buildLuckySpinBonusCodeError('Mã quay free đã hết hạn');
    }

    const [updateResult] = await executor.execute(
        `UPDATE lucky_spin_bonus_codes
         SET used_at = ?, used_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND used_at IS NULL`,
        [nowIso, userId, codeRow.id]
    );

    if (!updateResult?.affectedRows) {
        throw buildLuckySpinBonusCodeError('Mã quay free vua được sử dụng, vui lòng lấy mã mới');
    }

    return {
        id: Number(codeRow.id || 0),
        code: codeRow.code || normalizedCode
    };
}

function buildDailyCheckinProgress(settings, latestClaim, todayKey) {
    const rewards = Array.isArray(settings.rewards) && settings.rewards.length
        ? settings.rewards
        : DEFAULT_DAILY_CHECKIN_REWARDS;
    const maxRewardDay = rewards[rewards.length - 1]?.day || 1;

    if (!latestClaim) {
        return {
            canClaim: true,
            todayClaim: null,
            streakBroken: false,
            consecutiveDays: 0,
            nextConsecutiveDays: 1,
            nextRewardDay: 1
        };
    }

    const latestConsecutiveDays = Number(
        latestClaim.consecutive_days
        || latestClaim.consecutiveDays
        || latestClaim.reward_day
        || latestClaim.rewardDay
        || 1
    );
    const latestRewardDay = Number(latestClaim.reward_day || latestClaim.rewardDay || 1);
    const latestClaimDate = latestClaim.claim_date || latestClaim.claimDate;
    const gap = diffDays(latestClaimDate, todayKey);

    if (gap === 0) {
        return {
            canClaim: false,
            todayClaim: latestClaim,
            streakBroken: false,
            consecutiveDays: latestConsecutiveDays,
            nextConsecutiveDays: latestConsecutiveDays,
            nextRewardDay: latestRewardDay
        };
    }

    if (gap === 1) {
        const nextConsecutiveDays = latestConsecutiveDays + 1;
        return {
            canClaim: true,
            todayClaim: null,
            streakBroken: false,
            consecutiveDays: latestConsecutiveDays,
            nextConsecutiveDays,
            nextRewardDay: cycleRewardDay(nextConsecutiveDays, maxRewardDay)
        };
    }

    return {
        canClaim: true,
        todayClaim: null,
        streakBroken: true,
        consecutiveDays: 0,
        nextConsecutiveDays: 1,
        nextRewardDay: 1
    };
}

class WalletService {
    async ensureLuckySpinScheduleHealth(settingsInput = null) {
        const settings = settingsInput || await loadLuckySpinSettings();
        const todayKey = toDateKey(new Date());
        const currentWeekKey = getWeekStartDateKey(new Date());
        const nextWeekKey = addDaysToDateKey(currentWeekKey, 7);
        const [currentSchedule, nextSchedule] = await Promise.all([
            ensureLuckySpinWeekSchedule(currentWeekKey, settings),
            ensureLuckySpinWeekSchedule(nextWeekKey, settings)
        ]);

        await Promise.all([
            maybeSendLuckySpinAnnouncement(currentSchedule, settings, todayKey),
            maybeSendLuckySpinAnnouncement(nextSchedule, settings, todayKey)
        ]);

        return {
            settings,
            todayKey,
            currentWeekKey,
            nextWeekKey,
            currentSchedule,
            nextSchedule
        };
    }

    startLuckySpinScheduler() {
        if (luckySpinSchedulerTimer) {
            return;
        }

        const run = async () => {
            try {
                await this.ensureLuckySpinScheduleHealth();
            } catch (error) {
                console.error('Lucky spin scheduler error:', error.message);
            }
        };

        run();
        luckySpinSchedulerTimer = setInterval(run, LUCKY_SPIN_SCHEDULER_INTERVAL_MS);
    }

    async createLuckySpinBonusLink(userId, context = {}) {
        const settings = await loadLuckySpinSettings();
        if (!settings.enabled) {
            throw new Error('Tính năng đã tắt');
        }

        const existing = await getActiveLuckySpinBonusCodeForUser(userId);
        if (existing && (hasUsableLuckySpinBonusLink(existing) || existing.revealed_at)) {
            return {
                reused: true,
                shortUrl: hasUsableLuckySpinBonusLink(existing) ? (existing.short_url || '') : '',
                destinationUrl: existing.destination_url || '',
                expiresAt: existing.expires_at || null,
                code: existing.revealed_at ? existing.code || '' : '',
                revealed: !!existing.revealed_at
            };
        }

        if (existing && !hasUsableLuckySpinBonusLink(existing) && !existing.revealed_at) {
            await db.execute(
                `UPDATE lucky_spin_bonus_codes
                 SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [new Date().toISOString(), existing.id]
            );
        }

        let created = null;
        try {
            created = await createLuckySpinBonusCodeRecord(userId, context);
        } catch (error) {
            throw new Error(`ko tạo được: ${error.message}`);
        }

        return {
            reused: false,
            shortUrl: created.shortUrl,
            destinationUrl: created.destinationUrl,
            expiresAt: created.expiresAt,
            code: '',
            revealed: false
        };
    }

    async revealLuckySpinBonusCode(userId, claimToken) {
        const normalizedToken = normalizeText(claimToken);
        if (!normalizedToken) {
            throw buildLuckySpinBonusCodeError('Token nhận mã không hợp lệ');
        }

        const [rows] = await db.execute(
            `SELECT id, user_id, code, short_url, destination_url, revealed_at, used_at, expires_at
             FROM lucky_spin_bonus_codes
             WHERE claim_token = ?
             LIMIT 1`,
            [normalizedToken]
        );
        const bonusCode = rows[0] || null;

        if (!bonusCode) {
            throw buildLuckySpinBonusCodeError('ko có mã free từ link này ');
        }
        if (Number(bonusCode.user_id || 0) !== Number(userId)) {
            throw buildLuckySpinBonusCodeError('phải tự tạo và vượt link chứ ko có đâu');
        }
        if (bonusCode.used_at) {
            throw buildLuckySpinBonusCodeError('sữ dụng rồi mà ');
        }
        if (isIsoExpired(bonusCode.expires_at)) {
            throw buildLuckySpinBonusCodeError('Link nhận mã đã hết hạn');
        }

        if (!bonusCode.revealed_at) {
            await db.execute(
                `UPDATE lucky_spin_bonus_codes
                 SET revealed_at = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?
                   AND revealed_at IS NULL`,
                [new Date().toISOString(), bonusCode.id]
            );
        }

        return buildLuckySpinBonusCodePayload({
            ...bonusCode,
            revealed_at: bonusCode.revealed_at || new Date().toISOString()
        });
    }

    async getTransactions(userId, { page = 1, limit = 20 } = {}) {
        const offset = (page - 1) * limit;

        const [rows] = await db.execute(
            `SELECT id, type, amount, balance_before, balance_after, description, reference_id, created_at
             FROM transactions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, parseInt(limit, 10), offset]
        );

        const [count] = await db.execute(
            'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?',
            [userId]
        );

        return {
            transactions: rows,
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total: count[0].total,
                totalPages: Math.ceil(count[0].total / limit)
            }
        };
    }

    async getDepositRequests(userId) {
        const [rows] = await db.execute(
            `SELECT id, amount, payment_method, payment_proof, status, admin_note, created_at, processed_at
             FROM deposit_requests
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [userId]
        );

        return rows;
    }

    async createDepositRequest(userId, { amount, payment_method, payment_proof }, userContext = {}) {
        if (!amount || amount <= 0) {
            throw new Error('Invalid amount');
        }

        const [result] = await db.execute(
            `INSERT INTO deposit_requests (user_id, amount, payment_method, payment_proof)
             VALUES (?, ?, ?, ?)`,
            [userId, amount, payment_method || null, payment_proof || null]
        );

        try {
            const requestId = result.insertId;
            const requestLabel = [
                `Yeu cau: #${requestId}`,
                userContext.full_name ? `Ho ten: ${userContext.full_name}` : null,
                userContext.email ? `Email: ${userContext.email}` : null,
                `User ID: ${userId}`,
                `So tien: ${formatMoneyVnd(amount)}`,
                payment_method ? `Ngan hang / PTTT: ${payment_method}` : null,
                payment_proof ? `Anh chung tu: ${payment_proof}` : null,
                'Trang thai: Cho duyet'
            ].filter(Boolean).join('\n');
            const telegramText = [
                'Yeu cau nap tien moi',
                requestLabel,
                'Moi vao web hoac Telegram de duyet.'
            ].join('\n');
            const telegramKeyboard = {
                inline_keyboard: [
                    [
                        { text: `Duyet #${requestId}`, callback_data: `deposit_approve:${requestId}` },
                        { text: `Tu choi #${requestId}`, callback_data: `deposit_reject:${requestId}` }
                    ]
                ]
            };

            await notificationService.notifyAdmins({
                title: 'YÊU CẦU NẠP TIỀN MỚI',
                content: requestLabel,
                is_important: true,
                target_user_id: null,
                created_by: null,
                telegram_message: telegramText,
                telegram_options: { reply_markup: telegramKeyboard }
            }, {
                sendTelegram: true,
                telegramOptions: { reply_markup: telegramKeyboard }
            });
        } catch (error) {
            console.error('Failed to notify admins about deposit request:', error.message);
        }

        return { id: result.insertId };
    }

    async getPurchases(userId, { page = 1, limit = 20 } = {}) {
        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.max(1, parseInt(limit, 10) || 20);
        const offset = (currentPage - 1) * pageSize;

        const [rows] = await db.execute(
            `
                SELECT *
                FROM (
                    SELECT
                        'product' AS purchase_type,
                        p.id AS record_id,
                        p.product_id,
                        p.price_paid,
                        p.download_count,
                        p.last_download,
                        p.created_at,
                        pr.title,
                        pr.slug,
                        pr.main_image,
                        pr.download_url,
                        NULL AS category_name,
                        NULL AS category_slug,
                        NULL AS platform,
                        NULL AS account_status,
                        NULL AS account_id
                    FROM purchases p
                    LEFT JOIN products pr ON pr.id = p.product_id
                    WHERE p.user_id = ?

                    UNION ALL

                    SELECT
                        'mxh_account' AS purchase_type,
                        ph.id AS record_id,
                        NULL AS product_id,
                        ph.price AS price_paid,
                        NULL AS download_count,
                        NULL AS last_download,
                        ph.purchased_at AS created_at,
                        ph.title,
                        NULL AS slug,
                        NULL AS main_image,
                        NULL AS download_url,
                        c.name AS category_name,
                        c.slug AS category_slug,
                        c.platform AS platform,
                        'sold' AS account_status,
                        ph.account_id AS account_id
                    FROM mxh_purchase_history ph
                    LEFT JOIN mxh_categories c ON c.id = ph.category_id
                    WHERE ph.buyer_id = ?
                ) combined
                ORDER BY created_at DESC, record_id DESC
                LIMIT ? OFFSET ?
            `,
            [userId, userId, pageSize, offset]
        );

        const archive = await getArchive();
        const archivedProducts = Array.isArray(archive.products) ? archive.products : [];
        const archivedMap = new Map(
            archivedProducts.map(item => [String(item.id), item])
        );
        const productIds = rows
            .filter(row => row.purchase_type === 'product')
            .map(row => parseInt(row.product_id, 10))
            .filter(Number.isFinite);
        const galleryMap = {};

        if (productIds.length > 0) {
            const placeholders = productIds.map(() => '?').join(',');
            const [imageRows] = await db.execute(
                `SELECT product_id, image_url, display_order
                 FROM product_images
                 WHERE product_id IN (${placeholders})
                 ORDER BY product_id ASC, display_order ASC, id ASC`,
                productIds
            );
            imageRows.forEach(item => {
                if (!galleryMap[item.product_id]) galleryMap[item.product_id] = [];
                galleryMap[item.product_id].push(item);
            });
        }

        const enriched = rows.map(row => {
            if (row.purchase_type === 'mxh_account') {
                return {
                    ...row,
                    purchase_type_label: 'Tài khoản MXH',
                    action_label: 'Xem tài khoản',
                    action_url: `/mxh/account/${row.account_id}`,
                    hint: 'Mở để xem email và mật khẩu'
                };
            }

            if (row.title) {
                return {
                    ...row,
                    purchase_type_label: 'Mã nguồn',
                    action_label: row.download_url ? 'Tải về' : 'Xem sản phẩm',
                    action_url: row.download_url || (row.slug ? `/page2/${row.slug}` : `/page2/${row.product_id}`),
                    main_image: resolveProductMainImage(row.main_image, galleryMap[row.product_id] || [])
                };
            }

            const archived = archivedMap.get(String(row.product_id));
            if (!archived) {
                return {
                    ...row,
                    purchase_type_label: 'Mã nguồn',
                    action_label: row.download_url ? 'Tải về' : 'Xem sản phẩm',
                    action_url: row.download_url || (row.slug ? `/page2/${row.slug}` : `/page2/${row.product_id}`)
                };
            }

            return {
                ...row,
                title: archived.title,
                slug: archived.slug,
                main_image: resolveProductMainImage(archived.main_image, archived.gallery || []),
                download_url: archived.download_url,
                is_archived: true,
                purchase_type_label: 'Mã nguồn',
                action_label: archived.download_url ? 'Tải về' : 'Xem sản phẩm',
                action_url: archived.download_url || (archived.slug ? `/page2/${archived.slug}` : `/page2/${row.product_id}`)
            };
        });

        const [productCountRows, mxhCountRows] = await Promise.all([
            db.execute('SELECT COUNT(*) as total FROM purchases WHERE user_id = ?', [userId]),
            db.execute('SELECT COUNT(*) as total FROM mxh_purchase_history WHERE buyer_id = ?', [userId])
        ]);

        const productTotal = Number(productCountRows[0]?.[0]?.total || 0);
        const mxhTotal = Number(mxhCountRows[0]?.[0]?.total || 0);
        const total = productTotal + mxhTotal;

        return {
            purchases: enriched,
            pagination: {
                page: currentPage,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        };
    }

    async getLuckySpinStatus(userId) {
        const settings = await loadLuckySpinSettings();
        const [scheduleState, stateRows, historyRows, activeBonusCode] = await Promise.all([
            this.ensureLuckySpinScheduleHealth(settings),
            db.execute(
                `SELECT user_id, last_spin_at, next_spin_at, last_spin_event_key
                 FROM lucky_spin_state
                 WHERE user_id = ?`,
                [userId]
            ),
            db.execute(
                `SELECT id, reward_id, reward_label, reward_amount, spin_source, created_at
                 FROM lucky_spin_attempts
                 WHERE user_id = ?
                 ORDER BY created_at DESC, id DESC
                 LIMIT 10`,
                [userId]
            ),
            getActiveLuckySpinBonusCodeForUser(userId)
        ]);

        const state = stateRows[0][0] || null;
        const { todayKey, currentSchedule, nextSchedule } = scheduleState;
        const { activeSchedule, primarySchedule } = resolveLuckySpinWindows(todayKey, currentSchedule, nextSchedule);
        const hasPlayedCurrentEvent = !!(
            activeSchedule
            && state?.last_spin_event_key
            && state.last_spin_event_key === activeSchedule.weekKey
        );
        const canPlay = settings.enabled && !!activeSchedule && !hasPlayedCurrentEvent;
        const nextAvailabilitySchedule = canPlay
            ? activeSchedule
            : (
                activeSchedule
                    ? nextSchedule
                    : primarySchedule
            );
        const nextSpinAt = canPlay
            ? null
            : (nextAvailabilitySchedule?.startsAt || state?.next_spin_at || null);
        const remainingMs = canPlay ? 0 : getRemainingMs(nextSpinAt);

        return {
            enabled: settings.enabled,
            title: settings.title,
            subtitle: settings.subtitle,
            timezone: APP_TIMEZONE,
            scheduleMode: settings.scheduleMode,
            serverTime: new Date().toISOString(),
            canPlay,
            nextSpinAt,
            lastSpinAt: state?.last_spin_at || null,
            lastSpinEventKey: state?.last_spin_event_key || null,
            remainingMs,
            todayKey,
            hasPlayedCurrentEvent,
            event: buildLuckySpinSchedulePayload(primarySchedule, todayKey),
            nextEvent: buildLuckySpinSchedulePayload(nextSchedule, todayKey),
            activeEvent: buildLuckySpinSchedulePayload(activeSchedule, todayKey),
            activeBonusCode: activeBonusCode
                ? {
                    ...buildLuckySpinBonusCodePayload({
                        ...activeBonusCode,
                        short_url: hasUsableLuckySpinBonusLink(activeBonusCode) ? activeBonusCode.short_url : ''
                    }),
                    code: activeBonusCode.revealed_at ? activeBonusCode.code || '' : ''
                }
                : null,
            rewards: settings.rewards.map((reward, index) => ({
                index,
                id: reward.id,
                label: reward.label,
                amount: reward.amount,
                weight: reward.weight,
                color: reward.color
            })),
            history: mapLuckySpinHistory(historyRows[0])
        };
    }

    async playLuckySpin(userId, context = {}, options = {}) {
        const settings = await loadLuckySpinSettings();
        if (!settings.enabled) {
            throw new Error('TẠM THỜI TẮT');
        }

        if (!settings.rewards.length) {
            throw new Error('Admin chua cau hinh phan thuong vong quay');
        }

        const normalizedBonusCode = normalizeLuckySpinBonusCode(
            options?.bonusCode
            || options?.freeSpinCode
            || options?.code
            || ''
        );
        const now = new Date();
        const nowIso = now.toISOString();
        let currentEventKey = null;
        let nextSpinAt = null;
        let nextEventStartsAt = null;
        let spinSource = normalizedBonusCode ? 'bonus_code' : 'scheduled';

        if (!normalizedBonusCode) {
            const scheduleState = await this.ensureLuckySpinScheduleHealth(settings);
            const { todayKey, currentSchedule, nextSchedule } = scheduleState;
            const { activeSchedule, primarySchedule } = resolveLuckySpinWindows(todayKey, currentSchedule, nextSchedule);
            nextEventStartsAt = nextSchedule?.startsAt || null;

            if (!activeSchedule) {
                throw buildLuckySpinCooldownError(
                    'Chưa đến lịch ',
                    primarySchedule?.startsAt || nextEventStartsAt
                );
            }

            currentEventKey = activeSchedule.weekKey;
            nextSpinAt = nextEventStartsAt;
        }

        const reward = pickLuckySpinReward(settings.rewards);
        const rewardSnapshot = JSON.stringify({
            id: reward.id,
            label: reward.label,
            amount: reward.amount,
            weight: reward.weight,
            color: reward.color
        });

        const connection = await db.getConnection();
        let nextBalance = 0;
        let consumedBonusCode = null;

        try {
            if (spinSource === 'scheduled') {
                const [stateRows] = await connection.execute(
                    `SELECT user_id, last_spin_at, next_spin_at, last_spin_event_key
                     FROM lucky_spin_state
                     WHERE user_id = ?`,
                    [userId]
                );
                const currentState = stateRows[0] || null;

                if (!currentState) {
                    try {
                        await connection.execute(
                            `INSERT INTO lucky_spin_state (user_id, last_spin_at, next_spin_at, last_spin_event_key, updated_at)
                             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                            [userId, nowIso, nextSpinAt, currentEventKey]
                        );
                    } catch (error) {
                        if (isUniqueConstraintError(error)) {
                            const [retryRows] = await connection.execute(
                                `SELECT next_spin_at, last_spin_event_key
                                 FROM lucky_spin_state
                                 WHERE user_id = ?`,
                                [userId]
                            );
                            const retryState = retryRows[0] || null;
                            if (retryState?.last_spin_event_key === currentEventKey) {
                                throw buildLuckySpinCooldownError(
                                    '......',
                                    retryState.next_spin_at || nextEventStartsAt
                                );
                            }
                        }
                        throw error;
                    }
                } else {
                    if (currentState.last_spin_event_key === currentEventKey) {
                        throw buildLuckySpinCooldownError(
                            'Ban da quay trong su kien tuan nay',
                            currentState.next_spin_at || nextEventStartsAt
                        );
                    }

                    const [updateResult] = await connection.execute(
                        `UPDATE lucky_spin_state
                         SET last_spin_at = ?, next_spin_at = ?, last_spin_event_key = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE user_id = ?
                           AND (last_spin_event_key IS NULL OR last_spin_event_key <> ?)`,
                        [nowIso, nextSpinAt, currentEventKey, userId, currentEventKey]
                    );

                    if (!updateResult.affectedRows) {
                        const [freshRows] = await connection.execute(
                            `SELECT next_spin_at, last_spin_event_key
                             FROM lucky_spin_state
                             WHERE user_id = ?`,
                            [userId]
                        );
                        const freshState = freshRows[0] || null;
                        if (freshState?.last_spin_event_key === currentEventKey) {
                            throw buildLuckySpinCooldownError(
                                'Ban da quay trong su kien tuan nay',
                                freshState.next_spin_at || nextEventStartsAt
                            );
                        }
                        throw new Error('Khong the xac nhan luot quay. Vui long thu lai.');
                    }
                }
            } else {
                consumedBonusCode = await consumeLuckySpinBonusCode(userId, normalizedBonusCode, nowIso, connection);
            }

            const [userRows] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [userId]
            );
            if (!userRows.length) {
                throw new Error('User not found');
            }

            const currentBalance = Number(userRows[0].balance || 0);
            nextBalance = currentBalance + Number(reward.amount || 0);

            const [attemptResult] = await connection.execute(
                `INSERT INTO lucky_spin_attempts
                 (user_id, reward_id, reward_label, reward_amount, reward_snapshot, ip_address, user_agent, spin_source, bonus_code_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    reward.id || null,
                    reward.label,
                    Number(reward.amount || 0),
                    rewardSnapshot,
                    normalizeText(context.ip) || null,
                    normalizeText(context.userAgent).slice(0, 255) || null,
                    spinSource,
                    consumedBonusCode?.id || null
                ]
            );

            if (Number(reward.amount || 0) > 0) {
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [nextBalance, userId]
                );

                await connection.execute(
                    `INSERT INTO transactions
                     (user_id, type, amount, balance_before, balance_after, description, reference_id)
                     VALUES (?, 'deposit', ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        Number(reward.amount || 0),
                        currentBalance,
                        nextBalance,
                        consumedBonusCode
                            ? `Lucky spin reward: ${reward.label} (bonus code ${consumedBonusCode.code})`
                            : `Lucky spin reward: ${reward.label}`,
                        attemptResult.insertId || null
                    ]
                );
            } else {
                nextBalance = currentBalance;
            }

            await connection.commit();

            return {
                reward: {
                    id: reward.id,
                    label: reward.label,
                    amount: Number(reward.amount || 0),
                    color: reward.color,
                    weight: reward.weight
                },
                spinSource,
                usedBonusCode: consumedBonusCode?.code || '',
                balance: nextBalance,
                state: await this.getLuckySpinStatus(userId)
            };
        } catch (error) {
            await connection.rollback();
            if (error.code === 'LUCKY_SPIN_COOLDOWN') {
                await recordSecurityAction('lucky_spin_cooldown_blocked', {
                    userId,
                    ip: context.ip || '',
                    targetKey: error.nextSpinAt || ''
                });
            }
            if (error.code === 'LUCKY_SPIN_BONUS_CODE_INVALID') {
                await recordSecurityAction('lucky_spin_bonus_code_blocked', {
                    userId,
                    ip: context.ip || '',
                    targetKey: normalizedBonusCode
                });
            }
            throw error;
        } finally {
            await connection.release();
        }
    }

    async getDailyCheckinStatus(userId) {
        const [settings, claimRows] = await Promise.all([
            loadDailyCheckinSettings(),
            db.execute(
                `SELECT id, claim_date, reward_day, consecutive_days, reward_amount, reward_label, created_at
                 FROM daily_checkin_claims
                 WHERE user_id = ?
                 ORDER BY claim_date DESC, id DESC
                 LIMIT 14`,
                [userId]
            )
        ]);

        const todayKey = toDateKey(new Date());
        const history = mapDailyCheckinHistory(claimRows[0]);
        const latestClaim = history[0] || null;
        const progress = buildDailyCheckinProgress(settings, latestClaim, todayKey);

        return {
            enabled: settings.enabled,
            title: settings.title,
            subtitle: settings.subtitle,
            timezone: APP_TIMEZONE,
            todayKey,
            canClaim: settings.enabled && progress.canClaim,
            streakBroken: progress.streakBroken,
            consecutiveDays: progress.consecutiveDays,
            nextConsecutiveDays: progress.nextConsecutiveDays,
            nextRewardDay: progress.nextRewardDay,
            todayClaim: progress.todayClaim,
            rewards: settings.rewards,
            history
        };
    }

    async claimDailyCheckin(userId, context = {}) {
        const settings = await loadDailyCheckinSettings();
        if (!settings.enabled) {
            throw new Error('tính nang điểm danh đang tạm tắt');
        }

        if (!settings.rewards.length) {
            throw new Error('Admin chưa cấu hình');
        }

        const todayKey = toDateKey(new Date());
        const maxRewardDay = settings.rewards[settings.rewards.length - 1]?.day || 1;
        const connection = await db.getConnection();
        let nextBalance = 0;

        try {
            const [latestRows] = await connection.execute(
                `SELECT id, claim_date, reward_day, consecutive_days
                 FROM daily_checkin_claims
                 WHERE user_id = ?
                 ORDER BY claim_date DESC, id DESC
                 LIMIT 1`,
                [userId]
            );
            const latestClaim = latestRows[0] || null;

            if (latestClaim && latestClaim.claim_date === todayKey) {
                throw buildDailyCheckinClaimedError(todayKey);
            }

            let nextConsecutiveDays = 1;
            if (latestClaim) {
                const gap = diffDays(latestClaim.claim_date, todayKey);
                nextConsecutiveDays = gap === 1
                    ? Number(latestClaim.consecutive_days || latestClaim.reward_day || 0) + 1
                    : 1;
            }

            const rewardDay = cycleRewardDay(nextConsecutiveDays, maxRewardDay);
            const reward = settings.rewards.find(item => item.day === rewardDay) || settings.rewards[0];

            const [userRows] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [userId]
            );
            if (!userRows.length) {
                throw new Error('User not found');
            }

            const currentBalance = Number(userRows[0].balance || 0);
            nextBalance = currentBalance + Number(reward.amount || 0);

            const [claimResult] = await connection.execute(
                `INSERT INTO daily_checkin_claims
                 (user_id, claim_date, reward_day, consecutive_days, reward_amount, reward_label, ip_address, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    todayKey,
                    rewardDay,
                    nextConsecutiveDays,
                    Number(reward.amount || 0),
                    reward.label || `Ngày ${rewardDay}`,
                    normalizeText(context.ip) || null,
                    normalizeText(context.userAgent).slice(0, 255) || null
                ]
            );

            if (Number(reward.amount || 0) > 0) {
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [nextBalance, userId]
                );

                await connection.execute(
                    `INSERT INTO transactions
                     (user_id, type, amount, balance_before, balance_after, description, reference_id)
                     VALUES (?, 'deposit', ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        Number(reward.amount || 0),
                        currentBalance,
                        nextBalance,
                        `Daily check-in reward - Day ${rewardDay}`,
                        claimResult.insertId || null
                    ]
                );
            } else {
                nextBalance = currentBalance;
            }

            await connection.commit();

            return {
                reward: {
                    day: rewardDay,
                    amount: Number(reward.amount || 0),
                    label: reward.label || `Ngay ${rewardDay}`
                },
                balance: nextBalance,
                state: await this.getDailyCheckinStatus(userId)
            };
        } catch (error) {
            await connection.rollback();
            if (error.code === 'DAILY_CHECKIN_ALREADY_CLAIMED' || isUniqueConstraintError(error)) {
                await recordSecurityAction('daily_checkin_duplicate_blocked', {
                    userId,
                    ip: context.ip || '',
                    targetKey: todayKey
                });
                throw buildDailyCheckinClaimedError(todayKey);
            }
            throw error;
        } finally {
            await connection.release();
        }
    }
}

module.exports = new WalletService();
