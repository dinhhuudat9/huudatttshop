// ============================================
// SERVER ENTRY POINT
// File: backend/server.js
// ============================================

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
require('dotenv').config();

const app = require('./app');
const { ensureBootstrapped } = require('./bootstrap');
const humanGateService = require('./services/humanGateService');
const { adminPortalGuard } = require('./middleware/adminPortalGuard');
const productService = require('./services/productService');

const FRONTEND_ROOT = path.join(__dirname, '../frontend');
const FRAME_ROOT = path.join(__dirname, '../khungcanhan');
const APP_ENTRY_FILE = path.join(FRONTEND_ROOT, 'index.html');
const HUMAN_GATE_FILE = path.join(FRONTEND_ROOT, 'human-check.html');
const recaptchaService = require('./services/recaptchaService');
const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const DEFAULT_SITE_NAME = process.env.SITE_NAME || 'Sang dev';
const DEFAULT_SHARE_DESCRIPTION = process.env.SITE_SHARE_DESCRIPTION || 'sàn giao dịch mã nguồn và kỉ sản phẩm kỉ thuật số';
const DEFAULT_SHARE_IMAGE = process.env.SITE_SHARE_IMAGE || '/img/icon.ico';

function setStaticCacheHeaders(res, filePath) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    const extension = path.extname(normalizedPath);

    if (normalizedPath.endsWith('/human-check.html') || normalizedPath.endsWith('/blocked-ip.html')) {
        res.setHeader('Cache-Control', 'no-store');
        return;
    }

    if (!IS_PRODUCTION && ['.html', '.js', '.css'].includes(extension)) {
        res.setHeader('Cache-Control', 'no-store');
        return;
    }

    if (extension === '.html') {
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        return;
    }

    if (['.js', '.css'].includes(extension)) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
        return;
    }

    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif', '.woff', '.woff2'].includes(extension)) {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
}

function sendHtmlFile(res, filePath) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(filePath);
}

function escapeHtml(input) {
    return String(input || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripHtml(input) {
    return String(input || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncateText(input, maxLength = 180) {
    const text = String(input || '').trim();
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function getRequestOrigin(req) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0]
        .trim();

    if (!forwardedHost) {
        return process.env.APP_URL || process.env.BASE_URL || process.env.SITE_URL || process.env.PUBLIC_URL || 'http://localhost:3000';
    }

    return `${forwardedProto}://${forwardedHost}`;
}

function toAbsoluteUrl(input, origin) {
    const raw = String(input || '').trim();
    if (!raw) {
        return '';
    }

    try {
        return new URL(raw, origin).href;
    } catch (_) {
        return '';
    }
}

function isSocialPreviewBot(req) {
    const userAgent = String(req.headers['user-agent'] || '').toLowerCase();
    if (!userAgent) {
        return false;
    }

    return [
        'facebookexternalhit',
        'facebot',
        'twitterbot',
        'telegrambot',
        'discordbot',
        'linkedinbot',
        'slackbot',
        'skypeuripreview',
        'whatsapp',
        'pinterest',
        'vkshare',
        'zalo',
        'googlebot',
        'bingbot',
        'applebot'
    ].some(token => userAgent.includes(token));
}

function buildShareDescription(product) {
    const parts = [];
    const summary = stripHtml(product?.description || product?.content || '');
    if (summary) {
        parts.push(summary);
    }

    const price = Number(product?.effective_price ?? product?.price ?? 0);
    if (Number.isFinite(price) && price > 0) {
        parts.push(`Gia ${price.toLocaleString('vi-VN')} VND`);
    } else {
        parts.push('Sản phẩm miễn phí');
    }

    if (product?.seller_name) {
        parts.push(`Người bán: ${product.seller_name}`);
    }

    return truncateText(parts.join(' | ') || DEFAULT_SHARE_DESCRIPTION, 200);
}

function injectHeadMetadata(template, metadata) {
    const titleTag = `<title>${escapeHtml(metadata.title)}</title>`;
    const metaTags = [
        `<meta name="description" content="${escapeHtml(metadata.description)}">`,
        `<link rel="canonical" href="${escapeHtml(metadata.url)}">`,
        `<meta property="og:type" content="product">`,
        `<meta property="og:site_name" content="${escapeHtml(DEFAULT_SITE_NAME)}">`,
        `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
        `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
        `<meta property="og:url" content="${escapeHtml(metadata.url)}">`,
        `<meta property="og:image" content="${escapeHtml(metadata.image)}">`,
        `<meta property="og:image:alt" content="${escapeHtml(metadata.imageAlt)}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${escapeHtml(metadata.title)}">`,
        `<meta name="twitter:description" content="${escapeHtml(metadata.description)}">`,
        `<meta name="twitter:image" content="${escapeHtml(metadata.image)}">`
    ].join('\n    ');

    return template
        .replace(/<title>[\s\S]*?<\/title>/i, titleTag)
        .replace('</head>', `    ${metaTags}\n</head>`);
}

async function renderProductSharePage(req, res, identifier) {
    const origin = getRequestOrigin(req);
    const appTemplate = await fs.readFile(APP_ENTRY_FILE, 'utf8');

    try {
        const product = await productService.getProductSharePreview(identifier);
        const metadata = {
            title: truncateText(
                product?.title ? `${product.title} | ${DEFAULT_SITE_NAME}` : DEFAULT_SITE_NAME,
                120
            ),
            description: buildShareDescription(product),
            image: toAbsoluteUrl(product?.main_image || DEFAULT_SHARE_IMAGE, origin) || toAbsoluteUrl(DEFAULT_SHARE_IMAGE, origin),
            imageAlt: product?.title || DEFAULT_SITE_NAME,
            url: toAbsoluteUrl(req.originalUrl || req.path || '/', origin) || origin
        };

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(injectHeadMetadata(appTemplate, metadata));
    } catch (_) {
        const fallbackMetadata = {
            title: DEFAULT_SITE_NAME,
            description: DEFAULT_SHARE_DESCRIPTION,
            image: toAbsoluteUrl(DEFAULT_SHARE_IMAGE, origin),
            imageAlt: DEFAULT_SITE_NAME,
            url: toAbsoluteUrl(req.originalUrl || req.path || '/', origin) || origin
        };

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(injectHeadMetadata(appTemplate, fallbackMetadata));
    }
}

app.use((req, res, next) => {
    const requestPath = String(req.path || '').replace(/\\/g, '/');
    const isProtectedFrontendAsset =
        (requestPath.startsWith('/pages/') && requestPath.endsWith('.html')) ||
        (requestPath.startsWith('/css/') && requestPath.endsWith('.css')) ||
        (requestPath.startsWith('/js/pages/') && requestPath.endsWith('.js'));

    if (isProtectedFrontendAsset) {
        return res.status(404).send('Not found');
    }

    return next();
});

app.use(adminPortalGuard);

function shouldGateHtmlRequest(req) {
    if (!['GET', 'HEAD'].includes(req.method)) {
        return false;
    }

    const requestPath = String(req.path || '').replace(/\\/g, '/');
    if (!requestPath || requestPath.startsWith('/api/') || requestPath.startsWith('/frames/')) {
        return false;
    }

    if (requestPath === '/blocked-ip.html') {
        return false;
    }

    if (requestPath === '/human-check.html') {
        return true;
    }

    const hasExtension = path.extname(requestPath) !== '';
    if (!hasExtension) {
        return true;
    }

    return requestPath.endsWith('.html');
}

app.use((req, res, next) => {
    // If captcha is not configured, skip human gate entirely
    if (!recaptchaService.isEnabled(req)) {
        return next();
    }

    if (isSocialPreviewBot(req)) {
        return next();
    }

    if (!shouldGateHtmlRequest(req)) {
        return next();
    }

    if (humanGateService.hasClearance(req)) {
        if (req.path === '/human-check.html') {
            return res.redirect(302, '/');
        }
        return next();
    }

    return sendHtmlFile(res, HUMAN_GATE_FILE);
});

// Serve static files (local dev)
app.use(express.static(FRONTEND_ROOT, {
    index: false,
    setHeaders: setStaticCacheHeaders
}));
app.use('/frames', express.static(FRAME_ROOT, {
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
}));

app.get(['/product/:id', '/page2/:slug'], async (req, res, next) => {
    try {
        const identifier = req.params.id || req.params.slug;
        if (!identifier) {
            return next();
        }

        return await renderProductSharePage(req, res, identifier);
    } catch (error) {
        return next(error);
    }
});

// ============================================
// SERVE INDEX.HTML FOR ALL ROUTES (SPA)
// ============================================
app.get('*', (req, res) => {
    if (!recaptchaService.isEnabled(req) || humanGateService.hasClearance(req) || isSocialPreviewBot(req)) {
        return sendHtmlFile(res, APP_ENTRY_FILE);
    }

    return sendHtmlFile(res, HUMAN_GATE_FILE);
});

// ============================================
// START SERVER
// ============================================
async function startServer() {
    const PORT = process.env.PORT || 3000;

    await ensureBootstrapped({ startTelegramBot: true });

    app.listen(PORT, () => {
        console.log('\n============================================');
        console.log('SANG DEV SHOP');
        console.log(`Server: http://localhost:${PORT}`);
        console.log(`API: http://localhost:${PORT}/api`);
        console.log('============================================\n');
    });
}

startServer();
