const {
    ensureServiceDefaults,
    listServiceCategories,
    listServicePackages,
    listServiceItems,
    getServicePackageById,
    getServiceItemById,
    createServiceOrder,
    getUserServiceOrders,
    getAdminServiceOrders,
    updateServiceOrderStatus,
    upsertServicePackage,
    upsertServiceItem,
    deleteServiceItem
} = require('../services/mxhService');
const db = require('../config/database');

function parsePositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

exports.getServiceCategories = async (req, res) => {
    try {
        const rows = await listServiceCategories({
            ...(req.query || {}),
            include_inactive: req.user?.role === 'admin' ? '1' : '0'
        });
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error in getServiceCategories:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh mục dịch vụ' });
    }
};

exports.getServicePackages = async (req, res) => {
    try {
        const result = await listServicePackages({
            ...(req.query || {}),
            include_inactive: req.user?.role === 'admin' ? '1' : '0'
        });
        res.json({ success: true, data: result.items, pagination: result.pagination });
    } catch (error) {
        console.error('Error in getServicePackages:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy gói dịch vụ' });
    }
};

exports.getServiceItems = async (req, res) => {
    try {
        const result = await listServiceItems({
            ...(req.query || {}),
            include_inactive: req.user?.role === 'admin' ? '1' : '0'
        });
        res.json({ success: true, data: result.items, pagination: result.pagination });
    } catch (error) {
        console.error('Error in getServiceItems:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách dịch vụ con' });
    }
};

exports.getServicePackageDetail = async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id, 0);
        const item = await getServicePackageById(id, req.user?.role === 'admin');
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy gói dịch vụ' });
        }

        res.json({ success: true, data: item });
    } catch (error) {
        console.error('Error in getServicePackageDetail:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy chi tiết gói dịch vụ' });
    }
};

exports.getServiceItemDetail = async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id, 0);
        const item = await getServiceItemById(id, req.user?.role === 'admin');
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy dịch vụ con' });
        }

        res.json({ success: true, data: item });
    } catch (error) {
        console.error('Error in getServiceItemDetail:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy chi tiết dịch vụ con' });
    }
};

exports.createServiceOrder = async (req, res) => {
    try {
        const result = await createServiceOrder(req.user.id, req.body || {});
        if (result?.error) {
            const status = result.error.status || 500;
            return res.status(status).json({
                success: false,
                message: result.error.message || 'Không thể tạo đơn dịch vụ'
            });
        }

        res.json({
            success: true,
            message: 'Đơn dịch vụ đã được tạo',
            data: result
        });
    } catch (error) {
        console.error('Error in createServiceOrder:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đơn dịch vụ' });
    }
};

exports.getMyServiceOrders = async (req, res) => {
    try {
        const limit = parsePositiveInt(req.query.limit || 50, 50);
        const rows = await getUserServiceOrders(req.user.id, limit);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error in getMyServiceOrders:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy lịch sử đơn dịch vụ' });
    }
};

exports.adminGetServiceOrders = async (req, res) => {
    try {
        const limit = parsePositiveInt(req.query.limit || 100, 100);
        const rows = await getAdminServiceOrders(limit);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error in adminGetServiceOrders:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách đơn dịch vụ' });
    }
};

exports.adminCreateServicePackage = async (req, res) => {
    try {
        const result = await upsertServicePackage(req.body || {});
        if (result?.error) {
            return res.status(result.error.status || 500).json({
                success: false,
                message: result.error.message || 'Không thể tạo gói dịch vụ'
            });
        }
        res.json({ success: true, message: 'Đã lưu gói dịch vụ', data: result });
    } catch (error) {
        console.error('Error in adminCreateServicePackage:', error);
        res.status(500).json({ success: false, message: 'Loi khi tao goi dich vu' });
    }
};

exports.adminCreateServiceItem = async (req, res) => {
    try {
        const result = await upsertServiceItem(req.body || {});
        if (result?.error) {
            return res.status(result.error.status || 500).json({
                success: false,
                message: result.error.message || 'Không thể tạo dịch vụ con'
            });
        }
        res.json({ success: true, message: 'Đã lưu dịch vụ con', data: result });
    } catch (error) {
        console.error('Error in adminCreateServiceItem:', error);
        res.status(500).json({ success: false, message: 'Loi khi tao dich vu con' });
    }
};

exports.adminUpdateServicePackage = async (req, res) => {
    try {
        const result = await upsertServicePackage({ ...req.body, id: req.params.id });
        if (result?.error) {
            return res.status(result.error.status || 500).json({
                success: false,
                message: result.error.message || 'Không thể cập nhật gói dịch vụ'
            });
        }
        res.json({ success: true, message: 'Đã cập nhật gói dịch vụ', data: result });
    } catch (error) {
        console.error('Error in adminUpdateServicePackage:', error);
        res.status(500).json({ success: false, message: 'Loi khi cap nhat goi dich vu' });
    }
};

exports.adminUpdateServiceItem = async (req, res) => {
    try {
        const result = await upsertServiceItem({ ...req.body, id: req.params.id });
        if (result?.error) {
            return res.status(result.error.status || 500).json({
                success: false,
                message: result.error.message || 'Không thể cập nhật dịch vụ con'
            });
        }
        res.json({ success: true, message: 'Đã cập nhật dịch vụ con', data: result });
    } catch (error) {
        console.error('Error in adminUpdateServiceItem:', error);
        res.status(500).json({ success: false, message: 'Loi khi cap nhat dich vu con' });
    }
};

exports.adminDeleteServicePackage = async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id, 0);
        const [rows] = await db.execute(
            'SELECT id FROM mxh_service_orders WHERE service_id = ? LIMIT 1',
            [id]
        );
        if (rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Không thể xóa gói dịch vụ đã có đơn hàng'
            });
        }

        await db.execute('DELETE FROM mxh_service_packages WHERE id = ?', [id]);
        res.json({ success: true, message: 'Đã xóa gói dịch vụ' });
    } catch (error) {
        console.error('Error in adminDeleteServicePackage:', error);
        res.status(500).json({ success: false, message: 'Loi khi xoa goi dich vu' });
    }
};

exports.adminDeleteServiceItem = async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id, 0);
        const result = await deleteServiceItem(id);
        if (result?.error) {
            return res.status(result.error.status || 500).json({
                success: false,
                message: result.error.message || 'Không thể xóa dịch vụ con'
            });
        }
        res.json({ success: true, message: 'Đã xóa dịch vụ con' });
    } catch (error) {
        console.error('Error in adminDeleteServiceItem:', error);
        res.status(500).json({ success: false, message: 'Loi khi xoa dich vu con' });
    }
};

async function handleOrderAction(req, res, action) {
    const id = parsePositiveInt(req.params.id, 0);
    const adminNote = req.body?.admin_note || req.body?.note || '';
    try {
        const result = await updateServiceOrderStatus(id, action, req.user.id, adminNote);
        if (result?.error) {
            return res.status(result.error.status || 500).json({
                success: false,
                message: result.error.message || 'Không thể cập nhật đơn dịch vụ'
            });
        }
        res.json({ success: true, message: 'Đã cập nhật đơn dịch vụ' });
    } catch (error) {
        console.error('Error in handleOrderAction:', error);
        res.status(500).json({ success: false, message: 'Loi khi cap nhat don dich vu' });
    }
}

exports.adminProcessServiceOrder = (req, res) => handleOrderAction(req, res, 'processing');
exports.adminCompleteServiceOrder = (req, res) => handleOrderAction(req, res, 'complete');
exports.adminCancelServiceOrder = (req, res) => handleOrderAction(req, res, 'cancel');
exports.adminTestServiceOrder = (req, res) => handleOrderAction(req, res, 'test');

exports.ensureServiceDefaults = ensureServiceDefaults;
