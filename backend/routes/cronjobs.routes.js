const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');

const CRON_JOB_BASE = 'https://api.cron-job.org';

async function getCronJobToken() {
    try {
        const [rows] = await db.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'cron_job_token'"
        );
        if (rows.length > 0 && rows[0].setting_value) {
            return rows[0].setting_value.trim();
        }
    } catch (e) {
        console.error('Error fetching cron_job_token in user route:', e);
    }

    const configuredToken = String(process.env.CRON_JOB_TOKEN || '').trim();
    if (configuredToken) {
        return configuredToken;
    }

    throw new Error('Cron-job.org token chưa được cấu hình. Vui lòng thiết lập CRON_JOB_TOKEN hoặc setting cron_job_token.');
}

// Rate limiter for user cron job operations to prevent spamming the cron-job.org API
const cronLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 15, // Max 15 requests per minute
    message: {
        success: false,
        message: 'Bạn đang thao tác quá nhanh. Vui lòng thử lại sau 1 phút.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Protect and rate-limit all routes under this router
router.use(cronLimiter);
router.use(authenticate);

// Helper to check if a job belongs to a user
function doesJobBelongToUser(jobTitle, userId) {
    return String(jobTitle || '').startsWith(`[User #${userId}]`);
}

// Helper to validate target URL to prevent SSRF or local addresses
function validateCronJobUrl(urlStr) {
    if (!urlStr) {
        throw new Error('Đường dẫn API (URL) không được để trống');
    }
    
    let parsedUrl;
    try {
        parsedUrl = new URL(urlStr);
    } catch (e) {
        throw new Error('Đường dẫn API (URL) không đúng định dạng');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Đường dẫn API (URL) phải bắt đầu bằng http:// hoặc https://');
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    
    // Block local/private addresses
    if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.20.') ||
        hostname.startsWith('172.21.') ||
        hostname.startsWith('172.22.') ||
        hostname.startsWith('172.23.') ||
        hostname.startsWith('172.24.') ||
        hostname.startsWith('172.25.') ||
        hostname.startsWith('172.26.') ||
        hostname.startsWith('172.27.') ||
        hostname.startsWith('172.28.') ||
        hostname.startsWith('172.29.') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.') ||
        hostname.endsWith('.local') ||
        hostname === 'localhost.localdomain'
    ) {
        throw new Error('Đường dẫn API không được trỏ đến địa chỉ cục bộ (localhost/private IP)');
    }
}

// Helper to parse responses safely without throwing JSON syntax errors
async function parseResponse(response) {
    const text = await response.text();
    if (!text) {
        return { success: response.ok, message: `HTTP status ${response.status}` };
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        return { success: response.ok, message: text };
    }
}

// 1. List user's jobs
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const token = await getCronJobToken();
        const response = await fetch(`${CRON_JOB_BASE}/jobs`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        
        const data = await parseResponse(response);
        if (!response.ok) {
            return res.status(response.status).json({ success: false, ...data });
        }

        // Filter jobs belonging to this user
        const userJobs = (data.jobs || []).filter(job => doesJobBelongToUser(job.title, userId));
        
        // Strip the user prefix from the title for display
        const displayJobs = userJobs.map(job => ({
            ...job,
            title: job.title.replace(`[User #${userId}] `, '')
        }));

        res.json({ success: true, data: { jobs: displayJobs } });
    } catch (error) {
        const statusCode = error.message?.includes('Cron-job.org token') ? 503 : 500;
        res.status(statusCode).json({ success: false, message: error.message });
    }
});

// 2. Create user's job
router.put('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const jobData = req.body.job;

        if (!jobData || !jobData.title || !jobData.url) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin tác vụ' });
        }

        // Validate URL
        try {
            validateCronJobUrl(jobData.url);
        } catch (urlError) {
            return res.status(400).json({ success: false, message: urlError.message });
        }

        const token = await getCronJobToken();

        // Check current job limit for this user (max 5)
        const listResponse = await fetch(`${CRON_JOB_BASE}/jobs`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        const listData = await parseResponse(listResponse);
        if (listResponse.ok) {
            const userJobsCount = (listData.jobs || []).filter(job => doesJobBelongToUser(job.title, userId)).length;
            if (userJobsCount >= 5) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Bạn đã đạt giới hạn tối đa 5 tác vụ cron job. Vui lòng xóa bớt tác vụ cũ để thêm mới.' 
                });
            }
        } else {
            return res.status(listResponse.status).json({ success: false, ...listData });
        }

        // Enforce prefix in title
        jobData.title = `[User #${userId}] ${jobData.title}`;

        const response = await fetch(`${CRON_JOB_BASE}/jobs`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ job: jobData })
        });
        
        const data = await parseResponse(response);
        if (!response.ok) {
            return res.status(response.status).json({ success: false, ...data });
        }
        res.json({ success: true, data });
    } catch (error) {
        const statusCode = error.message?.includes('Cron-job.org token') ? 503 : 500;
        res.status(statusCode).json({ success: false, message: error.message });
    }
});

// Helper to fetch single job from cron-job.org and verify ownership
async function verifyJobOwnership(jobId, userId) {
    const token = await getCronJobToken();
    const response = await fetch(`${CRON_JOB_BASE}/jobs/${jobId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        }
    });
    const data = await parseResponse(response);
    if (!response.ok) {
        throw new Error(data.message || 'Không tìm thấy tác vụ trên hệ thống');
    }
    if (!doesJobBelongToUser(data.job?.title, userId)) {
        throw new Error('Bạn không có quyền thực hiện hành động này');
    }
    return data.job;
}

// 3. Update/Toggle user's job
router.patch('/:id', async (req, res) => {
    try {
        const jobId = req.params.id;
        const userId = req.user.id;
        const updateData = req.body.job || {};

        // Verify ownership
        const existingJob = await verifyJobOwnership(jobId, userId);

        // Validate URL if it is being updated
        if (updateData.url) {
            try {
                validateCronJobUrl(updateData.url);
            } catch (urlError) {
                return res.status(400).json({ success: false, message: urlError.message });
            }
        }

        // If title is being updated, enforce prefix
        if (updateData.title) {
            updateData.title = `[User #${userId}] ${updateData.title}`;
        }

        // Merge updates
        const mergedJob = {
            ...existingJob,
            ...updateData
        };

        const token = await getCronJobToken();
        const response = await fetch(`${CRON_JOB_BASE}/jobs/${jobId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ job: mergedJob })
        });

        const data = await parseResponse(response);
        if (!response.ok) {
            return res.status(response.status).json({ success: false, ...data });
        }
        res.json({ success: true, data });
    } catch (error) {
        const statusCode = error.message?.includes('Cron-job.org token') ? 503 : (error.message.includes('quyền') ? 403 : 500);
        res.status(statusCode).json({ success: false, message: error.message });
    }
});

// 4. Delete user's job
router.delete('/:id', async (req, res) => {
    try {
        const jobId = req.params.id;
        const userId = req.user.id;

        // Verify ownership
        await verifyJobOwnership(jobId, userId);

        const token = await getCronJobToken();
        const response = await fetch(`${CRON_JOB_BASE}/jobs/${jobId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        const data = await parseResponse(response);
        if (!response.ok) {
            return res.status(response.status).json({ success: false, ...data });
        }
        res.json({ success: true, data });
    } catch (error) {
        const statusCode = error.message?.includes('Cron-job.org token') ? 503 : (error.message.includes('quyền') ? 403 : 500);
        res.status(statusCode).json({ success: false, message: error.message });
    }
});

module.exports = router;
