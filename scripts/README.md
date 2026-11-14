# Local Test & Verification Scripts

Thư mục này chứa các kịch bản chạy thử nghiệm độc lập (standalone test runners) và công cụ đồng bộ dữ liệu cục bộ phục vụ quá trình phát triển (Sprints 1–4) trước khi triển khai lên hạ tầng AWS Cloud (Sprint 5).

## Danh mục Scripts

| Script | Sprint | Mục đích & Chức năng | Lệnh thực thi |
| :--- | :---: | :--- | :--- |
| `init_and_test.js` | **Sprint 1** | Khởi tạo cấu trúc 23 cột trên Google Sheets, kiểm tra quyền Service Account và gửi tin nhắn test đến Slack `#biz-admin-alerts`. | `npm run init:sheets` |
| `sync_and_audit.js` | **Sprint 1 & 2** | Đồng bộ 2 chiều giữa Google Sheets và DynamoDB cục bộ (LocalStack), tính toán mã băm SHA-256 (`row_hash`) và gắn nhãn audit. | `npm run sync:audit` |
| `reminder_worker.js` | **Sprint 3** | Quét lịch bay khởi hành trong vòng 24 giờ, gọi OpenRouter AI tạo cẩm nang hành lý và gửi DM riêng cho nhân viên. | `npm run reminder` |
| `test_ai_pr.js` | **Sprint 4** | Kiểm tra bóc tách yêu cầu tạo Purchase Request (PR) từ hội thoại tự nhiên tiếng Việt bằng mô hình AI. | `npm run test:pr` |
| `slack_server.js` | **Sprint 4** | Web server cục bộ (Port 3000) lắng nghe Slack Webhook, hỗ trợ test tương tác Modal, Block Kit card và upload ảnh vé máy bay. | `npm run start:local` |
| `ai_ocr_service.js` | **Sprint 4** | Module trung gian xử lý Multimodal Vision OCR (NVIDIA Super VL) và NLP PR Parser đọc cấu hình từ file `.env`. | *Import helper* |

## Cách sử dụng

Anh có thể chạy trực tiếp từ thư mục gốc của dự án:
```bash
# 1. Khởi tạo Sheet & kiểm tra kết nối Slack
npm run init:sheets
# hoặc: node scripts/init_and_test.js

# 2. Chạy worker đồng bộ & kiểm tra SHA-256 hash diff
npm run sync:audit
# hoặc: node scripts/sync_and_audit.js

# 3. Test gửi lời nhắc bay 24h & tạo cẩm nang AI
npm run reminder
# hoặc: node scripts/reminder_worker.js

# 4. Test bóc tách PR bằng AI
npm run test:pr
# hoặc: node scripts/test_ai_pr.js
```
