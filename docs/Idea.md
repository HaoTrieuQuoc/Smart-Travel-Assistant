
## Dự án: **Smart Travel Assistant**

#### Vấn đề:

Trước giờ bên phía Biz Admin hay quản lý các chuyến đi của các síp thông qua 1 cái Google Sheets, nhưng sử dụng nó rất phiền vì mỗi lần cần thêm chuyến đi hay update cái gì phải mò vào Google Sheets, chưa kể là nhiều khi mình điền thông tin sai format đến hồi kiểm toán rất khó và mọi thứ từ việc điền thông tin, kiểm tra lỗi, sửa đổi ngày giờ, soạn email để gửi rất phiền và mất thời gian. Mà công ty trước giờ đã sử dụng Slack làm platform để liên lạc chính thì không tội gì không sử dụng nó 1 cách triệt để luôn.

#### Plan:

1. Sử dụng 1 google account service để con Slack Bot có khả năng tương tác với cái Google Sheet.
2. Ingest đống data của cái Google Sheets đó vào DynamoDB thông qua Lambda.
3. Tạo cronjob để nó tự động làm việc trên bằng Event Bridge hằng ngày, nó chỉ cần kiểm tra diff để update.
4. 24h trước chuyến bay, nó sẽ tự động bắn 1 cái email và con Slack Bot sẽ DM người dùng để remind họ về chuyến bay sắp tới.
5. Nội dung bên trong email và Slack Bot DM sẽ bao gồm thông tin chuyến bay của người dùng, reminder là họ cần phải mang những gì, dựa vào mã code IATA của sân bay mà 1 con AI sẽ tạo 1 section chuyên về những chỗ vui chơi, đặc sản, danh lam thắng cảnh của điểm đáp.
6. Đồng thời trong qúa trình sync data từ Google Sheet qua DynamoDB nó cũng sẽ check xem có field nào còn thiếu, field nào sai format và báo cáo qua 1 Slack channel mỗi ngày để admin biết mà sửa.
7. Sử dụng Interactive Modal của Slack Bot để Admin sử dụng slash command sửa thẳng vào Google Sheet , ngoài ra họ có thể dùng chức năng đó để test và automate luôn.
8. Sử dụng chức năng Agent của Slack Bot để người dùng có thể nói chuyện với nó, họ có thể dùng nó để yêu cầu tạo 1 cái Purchase Request cho chuyến đi hoặc đơn giản là upload cái tầm hình vé máy bay của họ lên và nó sẽ đọc những field có sẵn trong tấm vé để điền vào.
