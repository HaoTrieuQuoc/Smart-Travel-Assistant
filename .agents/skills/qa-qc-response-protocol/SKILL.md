---
name: qa-qc-response-protocol
description: >-
  Standard operating response and delivery protocol for completing software engineering tasks.
  Use this skill whenever completing a code change, bug fix, feature implementation, or refactoring,
  to structure the response with technical mechanisms, improvements, and comprehensive QA/QC test verification.
---

# QA/QC Delivery & Technical Response Protocol

Quy chuẩn phản hồi kỹ thuật và bàn giao kết quả (Definition of Done & Delivery Protocol) dành cho trợ lý kỹ sư phần mềm / Tech Lead trong dự án Smart Travel Assistant.

---

## 1. Mục Đích & Nguyên Tắc Cốt Lõi

1. **Minh bạch kỹ thuật (Technical Transparency):** Không trả lời chung chung hoặc mang tính cảm tính. Luôn giải thích rõ bản chất: *Vấn đề gì đã xảy ra*, *Tại sao xảy ra*, *Cơ chế kỹ thuật nào đã giải quyết* và *Dữ liệu/luồng di chuyển ra sao*.
2. **Chứng minh bằng kiểm thử tự động (Verifiable QA/QC):** Mọi thay đổi logic code đều phải đi kèm với test case bổ sung hoặc cập nhật, chạy toàn bộ test suite (`npm test`, syntax linting) và báo cáo số liệu pass/fail cụ thể.
3. **Phong cách Anti-AI Persona:** Tuyệt đối không sử dụng các biểu tượng emoji robot/AI sáo rỗng (`🤖`, `🚀`, `💡`, `🧠`, `✨`). Sử dụng phong cách viết gãy gọn, chuyên nghiệp của Kỹ sư Cấp cao / QA Lead.
4. **Tham chiếu tệp tin có thể nhấp chuột (Clickable File Links):** Mọi tệp nguồn được đề cập phải dùng định dạng Markdown link `[tên_file](file:///đường/dẫn/tuyệt/đối)` với dấu gạch chéo `/`.

---

## 2. Quy Trình Các Bước Thực Hiện Trước Khi Phản Hồi (Pre-Flight Protocol)

Khi nhận và thực hiện bất kỳ yêu cầu sửa lỗi (bug fix) hay tính năng mới (feature):

```
+-------------------------------------------------------------+
| 1. Code Implementation & Edge Case Handling                 |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 2. Write / Update Test Cases (Unit & E2E Simulations)       |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 3. Run Automated Validation:                                |
|    - npm run lint:syntax                                    |
|    - npm test                                               |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 4. Git Synchronize: Stage -> Commit -> Push (origin main)  |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| 5. Generate Structured Response (Mục 3 bên dưới)            |
+-------------------------------------------------------------+
```

---

## 3. Cấu Trúc Khung Phản Hồi Chuẩn (Mandatory Response Format)

Mỗi khi hoàn thành một tác vụ lập trình hoặc bàn giao, phản hồi tới người dùng BẮT BUỘC tuân thủ cấu trúc 3 phần sau:

### Phần 1: Cơ Chế Xử Lý & Cải Tiến Kỹ Thuật (Mechanism & Technical Improvements)
- **Bối cảnh & Nguyên nhân gốc rễ (Root Cause & Context):** Mô tả ngắn gọn hiện tượng lỗi hoặc nhu cầu cải tiến (ví dụ: nút bấm bị lưu lại ở tin nhắn cũ, race condition, thiếu validation, lệch chuẩn schema).
- **Cơ chế xử lý cốt lõi (Core Technical Mechanism):**
  - Luồng dữ liệu (Data Flow / Event Lifecycle).
  - Tên các hàm/module được tạo mới hoặc chỉnh sửa kèm clickable file link (ví dụ: [common.js](file:///d:/Góc Của Hào/CV/Smart Travel Assistant/lambda/common.js)).
  - Cơ chế quản lý trạng thái (State tracking, Database Item, Private Metadata, Webhook Update).
- **Cải tiến & Tối ưu hóa (Improvements & Resilience):**
  - Các trường hợp biên (Edge Cases) đã được xử lý (backward compatibility, dọn dẹp bộ nhớ, retry, idempotency).
  - Trải nghiệm người dùng (UX/UI): thông báo trạng thái, gỡ nút bấm thừa, định dạng văn bản rõ ràng.

### Phần 2: Kết Quả Kiểm Thử QA/QC & Đảm Bảo Chất Lượng (QA/QC Testing & Quality Gate)
- **Test Cases Bổ sung / Cập nhật:**
  - Nêu rõ mã định danh test (ví dụ `TC-UI-06`, `E2E-FLOW-03`).
  - Phân loại (Unit Test, UI/UX Compliance, Security, Data Schema, E2E Flow).
  - Mục tiêu kiểm tra cụ thể.
- **Báo cáo kết quả kiểm thử tự động (Execution Summary):**
  - Số lượng Unit Tests chạy & tỷ lệ pass (ví dụ: `31/31 Unit Tests PASS (100%)`).
  - Số lượng E2E Flows chạy & tỷ lệ pass (ví dụ: `5/5 E2E Simulation Flows PASS (100%)`).
  - Trạng thái kiểm tra cú pháp (Syntax Linting: `PASS`).
- **Trạng thái đồng bộ mã nguồn (VCS / Git Status):**
  - Commit SHA / Message chuẩn Conventional Commits.
  - Trạng thái push lên remote repository (`main -> main`).

### Phần 3: Hướng Dẫn Xác Nhận Thực Tế (User Acceptance Verification)
- 1 đến 3 bước thao tác ngắn gọn để người dùng hoặc tester có thể tái hiện và kiểm tra ngay trên thực tế (trên Slack channel, Google Sheets, hoặc môi trường test).

---

## 4. Mẫu Phản Hồi Tham Khảo (Golden Reference Template)

```markdown
Yêu cầu của anh/chị đã được xử lý hoàn tất và đồng bộ lên repository. Dưới đây là báo cáo cơ chế kỹ thuật và kết quả kiểm định chất lượng:

---

### 1. Cơ Chế Xử Lý & Cải Tiến Kỹ Thuật

1. **Lưu vết định danh & Trạng thái:**
   - Mô tả cách hệ thống lưu trữ trạng thái qua metadata hoặc database.
2. **Triển khai phương thức xử lý mới:**
   - Bổ sung hàm `functionName()` trong [module.js](file:///d:/path/to/module.js).
3. **Phân tách trạng thái hiển thị:**
   - Xử lý các điều kiện rẽ nhánh và giao diện tương ứng.
4. **Xử lý triệt để các trường hợp ngoại lệ (Edge Cases):**
   - Đảm bảo tính tương thích ngược và dọn dẹp tài nguyên rác.

---

### 2. Kết Quả Kiểm Thử (Automated QA/QC Test Suite)

- **Các ca kiểm thử đã bổ sung/cập nhật:**
  - `TC-XX-YY`: Mô tả nội dung kiểm tra.
  - `E2E-FLOW-ZZ`: Mô phỏng luồng người dùng từ đầu đến cuối.
- **Kết quả thực thi toàn diện (`npm test`):**
  - **Unit Tests:** XX/XX PASS (100%)
  - **E2E Simulation:** YY/YY PASS (100%)
  - **Syntax Check (`npm run lint:syntax`):** Không phát hiện lỗi cú pháp.
- **Trạng thái mã nguồn:** Đã commit và đẩy thành công lên nhánh `main` (`commit_hash`).

---

### 3. Hướng Dẫn Kiểm Tra Thực Tế (UAT)
- Bước 1: ...
- Bước 2: ...
```
