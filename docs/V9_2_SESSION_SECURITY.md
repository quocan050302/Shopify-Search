# Hướng Dẫn Bảo Mật Phiên TikTok & Thu Hồi Cookie Bị Lộ — SWAI V9.2

Tài liệu này hướng dẫn cách bảo vệ tài khoản TikTok, thu hồi các phiên đăng nhập (session cookies) đã từng bị chia sẻ hoặc vô tình lộ trong quá khứ, và các nguyên tắc bảo mật thông tin xác thực trong hệ thống **Shopify Winning Ads Intelligence (SWAI)**.

---

## 1. Cảnh Báo An Toàn & Đánh Giá Rủi Ro

- **Không bao giờ tái sử dụng các cookie phiên đã lộ:** Bất kỳ chuỗi cookie nào (chứa `sessionid`, `sid_tt`, `msToken`, v.v.) đã từng xuất hiện trong tin nhắn, ảnh chụp màn hình, tài liệu chia sẻ hoặc kho lưu trữ công khai đều phải được xem là **đã bị xâm phạm (compromised)**.
- **Không tự động dò tìm hoặc thử nghiệm cookie ngẫu nhiên:** Việc gửi lặp lại các session cookie không rõ nguồn gốc tới endpoint của TikTok có thể khiến tài khoản hoặc IP bị khóa vĩnh viễn bởi hệ thống WAF (Web Application Firewall).
- **Hệ thống SWAI V9.2 tuân thủ bảo mật tuyệt đối:** SWAI không lưu trữ, không hardcode, không gửi tự động và không che giấu lỗi xác thực.

---

## 2. Hướng Dẫn Thu Hồi & Hủy Hiệu Lực Phiên Đăng Nhập Cũ (Session Revocation)

Để đảm bảo các session cookie cũ không còn giá trị sử dụng trên bất kỳ hệ thống nào, bạn cần thực hiện thu hồi quyền đăng nhập trực tiếp từ tài khoản TikTok theo các bước sau:

### Cách 1: Đăng xuất tất cả thiết bị trên TikTok Web & Mobile
1. Mở ứng dụng **TikTok** trên điện thoại hoặc truy cập [https://www.tiktok.com](https://www.tiktok.com).
2. Vào **Hồ sơ (Profile)** -> bấm vào biểu tượng menu **3 dấu gạch ngang (≡)** ở góc trên bên phải.
3. Chọn **Cài đặt và quyền riêng tư (Settings and privacy)**.
4. Chọn **Bảo mật & Quyền riêng tư (Security & permissions)** -> chọn **Quản lý thiết bị (Manage devices)**.
5. Kiểm tra danh sách các phiên đăng nhập / thiết bị đang hoạt động.
6. Bấm vào biểu tượng **Thùng rác / Xóa (Remove / Log out)** cạnh tất cả các thiết bị hoặc trình duyệt mà bạn không nhận diện hoặc nơi bạn đã từng copy cookie.
7. Khi đăng xuất thành công, TikTok sẽ lập tức vô hiệu hóa giá trị `sessionid` và toàn bộ token liên quan ở phía máy chủ của họ.

### Cách 2: Đổi Mật Khẩu Tài Khoản (Khuyến nghị cao nhất)
1. Trong mục **Cài đặt và quyền riêng tư** -> **Tài khoản (Account)** -> **Mật khẩu (Password)**.
2. Thực hiện đổi mật khẩu mới có độ dài tối thiểu 12 ký tự gồm chữ hoa, chữ thường, số và ký tự đặc biệt.
3. TikTok sẽ hỏi bạn có muốn **Đăng xuất khỏi tất cả thiết bị khác** hay không -> Chọn **Đăng xuất tất cả (Log out of all devices)**.
4. Thao tác này sẽ làm mất hiệu lực toàn bộ session cookie cũ ngay lập tức.

### Cách 3: Kích Hoạt Xác Thực 2 Bước (2-Step Verification - 2FA)
1. Trong mục **Bảo mật (Security)**, bật **Xác minh 2 bước (2-step verification)** qua ứng dụng xác thực (Google Authenticator) hoặc SMS/Email.
2. Điều này ngăn chặn bất kỳ ai dù có mật khẩu cũ cũng không thể đăng nhập trái phép vào tài khoản của bạn.

---

## 3. Nguyên Tắc Bảo Mật Của SWAI V9.2

1. **Không yêu cầu Cookie mặc định:** Kiến trúc mặc định của SWAI V9.2 vận hành ở chế độ an toàn, không bắt buộc người dùng phải xuất session cookie từ trình duyệt cá nhân.
2. **Lọc sạch Header nhạy cảm trong Request Ledger:**
   - Bộ phận giám sát mạng (`providerRequestGuard.ts`) tự động lọc bỏ và kiểm duyệt các header như `Cookie`, `Authorization`, `Set-Cookie`, `x-tt-logid` trước khi ghi vào cơ sở dữ liệu kiểm toán.
   - Không có token hoặc cookie nào hiển thị trên giao diện người dùng (Dashboard) hay trong file log.
3. **Phân tách rõ ràng giữa cấu hình và quyền hạn API:**
   - Việc có cookie trong trình duyệt không đồng nghĩa với việc bạn có quyền cấp phép cho ứng dụng bên thứ ba tự động thu thập dữ liệu hàng loạt.
   - Khi không có thông tin xác thực hợp lệ, SWAI báo cáo trạng thái chân thực: `NOT_CONFIGURED` hoặc `NO_AUTHORIZED_PROVIDER`, hoàn toàn không giả lập dữ liệu thành công hay sinh mã lỗi giả 40101.
4. **Phương Án Thay Thế Miễn Phí & An Toàn Tuyệt Đối:**
   - Thay vì đưa cookie phiên vào phần mềm tự động, người dùng có thể sử dụng tính năng **Manual URL Import** hoặc **Batch Import** tại trang *Ads Explorer*.
   - Bạn duyệt TikTok Creative Center trực tiếp trên trình duyệt chính chủ của mình, sau đó dán liên kết quảng cáo cần phân tích vào SWAI. Cách tiếp cận này hoàn toàn tuân thủ bảo mật, không tiêu tốn API và không gặp rủi ro lộ phiên đăng nhập.
