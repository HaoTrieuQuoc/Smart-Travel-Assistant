# Smart Travel Assistant - Demo trên Slack (BẢN NHÁP ĐỂ DUYỆT)

Trạng thái: chờ duyệt. Chưa chạy `demo-setup`, chưa quay.
Định dạng theo `.agents/skills/demo-setup/references/script-format.md` (Say = lời dẫn, Show = thao tác).
Tổng thời lượng dự kiến: khoảng 6 phút 30 giây (9 vòng). Có thể cắt vòng 3, 7, 8 để còn khoảng 4 phút.

## Prep (chuẩn bị ngoài camera)

1. Workspace Slack demo riêng, có 2 kênh: `#travel-booking` (EMPLOYEE) và `#biz-admin-alerts` (ADMIN_HR). Đã mời bot.
2. Anh đăng nhập Slack web một lần trong cửa sổ Playwright; em lưu `storageState`. Em không nhập mật khẩu hay 2FA.
3. Ảnh vé máy bay mẫu (anh đã cung cấp): `demos/slack-demo/fixtures/ticket_han_vca.png`. Vietnam Airlines VN1203, Hà Nội -> Cần Thơ, 25/12, 14:00. Vé **không in giá**, nên bot sẽ hiện "Chưa rõ", rất hợp để minh họa quy tắc giá thiếu và cảnh báo bất thường ở vòng BI.
4. Dùng cùng một vé này xuyên suốt vòng 1-4 và vòng 7. Nếu OCR đọc lệch, em chỉnh ảnh (cắt, phóng to) trước khi quay.
5. Google Sheet `Lịch_Trình_Công_Tác` (link xem công khai, không cần đăng nhập Google) mở ở tab thứ hai. Hiện có 5 chuyến: 3 chuyến có giá (1.8tr, 1.8tr, 1tr) và 2 chuyến "Chưa rõ", đủ để vòng BI có số liệu và cảnh báo thiếu giá. Không có chuyến Business, nên bỏ ý "hạng Business" khỏi lời dẫn vòng 6.
   - Lưu ý: Sheet đã có sẵn 1 dòng `Le Dang Hieu`, VN1203, HAN -> VCA, 25/12 (từ lần thử trước). Vòng 4 sẽ thêm dòng thứ hai trùng chuyến bay. Em đề xuất anh xóa dòng cũ này (và item tương ứng trong DynamoDB) trước khi quay, hoặc chấp nhận trùng.
   - Cột email (F) và Slack username (G) lộ trên màn hình; em phủ lớp làm mờ lên hai cột này khi quay.
6. Vòng 8 (nhắc 24h): Lambda `smart-travel-assistant-flight-reminder` chỉ gửi cho chuyến `APPROVED` có giờ bay trong 24h tới, mà hiện không có chuyến nào như vậy (chuyến 21/09 đã qua, chuyến 25/12 còn 30 ngày). Cách xử lý khi quay: em tạo tạm 1 item `DEMO-REMIND` trong DynamoDB với giờ bay ngày mai, gọi Lambda bằng AWS CLI, quay lúc tin nhắn xuất hiện ở `#biz-admin-alerts`, rồi **xóa item đó**. Item này không có dòng trong Sheet nên cột U sẽ không đổi: bỏ bước "cột U hiển thị SENT" ở vòng 8.
7. Ẩn thông tin thật: không để tên người thật, email, token lộ trên màn hình.

## Kết quả chạy thử thật (đã kiểm chứng ngày 25/11/2026)

Em đã gửi thử ảnh vé vào `#travel-booking` và đọc phản hồi của bot. Những điều này thay đổi cách quay:

1. **Phải gắn `@Travel Assistant` trong mọi tin nhắn** (kể cả khi tải ảnh, hỏi báo cáo, sửa chuyến). Bot trả lời **trong thread**, nên các thẻ nằm ở khung Thread bên phải. Các cảnh quay mở thread và focus vào khung đó.
2. OCR đọc đúng vé mẫu: Le Dang Hieu, VN1203, PNR TKNE, Hà Nội (HAN) -> Cần Thơ (VCA), 2026-12-25 14:00, Economy, giá "Chưa rõ". Bot phản hồi trong khoảng 1 phút.
3. Nút trên thẻ bản nháp: **"Xác nhận"**, **"Chỉnh sửa"**, **"Hủy bỏ"**.
4. Tài khoản đang đăng nhập hiển thị tên "Quoc Hao". Tin nhắn cũ trong kênh và các hội thoại riêng ở thanh bên (tên người thật) sẽ được ẩn bằng CSS khi quay; banner "16 days left in trial" và banner ứng dụng di động cũng ẩn.
5. Lần chạy thử này đã để lại 1 tin nhắn có ảnh và 1 bản nháp (chưa xác nhận, chưa ghi vào Sheet) trong `#travel-booking`. Bản nháp sẽ bị ghi đè ở lần tải ảnh kế tiếp.

## Vòng 0 - Mở đầu (khoảng 20s)

### Say
1. "Smart Travel Assistant tự động hóa quy trình công tác ngay trong Slack: từ đọc vé máy bay, lưu dữ liệu, đến báo cáo và nhắc lịch bay."
2. "Hệ thống có hai kênh với hai quyền khác nhau: kênh đặt vé cho nhân viên, và kênh quản trị cho HR."

### Show
1. Mở Slack, đứng ở `#travel-booking`. Wide.
2. Click qua `#biz-admin-alerts` rồi quay lại `#travel-booking`.

## Vòng 1 - Upload vé, AI đọc và tạo bản nháp (khoảng 45s)

### Say
1. "Nhân viên chỉ cần thả ảnh vé vào kênh."
2. "Vision AI đọc tên hành khách, chuyến bay, giờ bay, mã đặt chỗ và giá vé, rồi chuẩn hóa mã sân bay thành tên thành phố."
3. "Kết quả hiện thành thẻ xem trước, chưa lưu gì cả cho đến khi người dùng xác nhận."

### Show
1. Wide, kênh `#travel-booking`.
2. Click nút đính kèm, chọn `ticket_han_vca.png` (qua `setInputFiles`), bấm gửi.
3. Wide, chờ bot trả lời (chờ theo điều kiện: thẻ xem trước xuất hiện, không chờ giây cố định).
4. Focus vào thẻ xem trước, giữ khoảng 4s cho khán giả đọc các trường (HAN -> Hà Nội, VCA -> Cần Thơ, VN1203, 14:00) và giá "Chưa rõ".
5. Wide.

## Vòng 2 - Sửa bản nháp bằng câu chat tự nhiên (khoảng 40s)

### Say
1. "Nếu thông tin chưa đúng, nhân viên có thể sửa bằng một câu bình thường trong thread."
2. "Bot cập nhật bản nháp và gửi lại thẻ xem trước mới."

### Show
1. Click "Reply in thread" ở thẻ xem trước.
2. Gõ: "Đổi phòng ban thành Kinh doanh, mục đích là gặp khách hàng đối tác".
3. Gửi, chờ thẻ xem trước mới.
4. Focus vào hai trường đã đổi, giữ 3s. Wide.

## Vòng 3 - Sửa bằng form Modal 14 trường (khoảng 35s) (có thể cắt)

### Say
1. "Với người thích form, có thể mở biểu mẫu chỉnh sửa đầy đủ mười bốn trường."
2. "Thẻ cũ bị khóa nút để tránh bấm nhầm bản đã lỗi thời."

### Show
1. Click "Chỉnh sửa" trên thẻ xem trước, modal mở.
2. Cuộn nhanh modal để thấy nhiều trường, sửa 1 trường (ví dụ ngân sách), bấm Lưu.
3. Wide, chỉ vào thẻ mới và thẻ cũ đã bị vô hiệu nút. Giữ 3s.

## Vòng 4 - Xác nhận, ghi đồng thời DynamoDB và Google Sheets (khoảng 50s)

### Say
1. "Khi bấm xác nhận, hệ thống cấp mã chuyến công tác và ghi đồng thời vào hai nơi."
2. "DynamoDB là kho dữ liệu chính, kèm mã băm SHA-256 để kiểm toán. Google Sheets là bảng theo dõi cho bộ phận tài chính."
3. "Bên Sheets, dòng mới xuất hiện đầy đủ hai mươi ba cột."

### Show
1. Click "Xác nhận lưu" trên thẻ.
2. Wide, chờ thông báo thành công có mã `TRIP-YYYYMM-XXX`. Focus vào mã, giữ 3s.
3. Chuyển sang tab Google Sheets (đã mở sẵn), cuộn tới dòng cuối. Focus vào dòng mới, giữ 4s.
4. Quay lại tab Slack.

## Vòng 5 - Phân quyền theo kênh (khoảng 35s)

### Say
1. "Phân quyền dựa trên kênh. Nhân viên không được truy vấn báo cáo hay sửa chuyến đã lưu."
2. "Bot từ chối lịch sự và hướng dẫn đúng quy trình."

### Show
1. Ở `#travel-booking`, gõ: "Tổng chi phí vé tháng này của cả công ty là bao nhiêu?".
2. Gửi, chờ tin nhắn từ chối.
3. Focus vào tin nhắn từ chối, giữ 3s. Wide.

## Vòng 6 - HR hỏi báo cáo BI bằng ngôn ngữ tự nhiên (khoảng 60s)

### Say
1. "Chuyển sang kênh quản trị. HR hỏi bằng tiếng Việt thông thường."
2. "AI chỉ lập kế hoạch truy vấn. Con số được tính bằng mã JavaScript trên dữ liệu thật, nên không có chuyện AI tính sai."
3. "Báo cáo gồm tổng chi phí, nhóm theo phòng ban hoặc hãng bay, cảnh báo bất thường như vé thiếu giá, kèm nhận định ngắn."

### Show
1. Click `#biz-admin-alerts`. Wide.
2. Gõ: "Thống kê chi phí công tác theo phòng ban tháng này và cảnh báo bất thường".
3. Gửi, chờ thẻ báo cáo (chờ theo điều kiện).
4. Focus lần lượt: bảng tổng hợp, mục cảnh báo, phần nhận định. Mỗi mục giữ khoảng 3s. Wide.

## Vòng 7 - HR sửa chuyến đã lưu bằng chat (khoảng 40s) (có thể cắt)

### Say
1. "Quản trị viên còn có thể sửa chuyến đã lưu bằng một câu lệnh."
2. "Thay đổi được cập nhật đồng thời ở cả Sheets lẫn DynamoDB."

### Show
1. Gõ: "Sửa chuyến TRIP-... đổi ngân sách thành 12 triệu" (mã lấy từ vòng 4).
2. Gửi, chờ bot xác nhận.
3. Focus vào xác nhận, giữ 3s. (Tùy chọn: chuyển nhanh sang Sheets xem ô đã đổi, 3s.)

## Vòng 8 - Nhắc bay trước 24 giờ (khoảng 35s)

### Say
1. "Mỗi sáng tám giờ, một lịch tự động quét các chuyến sắp bay trong hai mươi bốn giờ."
2. "Bot đăng cảnh báo kèm checklist điểm đến và hành lý do AI soạn, rồi đánh dấu đã nhắc để không gửi trùng."

### Show
1. Wide ở `#biz-admin-alerts`, tin nhắn nhắc bay đã được kích hoạt ngoài camera (xem Prep mục 6), cuộn tới tin nhắn.
2. Focus vào tiêu đề chuyến bay, rồi checklist. Giữ khoảng 4s.
3. Wide, giữ 2s. (Không quay cột U vì item tạm không có dòng trong Sheet.)

## Vòng 9 - Kết (khoảng 15s)

### Say
1. "Toàn bộ chạy trên AWS serverless, chi phí gần như bằng không khi không dùng. Đó là Smart Travel Assistant."

### Show
1. Wide, giữ 3s. Dừng.

## Lưu ý kỹ thuật và rủi ro cần anh biết

| Vấn đề | Cách xử lý |
|---|---|
| Phản hồi của AI không cố định thời gian | Chờ theo điều kiện thấy thẻ/tin nhắn; quay nhiều take, chọn take tốt |
| Kết quả OCR có thể lệch ở ảnh mẫu | Em chạy thử không quay ở bước dựng script, chỉnh ảnh mẫu cho ổn định |
| Slack web đổi giao diện, selector có thể vỡ | Dùng selector theo `data-qa` và role; kiểm tra trước khi quay |
| Dữ liệu thật lộ trên video | Dùng workspace và Sheet demo, tên giả |
| Công cụ trên máy | Máy hiện có Node 26.1.0 và Python 3.11.9; **chưa có ffmpeg và Playwright**. Cần cài trước khi quay |

## Câu hỏi để anh chốt

Đã chốt: có thuyết minh giọng nói (ElevenLabs, key đã lưu trong `.env`), giữ đủ 9 vòng, bot chạy trên AWS.
