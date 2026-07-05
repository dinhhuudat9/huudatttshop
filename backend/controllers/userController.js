// ============================================
// USER CONTROLLER
// File: backend/controllers/userController.js
// ============================================

const userService = require('../services/userService');
const path = require('path');
const fs = require('fs');

const FRAMES_DIR = path.join(__dirname, '../../khungcanhan');

function scanFrameDirectory(dir, prefix = '') {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
            const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
            const absolutePath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                return scanFrameDirectory(absolutePath, relativePath);
            }

            if (!/\.(png|jpe?g|gif|webp)$/i.test(entry.name)) {
                return [];
            }

            const normalized = relativePath.replace(/\\/g, '/');
            return [{
                name: normalized,
                url: `/frames/${normalized}`
            }];
        });
}

function resolveFramePath(frameUrl) {
    const safeUrl = String(frameUrl || '').trim();
    if (!safeUrl.startsWith('/frames/')) {
        return null;
    }

    const relative = decodeURIComponent(safeUrl.replace(/^\/frames\//, ''));
    const normalized = path.posix.normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.resolve(FRAMES_DIR, normalized);
    const resolvedRoot = path.resolve(FRAMES_DIR);

    if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`) && absolutePath !== resolvedRoot) {
        return null;
    }

    return absolutePath;
}

class UserController {
    // GET /api/users/search
    async searchUsers(req, res) {
        try {
            const result = await userService.searchUsers(req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/users/:id
    async getProfile(req, res) {
        try {
            const user = await userService.getProfile(req.params.id);
            res.json({ success: true, data: user });
        } catch (error) {
            res.status(404).json({ success: false, message: error.message });
        }
    }

    // GET /api/users/frames/list
    async listFrames(req, res) {
        try {
            const files = scanFrameDirectory(FRAMES_DIR);
            res.json({ success: true, data: files });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    // PUT /api/users/me/frame
    async updateFrame(req, res) {
        try {
            const { frame_url } = req.body;
            let finalUrl = '';

            if (frame_url) {
                const filepath = resolveFramePath(frame_url);
                if (!filepath || !fs.existsSync(filepath)) {
                    return res.status(400).json({ success: false, message: 'Khung không tồn tại' });
                }

                finalUrl = String(frame_url).trim();
            }

            const updated = await userService.updateFrame(req.user.id, finalUrl);
            res.json({ success: true, data: updated });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new UserController();
