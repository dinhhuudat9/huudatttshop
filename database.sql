-- ============================================
-- SOURCE MARKET DATABASE SCHEMA (SQLite / Turso)
-- ============================================

-- ============================================
-- TABLE: USERS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    avatar TEXT,
    cover_image TEXT,
    frame_url TEXT,
    profile_music_url TEXT,
    profile_music_title TEXT,
    gender TEXT DEFAULT 'male' CHECK (gender IN ('male', 'female', 'other')),
    bio TEXT,
    contact_info TEXT,
    phone TEXT,
    balance REAL DEFAULT 0,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'seller', 'admin')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'banned')),
    is_verified INTEGER DEFAULT 0,
    failed_login_count INTEGER DEFAULT 0,
    last_failed_login_at DATETIME,
    last_failed_login_ip TEXT,
    login_locked_until DATETIME,
    register_ip TEXT,
    last_login_ip TEXT,
    security_lock_reason TEXT,
    security_locked_ip TEXT,
    security_locked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_login_locked_until ON users (login_locked_until);
CREATE INDEX IF NOT EXISTS idx_users_register_ip ON users (register_ip);
CREATE INDEX IF NOT EXISTS idx_users_last_login_ip ON users (last_login_ip);
CREATE INDEX IF NOT EXISTS idx_users_security_locked_ip ON users (security_locked_ip);

-- ============================================
-- TABLE: CATEGORIES
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    icon TEXT,
    parent_id INTEGER,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories (is_active);

-- ============================================
-- TABLE: PRODUCTS
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    content TEXT,
    price REAL NOT NULL,
    category_id INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    main_image TEXT,
    background_image TEXT,
    video_url TEXT,
    demo_url TEXT,
    download_url TEXT,
    view_count INTEGER DEFAULT 0,
    purchase_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'banned')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products (slug);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products (seller_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_created ON products (created_at);

-- ============================================
-- TABLE: PRODUCT_IMAGES
-- ============================================
CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);

-- ============================================
-- TABLE: PRODUCT_CATEGORIES
-- ============================================
CREATE TABLE IF NOT EXISTS product_categories (
    product_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_pc_category ON product_categories (category_id);

-- ============================================
-- TABLE: TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_before REAL NOT NULL,
    balance_after REAL NOT NULL,
    description TEXT,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions (created_at);

CREATE TABLE IF NOT EXISTS withdraw_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    net_amount REAL NOT NULL DEFAULT 0,
    bank_info TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note TEXT,
    approved_by INTEGER,
    expected_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_user ON withdraw_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status ON withdraw_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS bypass_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_string TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    mission_date TEXT NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, mission_date)
);
CREATE INDEX IF NOT EXISTS idx_bypass_keys_user ON bypass_keys (user_id, mission_date DESC);
CREATE INDEX IF NOT EXISTS idx_bypass_keys_key ON bypass_keys (key_string);

-- ============================================
-- TABLE: DEPOSIT_REQUESTS
-- ============================================
CREATE TABLE IF NOT EXISTS deposit_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT,
    payment_proof TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note TEXT,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_deposit_user ON deposit_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_status ON deposit_requests (status);
CREATE INDEX IF NOT EXISTS idx_deposit_created ON deposit_requests (created_at);

-- ============================================
-- TABLE: PURCHASES
-- ============================================
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    price_paid REAL NOT NULL,
    download_count INTEGER DEFAULT 0,
    last_download DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases (product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases (created_at);

-- ============================================
-- TABLE: PRODUCT_REVIEWS
-- ============================================
CREATE TABLE IF NOT EXISTS product_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews (user_id);

-- ============================================
-- TABLE: POSTS
-- ============================================
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at);

-- ============================================
-- TABLE: POST_MEDIA
-- ============================================
CREATE TABLE IF NOT EXISTS post_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    media_url TEXT NOT NULL,
    thumbnail_url TEXT,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media (post_id);

-- ============================================
-- TABLE: POST_LIKES
-- ============================================
CREATE TABLE IF NOT EXISTS post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes (user_id);

-- ============================================
-- TABLE: POST_COMMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_created ON post_comments (created_at);

-- ============================================
-- TABLE: MESSAGES
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video', 'file')),
    content TEXT,
    media_url TEXT,
    file_size INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages (receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at);

-- ============================================
-- TABLE: SYSTEM_SETTINGS
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings (setting_key);

-- ============================================
-- TABLE: LUCKY SPIN
-- ============================================
CREATE TABLE IF NOT EXISTS lucky_spin_state (
    user_id INTEGER PRIMARY KEY,
    last_spin_at TEXT,
    next_spin_at TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lucky_spin_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reward_id TEXT,
    reward_label TEXT NOT NULL,
    reward_amount REAL DEFAULT 0,
    reward_snapshot TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lucky_spin_attempts_user ON lucky_spin_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lucky_spin_attempts_created ON lucky_spin_attempts (created_at DESC);

-- ============================================
-- TABLE: DAILY CHECK-IN
-- ============================================
CREATE TABLE IF NOT EXISTS daily_checkin_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    claim_date TEXT NOT NULL,
    reward_day INTEGER NOT NULL,
    consecutive_days INTEGER NOT NULL DEFAULT 1,
    reward_amount REAL DEFAULT 0,
    reward_label TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_checkin_claim_unique ON daily_checkin_claims (user_id, claim_date);
CREATE INDEX IF NOT EXISTS idx_daily_checkin_claims_user ON daily_checkin_claims (user_id, claim_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_checkin_claims_created ON daily_checkin_claims (created_at DESC);

-- ============================================
-- TABLE: REGISTRATION_OTPS
-- ============================================
CREATE TABLE IF NOT EXISTS registration_otps (
    email TEXT PRIMARY KEY,
    otp_hash TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    gender TEXT DEFAULT 'male' CHECK (gender IN ('male', 'female', 'other')),
    request_ip TEXT,
    attempt_count INTEGER DEFAULT 0,
    resend_available_at DATETIME,
    expires_at DATETIME NOT NULL,
    last_sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_registration_otps_expires ON registration_otps (expires_at);
CREATE INDEX IF NOT EXISTS idx_registration_otps_resend ON registration_otps (resend_available_at);

-- ============================================
-- TABLE: COMMUNITY_MESSAGES
-- ============================================
CREATE TABLE IF NOT EXISTS community_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image')),
    media_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_user ON community_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_community_created ON community_messages (created_at);

-- ============================================
-- TABLE: SUPPORT_REQUESTS
-- ============================================
CREATE TABLE IF NOT EXISTS support_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT DEFAULT 'support' CHECK (type IN ('support', 'report')),
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'replied', 'closed')),
    admin_reply TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    replied_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_support_user ON support_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_support_type ON support_requests (type);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_requests (status);
CREATE INDEX IF NOT EXISTS idx_support_created ON support_requests (created_at);

-- ============================================
-- TABLE: NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    image_url TEXT,
    is_important INTEGER DEFAULT 0,
    dismiss_hours INTEGER DEFAULT 2,
    target_user_id INTEGER,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications (target_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications (created_by);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);

-- ============================================
-- TABLE: NOTIFICATION_READS
-- ============================================
CREATE TABLE IF NOT EXISTS notification_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads (user_id);

-- ============================================
-- TABLE: API_KEYS
-- ============================================
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    UNIQUE (key_hash)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys (created_by);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys (revoked_at);

-- ============================================
-- TABLE: SECURITY_IP_BLOCKS
-- ============================================
CREATE TABLE IF NOT EXISTS security_ip_blocks (
    ip TEXT PRIMARY KEY,
    reason TEXT,
    detail TEXT,
    block_until DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_ip_blocks_until ON security_ip_blocks (block_until);

-- ============================================
-- TABLE: SECURITY_ACTION_LOGS
-- ============================================
CREATE TABLE IF NOT EXISTS security_action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_ip TEXT,
    target_key TEXT,
    content_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_action_logs_user ON security_action_logs (action_type, actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_action_logs_ip ON security_action_logs (action_type, actor_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_security_action_logs_hash ON security_action_logs (action_type, actor_user_id, content_hash, created_at);

-- ============================================
-- SAMPLE DATA
-- ============================================
INSERT INTO categories (name, slug, description, display_order) VALUES
('Website Template', 'website-template', 'Mẫu website hoàn chỉnh', 1),
('WordPress Theme', 'wordpress-theme', 'Theme WordPress', 2),
('React Component', 'react-component', 'Component React', 3),
('Script & Plugin', 'script-plugin', 'Script và Plugin', 4),
('Mobile App', 'mobile-app', 'Source code ứng dụng mobile', 5);

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('site_name', 'Source Market', 'Tên website'),
('total_revenue', '0', 'Tổng doanh thu hệ thống'),
('max_file_size', '26214400', 'Kích thước file tối đa (25MB)'),
('commission_rate', '10', 'Phần trăm hoa hồng (%)'),
('hero_title', 'Dịch vụ lập trình Sang dev', 'Tiêu đề hero trang chủ'),
('hero_subtitle', 'Mua bán source code rõ ràng, minh bạch, quy trình thanh toán an toàn.', 'Mô tả hero trang chủ'),
('hero_btn_primary_text', 'Đăng bán ngay', 'Text nút chính hero'),
('hero_btn_primary_link', '/dangban', 'Link nút chính hero'),
('hero_btn_secondary_text', 'Nạp tiền', 'Text nút phụ hero'),
('hero_btn_secondary_link', '/naptien', 'Link nút phụ hero'),
('hero_card_title', 'Vì sao chọn Sang dev shop?', 'Tiêu đề khối hero bên phải'),
('hero_card_subtitle', 'Hệ thống phân loại rõ ràng, trình duyệt nhanh, giao dịch minh bạch.', 'Mô tả khối hero bên phải'),
('hero_badges', 'Bảo mật tài khoản\nThanh toán linh hoạt', 'Danh sách badge hero (mỗi dòng 1 badge)'),
('footer_title', 'Sang dev', 'Tiêu đề footer'),
('footer_subtitle', 'Nền tảng mua bán mã nguồn uy tín', 'Mô tả footer'),
('footer_links_title', 'Liên kết', 'Tiêu đề khối liên kết footer'),
('footer_links', 'Trang chủ | /\nBài đăng | /baidang\nChính sách bảo mật | /privacy\nĐiều khoản dịch vụ | /terms', 'Danh sách liên kết footer (mỗi dòng: text | link)'),
('footer_contact_title', 'Liên hệ', 'Tiêu đề liên hệ footer'),
('footer_contact_email', 'Email: nguyenhongsang0207@gmail.com', 'Email liên hệ footer'),
('footer_copyright', '© 2026 Sang dev. All rights reserved.', 'Bản quyền footer'),
('contact_button_text', '', 'Text nút liên hệ ở footer'),
('contact_button_link', '', 'Link nút liên hệ ở footer'),
('bank_name', '', 'Tên ngân hàng'),
('bank_account_number', '', 'Số tài khoản ngân hàng'),
('bank_account_name', '', 'Tên chủ tài khoản'),
('bank_qr_url', '', 'Link QR ngân hàng'),
('bank_note', '', 'Nội dung chuyển khoản'),
('tos_title', 'Điều khoản dịch vụ', 'Tiêu đề điều khoản dịch vụ'),
('tos_content', '1. Nội dung trên website chỉ phục vụ mục đích trao đổi sản phẩm số.\n2. Người dùng chịu trách nhiệm về nội dung đã đăng.\n3. Không chia sẻ tài khoản cho người khác sử dụng.\n4. Giao dịch là tự nguyện và không hoàn tiền sau khi tải.\n5. Admin có quyền xử lý vi phạm theo quy định.', 'Nội dung điều khoản dịch vụ (mỗi dòng là 1 đoạn)'),
('lucky_spin_enabled', '1', 'Bat/tat mini game vong quay may man'),
('lucky_spin_title', 'Vong quay may man', 'Tieu de trang vong quay'),
('lucky_spin_subtitle', 'Phan thuong do he thong xu ly tu dong o phia server sau moi lan quay hop le.', 'Mo ta trang vong quay'),
('lucky_spin_cooldown_minutes', '1440', 'So phut cho moi lan quay'),
('lucky_spin_rewards_text', 'Chuc ban may man | 0 | 30 | #1f2937\nThuong 1.000d | 1000 | 38 | #0ea5e9\nThuong 2.000d | 2000 | 18 | #22c55e\nThuong 5.000d | 5000 | 10 | #f59e0b\nJackpot mini | 10000 | 4 | #ef4444', 'Moi dong: Ten | So tien | Trong so | Mau'),
('daily_checkin_enabled', '1', 'Bat/tat diem danh hang ngay'),
('daily_checkin_title', 'Diem danh nhan tien', 'Tieu de trang diem danh'),
('daily_checkin_subtitle', 'Nhan thuong moi ngay, chi backend moi co quyen tinh ngay va cong so du.', 'Mo ta trang diem danh'),
('daily_checkin_rewards_text', '1 | 1000 | Bat dau\n2 | 1500 | On dinh\n3 | 2000 | Tang toc\n4 | 2500 | Chuyen can\n5 | 3000 | Ben bi\n6 | 4000 | Gan dich\n7 | 5000 | Moc tuan', 'Moi dong: Ngay | So tien | Nhan tuy chon'),
('product_sale_enabled', '0', 'Bat/tat sale giam gia san pham'),
('product_sale_scope', 'all', 'Pham vi sale: all hoac category'),
('product_sale_percent', '0', 'Phan tram giam gia'),
('product_sale_category_ids', '', 'Danh sach category_id ap dung sale, cach nhau boi dau phay'),
('ip_check_enabled', '1', 'Bat/tat kiem tra IP bảo mật (1=Bật, 0=Tắt)'),
('bot_check_enabled', '1', 'Bat/tat kiem tra Bot human-check (1=Bật, 0=Tắt)');

INSERT INTO users (email, password_hash, full_name, role, status) VALUES
('duongthithuyhangkupee@gmail.com', '$2b$10$MgOJCJBxtw5wlWsOH3NaQeylP2ByjUefwmIZ130p7QBKXLkBHVxs.', 'System Admin', 'admin', 'active');
