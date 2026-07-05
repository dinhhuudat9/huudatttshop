// ============================================
// In-memory log buffer for admin view
// ============================================

const MAX_LOGS = 500;
const buffer = [];
let totalRequestCount = 0;
const requestTimestamps = [];
const REQUEST_WINDOW_MS = 60 * 60 * 1000; // keep last 1h for quick stats

function push(entry) {
    buffer.push(entry);
    if (buffer.length > MAX_LOGS) {
        buffer.shift();
    }
}

function pruneRequestTimestamps(now = Date.now()) {
    const cutoff = now - REQUEST_WINDOW_MS;
    while (requestTimestamps.length && requestTimestamps[0] < cutoff) {
        requestTimestamps.shift();
    }
}

function recordRequest({ method, path, status, durationMs, userId = null, email = null, ip = '' }) {
    const now = Date.now();
    totalRequestCount += 1;
    requestTimestamps.push(now);
    pruneRequestTimestamps(now);

    push({
        type: 'request',
        ts: new Date().toISOString(),
        method,
        path,
        status,
        durationMs,
        userId,
        email,
        ip
    });
}

function recordLogin({ email, userId = null, success = true, ip = '' }) {
    push({
        type: 'login',
        ts: new Date().toISOString(),
        email,
        userId,
        success,
        ip
    });
}

function recordSecurity({ action, ip = '', reason = '', detail = '', path = '', method = '', blockUntil = null }) {
    push({
        type: 'security',
        ts: new Date().toISOString(),
        action,
        ip,
        reason,
        detail,
        path,
        method,
        blockUntil
    });
}

function getLogs(limit = 200) {
    const n = Math.min(limit, buffer.length);
    return buffer.slice(buffer.length - n);
}

function getRequestStats() {
    const now = Date.now();
    pruneRequestTimestamps(now);

    const bufferedRequests = buffer.filter((entry) => entry.type === 'request');
    const last5m = bufferedRequests.filter(
        (entry) => entry.ts && Date.now() - Date.parse(entry.ts) <= 5 * 60 * 1000
    ).length;

    return {
        total: totalRequestCount,
        buffered: bufferedRequests.length,
        last1h: requestTimestamps.length,
        last5m,
        windowMs: REQUEST_WINDOW_MS
    };
}

module.exports = {
    recordRequest,
    recordLogin,
    recordSecurity,
    getLogs,
    getRequestStats
};
