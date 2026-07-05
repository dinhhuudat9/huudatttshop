# Source Market - Ghi chú dự án (Backend + Frontend)

Tài liệu này mô tả ngắn gọn, dễ đọc về **tính năng** và **kiến trúc** của cả Backend lẫn Frontend để bạn nắm tổng quan nhanh.

## 1) Tổng quan
sang dev shop là nền tảng mua bán mã nguồn, có:
- Trang chủ, danh mục, chi tiết sản phẩm
- Đăng bán, mua sản phẩm, ví tiền
- Cộng đồng, bài đăng, nhắn tin
- Admin panel toàn quyền
- Thông báo trong web + backup Telegram
- Lưu trữ ảnh qua imgbb, video dùng link

---

## 2) Tính năng chính

### Người dùng
- Đăng ký/đăng nhập bằng JWT
- Hồ sơ cá nhân: sửa thông tin, avatar, liên hệ
- Xem và mua sản phẩm
- Nạp tiền (gửi yêu cầu, xem lịch sử)
- Lịch sử mua hàng
- Cộng đồng: đăng bài (ảnh), bình luận/like
- Hỗ trợ & tố cáo

### Người bán (seller)
- Đăng bán sản phẩm
- Sửa/xóa sản phẩm của mình
- Upload ảnh (tự chuyển thành link)
- Video sản phẩm dùng link

### Admin
- Dashboard tổng quan doanh thu và số liệu
- Quản lý user, nạp tiền, sản phẩm, bài đăng, tin nhắn
- Gửi thông báo (toàn hệ thống hoặc chọn user)
- Quản lý nội dung trang chủ, footer, nút liên hệ
- Trang lưu trữ (dung lượng DB + thống kê bảng)
- Xuất data.json hoặc gửi backup lên Telegram
- Tạo/thu hồi API key tích hợp
- Bảo vệ admin chính (không cho admin phụ chỉnh sửa/xóa)

---

## 3) Backend (Node.js + Express + MySQL)

### Cấu trúc chính
- `backend/server.js`: khởi động server + route
- `backend/routes/*`: routing API
- `backend/controllers/*`: xử lý request
- `backend/services/*`: logic nghiệp vụ
- `backend/middleware/*`: auth, API key, upload

### Module quan trọng
- Auth: JWT + bcrypt
- Products: CRUD, mua hàng, thống kê
- Wallet: nạp tiền, lịch sử giao dịch
- Posts & Community: bài đăng, like, comment
- Messages: chat
- Notifications: thông báo trong web
- Telegram backup: xuất dữ liệu + menu /data
- Settings: đọc cấu hình hệ thống

### Database chính
Các bảng chính:
- `users`, `products`, `categories`
- `product_images`, `product_categories`
- `transactions`, `deposit_requests`, `purchases`
- `posts`, `post_media`, `post_likes`, `post_comments`
- `messages`, `community_messages`
- `support_requests`, `notifications`, `notification_reads`
- `system_settings`, `api_keys`

---

## 4) Frontend (Vanilla JS + SPA)

### Kiến trúc
- SPA router tự viết: `frontend/js/router.js`
- Mỗi trang có file riêng ở `frontend/js/pages/*`
- API client: `frontend/js/api.js`
- Auth helper: `frontend/js/auth.js`
- UI & CSS: `frontend/css/main.css`, `frontend/css/components.css`

### Các trang chính
- Trang chủ: `/`
- Feed: `/feed`
- Cộng đồng: `/congdong`
- Đăng bán: `/dangban`
- Chi tiết sản phẩm: `/page2/:slug`
- Hồ sơ: `/trangcanhan/:id`
- Nạp tiền: `/naptien`
- Admin: `/admin`

---

## 5) Luồng nghiệp vụ quan trọng

### Đăng bán
1. Upload ảnh -> gửi qua imgbb -> lưu link
2. Video nhập link
3. Tạo sản phẩm -> lưu DB

### Mua hàng
1. Kiểm tra số dư
2. Trừ tiền người mua
3. Cộng tiền người bán
4. Ghi giao dịch + purchase
5. Cập nhật doanh thu
6. Backup Telegram (nếu bật)

### Thông báo
Admin có thể gửi:
- Cho toàn hệ thống
- Hoặc chọn nhiều user theo danh sách
Thông báo sẽ auto xóa sau 12 giờ

---

## 6) Settings có thể chỉnh trong Admin
- Nội dung Hero trang chủ
- Footer
- Nút liên hệ
- Thông tin ngân hàng
- Điều khoản dịch vụ
- API key tích hợp

---

## 7) Lưu ý vận hành
- Mọi API admin yêu cầu đăng nhập và role `admin`
- Backend phải chạy mới dùng được frontend
- Token JWT lưu ở `localStorage`

---

Nếu bạn muốn, mình có thể mở rộng tài liệu này thành hướng dẫn triển khai hoặc checklist kiểm thử chi tiết.
