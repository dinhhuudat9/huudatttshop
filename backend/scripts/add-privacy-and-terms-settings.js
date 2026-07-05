// ============================================
// DATABASE MIGRATION: ADD PRIVACY & TERMS SETTINGS
// File: backend/scripts/add-privacy-and-terms-settings.js
// ============================================

const db = require('../config/database');

async function migrate() {
    console.log('Starting migration to add privacy policy and terms settings...');
    try {
        const settings = [
            {
                key: 'tos_title',
                value: 'Điều khoản dịch vụ',
                desc: 'Tiêu đề trang điều khoản dịch vụ'
            },
            {
                key: 'tos_content',
                value: [
                    '1. Chào mừng bạn đến với Sang dev - Sàn giao dịch mã nguồn chuyên nghiệp. Khi truy cập và sử dụng dịch vụ của chúng tôi, bạn đồng ý tuân thủ toàn bộ các điều khoản và điều kiện được quy định tại đây.',
                    '2. Người dùng khi đăng ký tài khoản có nghĩa vụ bảo mật thông tin tài khoản đăng nhập của mình, không chia sẻ cho bất kỳ bên thứ ba nào khác. Mọi hoạt động phát sinh từ tài khoản của bạn sẽ thuộc hoàn toàn trách nhiệm của bạn.',
                    '3. Người bán (Seller) cam kết rằng toàn bộ mã nguồn đăng tải trên website đều thuộc quyền sở hữu hợp pháp hoặc có quyền phân phối hợp lệ, không vi phạm bản quyền và không chứa mã độc (backdoor, virus, shell). Nếu phát hiện vi phạm, tài khoản người bán sẽ bị khóa vĩnh viễn và tịch thu số dư.',
                    '4. Giao dịch mua bán sản phẩm số tại Sang dev là giao dịch tự nguyện giữa người mua và người bán. Sau khi hệ thống đã cung cấp liên kết tải xuống mã nguồn thành công, chúng tôi sẽ không áp dụng chính sách hoàn tiền trừ trường hợp sản phẩm không đúng mô tả và người bán không hỗ trợ giải quyết trong vòng 48 giờ.',
                    '5. Ban quản trị có toàn quyền xử lý các tài khoản vi phạm quy chế hoạt động của sàn, bao gồm tạm khóa tài khoản, khóa vĩnh viễn, hoặc từ chối cung cấp dịch vụ mà không cần thông báo trước nếu phát hiện hành vi gian lận hoặc gây hại cho hệ thống.',
                    '6. Mọi tranh chấp phát sinh giữa người mua và người bán sẽ được hỗ trợ giải quyết thông qua cổng tranh chấp/hỗ trợ của Sang dev. Quyết định cuối cùng của Ban quản trị sẽ là quyết định có hiệu lực cao nhất.'
                ].join('\n'),
                desc: 'Nội dung điều khoản dịch vụ (mỗi dòng là 1 đoạn)'
            },
            {
                key: 'privacy_title',
                value: 'Chính sách bảo mật',
                desc: 'Tiêu đề trang chính sách bảo mật'
            },
            {
                key: 'privacy_content',
                value: [
                    '1. Sang dev cam kết tôn trọng và bảo vệ quyền riêng tư của tất cả người dùng khi sử dụng dịch vụ trên sàn giao dịch mã nguồn của chúng tôi.',
                    '2. Chúng tôi thu thập thông tin cá nhân bao gồm: Họ tên, địa chỉ Email, giới tính, địa chỉ IP, lịch sử giao dịch và nạp rút tiền để vận hành tài khoản và cải thiện chất lượng dịch vụ.',
                    '3. Thông tin cá nhân thu thập được chỉ sử dụng nội bộ cho các mục đích: Xác thực tài khoản qua OTP, thực hiện giao dịch nạp rút tiền, hỗ trợ kỹ thuật và thông báo các thông tin quan trọng từ hệ thống.',
                    '4. Chúng tôi áp dụng các công nghệ bảo mật tiên tiến (mã hóa mật khẩu bằng bcrypt, giao thức kết nối bảo mật HTTPS) nhằm bảo vệ thông tin người dùng khỏi việc truy cập, thay đổi hoặc tiết lộ trái phép.',
                    '5. Sàn giao dịch Sang dev tuyệt đối không bán, trao đổi hoặc tiết lộ thông tin cá nhân của người dùng cho bất kỳ bên thứ ba nào, trừ trường hợp có yêu cầu bằng văn bản từ cơ quan nhà nước có thẩm quyền theo quy định của pháp luật Việt Nam.',
                    '6. Người dùng có quyền truy cập, chỉnh sửa thông tin cá nhân trong phần cài đặt tài khoản, hoặc liên hệ với bộ phận hỗ trợ của chúng tôi để yêu cầu xóa tài khoản vĩnh viễn khi không còn nhu cầu sử dụng dịch vụ.'
                ].join('\n'),
                desc: 'Nội dung chính sách bảo mật (mỗi dòng là 1 đoạn)'
            }
        ];

        for (const item of settings) {
            // Check if key already exists
            const [rows] = await db.execute('SELECT id FROM system_settings WHERE setting_key = ?', [item.key]);
            if (rows.length > 0) {
                // Update
                await db.execute(
                    'UPDATE system_settings SET setting_value = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
                    [item.value, item.desc, item.key]
                );
                console.log(`Updated setting key: ${item.key}`);
            } else {
                // Insert
                await db.execute(
                    'INSERT INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
                    [item.key, item.value, item.desc]
                );
                console.log(`Inserted setting key: ${item.key}`);
            }
        }

        console.log('Settings migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
