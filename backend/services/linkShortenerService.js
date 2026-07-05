require('dotenv').config();

const DEFAULT_LINK4M_ENDPOINTS = [
    'https://link4m.co/api-shorten/v2'
];

function normalizeText(value = '') {
    return String(value || '').trim();
}

function normalizeUrl(value = '') {
    const input = normalizeText(value);
    if (!input) {
        return '';
    }

    try {
        return new URL(input).toString().replace(/\/+$/, '');
    } catch (_) {
        return '';
    }
}

function resolvePublicBaseUrl(context = {}) {
    const directCandidates = [
        context.origin,
        context.baseUrl,
        process.env.APP_URL,
        process.env.BASE_URL,
        process.env.SITE_URL,
        process.env.PUBLIC_URL,
        process.env.RENDER_EXTERNAL_URL
    ];

    for (const candidate of directCandidates) {
        const normalized = normalizeUrl(candidate);
        if (normalized) {
            return normalized;
        }
    }

    const host = normalizeText(context.forwardedHost || context.host);
    if (!host) {
        return '';
    }

    const protocol = normalizeText(context.forwardedProto || context.protocol).toLowerCase() || 'https';
    const safeProtocol = ['http', 'https'].includes(protocol) ? protocol : 'https';

    return `${safeProtocol}://${host}`;
}

function extractUrlFromString(value = '') {
    const match = String(value || '').match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : '';
}

function isBlockedChallengeUrl(url = '') {
    const normalized = normalizeText(url).toLowerCase();
    return (
        normalized.includes('challenges.cloudflare.com')
        || normalized.includes('/turnstile/')
    );
}

function extractShortUrl(payload) {
    if (!payload) {
        return '';
    }

    if (typeof payload === 'string') {
        return extractUrlFromString(payload);
    }

    if (Array.isArray(payload)) {
        for (const item of payload) {
            const found = extractShortUrl(item);
            if (found) return found;
        }
        return '';
    }

    const preferredKeys = [
        'shortenedUrl',
        'short_url',
        'shortUrl',
        'shortlink',
        'short_link',
        'short',
        'link',
        'url'
    ];

    for (const key of preferredKeys) {
        const found = extractShortUrl(payload[key]);
        if (found && !isBlockedChallengeUrl(found)) return found;
    }

    for (const value of Object.values(payload)) {
        const found = extractShortUrl(value);
        if (found && !isBlockedChallengeUrl(found)) return found;
    }

    return '';
}

function getLink4mEndpoints() {
    const configured = normalizeText(process.env.LINK4M_API_ENDPOINT);
    const candidates = configured
        ? [configured, ...DEFAULT_LINK4M_ENDPOINTS]
        : DEFAULT_LINK4M_ENDPOINTS;

    return Array.from(new Set(candidates.map(item => item.trim()).filter(Boolean)));
}

async function requestShortUrl(endpoint, apiKey, destinationUrl) {
    const apiUrl = new URL(endpoint);
    apiUrl.searchParams.set('api', apiKey);
    apiUrl.searchParams.set('url', destinationUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(apiUrl.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json,text/plain,*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
            },
            signal: controller.signal
        });

        const rawText = await response.text();
        let payload = rawText;
        try {
            payload = JSON.parse(rawText);
        } catch (_) {
            // Keep raw text fallback.
        }

        if (String(rawText || '').toLowerCase().includes('challenges.cloudflare.com/turnstile')) {
            throw new Error('Link4m is blocking automated requests with a Cloudflare challenge');
        }

        if (!response.ok) {
            const message = typeof payload === 'object'
                ? JSON.stringify(payload)
                : rawText;
            const error = new Error(`Link4m returned HTTP ${response.status}${message ? `: ${message}` : ''}`);
            error.status = response.status;
            throw error;
        }

        const shortUrl = extractShortUrl(payload);
        if (!shortUrl) {
            throw new Error('Link4m response does not contain a shortened URL');
        }

        return {
            shortUrl,
            payload
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function shortenWithLink4m(destinationUrl) {
    const apiKey = normalizeText(process.env.LINK4M_API_KEY);
    if (!apiKey) {
        throw new Error('Link4m API key is not configured');
    }

    let lastError = null;
    const endpoints = getLink4mEndpoints();

    for (const endpoint of endpoints) {
        try {
            const result = await requestShortUrl(endpoint, apiKey, destinationUrl);
            return {
                provider: 'link4m',
                endpoint,
                ...result
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Could not create Link4m short URL');
}

module.exports = {
    shortenWithLink4m,
    resolvePublicBaseUrl
};
