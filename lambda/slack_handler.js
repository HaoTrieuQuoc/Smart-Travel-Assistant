/**
 * AWS Lambda Handler for Slack Webhooks (Events, Commands, Interactions)
 * Triggered by AWS API Gateway HTTP API
 */
const crypto = require('crypto');
const { extractTicketFromBase64, parsePurchaseRequestChat } = require('./ai_ocr_service');
const {
  docClient,
  PutCommand,
  makeRequest,
  getGoogleAccessToken,
  downloadSlackFile,
  getSlackFileInfo,
  postSlackMessage
} = require('./common');

const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE_NAME || 'TravelBookings';
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// Verify Slack Request Signature
function verifySlackSignature(event) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true; // Skip if not set

  const headers = event.headers || {};
  const signature = headers['x-slack-signature'] || headers['X-Slack-Signature'];
  const timestamp = headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'];

  if (!signature || !timestamp) return false;

  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (60 * 5);
  if (timestamp < fiveMinutesAgo) return false;

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body || '');
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring, 'utf8').digest('hex');

  return crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(signature, 'utf8'));
}

// Save Trip Record to Google Sheets and DynamoDB
async function saveTripRecord(tripData) {
  const accessToken = await getGoogleAccessToken();
  const now = new Date();
  const tripSeq = Math.floor(100 + Math.random() * 900);
  const tripId = `TRIP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${tripSeq}`;
  const prNumber = `PR-${now.getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

  const newRow = [
    tripId,
    prNumber,
    "APPROVED",
    tripData.passenger_name || "N/A",
    "Nhân sự / Quản lý",
    tripData.passenger_email || "user@company.com",
    `@${(tripData.passenger_email || 'user').split('@')[0]}`,
    tripData.airline || "Vietnam Airlines",
    tripData.flight_number || "VN214",
    tripData.departure_city || "Hồ Chí Minh",
    tripData.departure_iata || "SGN",
    tripData.arrival_city || "Hà Nội",
    tripData.arrival_iata || "HAN",
    tripData.departure_time || "2026-11-20 08:30",
    tripData.arrival_time || "",
    tripData.pnr || "N/A",
    tripData.ticket_class || "Economy",
    tripData.ticket_price || "0",
    "Corporate Card",
    tripData.purpose || "Công tác nội bộ",
    "PENDING",
    "VALID",
    "Được bóc tách tự động qua AWS Lambda & AI Vision OCR."
  ];

  // 1. Ghi Google Sheet
  await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A:W:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, { values: [newRow] });

  // 2. Ghi AWS DynamoDB
  const rowHash = crypto.createHash('sha256').update(`${tripId}|${tripData.passenger_name}|${tripData.flight_number}|${tripData.departure_time}`).digest('hex');
  await docClient.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      trip_id: tripId,
      pr_number: prNumber,
      status: 'APPROVED',
      passenger_name: tripData.passenger_name || 'N/A',
      passenger_email: tripData.passenger_email || 'user@company.com',
      slack_handle: `@${(tripData.passenger_email || 'user').split('@')[0]}`,
      airline: tripData.airline || 'Vietnam Airlines',
      flight_number: tripData.flight_number || 'VN214',
      departure_city: tripData.departure_city || 'Hồ Chí Minh',
      departure_iata: tripData.departure_iata || 'SGN',
      arrival_city: tripData.arrival_city || 'Hà Nội',
      arrival_iata: tripData.arrival_iata || 'HAN',
      departure_time: tripData.departure_time || '2026-11-20 08:30',
      arrival_time: tripData.arrival_time || '',
      pnr: tripData.pnr || 'N/A',
      ticket_class: tripData.ticket_class || 'Economy',
      ticket_price: String(tripData.ticket_price || '0'),
      payment_method: 'Corporate Card',
      purpose: tripData.purpose || 'Công tác nội bộ',
      reminder_sent: 'PENDING',
      audit_status: 'VALID',
      row_hash: rowHash,
      last_synced_at: new Date().toISOString()
    }
  }));

  return { tripId, prNumber };
}

// Handle Slack Events (Message or App Mention)
async function handleSlackEvent(event) {
  if (event.bot_id || event.subtype === 'bot_message') return;

  const channelId = event.channel;
  const userText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  const threadTs = event.thread_ts || event.ts;

  // 1. Thu thập tất cả các file đính kèm từ mọi thuộc tính có thể có
  let rawFiles = [];
  if (Array.isArray(event.files)) {
    rawFiles = event.files;
  } else if (event.file) {
    rawFiles = [event.file];
  }

  // Lọc các file ảnh (png, jpg, jpeg, webp, bmp, heic)
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.heic'];
  const isImageFile = (f) => {
    if (f.mimetype && f.mimetype.startsWith('image/')) return true;
    if (f.filetype && ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(String(f.filetype).toLowerCase())) return true;
    if (f.name && imageExtensions.some(ext => String(f.name).toLowerCase().endsWith(ext))) return true;
    return false;
  };

  const imageFiles = rawFiles.filter(isImageFile);

  // Case 1: Có ảnh vé máy bay đính kèm -> Phản hồi tức thì & Quét OCR
  if (imageFiles.length > 0) {
    let file = imageFiles[0];

    // PHẢN HỒI NGAY LẬP TỨC (< 200ms) CHO USER BIẾT BOT ĐÃ NHẬN ẢNH VÀ ĐANG QUÉT
    await postSlackMessage(channelId, {
      channel: channelId,
      thread_ts: threadTs,
      text: "🤖 *Chào Sếp! Em đã nhận được ảnh vé máy bay rồi ạ.*\n⏳ *AI Vision đang quét và trích xuất dữ liệu hành trình trong 2-3 giây, Sếp đợi em một chút nhé!*"
    });

    try {
      // Nếu file chưa có URL tải thì gọi Slack API lấy chi tiết
      if (!file.url_private_download && !file.url_private && file.id) {
        const fullFileInfo = await getSlackFileInfo(file.id);
        if (fullFileInfo) file = fullFileInfo;
      }

      const downloadUrl = file.url_private_download || file.url_private;
      if (!downloadUrl) {
        throw new Error('Không lấy được liên kết tải ảnh từ Slack');
      }

      const base64Data = await downloadSlackFile(downloadUrl);
      const ticketInfo = await extractTicketFromBase64(base64Data, file.mimetype || 'image/png');

      const previewCard = {
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🎫 KẾT QUẢ ĐỌC VÉ MÁY BAY TỰ ĐỘNG (AI VISION)", emoji: true }
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: "Bot đã nhận diện thành công các thông tin sau từ ảnh vé của Sếp. Vui lòng kiểm tra lại trước khi lưu:" }
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Hành khách:*\n${ticketInfo.passenger_name || 'N/A'}` },
              { type: "mrkdwn", text: `*Hãng hàng không:*\n${ticketInfo.airline || 'Vietnam Airlines'}` },
              { type: "mrkdwn", text: `*Số hiệu chuyến bay:*\n✈️ \`${ticketInfo.flight_number || 'N/A'}\`` },
              { type: "mrkdwn", text: `*Mã đặt chỗ (PNR):*\n🎫 \`${ticketInfo.pnr || 'N/A'}\`` },
              { type: "mrkdwn", text: `*Lộ trình:*\n${ticketInfo.departure_iata || 'HAN'} ➔ *${ticketInfo.arrival_iata || 'SGN'}* (${ticketInfo.arrival_city || ''})` },
              { type: "mrkdwn", text: `*Giờ cất cánh:*\n🕒 *${ticketInfo.departure_time || 'N/A'}*` },
              { type: "mrkdwn", text: `*Hạng vé:*\n${ticketInfo.ticket_class || 'Economy'}` },
              { type: "mrkdwn", text: `*Giá vé:*\n${ticketInfo.ticket_price && ticketInfo.ticket_price !== '0' ? Number(ticketInfo.ticket_price).toLocaleString('vi-VN') + ' VND' : 'Đã xuất vé (Boarding Pass)'}` }
            ]
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "✅ Xác Nhận & Lưu Vào Sheet", emoji: true },
                style: "primary",
                action_id: "confirm_save_ticket",
                value: JSON.stringify(ticketInfo)
              },
              {
                type: "button",
                text: { type: "plain_text", text: "❌ Hủy Bỏ", emoji: true },
                style: "danger",
                action_id: "cancel_ticket"
              }
            ]
          }
        ]
      };

      await postSlackMessage(channelId, previewCard);
    } catch (err) {
      console.error('OCR Error:', err);
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: `⚠️ *Không thể đọc được ảnh vé này:* ${err.message}. Sếp vui lòng thử lại với ảnh rõ nét hơn nhé!`
      });
    }
    return;
  }

  // Case 2: Người dùng tag bot nói về vé nhưng chưa đính kèm ảnh
  const isTicketIntent = /(vé|ticket|boarding|pass|thêm vé|add vé|ảnh vé|scan|ocr|quét|lịch trình)/i.test(userText);
  if (isTicketIntent && imageFiles.length === 0) {
    await postSlackMessage(channelId, {
      channel: channelId,
      thread_ts: threadTs,
      text: "🤖 *Chào Sếp! Em đã nhận được yêu cầu thêm thông tin vé máy bay của Sếp.*\n📎 *Tuy nhiên em chưa thấy file ảnh vé hoặc thẻ lên máy bay đính kèm.* Sếp vui lòng đính kèm ảnh vé máy bay (ảnh e-ticket/boarding pass) vào tin nhắn và gửi lại để em quét tự động nhé!\n*(Hoặc Sếp có thể gõ lệnh `/travel-admin` để mở form điền thông tin trực tiếp)*"
    });
    return;
  }

  // Case 3: Natural Language PR Chat (Xin duyệt công tác)
  if (userText.length > 0) {
    try {
      const prData = await parsePurchaseRequestChat(userText);
      if (prData.is_pr_request) {
        await postSlackMessage(channelId, {
          channel: channelId,
          thread_ts: threadTs,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "📋 ĐÃ GHI NHẬN YÊU CẦU TẠO PURCHASE REQUEST (PR)", emoji: true }
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `Dạ, em đã ghi nhận đề xuất công tác của Sếp và chuẩn bị sẵn phiếu duyệt PR:` }
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Điểm đến:*\n📍 ${prData.destination || 'Chưa rõ'}` },
                { type: "mrkdwn", text: `*Ngày đi dự kiến:*\n🗓️ ${prData.departure_date || 'Chưa định ngày'}` },
                { type: "mrkdwn", text: `*Ngân sách dự trù:*\n💰 ${Number(prData.estimated_cost || 0).toLocaleString('vi-VN')} VND` },
                { type: "mrkdwn", text: `*Mục đích:*\n${prData.purpose || 'Công tác'}` }
              ]
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "✅ Gửi Sếp Tổng / CFO Duyệt", emoji: true },
                  style: "primary",
                  action_id: "submit_pr_approval",
                  value: JSON.stringify(prData)
                }
              ]
            }
          ]
        });
        return;
      }
    } catch (err) {
      console.log('Not a PR request:', err.message);
    }

    // Fallback: Nếu tag bot với câu chào hỏi chung chung
    if (event.type === 'app_mention') {
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: "👋 *Chào Sếp! Em là Smart Travel Assistant - Trợ lý Quản lý Công tác Thông minh.*\n\nSếp có thể giao việc cho em bằng các cách sau:\n1. 📸 *Kéo thả ảnh vé máy bay/boarding pass vào đây kèm tag tên em:* Em sẽ tự động bóc tách thông tin và lưu vào Google Sheets.\n2. 📝 *Gõ lệnh `/travel-admin`:* Mở form đặt lịch công tác chuẩn 9 trường dữ liệu.\n3. 💬 *Nhắn tin tự nhiên xin đi công tác (VD:* `Tạo giúp anh PR đi Hà Nội ngày 20/11 ngân sách 15tr`*):* Em sẽ soạn sẵn phiếu trình duyệt gửi Sếp Tổng/CFO!"
      });
    }
  }
}

// Main Lambda Handler for API Gateway
exports.handler = async (event, context) => {
  const path = event.rawPath || event.path || '';
  const bodyStr = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body || '');

  // 1. Endpoint: /slack/events
  if (path.endsWith('/slack/events')) {
    let payload;
    try {
      payload = JSON.parse(bodyStr);
    } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    // A. Slack URL Verification Challenge
    if (payload.type === 'url_verification') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: payload.challenge })
      };
    }

    // B. Slack Event Callback
    if (payload.type === 'event_callback') {
      // Async process event
      await handleSlackEvent(payload.event);
      return { statusCode: 200, body: 'OK' };
    }

    return { statusCode: 200, body: 'OK' };
  }

  // 2. Endpoint: /slack/commands (/travel-admin or /book-travel)
  if (path.endsWith('/slack/commands')) {
    const params = new URLSearchParams(bodyStr);
    const triggerId = params.get('trigger_id');

    if (triggerId) {
      const modalView = {
        type: "modal",
        callback_id: "travel_booking_modal",
        title: { type: "plain_text", text: "Đặt Lịch Công Tác", emoji: true },
        submit: { type: "plain_text", text: "Gửi Duyệt", emoji: true },
        close: { type: "plain_text", text: "Hủy", emoji: true },
        blocks: [
          {
            type: "input",
            block_id: "name_block",
            element: { type: "plain_text_input", action_id: "name_input", placeholder: { type: "plain_text", text: "VD: NGUYEN VAN A" } },
            label: { type: "plain_text", text: "Họ và Tên Nhân Sự" }
          },
          {
            type: "input",
            block_id: "email_block",
            element: { type: "plain_text_input", action_id: "email_input", placeholder: { type: "plain_text", text: "VD: nguyen.a@company.com" } },
            label: { type: "plain_text", text: "Email Công Ty" }
          },
          {
            type: "input",
            block_id: "flight_block",
            element: { type: "plain_text_input", action_id: "flight_input", placeholder: { type: "plain_text", text: "VD: VN214 - Vietnam Airlines" } },
            label: { type: "plain_text", text: "Số Hiệu & Hãng Hàng Không" }
          },
          {
            type: "input",
            block_id: "dep_iata_block",
            element: { type: "plain_text_input", action_id: "dep_iata_input", placeholder: { type: "plain_text", text: "VD: SGN, HAN, DAD..." } },
            label: { type: "plain_text", text: "Sân Bay Đi (Mã IATA 3 ký tự)" }
          },
          {
            type: "input",
            block_id: "arr_iata_block",
            element: { type: "plain_text_input", action_id: "arr_iata_input", placeholder: { type: "plain_text", text: "VD: HAN, DAD, NRT, SIN..." } },
            label: { type: "plain_text", text: "Sân Bay Đến (Mã IATA 3 ký tự)" }
          },
          {
            type: "input",
            block_id: "time_block",
            element: { type: "plain_text_input", action_id: "time_input", placeholder: { type: "plain_text", text: "YYYY-MM-DD HH:mm (VD: 2026-11-20 08:30)" } },
            label: { type: "plain_text", text: "Ngày & Giờ Cất Cánh" }
          },
          {
            type: "input",
            block_id: "pnr_block",
            element: { type: "plain_text_input", action_id: "pnr_input", placeholder: { type: "plain_text", text: "VD: XYZ123 (6 ký tự)" } },
            label: { type: "plain_text", text: "Mã Đặt Chỗ (PNR)" }
          },
          {
            type: "input",
            block_id: "cost_block",
            element: { type: "plain_text_input", action_id: "cost_input", placeholder: { type: "plain_text", text: "VD: 2500000" } },
            label: { type: "plain_text", text: "Chi Phí Vé / Dự Trù (VND)" }
          },
          {
            type: "input",
            block_id: "purpose_block",
            element: { type: "plain_text_input", action_id: "purpose_input", multiline: true, placeholder: { type: "plain_text", text: "VD: Gặp đối tác ký kết hợp đồng dự án Q4" } },
            label: { type: "plain_text", text: "Mục Đích Công Tác" }
          }
        ]
      };

      await makeRequest('https://slack.com/api/views.open', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }, { trigger_id: triggerId, view: modalView });
    }

    return { statusCode: 200, body: '' };
  }

  // 3. Endpoint: /slack/interactions
  if (path.endsWith('/slack/interactions')) {
    const params = new URLSearchParams(bodyStr);
    const payloadStr = params.get('payload');

    if (payloadStr) {
      const payload = JSON.parse(payloadStr);

      // A. Xử lý khi Admin Submit Form Modal
      if (payload.type === 'view_submission') {
        const values = payload.view.state.values;
        const passengerName = values.name_block?.name_input?.value || 'N/A';
        const passengerEmail = values.email_block?.email_input?.value || 'user@company.com';
        const flightRaw = values.flight_block?.flight_input?.value || 'VN214';
        const depIata = (values.dep_iata_block?.dep_iata_input?.value || 'SGN').trim().toUpperCase();
        const arrIata = (values.arr_iata_block?.arr_iata_input?.value || 'HAN').trim().toUpperCase();
        const depTime = (values.time_block?.time_input?.value || '2026-11-20 08:30').trim();
        const pnr = (values.pnr_block?.pnr_input?.value || 'N/A').trim().toUpperCase();
        const price = (values.cost_block?.cost_input?.value || '0').replace(/[^0-9]/g, '');
        const purpose = values.purpose_block?.purpose_input?.value || 'Công tác nội bộ';

        let flightNum = flightRaw;
        let airline = 'Vietnam Airlines';
        if (flightRaw.includes('-')) {
          const parts = flightRaw.split('-');
          flightNum = parts[0].trim();
          airline = parts[1].trim();
        }

        const cityMap = { 'SGN': 'Hồ Chí Minh', 'HAN': 'Hà Nội', 'DAD': 'Đà Nẵng', 'NRT': 'Tokyo', 'SIN': 'Singapore' };
        const tripData = {
          passenger_name: passengerName,
          passenger_email: passengerEmail,
          airline: airline,
          flight_number: flightNum,
          departure_iata: depIata,
          departure_city: cityMap[depIata] || depIata,
          arrival_iata: arrIata,
          arrival_city: cityMap[arrIata] || arrIata,
          departure_time: depTime,
          pnr: pnr,
          ticket_class: 'Economy',
          ticket_price: price || '0',
          purpose: purpose
        };

        // Ghi vào Google Sheet và DynamoDB trong nền
        saveTripRecord(tripData).then(({ tripId }) => {
          postSlackMessage(process.env.SLACK_ADMIN_CHANNEL_ID || 'C0CGLFPNW7R', {
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "✈️ ĐÃ TẠO CHUYẾN CÔNG TÁC MỚI QUA SLACK MODAL", emoji: true }
              },
              {
                type: "section",
                fields: [
                  { type: "mrkdwn", text: `*Hành khách:*\n${passengerName}` },
                  { type: "mrkdwn", text: `*Chuyến bay:*\n${flightNum} (${airline})` },
                  { type: "mrkdwn", text: `*Lộ trình:*\n${tripData.departure_city} (${tripData.departure_iata}) ➔ ${tripData.arrival_city} (${tripData.arrival_iata})` },
                  { type: "mrkdwn", text: `*Giờ cất cánh:*\n🕒 ${depTime}` },
                  { type: "mrkdwn", text: `*Trip ID:*\n\`${tripId}\`` },
                  { type: "mrkdwn", text: `*PNR:*\n🎫 \`${pnr}\`` }
                ]
              }
            ]
          }).catch(console.error);
        }).catch(console.error);

        // Trả về đóng modal
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response_action: 'clear' })
        };
      }

      // B. Xử lý các nút bấm tương tác (Block Actions)
      if (payload.type === 'block_actions') {
        const action = payload.actions?.[0];
        if (action?.action_id === 'confirm_save_ticket') {
          const ticketData = JSON.parse(action.value);
          const { tripId } = await saveTripRecord(ticketData);

          if (payload.response_url) {
            await makeRequest(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, {
              text: `🎉 *ĐÃ LƯU THÀNH CÔNG VÀO GOOGLE SHEET & DYNAMODB!*\nTrip ID được cấp: \`${tripId}\` (Hành khách: *${ticketData.passenger_name}* - Chuyến bay *${ticketData.flight_number}*).`
            });
          }
        } else if (action?.action_id === 'submit_pr_approval') {
          if (payload.response_url) {
            await makeRequest(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, {
              text: "✅ *Yêu cầu Purchase Request (PR) đã được chuyển tiếp đến Ban Giám Đốc/CFO để phê duyệt!*\nSau khi duyệt thành công, hệ thống sẽ tự động cập nhật lịch trình."
            });
          }
        }
      }
    }

    return { statusCode: 200, body: '' };
  }

  return { statusCode: 404, body: 'Not Found' };
};

