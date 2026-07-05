// ============================================
// PRODUCT DETAIL PAGE SCRIPT
// File: frontend/js/pages/product.js
// ============================================

window.pageInit = async function(params, query) {
    const productId = params.id || params.slug;
    const currentUser = Auth.getCurrentUser();
    let product = null;
    let reviewsData = {
        reviews: [],
        can_review: false,
        review_reason: null,
        my_review: null,
        avg_rating: 0,
        review_count: 0
    };
    let freePurchaseRecaptchaState = {
        enabled: false,
        widgetId: null,
        status: 'idle'
    };
    let anonymousViewCaptchaState = {
        required: false,
        enabled: false,
        widgetId: null,
        status: 'idle',
        threshold: 10,
        spamThreshold: 10,
        distinctProductCount: 0,
        viewCount: 0,
        reason: '',
        message: '',
        renderError: ''
    };

    await loadProduct();

    async function loadProduct(options = {}) {
        try {
            showLoading('product-content');

            const headers = {};
            if (options.recaptchaToken) {
                headers['X-Recaptcha-Token'] = options.recaptchaToken;
            }

            const response = await api.request(`/products/${productId}`, {
                method: 'GET',
                headers
            });

            if (response.success) {
                product = response.data;
                anonymousViewCaptchaState = {
                    required: false,
                    enabled: false,
                    widgetId: null,
                    status: 'idle',
                    threshold: 10,
                    spamThreshold: 10,
                    distinctProductCount: 0,
                    viewCount: 0,
                    reason: '',
                    message: '',
                    renderError: ''
                };
                await loadReviews();
                renderProduct();
            }

        } catch (error) {
            console.error('Load product error:', error);
            if (error.code === 'ANON_PRODUCT_CAPTCHA_REQUIRED' || error.data?.captchaRequired) {
                anonymousViewCaptchaState = {
                    required: true,
                    enabled: true,
                    widgetId: null,
                    status: 'pending',
                    threshold: Number(error.data?.threshold || 10),
                    spamThreshold: Number(error.data?.spamThreshold || error.data?.threshold || 10),
                    distinctProductCount: Number(error.data?.distinctProductCount || 0),
                    viewCount: Number(error.data?.viewCount || 0),
                    reason: String(error.data?.reason || ''),
                    message: error.message || 'Xác thực capcha để mua',
                    renderError: ''
                };
                renderAnonymousCaptchaGate();
                void initAnonymousViewRecaptcha();
                return;
            }

            if (anonymousViewCaptchaState.required || options.recaptchaToken) {
                anonymousViewCaptchaState = {
                    ...anonymousViewCaptchaState,
                    required: true,
                    enabled: true,
                    widgetId: null,
                    status: 'pending',
                    reason: anonymousViewCaptchaState.reason,
                    message: error.message || anonymousViewCaptchaState.message,
                    renderError: ''
                };
                renderAnonymousCaptchaGate();
                void initAnonymousViewRecaptcha();
                showToast(error.message || 'Khong the xac thuc reCAPTCHA', 'error');
                return;
            }

            document.getElementById('product-content').innerHTML = `
                <div class="error-message">
                    <h2>Không tìm thấy sản phẩm</h2>
                    <p>${error.message}</p>
                    <button onclick="router.navigate('/')" class="btn-primary">Về trang chủ</button>
                </div>
            `;
        }
    }

    function renderProduct() {
        const container = document.getElementById('product-content');

        container.innerHTML = `
            <div class="product-layout">
                <!-- Gallery -->
                <div class="product-gallery">
                    <div class="main-image-container">
                        <img src="${getProductImageUrl(product)}" 
                             onerror="${getProductImageErrorHandler()}"
                             alt="${product.title}" 
                             class="main-image" 
                             id="main-image">
                    </div>
                    <div class="gallery-thumbs" id="gallery-thumbs">
                        <!-- Thumbnails will be inserted here -->
                    </div>
                </div>

                <!-- Info -->
                <div class="product-info-section">
                    <div class="product-header">
                        <h1>${product.title}</h1>
                        <div class="product-meta">
                            <span><i class="fas fa-eye"></i> ${product.view_count} lượt xem</span>
                            <span><i class="fas fa-shopping-cart"></i> ${product.purchase_count} lượt mua</span>
                            <span><i class="fas fa-star"></i> ${(Number(product.avg_rating || 0)).toFixed(1)} (${Number(product.review_count || 0)} đánh giá)</span>
                            <span><i class="fas fa-clock"></i> ${formatDateShort(product.created_at)}</span>
                        </div>
                    </div>

                    <div class="product-price-box">
                        <div class="price">${formatMoney(product.price)}</div>
                        <div class="purchase-section">
                            ${renderPurchaseButtons()}
                        </div>
                    </div>

                    ${renderSellerInfo()}
                </div>
            </div>

            <!-- Tabs -->
            <div class="product-tabs">
                <div class="tab-buttons">
                    <button class="tab-btn active" data-tab="description">Mô tả</button>
                    <button class="tab-btn" data-tab="video">Video demo</button>
                    <button class="tab-btn" data-tab="reviews">Đánh giá</button>
                </div>
            </div>

            <div class="tab-content">
                <div id="tab-description" class="tab-pane active">
                    <div class="description-content">
                        ${product.content || product.description || 'Chưa có mô tả chi tiết'}
                    </div>
                    ${renderAiAssistant()}
                </div>
                <div id="tab-video" class="tab-pane">
                    ${renderVideo()}
                </div>
                <div id="tab-reviews" class="tab-pane">
                    ${renderReviews()}
                </div>
            </div>
        `;

        bindEvents();
        loadGallery();
        void initFreePurchaseRecaptcha();
    }

    function renderAnonymousCaptchaGate() {
        const container = document.getElementById('product-content');
        if (!container) {
            return;
        }

        container.innerHTML = `
            <div class="error-message">
                <h2>Xac thuc truoc khi xem tiep</h2>
                <p>${escapeHtml(anonymousViewCaptchaState.message || 'làm gì mà xem đi xem lại nhiều lần vậy')}</p>
                <p>${buildAnonymousCaptchaSummary()}</p>
                <div id="anonymous-product-recaptcha" class="recaptcha-slot is-hidden"></div>
                <p id="anonymous-product-recaptcha-status" class="captcha-gate-status"></p>
                <div style="margin-top:16px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                    <button type="button" id="anonymous-product-verify-btn" class="btn-primary">
                        Xác thực và thêm sản phẩm
                    </button>
                    <button type="button" id="anonymous-product-retry-btn" class="btn-outline" hidden>
                        tải lại xác thực
                    </button>
                    <button type="button" id="anonymous-product-home-btn" class="btn-outline">
                        về trang chủ
                    </button>
                </div>
            </div>
        `;

        bindAnonymousCaptchaGateEvents();
        updateAnonymousCaptchaGateState();
    }

    function buildAnonymousCaptchaSummary() {
        if (anonymousViewCaptchaState.reason === 'rapid_views') {
            return `Da ghi nhan ${anonymousViewCaptchaState.viewCount} tạm thời ko cho mày xem Sau ${anonymousViewCaptchaState.spamThreshold} luot, yêu cầu reCAPTCHA.`;
        }

        return `Da ghi nhan ${anonymousViewCaptchaState.distinctProductCount} sản phẩm khác nhau. Sau ${anonymousViewCaptchaState.threshold} sản phẩm, yêu cầu reCAPTCHA.`;
    }

    function updateAnonymousCaptchaGateState() {
        const statusEl = document.getElementById('anonymous-product-recaptcha-status');
        const verifyBtn = document.getElementById('anonymous-product-verify-btn');
        const retryBtn = document.getElementById('anonymous-product-retry-btn');

        if (statusEl) {
            statusEl.classList.toggle('is-error', anonymousViewCaptchaState.status === 'error');
            if (anonymousViewCaptchaState.status === 'loading') {
                statusEl.textContent = 'Dang tai hop xac thuc nguoi dung...';
            } else if (anonymousViewCaptchaState.status === 'ready') {
                statusEl.textContent = anonymousViewCaptchaState.enabled
                    ? 'Danh dau "Toi khong phai robot" roi bam xac thuc.'
                    : '';
            } else if (anonymousViewCaptchaState.status === 'error') {
                statusEl.textContent = anonymousViewCaptchaState.renderError || 'Khong the hien reCAPTCHA. Vui long thu lai.';
            } else {
                statusEl.textContent = '';
            }
        }

        if (verifyBtn) {
            const disabled = anonymousViewCaptchaState.status !== 'ready';
            verifyBtn.disabled = disabled;
            verifyBtn.innerHTML = anonymousViewCaptchaState.status === 'loading'
                ? '<i class="fas fa-spinner fa-spin"></i>Để xem...'
                : 'xác thực và xem sản phẩm';
        }

        if (retryBtn) {
            retryBtn.hidden = anonymousViewCaptchaState.status !== 'error';
            retryBtn.disabled = anonymousViewCaptchaState.status === 'loading';
        }
    }

    function renderPurchaseButtons() {
        const user = Auth.getCurrentUser();
        const canEdit = user && (user.role === 'admin' || user.id === product.seller_id);
        const isFreeProduct = Number(product.price || 0) <= 0;
        const editBtn = canEdit ? `
            <button class="btn btn-outline" onclick="router.navigate('/suasanpham/${product.id}')">
                <i class="fas fa-pen"></i> sữa sản phẩm
            </button>
        ` : '';

        if (product.is_archived) {
            return `
                <div class="badge badge-info">Sản phẩm đã lưu trữ</div>
                ${editBtn}
            `;
        }

        if (product.is_purchased) {
            return `
                <button class="btn btn-buy" onclick="downloadProduct()">
                    <i class="fas fa-download"></i> Tải xuống
                </button>
                ${editBtn}
            `;
        }

        return `
            <div class="purchase-actions">
                <button class="btn btn-buy" id="product-purchase-btn" onclick="purchaseProduct()">
                    <i class="fas fa-shopping-cart"></i> Mua ngay
                </button>
                ${product.demo_url ? `
                    <a href="${product.demo_url}" target="_blank" class="btn btn-demo">
                        <i class="fas fa-eye"></i> Xem demo
                    </a>
                ` : ''}
                ${editBtn}
            </div>
            ${isFreeProduct ? `
                <div class="free-purchase-guard">
                    <div class="free-purchase-note">Cái ni cần xác thực chứ ko bây ddos nữa"Tôi không phải robot" trước khi nhắn.</div>
                    <div id="free-purchase-recaptcha" class="recaptcha-slot is-hidden"></div>
                </div>
            ` : ''}
        `;
    }

    function renderSellerInfo() {
        return `
            <div class="seller-info">
                ${renderAvatarWithFrame({
                    avatar: product.seller_avatar,
                    gender: product.seller_gender,
                    is_verified: product.seller_is_verified
                }, 'lg', product.seller_name || 'seller')}
                <div class="seller-details">
                    <h3>${renderDisplayName({ full_name: product.seller_name, is_verified: product.seller_is_verified }, product.seller_name)}</h3>
                    <p>${product.seller_email}</p>
                    <a href="/trangcanhan/${product.seller_id}" 
                       data-link 
                       onclick="event.preventDefault(); window.router && window.router.navigate('/trangcanhan/${product.seller_id}')">
                        Xem trang cá nhân
                    </a>
                </div>
            </div>
        `;
    }

    function renderVideo() {
        if (!product.video_url) {
            return '<p>Sản phẩm không có video demo</p>';
        }

        if (isEmbedVideo(product.video_url)) {
            return `
                <div class="video-container">
                    <iframe src="${toEmbedUrl(product.video_url)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
                </div>
            `;
        }

        return `
            <div class="video-container">
                <video controls>
                    <source src="${product.video_url}" type="video/mp4">
                    Trình duyệt không hỗ trợ video
                </video>
            </div>
        `;
    }

    function renderReviews() {
        const avgRating = Number(reviewsData.avg_rating || product.avg_rating || 0);
        const reviewCount = Number(reviewsData.review_count || product.review_count || 0);

        return `
            <div class="review-summary-card">
                <div class="review-summary-score">${avgRating.toFixed(1)}</div>
                <div>
                    <div class="review-summary-stars">${renderStarIcons(avgRating)}</div>
                    <div class="review-summary-count">${reviewCount} đánh giá</div>
                </div>
            </div>
            ${renderReviewForm()}
            ${renderReviewList()}
        `;
    }

    function renderReviewForm() {
        const myReview = reviewsData.my_review || product.my_review || null;
        const initialRating = Number(myReview?.rating || 5);
        const initialComment = escapeHtml(myReview?.comment || '');

        if (!Auth.isAuthenticated()) {
            return `
                <div class="review-form-card">
                    <p>Vui lòng <a href="/login" data-link onclick="event.preventDefault(); router.navigate('/login?redirect=' + window.location.pathname)">đăng nhập</a> để gửi đánh giá.</p>
                </div>
            `;
        }

        if (!reviewsData.can_review) {
            return `
                <div class="review-form-card">
                    <p>${escapeHtml(reviewsData.review_reason || 'Bạn chưa thể đánh giá sản phẩm này')}</p>
                </div>
            `;
        }

        return `
            <form id="review-form" class="review-form-card">
                <h3>${myReview ? 'Cập nhật đánh giá của bạn' : 'Viết đánh giá của bạn'}</h3>
                <div class="rating-stars-select" id="rating-stars">
                    ${[1, 2, 3, 4, 5].map(star => `
                        <button type="button" class="rating-star-btn ${star <= initialRating ? 'active' : ''}" data-rating-value="${star}" aria-label="${star} sao">
                            <i class="fas fa-star"></i>
                        </button>
                    `).join('')}
                </div>
                <input type="hidden" id="review-rating-input" value="${initialRating}">
                <textarea id="review-comment-input" rows="4" placeholder="Mô tả trải nghiệm của bạn..." required>${initialComment}</textarea>
                <button type="submit" class="btn btn-buy">${myReview ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}</button>
            </form>
        `;
    }

    function renderReviewList() {
        const items = Array.isArray(reviewsData.reviews) ? reviewsData.reviews : [];
        if (!items.length) {
            return `
                <div class="review-list">
                    <p class="review-empty">Chưa có đánh giá nào.</p>
                </div>
            `;
        }

        return `
            <div class="review-list">
                ${items.map(item => `
                    <article class="review-item">
                        <div class="review-item-head">
                            <div class="review-item-user">
                                ${renderAvatarWithFrame(item, 'sm', item.full_name)}
                                <strong>${renderDisplayName(item, `User #${item.user_id}`)}</strong>
                            </div>
                            <div class="review-item-side">
                                <span class="review-item-date">${formatDateShort(item.updated_at || item.created_at)}</span>
                                ${(currentUser && (currentUser.role === 'admin' || Number(currentUser.id) === Number(item.user_id) || Number(currentUser.id) === Number(product?.seller_id))) ? `
                                    <button type="button" class="btn-ghost btn-danger review-delete-btn" data-review-delete="${item.id}">Xóa</button>
                                ` : ''}
                            </div>
                        </div>
                        <div class="review-item-stars">${renderStarIcons(item.rating)}</div>
                        <p class="review-item-comment">${escapeHtml(item.comment || '')}</p>
                    </article>
                `).join('')}
            </div>
        `;
    }

    function isEmbedVideo(url) {
        return /youtube\.com|youtu\.be|vimeo\.com/.test(url);
    }

    function toEmbedUrl(url) {
        if (url.includes('youtube.com')) {
            const id = new URL(url).searchParams.get('v');
            return `https://www.youtube.com/embed/${id}`;
        }
        if (url.includes('youtu.be')) {
            const id = url.split('/').pop();
            return `https://www.youtube.com/embed/${id}`;
        }
        if (url.includes('vimeo.com')) {
            const id = url.split('/').pop();
            return `https://player.vimeo.com/video/${id}`;
        }
        return url;
    }

    function renderAiAssistant() {
        return `
            <div class="ai-assistant-box">
                <div class="ai-assistant-head">
                    <h3>Trợ lý AI sản phẩm</h3>
                    <p>Thắc mắc gì hỏi lẹ cái</p>
                </div>
                <div class="ai-assistant-form">
                    <textarea id="ai-question" rows="3" placeholder="Ví dụ: Sản phẩm này phù hợp với người mới không?"></textarea>
                    <button class="btn btn-buy" id="ai-ask-btn" type="button">
                        <i class="fas fa-robot"></i> Hỏi AI
                    </button>
                </div>
                <div class="ai-assistant-result" id="ai-assistant-result" style="display:none;">
                    <p class="ai-summary" id="ai-summary"></p>
                    <ul class="ai-highlights" id="ai-highlights"></ul>
                    <div class="ai-answer" id="ai-answer"></div>
                </div>
            </div>
        `;
    }

    function loadGallery() {
        const thumbsContainer = document.getElementById('gallery-thumbs');
        const mainImage = document.getElementById('main-image');

        const images = getProductGalleryUrls(product);

        thumbsContainer.innerHTML = images.map((img, index) => `
            <img src="${img}" 
                 onerror="${getProductImageErrorHandler()}"
                 alt="Thumbnail ${index + 1}" 
                 class="thumb ${index === 0 ? 'active' : ''}"
                 data-image="${img}">
        `).join('');

        thumbsContainer.querySelectorAll('.thumb').forEach(thumb => {
            thumb.addEventListener('click', () => {
                mainImage.src = thumb.dataset.image;
                thumbsContainer.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
                thumb.classList.add('active');
            });
        });
    }

    function bindEvents() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;

                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                });
                document.getElementById(`tab-${tab}`).classList.add('active');
            });
        });

        bindReviewForm();
        bindReviewActions();
        bindAiAssistant();
    }

    function bindReviewForm() {
        const form = document.getElementById('review-form');
        if (!form) return;

        const ratingInput = document.getElementById('review-rating-input');
        const commentInput = document.getElementById('review-comment-input');

        const refreshStarSelection = (value) => {
            form.querySelectorAll('[data-rating-value]').forEach(btn => {
                const starValue = Number(btn.dataset.ratingValue || 0);
                btn.classList.toggle('active', starValue <= value);
            });
        };

        form.querySelectorAll('[data-rating-value]').forEach(btn => {
            btn.addEventListener('click', () => {
                const value = Number(btn.dataset.ratingValue || 0);
                ratingInput.value = String(value);
                refreshStarSelection(value);
            });
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const rating = Number(ratingInput.value || 0);
            const comment = (commentInput.value || '').trim();

            if (rating < 1 || rating > 5) {
                showToast('Vui lòng chọn số sao từ 1 đến 5', 'warning');
                return;
            }
            if (!comment) {
                showToast('Vui lòng nhập mô tả đánh giá', 'warning');
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang lưu...';
            }

            try {
                const response = await api.post(`/products/${productId}/reviews`, { rating, comment });
                if (response.success) {
                    showToast('Đánh giá đã được lưu', 'success');
                    await loadReviews();
                    product.avg_rating = Number(reviewsData.avg_rating || product.avg_rating || 0);
                    product.review_count = Number(reviewsData.review_count || product.review_count || 0);
                    product.my_review = reviewsData.my_review || product.my_review || null;
                    renderProduct();
                    setTimeout(() => {
                        const reviewTabBtn = document.querySelector('[data-tab="reviews"]');
                        if (reviewTabBtn) reviewTabBtn.click();
                    }, 0);
                }
            } catch (error) {
                showToast(error.message || 'Không thể gửi đánh giá', 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = reviewsData.my_review ? 'Cập nhật đánh giá' : 'Gửi đánh giá';
                }
            }
        });
    }

    function bindReviewActions() {
        document.querySelectorAll('button[data-review-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Xóa đánh giá này?')) return;
                try {
                    const response = await api.delete(`/products/${productId}/reviews/${btn.dataset.reviewDelete}`);
                    if (response.success) {
                        showToast('Đã xóa đánh giá', 'success');
                        await loadReviews();
                        product.avg_rating = Number(reviewsData.avg_rating || 0);
                        product.review_count = Number(reviewsData.review_count || 0);
                        product.my_review = reviewsData.my_review || null;
                        renderProduct();
                        setTimeout(() => {
                            const reviewTabBtn = document.querySelector('[data-tab="reviews"]');
                            if (reviewTabBtn) reviewTabBtn.click();
                        }, 0);
                    }
                } catch (error) {
                    showToast(error.message || 'Không thể xóa đánh giá', 'error');
                }
            });
        });
    }

    function bindAiAssistant() {
        const askBtn = document.getElementById('ai-ask-btn');
        const questionInput = document.getElementById('ai-question');
        const resultBox = document.getElementById('ai-assistant-result');
        const summaryEl = document.getElementById('ai-summary');
        const highlightsEl = document.getElementById('ai-highlights');
        const answerEl = document.getElementById('ai-answer');

        if (!askBtn || !questionInput || !resultBox || !summaryEl || !highlightsEl || !answerEl) {
            return;
        }

        askBtn.addEventListener('click', async () => {
            const question = questionInput.value.trim();
            askBtn.disabled = true;
            askBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Dang hoi...';

            try {
                const response = await api.post(`/products/${productId}/assistant-ai`, { question });
                const data = response.data || {};
                resultBox.style.display = 'block';
                summaryEl.innerHTML = formatAiRichText(data.summary || '');
                answerEl.innerHTML = formatAiRichText(data.answer || '');

                const highlights = Array.isArray(data.highlights) ? data.highlights : [];
                highlightsEl.innerHTML = highlights.map(item => `<li>${formatAiRichText(item)}</li>`).join('');
            } catch (error) {
                showToast(error.message || 'Khong the su dung tro ly AI luc nay', 'warning');
            } finally {
                askBtn.disabled = false;
                askBtn.innerHTML = '<i class="fas fa-robot"></i> Hoi AI';
            }
        });
    }

    function formatAiRichText(input) {
        const text = (input || '').toString();
        const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
        let html = '';
        let lastIndex = 0;
        let match;

        while ((match = urlRegex.exec(text)) !== null) {
            const [rawUrl] = match;
            const index = match.index;
            html += escapeHtml(text.slice(lastIndex, index)).replace(/\n/g, '<br>');
            html += buildAiLinkHtml(rawUrl);
            lastIndex = index + rawUrl.length;
        }

        html += escapeHtml(text.slice(lastIndex)).replace(/\n/g, '<br>');
        return html;
    }

    function renderStarIcons(rating) {
        const rounded = Math.round(Number(rating || 0));
        return [1, 2, 3, 4, 5].map(index =>
            `<i class="fas fa-star ${index <= rounded ? 'star-filled' : 'star-empty'}"></i>`
        ).join('');
    }

    function buildAiLinkHtml(rawUrl) {
        const safeUrl = escapeHtml(rawUrl);
        const label = escapeHtml(formatLinkLabel(rawUrl));
        return `<a class="ai-rich-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${safeUrl}"><i class="fas fa-link"></i><span>${label}</span></a>`;
    }

    function formatLinkLabel(rawUrl) {
        try {
            const url = new URL(rawUrl);
            const host = (url.hostname || '').replace(/^www\./i, '');
            const path = (url.pathname && url.pathname !== '/') ? url.pathname : '';
            if (!path) return host || rawUrl;
            const shortPath = path.length > 22 ? `${path.slice(0, 22)}...` : path;
            return `${host}${shortPath}`;
        } catch (error) {
            return rawUrl;
        }
    }

    async function loadReviews() {
        try {
            const response = await api.get(`/products/${productId}/reviews`);
            if (response.success) {
                reviewsData = {
                    ...reviewsData,
                    ...(response.data || {})
                };
            }
        } catch (error) {
            reviewsData = {
                ...reviewsData,
                reviews: [],
                can_review: false,
                review_reason: 'Không thể tải danh sách đánh giá'
            };
        }
    }

    async function initFreePurchaseRecaptcha() {
        const container = document.getElementById('free-purchase-recaptcha');
        if (!container) {
            freePurchaseRecaptchaState = {
                enabled: false,
                widgetId: null,
                status: 'not_needed'
            };
            return;
        }

        freePurchaseRecaptchaState = {
            enabled: false,
            widgetId: null,
            status: 'loading'
        };

        try {
            const nextState = await window.RecaptchaManager.render(container);
            freePurchaseRecaptchaState = {
                ...nextState,
                status: 'ready'
            };
        } catch (error) {
            freePurchaseRecaptchaState = {
                enabled: true,
                widgetId: null,
                status: 'error'
            };
            showToast(error.message || 'Khong the tai reCAPTCHA', 'error');
        }
    }

    function bindAnonymousCaptchaGateEvents() {
        const verifyBtn = document.getElementById('anonymous-product-verify-btn');
        const retryBtn = document.getElementById('anonymous-product-retry-btn');
        const homeBtn = document.getElementById('anonymous-product-home-btn');

        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                router.navigate('/');
            });
        }

        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                anonymousViewCaptchaState = {
                    ...anonymousViewCaptchaState,
                    enabled: false,
                    widgetId: null,
                    status: 'pending',
                    renderError: ''
                };
                updateAnonymousCaptchaGateState();
                void initAnonymousViewRecaptcha(true);
            });
        }

        if (!verifyBtn) {
            return;
        }

        verifyBtn.addEventListener('click', async () => {
            if (anonymousViewCaptchaState.status === 'loading') {
                return;
            }

            const recaptchaToken = anonymousViewCaptchaState.enabled
                ? window.RecaptchaManager.getResponse(anonymousViewCaptchaState.widgetId)
                : '';

            if (anonymousViewCaptchaState.enabled && !recaptchaToken) {
                showToast('Vui long xac nhan "Toi khong phai robot"', 'warning');
                return;
            }

            anonymousViewCaptchaState.status = 'loading';
            updateAnonymousCaptchaGateState();

            try {
                await loadProduct({ recaptchaToken });
            } catch (_) {
                // loadProduct tu xu ly giao dien loi
            } finally {
                if (document.getElementById('anonymous-product-verify-btn')) {
                    anonymousViewCaptchaState.status = anonymousViewCaptchaState.renderError ? 'error' : 'ready';
                    updateAnonymousCaptchaGateState();
                }
            }
        });
    }

    async function initAnonymousViewRecaptcha(forceReload = false) {
        const container = document.getElementById('anonymous-product-recaptcha');
        if (!container) {
            anonymousViewCaptchaState = {
                ...anonymousViewCaptchaState,
                enabled: false,
                widgetId: null,
                status: 'not_needed',
                renderError: ''
            };
            return;
        }

        anonymousViewCaptchaState = {
            ...anonymousViewCaptchaState,
            enabled: false,
            widgetId: null,
            status: 'loading',
            renderError: ''
        };
        updateAnonymousCaptchaGateState();

        try {
            const nextState = await window.RecaptchaManager.render(container, { forceReload });
            if (!nextState.enabled) {
                throw new Error('Khong nhan duoc cau hinh reCAPTCHA hop le. Vui long tai lai trang.');
            }

            anonymousViewCaptchaState = {
                ...anonymousViewCaptchaState,
                ...nextState,
                status: 'ready',
                renderError: ''
            };
        } catch (error) {
            anonymousViewCaptchaState = {
                ...anonymousViewCaptchaState,
                enabled: false,
                widgetId: null,
                status: 'error',
                renderError: error.message || 'Khong the tai reCAPTCHA'
            };
            showToast(anonymousViewCaptchaState.renderError, 'error');
        }

        updateAnonymousCaptchaGateState();
    }

    function escapeHtml(input) {
        return (input || '')
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Global functions
    window.purchaseProduct = async function() {
        const isFreeProduct = Number(product?.price || 0) <= 0;

        if (product.is_archived) {
            showToast('Sản phẩm đã lưu trữ, không thể mua', 'warning');
            return;
        }

        if (!Auth.isAuthenticated()) {
            showToast('Vui lòng đăng nhập để mua sản phẩm', 'warning');
            router.navigate('/login?redirect=' + window.location.pathname);
            return;
        }

        if (!confirm(`Bạn có chắc muốn mua "${product.title}" với giá ${formatMoney(product.price)}?`)) {
            return;
        }

        let recaptchaToken = '';
        if (isFreeProduct) {
            if (freePurchaseRecaptchaState.status === 'loading') {
                showToast('reCAPTCHA dang duoc tai, vui long doi mot chut', 'warning');
                return;
            }

            if (freePurchaseRecaptchaState.status === 'error') {
                showToast('Không thể tải reCAPTCHA cho sản phẩm miễn phí', 'error');
                return;
            }

            recaptchaToken = freePurchaseRecaptchaState.enabled
                ? window.RecaptchaManager.getResponse(freePurchaseRecaptchaState.widgetId)
                : '';

            if (freePurchaseRecaptchaState.enabled && !recaptchaToken) {
                showToast('Vui long xac nhan "Toi khong phai robot"', 'warning');
                return;
            }
        }

        try {
            const response = await api.post(`/products/${productId}/purchase`, {
                recaptcha_token: recaptchaToken
            });

            if (response.success) {
                showToast('Mua sản phẩm thành công!', 'success');
                
                // Update user balance
                const user = Auth.getCurrentUser();
                user.balance = response.data.newBalance;
                Auth.updateUser(user);

                // Reload product
                await loadProduct();
            }

        } catch (error) {
            if (isFreeProduct && freePurchaseRecaptchaState.enabled) {
                window.RecaptchaManager.reset(freePurchaseRecaptchaState.widgetId);
            }
            showToast(error.message || 'Không thể mua sản phẩm', 'error');
        }
    };

    window.downloadProduct = function() {
        if (product.download_url) {
            window.open(product.download_url, '_blank');
            showToast('Đang tải xuống...', 'success');
        } else {
            showToast('Link tải chưa có sẵn', 'warning');
        }
    };
};
