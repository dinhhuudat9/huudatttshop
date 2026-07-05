// ============================================
// INTERNAL SYSTEM CRON SERVICE
// File: backend/services/cronService.js
// ============================================

const db = require('../config/database');

class CronService {
    constructor() {
        this.timers = {};
        this.jobs = {
            cleanupNotifications: {
                name: 'cleanupNotifications',
                intervalMs: 60 * 60 * 1000, // 1 hour
                run: async () => {
                    const [result] = await db.execute(
                        "DELETE FROM notifications WHERE created_at < datetime('now', '-12 hours')"
                    );
                    return `Đã dọn dẹp ${result.affectedRows || 0} thông báo đã hết hạn (hơn 12 giờ).`;
                }
            },
            cleanupExpiredOtps: {
                name: 'cleanupExpiredOtps',
                intervalMs: 30 * 60 * 1000, // 30 minutes
                run: async () => {
                    const [result] = await db.execute(
                        "DELETE FROM registration_otps WHERE expires_at <= CURRENT_TIMESTAMP"
                    );
                    return `Đã xóa ${result.affectedRows || 0} mã OTP đăng ký đã hết hạn.`;
                }
            },
            cleanupUnusedBypassKeys: {
                name: 'cleanupUnusedBypassKeys',
                intervalMs: 24 * 60 * 60 * 1000, // 24 hours
                run: async () => {
                    const [result] = await db.execute(
                        "DELETE FROM bypass_keys WHERE is_used = 0 AND created_at < datetime('now', '-7 days')"
                    );
                    return `Đã dọn dẹp ${result.affectedRows || 0} khóa bypass chưa sử dụng quá 7 ngày.`;
                }
            },
            optimizeDatabase: {
                name: 'optimizeDatabase',
                intervalMs: 24 * 60 * 60 * 1000, // 24 hours
                run: async () => {
                    // VACUUM database (Only if not in replication or allowed by provider)
                    try {
                        await db.execute("VACUUM");
                        return "Đã tối ưu hóa cơ sở dữ liệu (VACUUM thành công).";
                    } catch (err) {
                        return `Tối ưu hóa cơ sở dữ liệu: ${err.message}`;
                    }
                }
            }
        };
    }

    /**
     * Start all internal cron job schedulers
     */
    startSchedulers() {
        console.log('[Cron Service] Khởi động các tiến trình cron job nội bộ...');

        for (const jobKey of Object.keys(this.jobs)) {
            const job = this.jobs[jobKey];
            
            // Clear existing if any
            if (this.timers[job.name]) {
                clearInterval(this.timers[job.name]);
            }

            // Run immediately on startup
            this.executeJob(job).catch(err => {
                console.error(`[Cron Service] Lỗi thực thi ban đầu cho ${job.name}:`, err);
            });

            // Set interval
            this.timers[job.name] = setInterval(() => {
                this.executeJob(job).catch(err => {
                    console.error(`[Cron Service] Lỗi thực thi định kỳ cho ${job.name}:`, err);
                });
            }, job.intervalMs);
        }
    }

    /**
     * Execute a specific job and log it to the database
     */
    async executeJob(job) {
        const startTime = Date.now();
        console.log(`[Cron Service] Bắt đầu chạy tác vụ: ${job.name}`);
        
        try {
            const message = await job.run();
            const duration = Date.now() - startTime;
            
            console.log(`[Cron Service] Tác vụ ${job.name} hoàn tất trong ${duration}ms: ${message}`);
            
            await this.logExecution(job.name, 'success', message, duration);
            return { success: true, message, duration };
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[Cron Service] Tác vụ ${job.name} thất bại sau ${duration}ms:`, error);
            
            await this.logExecution(job.name, 'failed', error.message, duration);
            return { success: false, message: error.message, duration };
        }
    }

    /**
     * Log execution to database
     */
    async logExecution(jobName, status, message, durationMs) {
        try {
            await db.execute(
                `INSERT INTO cron_execution_logs (job_name, status, message, duration_ms) 
                 VALUES (?, ?, ?, ?)`,
                [jobName, status, message || '', durationMs]
            );
        } catch (err) {
            console.error('[Cron Service] Không thể lưu log cron vào cơ sở dữ liệu:', err.message);
        }
    }

    /**
     * Manually trigger a cron job by name
     */
    async triggerManually(jobName) {
        const job = this.jobs[jobName];
        if (!job) {
            throw new Error(`Không tìm thấy tác vụ nào có tên "${jobName}"`);
        }
        return await this.executeJob(job);
    }

    /**
     * Get execution history of cron jobs
     */
    async getExecutionLogs(limit = 50) {
        const [rows] = await db.execute(
            `SELECT * FROM cron_execution_logs ORDER BY executed_at DESC LIMIT ?`,
            [limit]
        );
        return rows;
    }
}

module.exports = new CronService();
