/**
 * AWS Lambda Handler for 24h Flight Reminders
 * Triggered periodically by AWS EventBridge Cron
 */
const { callOpenRouter } = require('./ai_ocr_service');
const {
  docClient,
  ScanCommand,
  UpdateCommand,
  makeRequest,
  getGoogleAccessToken,
  postSlackMessage
} = require('./common');

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE_NAME || 'TravelBookings';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác';
const ADMIN_CHANNEL_ID = process.env.SLACK_ADMIN_CHANNEL_ID || 'C0CGLFPNW7R';

async function generateAITravelGuide(booking) {
  const prompt = `Bạn là Trợ lý Quản lý Công tác Doanh nghiệp.
Một nhân viên sắp bay chuyến sau trong vòng 24 giờ tới:
- Họ tên: ${booking.passenger_name}
- Chuyến bay: ${booking.flight_number} (${booking.airline})
- Lộ trình: ${booking.departure_city} (${booking.departure_iata}) ➔ ${booking.arrival_city} (${booking.arrival_iata})
- Giờ cất cánh: ${booking.departure_time}
- Hạng vé: ${booking.ticket_class}
- Mục đích: ${booking.purpose}

Hãy tạo thông điệp nhắc nhở công tác chuyên nghiệp bằng tiếng Việt gồm:
1. Checklist hành lý cần thiết & giấy tờ tùy thân (Hộ chiếu/CCCD, Visa nếu có, Laptop, sạc dự phòng...).
2. Lưu ý nhập cảnh & thời tiết tại điểm đến (${booking.arrival_city}).
3. Khuyên giờ có mặt tại sân bay (nội địa trước 2 tiếng, quốc tế trước 3 tiếng).
Giữ văn phong lịch sự, súc tích, định dạng Markdown rõ ràng, tuyệt đối không dùng icon hoặc emoji.`;

  const payload = {
    model: process.env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: 'system', content: 'You are an enterprise corporate travel assistant. Avoid using emojis.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3
  };

  return await callOpenRouter(payload);
}

exports.handler = async (event, context) => {
  console.log('Starting 24h Flight Reminder Cron Job...');

  // 1. Quét các booking APPROVED và PENDING reminder
  const scanResult = await docClient.send(new ScanCommand({
    TableName: DYNAMODB_TABLE,
    FilterExpression: '#st = :approved AND (#rem = :pending OR attribute_not_exists(#rem))',
    ExpressionAttributeNames: {
      '#st': 'status',
      '#rem': 'reminder_sent'
    },
    ExpressionAttributeValues: {
      ':approved': 'APPROVED',
      ':pending': 'PENDING'
    }
  }));

  const items = scanResult.Items || [];
  console.log(`Tìm thấy ${items.length} chuyến bay APPROVED đang chờ xử lý.`);

  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let remindersSent = 0;

  for (const booking of items) {
    const depTime = new Date(booking.departure_time);
    const isWithin24h = depTime >= now && depTime <= next24h;

    // Nếu thời gian cất cánh trong vòng 24h
    if (isWithin24h) {
      console.log(`Xử lý gửi reminder cho ${booking.passenger_name} (${booking.flight_number})...`);

      const aiGuide = await generateAITravelGuide(booking);

      // Gửi thông báo đến Admin Channel (không chứa icon/emoji)
      await postSlackMessage(ADMIN_CHANNEL_ID, {
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `NHẮC LỊCH BAY 24H: ${booking.passenger_name.toUpperCase()}`, emoji: false }
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Chuyến bay:*\n${booking.flight_number} (${booking.airline})` },
              { type: "mrkdwn", text: `*Chặng:*\n${booking.departure_iata} ➔ ${booking.arrival_iata}` },
              { type: "mrkdwn", text: `*Giờ bay:*\n${booking.departure_time}` },
              { type: "mrkdwn", text: `*Hành khách:*\n${booking.passenger_name}` }
            ]
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Hướng dẫn & Chuẩn bị hành lý:*\n\n${aiGuide}` }
          }
        ]
      });

      // 1. Cập nhật DynamoDB
      await docClient.send(new UpdateCommand({
        TableName: DYNAMODB_TABLE,
        Key: { trip_id: booking.trip_id },
        UpdateExpression: 'SET reminder_sent = :sent, last_synced_at = :now',
        ExpressionAttributeValues: {
          ':sent': 'SENT',
          ':now': new Date().toISOString()
        }
      }));

      // 2. Cập nhật Google Sheets Column U (Reminder_24h)
      if (SPREADSHEET_ID && booking.trip_id) {
        try {
          const accessToken = await getGoogleAccessToken();
          const sheetRes = await makeRequest(
            `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A:U`,
            {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${accessToken}` }
            }
          );
          const rows = sheetRes.data?.values || [];
          for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] && rows[i][0].toString().trim().toUpperCase() === booking.trip_id.toUpperCase()) {
              const rowIndex = i + 1;
              await makeRequest(
                `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!U${rowIndex}?valueInputOption=USER_ENTERED`,
                {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  }
                },
                { values: [['SENT']] }
              );
              break;
            }
          }
        } catch (sheetErr) {
          console.error(`Lỗi cập nhật Google Sheet cho chuyến ${booking.trip_id}:`, sheetErr);
        }
      }

      remindersSent++;
    }
  }

  console.log(`Hoàn thành Cron Job. Đã gửi ${remindersSent} thông báo nhắc bay.`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success', remindersSent })
  };
};
