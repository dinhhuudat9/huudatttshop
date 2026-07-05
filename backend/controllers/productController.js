// ============================================
// PRODUCT CONTROLLER
// File: backend/controllers/productController.js
// ============================================

const productService = require('../services/productService');
const notificationService = require('../services/notificationService');
const { askProductAssistant } = require('../services/aiService');
const recaptchaService = require('../services/recaptchaService');
const anonymousVisitorService = require('../services/anonymousVisitorService');
const db = require('../config/database');

class ProductController {
    async getProducts(req, res) {
        try {
            const result = await productService.getProducts(req.query);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    async getProductById(req, res) {
        try {
            const recaptchaToken = String(req.headers['x-recaptcha-token'] || req.query?.recaptcha_token || '').trim();
            await anonymousVisitorService.assertProductViewAllowed(req, res, req.params.id, recaptchaToken);

            const userId = req.user ? req.user.id : null;
            const product = await productService.getProductById(req.params.id, userId);

            if (product && req.user) {
                const viewerLabel = req.user
                    ? (req.user.full_name || req.user.email || `User #${req.user.id}`)
                    : `Khách (${req.ip || 'IP ẩn'})`;
                const time = new Date().toLocaleString('vi-VN');
                const titleText = product.title || `Sản phẩm #${product.id}`;
                notificationService.notifyAdmins({
                    title: 'Xem sản phẩm',
                    content: `${viewerLabel} xem \"${titleText}\" (#${product.id}) lúc ${time}`,
                    created_by: req.user ? req.user.id : null
                }, { sendTelegram: false }).catch(() => {});
            }

            res.json({
                success: true,
                data: product
            });

        } catch (error) {
            res.status(error.statusCode || 404).json({
                success: false,
                message: error.message,
                code: error.code || undefined,
                data: error.data || undefined
            });
        }
    }

    async createProduct(req, res) {
        try {
            const { main_image, video_url, demo_url, gallery } = req.body;
            const hasGallery = Array.isArray(gallery) && gallery.some(item => String(item || '').trim());
            const hasMainImage = !!String(main_image || '').trim();
            const hasVideoUrl = !!String(video_url || '').trim();
            const hasDemoUrl = !!String(demo_url || '').trim();
            if (!hasMainImage && !hasGallery) {
                return res.status(400).json({
                    success: false,
                    message: 'Main image is required'
                });
            }
            if (!hasVideoUrl && !hasGallery && !hasDemoUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'Demo media is required'
                });
            }

            const product = await productService.createProduct(req.user.id, req.body);

            res.status(201).json({
                success: true,
                message: 'Product created successfully',
                data: product
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    async updateProduct(req, res) {
        try {
            const product = await productService.updateProduct(
                req.params.id,
                req.user.id,
                req.user.role,
                req.user.email,
                req.body
            );

            res.json({
                success: true,
                message: 'Product updated successfully',
                data: product
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    // DELETE /api/products/:id
    async deleteProduct(req, res) {
        try {
            await productService.deleteProduct(
                req.params.id,
                req.user.id,
                req.user.role,
                req.user.email
            );

            res.json({
                success: true,
                message: 'Product deleted successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    // POST /api/products/:id/purchase
    async purchaseProduct(req, res) {
        try {
            const clientIp = req.clientIp || req.ip || req.socket?.remoteAddress || '';
            const purchaseTarget = await productService.getPurchaseTarget(req.params.id);
            const recaptchaToken = String(
                req.body?.recaptcha_token ||
                req.headers['x-recaptcha-token'] ||
                req.query?.recaptcha_token ||
                ''
            ).trim();

            await recaptchaService.assertVerified({
                token: recaptchaToken,
                ip: clientIp,
                req,
                action: Number(purchaseTarget.price || 0) <= 0 ? 'product_free_purchase' : 'product_purchase'
            });

            const result = await productService.purchaseProduct(
                req.user.id,
                req.params.id,
                {
                    ip: clientIp,
                    couponCode: req.body?.coupon_code || null
                }
            );

            try {
                const buyerName = req.user.full_name || req.user.email || `User #${req.user.id}`;
                const productInfo = result?.product || {};
                const time = new Date().toLocaleString('vi-VN');
                const priceText = typeof productInfo.price === 'number'
                    ? `${productInfo.price.toLocaleString('vi-VN')} VND`
                    : '';
                await notificationService.notifyAdmins({
                    title: 'Mua sản phẩm',
                    content: `${buyerName} mua \"${productInfo.title || 'Sản phẩm'}\" (#${productInfo.id || req.params.id}) ${priceText ? `giá ${priceText} ` : ''}lúc ${time}`,
                    created_by: req.user.id
                }, { sendTelegram: false });
            } catch (err) {
                // ignore notification errors
            }

            res.json({
                success: true,
                message: 'Purchase successful',
                data: result
            });

        } catch (error) {
            if (error.retryAfterSeconds) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }

            res.status(error.statusCode || 400).json({
                success: false,
                message: error.message
            });
        }
    }

    // POST /api/products/:id/validate-coupon
    async validateCoupon(req, res) {
        try {
            const { coupon_code } = req.body;
            if (!coupon_code) {
                return res.status(400).json({ success: false, message: 'Mã giảm giá không được để trống' });
            }
            const result = await productService.validateCoupon(
                req.user.id,
                req.params.id,
                coupon_code
            );
            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            res.status(error.statusCode || 400).json({
                success: false,
                message: error.message
            });
        }
    }

    // GET /api/products/:id/reviews
    async getProductReviews(req, res) {
        try {
            const userId = req.user ? req.user.id : null;
            const result = await productService.getProductReviews(req.params.id, userId);
            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            if (error.retryAfterSeconds) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }

            res.status(error.statusCode || 400).json({
                success: false,
                message: error.message
            });
        }
    }

    // POST /api/products/:id/reviews
    async upsertProductReview(req, res) {
        try {
            const result = await productService.upsertProductReview(req.params.id, req.user.id, req.body || {});
            res.json({
                success: true,
                message: 'Đánh giá đã được lưu',
                data: result
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    // DELETE /api/products/:id/reviews/:reviewId
    async deleteProductReview(req, res) {
        try {
            await productService.deleteProductReview(req.params.id, req.params.reviewId, req.user.id, req.user.role, req.user.email);
            res.json({
                success: true,
                message: 'Review deleted'
            });
        } catch (error) {
            res.status(error.statusCode || 400).json({
                success: false,
                message: error.message
            });
        }
    }

    // POST /api/products/:id/assistant-ai
    async askProductAssistant(req, res) {
        try {
            const product = await productService.getProductById(req.params.id, req.user?.id || null);
            const question = (req.body?.question || '').toString().trim();

            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            const data = await askProductAssistant(product, question);

            res.json({
                success: true,
                data
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }
}

module.exports = new ProductController();
