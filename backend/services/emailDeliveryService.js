const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const APP_NAME = process.env.SITE_NAME || 'Sang dev shop';
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const parsedSmtpPort = Number.parseInt(process.env.SMTP_PORT || '0', 10);
const SMTP_PORT = Number.isFinite(parsedSmtpPort) ? parsedSmtpPort : 0;
const SMTP_SECURE = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SMTP_SECURE || '').trim().toLowerCase()
);
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const BREVO_SMTP_HOST = String(process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com').trim();
const parsedBrevoSmtpPort = Number.parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
const BREVO_SMTP_PORT = Number.isFinite(parsedBrevoSmtpPort) ? parsedBrevoSmtpPort : 587;
const BREVO_SMTP_SECURE = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.BREVO_SMTP_SECURE || (BREVO_SMTP_PORT === 465 ? 'true' : 'false')).trim().toLowerCase()
);
const BREVO_SMTP_LOGIN = String(
    process.env.BREVO_SMTP_LOGIN || process.env.BREVO_SMTP_USERNAME || ''
).trim();
const BREVO_SMTP_KEY = String(
    process.env.BREVO_SMTP_KEY || process.env.BREVO_SMTP_PASSWORD || ''
).trim();
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim();
const BREVO_SENDER_EMAIL = String(
    process.env.BREVO_SENDER_EMAIL || process.env.BREVO_FROM_EMAIL || process.env.MAIL_FROM || process.env.EMAIL_FROM || ''
).trim();
const BREVO_SENDER_NAME = String(process.env.BREVO_SENDER_NAME || process.env.MAIL_FROM_NAME || APP_NAME).trim();
const BREVO_SANDBOX_ENABLED = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.BREVO_SANDBOX || '').trim().toLowerCase()
);
const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
const { Resend } = require('resend');
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || 're_g4RSRPzr_8kb4gokhs96hoKETR24L1hHM').trim();
const resendClient = new Resend(RESEND_API_KEY);
const MAIL_FROM = String(
    process.env.RESEND_FROM_EMAIL || process.env.MAIL_FROM || process.env.EMAIL_FROM || 'onboarding@resend.dev'
).trim();
const MAIL_FROM_NAME = String(process.env.MAIL_FROM_NAME || APP_NAME).trim();
const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

let brevoSmtpTransporter = null;
let smtpTransporter = null;

function createMailConfigError() {
    const error = new Error(
        'Server chua cau hinh gui email OTP. Can SMTP_HOST/SMTP_USER/SMTP_PASS hoac BREVO_SMTP_LOGIN + BREVO_SMTP_KEY + BREVO_SENDER_EMAIL hoac BREVO_API_KEY/BREVO_SENDER_EMAIL.'
    );
    error.statusCode = 500;
    return error;
}

function formatAddress(email, name = '') {
    const safeEmail = String(email || '').trim();
    const safeName = String(name || '').trim();

    if (!safeEmail) {
        return '';
    }

    return safeName ? `${safeName} <${safeEmail}>` : safeEmail;
}

function buildBrevoSender() {
    if (!BREVO_SENDER_EMAIL) {
        return null;
    }

    return {
        email: BREVO_SENDER_EMAIL,
        name: BREVO_SENDER_NAME || APP_NAME
    };
}

function buildBrevoFromAddress() {
    const sender = buildBrevoSender();
    if (!sender) {
        return '';
    }

    return formatAddress(sender.email, sender.name);
}

function buildBrevoRecipients(to) {
    const recipients = Array.isArray(to) ? to : [to];
    return recipients
        .map((entry) => {
            if (!entry) {
                return null;
            }

            if (typeof entry === 'string') {
                return { email: entry };
            }

            if (typeof entry === 'object' && entry.email) {
                return {
                    email: entry.email,
                    name: entry.name || undefined
                };
            }

            return null;
        })
        .filter(Boolean);
}

function buildResendFromAddress() {
    if (!MAIL_FROM) {
        return '';
    }

    return formatAddress(MAIL_FROM, MAIL_FROM_NAME);
}

function buildGenericSmtpFromAddress() {
    const fromEmail = MAIL_FROM || SMTP_USER;
    const fromName = MAIL_FROM_NAME || APP_NAME;
    return formatAddress(fromEmail, fromName);
}

function getBrevoSmtpTransporter() {
    if (!BREVO_SMTP_LOGIN || !BREVO_SMTP_KEY || !BREVO_SENDER_EMAIL) {
        return null;
    }

    if (!brevoSmtpTransporter) {
        brevoSmtpTransporter = nodemailer.createTransport({
            pool: true,
            maxConnections: 3,
            maxMessages: 100,
            host: BREVO_SMTP_HOST,
            port: BREVO_SMTP_PORT,
            secure: BREVO_SMTP_SECURE,
            auth: {
                user: BREVO_SMTP_LOGIN,
                pass: BREVO_SMTP_KEY
            }
        });
    }

    return brevoSmtpTransporter;
}

function getGenericSmtpTransporter() {
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        return null;
    }

    if (!smtpTransporter) {
        smtpTransporter = nodemailer.createTransport({
            pool: true,
            maxConnections: 3,
            maxMessages: 100,
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });
    }

    return smtpTransporter;
}

function buildSmtpRecipients(to) {
    return buildBrevoRecipients(to).map((entry) => formatAddress(entry.email, entry.name || ''));
}

async function sendWithGenericSmtp({ to, subject, html, text }) {
    const transporter = getGenericSmtpTransporter();
    if (!transporter) {
        throw createMailConfigError();
    }

    const info = await transporter.sendMail({
        from: buildGenericSmtpFromAddress(),
        to: buildSmtpRecipients(to),
        subject,
        html,
        text
    });

    return {
        provider: 'smtp',
        messageId: info.messageId,
        accepted: info.accepted || []
    };
}

async function sendWithBrevoSmtp({ to, subject, html, text }) {
    const transporter = getBrevoSmtpTransporter();
    if (!transporter) {
        throw createMailConfigError();
    }

    const info = await transporter.sendMail({
        from: buildBrevoFromAddress(),
        to: buildSmtpRecipients(to),
        subject,
        html,
        text
    });

    return {
        provider: 'brevo-smtp',
        messageId: info.messageId,
        accepted: info.accepted || []
    };
}

async function sendWithBrevoApi({ to, subject, html, text }) {
    const sender = buildBrevoSender();
    const recipients = buildBrevoRecipients(to);

    const payload = {
        sender,
        to: recipients,
        subject
    };

    if (html) {
        payload.htmlContent = html;
    }
    if (text) {
        payload.textContent = text;
    }
    if (BREVO_SANDBOX_ENABLED) {
        payload.headers = {
            'X-Sib-Sandbox': 'drop'
        };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s safety timeout

    let response;
    try {
        response = await fetch(BREVO_API_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'api-key': BREVO_API_KEY
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } catch (err) {
        if (err.name === 'AbortError') {
            const error = new Error('Khong gui duoc email OTP (timeout khi goi Brevo API).');
            error.statusCode = 504;
            throw error;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }

    const responseText = await response.text();
    let parsedPayload = {};

    try {
        parsedPayload = responseText ? JSON.parse(responseText) : {};
    } catch (_) {
        parsedPayload = {};
    }

    if (!response.ok) {
        const message =
            parsedPayload?.message ||
            parsedPayload?.code ||
            responseText ||
            'Khong gui duoc email OTP qua Brevo API.';
        const error = new Error(message);
        error.statusCode = response.status || 502;
        throw error;
    }

    return {
        provider: 'brevo-api',
        ...parsedPayload
    };
}

async function sendWithResend({ to, subject, html, text }) {
    const { data, error } = await resendClient.emails.send({
        from: buildResendFromAddress(),
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined
    });

    if (error) {
        const message = error.message || 'Khong gui duoc email OTP.';
        const err = new Error(message);
        err.statusCode = 502;
        throw err;
    }

    return {
        provider: 'resend',
        ...data
    };
}

async function sendMail({ to, subject, html, text, forceProvider }) {
    const provider = forceProvider || EMAIL_PROVIDER;

    if (provider === 'smtp' || provider === 'gmail') {
        if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
            throw createMailConfigError();
        }
        return sendWithGenericSmtp({ to, subject, html, text });
    }

    if (provider === 'brevo-api') {
        if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
            throw createMailConfigError();
        }
        return sendWithBrevoApi({ to, subject, html, text });
    }

    if (provider === 'brevo-smtp') {
        if (!BREVO_SMTP_LOGIN || !BREVO_SMTP_KEY || !BREVO_SENDER_EMAIL) {
            throw createMailConfigError();
        }
        return sendWithBrevoSmtp({ to, subject, html, text });
    }

    if (provider === 'resend') {
        if (!RESEND_API_KEY || !MAIL_FROM) {
            throw createMailConfigError();
        }
        return sendWithResend({ to, subject, html, text });
    }

    if (BREVO_API_KEY && BREVO_SENDER_EMAIL) {
        return sendWithBrevoApi({ to, subject, html, text });
    }

    if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
        return sendWithGenericSmtp({ to, subject, html, text });
    }

    if (BREVO_SMTP_LOGIN && BREVO_SMTP_KEY && BREVO_SENDER_EMAIL) {
        return sendWithBrevoSmtp({ to, subject, html, text });
    }

    if (RESEND_API_KEY && MAIL_FROM) {
        return sendWithResend({ to, subject, html, text });
    }

    if (!IS_PRODUCTION) {
        console.log('[dev-email] to=%s subject=%s text=%s', to, subject, text);
        return {
            provider: 'console-log'
        };
    }

    throw createMailConfigError();
}

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatOtpForPlainText(otpCode = '') {
    return String(otpCode || '')
        .trim()
        .split('')
        .join(' ');
}

function buildOtpDigitsHtml(otpCode = '') {
    const digits = String(otpCode || '').trim().split('');

    return digits
        .map((digit) => `
            <td align="center" valign="middle" style="width:52px;height:60px;border:1px solid #d7e2ec;border-radius:14px;background-color:#f8fafc;font-size:28px;line-height:28px;font-weight:800;color:#0f172a;">
                ${escapeHtml(digit)}
            </td>
        `)
        .join('<td style="width:8px;font-size:0;line-height:0;">&nbsp;</td>');
}

async function sendRegistrationOtp({ to, otpCode, fullName = '', expiresInMinutes = 10, forceProvider }) {
    const safeName = String(fullName || '').trim();
    const greeting = safeName ? `Xin chao ${safeName},` : 'Xin chao,';
    const safeAppName = escapeHtml(APP_NAME);
    const safeGreeting = escapeHtml(greeting);
    const safeOtpCode = escapeHtml(otpCode);
    const safeOtpDigitsHtml = buildOtpDigitsHtml(otpCode);
    const subject = `${APP_NAME} | Ma OTP dang ky cua ban`;
    const text = [
        greeting,
        '',
        `Ban vua yeu cau tao tai khoan tren ${APP_NAME}.`,
        `Ma OTP cua ban: ${formatOtpForPlainText(otpCode)}`,
        '',
        `Ma co hieu luc trong ${expiresInMinutes} phut.`,
        'Khong chia se ma nay cho bat ky ai.',
        '',
        'Neu ban khong thuc hien yeu cau nay, hay bo qua email nay.'
    ].join('\n');
    const html = `
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
            Ma OTP dang ky cua ban la ${safeOtpCode}. Ma co hieu luc trong ${expiresInMinutes} phut.
        </div>
        <div style="margin:0;padding:24px 12px;background-color:#eef4f8;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#0f172a;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
                <tr>
                    <td align="center">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;border-collapse:separate;background-color:#ffffff;border:1px solid #d8e2eb;border-radius:24px;overflow:hidden;">
                            <tr>
                                <td style="padding:20px 28px;background-color:#0f766e;">
                                    <div style="font-size:13px;line-height:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ccfbf1;">
                                        ${safeAppName}
                                    </div>
                                    <div style="margin-top:10px;font-size:28px;line-height:36px;font-weight:800;color:#ffffff;">
                                        Xac nhan tao tai khoan
                                    </div>
                                    <div style="margin-top:8px;font-size:14px;line-height:22px;color:#d9fffb;">
                                        Day la email xac minh dang ky. Chi can nhap ma OTP ben duoi de hoan tat tai khoan.
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:30px 28px 10px 28px;">
                                    <div style="font-size:16px;line-height:26px;font-weight:600;color:#0f172a;">
                                        ${safeGreeting}
                                    </div>
                                    <div style="margin-top:12px;font-size:15px;line-height:24px;color:#334155;">
                                        Ban vua yeu cau tao tai khoan tren <strong>${safeAppName}</strong>. Su dung ma OTP sau de xac nhan email cua ban.
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:8px 28px 6px 28px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="border-collapse:separate;margin:0 auto;">
                                        <tr>
                                            ${safeOtpDigitsHtml}
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:10px 28px 0 28px;" align="center">
                                    <div style="display:inline-block;padding:10px 14px;border-radius:999px;background-color:#ecfeff;font-size:13px;line-height:18px;font-weight:700;color:#0f766e;">
                                        Ma co hieu luc trong ${expiresInMinutes} phut
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:22px 28px 4px 28px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
                                        <tr>
                                            <td style="padding:14px 16px;border:1px solid #dbe7f0;border-radius:16px;background-color:#f8fafc;font-size:14px;line-height:22px;color:#334155;">
                                                <strong>Luu y:</strong> Khong chia se ma nay cho bat ky ai. Doi ngu cua ${safeAppName} se khong bao gio hoi OTP cua ban.
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:16px 28px 30px 28px;font-size:14px;line-height:22px;color:#475569;">
                                    Neu ban khong thuc hien yeu cau nay, hay bo qua email nay. Tai khoan se khong duoc tao neu ma OTP khong duoc xac nhan.
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:18px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:20px;color:#64748b;">
                                    Email nay duoc gui tu he thong tu dong cua ${safeAppName}. Vui long khong tra loi truc tiep email nay.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    `;

    return sendMail({
        to,
        subject,
        html,
        text,
        forceProvider
    });
}

module.exports = {
    sendMail,
    sendRegistrationOtp
};
