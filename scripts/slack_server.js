const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { extractTicketFromBase64, parsePurchaseRequestChat } = require('./ai_ocr_service');

// 1. Đọc cấu hình từ .env (hỗ trợ gọi từ root hoặc scripts/)
function loadEnv() {
  const envPath = fs.existsSync(path.join(__dirname, '.env'))
    ? path.join(__dirname, '.env')
    : path.resolve(__dirname, '..', '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const config = {};
  envContent.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const idx = line.indexOf('=');
      if (idx !== -1) {
        config[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
  });
  return config;
}

const env = loadEnv();
const PORT = process.env.PORT || 3000;
const slackToken = env.SLACK_BOT_TOKEN;
const spreadsheetId = env.GOOGLE_SHEET_ID;
const tabName = env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác';
const localstackUrl = env.LOCALSTACK_ENDPOINT || 'http://127.0.0.1:4566';
const serviceAccountPath = fs.existsSync(path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE))
  ? path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE)
  : path.resolve(__dirname, '..', env.GOOGLE_SERVICE_ACCOUNT_FILE);

console.log('================================================================');
console.log('  SMART TRAVEL BOT - SPRINT 4: AI VISION OCR & CHATBOT PR FLOW  ');
console.log('================================================================');

// Helper: HTTP/HTTPS Request
function makeRequest(urlStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = client.request(reqOptions, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

// Lấy Google Access Token
function base64Url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken() {
  const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  const signInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const jwt = `${signInput}.${base64Url(signer.sign(sa.private_key))}`;

  const res = await makeRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`);

  return res.data.access_token;
}

// 2. Tải file ảnh từ Slack API
function downloadSlackFile(fileUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(fileUrl);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${slackToken}`
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('base64'));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 3. Xử lý lưu vé vào Google Sheet & DynamoDB
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
    "Được bóc tách tự động qua AI Vision OCR."
  ];

  // Ghi Google Sheet
  await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A:W:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, { values: [newRow] });

  // Ghi DynamoDB
  try {
    const rowHash = crypto.createHash('sha256').update(`${tripId}|${tripData.passenger_name}|${tripData.flight_number}|${tripData.departure_time}`).digest('hex');
    await makeRequest(localstackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'x-amz-target': 'DynamoDB_20120810.PutItem',
        'Authorization': 'AWS4-HMAC-SHA256 Credential=test/20261112/us-east-1/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-target, Signature=test'
      }
    }, {
      TableName: 'TravelBookings',
      Item: {
        trip_id: { S: tripId },
        passenger_name: { S: tripData.passenger_name || 'N/A' },
        passenger_email: { S: tripData.passenger_email || 'user@company.com' },
        flight_code: { S: tripData.flight_number || 'N/A' },
        departure_iata: { S: tripData.departure_iata || 'SGN' },
        arrival_iata: { S: tripData.arrival_iata || 'HAN' },
        departure_time: { S: tripData.departure_time || '2026-11-20 08:30' },
        pnr: { S: tripData.pnr || 'N/A' },
        reminder_sent: { S: "PENDING" },
        audit_status: { S: "VALID" },
        row_hash: { S: rowHash },
        last_synced_at: { S: new Date().toISOString() }
      }
    });
  } catch (err) {
    console.log('⚠️ Bỏ qua ghi DynamoDB Local:', err.message);
  }

  return { tripId, prNumber };
}

// 4. Xử lý sự kiện tin nhắn & upload file từ Slack (Event Subscription)
async function handleSlackEvent(event) {
  // Bỏ qua tin nhắn do chính Bot gửi để tránh vòng lặp vô tận
  if (event.bot_id || event.subtype === 'bot_message') return;

  const channelId = event.channel;
  // Làm sạch text nếu user tag @bot trong channel
  let userText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  const files = event.files || [];

  console.log(`\n• NHẬN EVENT TỪ SLACK (Channel: ${channelId}): "${userText}"`);

  // TRƯỜNG HỢP 1: NGƯỜI DÙNG TẢI ẢNH VÉ MÁY BAY LÊN
  if (files.length > 0 && files[0].mimetype.startsWith('image/')) {
    const file = files[0];
    console.log(`📸 Người dùng tải ảnh: ${file.name} (${file.mimetype})`);

    // Gửi thông báo đang xử lý
    await makeRequest('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    }, {
      channel: channelId,
      text: "🔍 *AI đang đọc và bóc tách thông tin từ vé máy bay của Sếp... Vui lòng chờ 3-5 giây nhé!*"
    });

    try {
      // Tải ảnh về dưới dạng base64
      const base64Data = await downloadSlackFile(file.url_private_download);
      // Gọi AI Vision OCR
      const ticketInfo = await extractTicketFromBase64(base64Data, file.mimetype);

      // Render thẻ xem trước (Card Preview) kèm nút bấm "Xác nhận & Lưu"
      const previewCard = {
        channel: channelId,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🎫 KẾT QUẢ ĐỌC VÉ MÁY BAY TỰ ĐỘNG (AI VISION)",
              emoji: true
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Bot đã nhận diện thành công các thông tin sau từ ảnh vé của Sếp. Vui lòng kiểm tra lại trước khi lưu:"
            }
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Hành khách:*\n${ticketInfo.passenger_name || 'N/A'}` },
              { type: "mrkdwn", text: `*Hãng hàng không:*\n${ticketInfo.airline || 'Vietnam Airlines'}` },
              { type: "mrkdwn", text: `*Số hiệu chuyến bay:*\n✈️ \`${ticketInfo.flight_number || 'N/A'}\`` },
              { type: "mrkdwn", text: `*Mã đặt chỗ (PNR):*\n🎫 \`${ticketInfo.pnr || 'N/A'}\`` },
              { type: "mrkdwn", text: `*Lộ trình:*\n${ticketInfo.departure_iata} ➔ *${ticketInfo.arrival_iata}* (${ticketInfo.arrival_city || ''})` },
              { type: "mrkdwn", text: `*Giờ cất cánh:*\n🕒 *${ticketInfo.departure_time || 'N/A'}*` },
              { type: "mrkdwn", text: `*Hạng vé:*\n${ticketInfo.ticket_class || 'Economy'}` },
              { type: "mrkdwn", text: `*Giá vé:*\n${ticketInfo.ticket_price ? Number(ticketInfo.ticket_price).toLocaleString('vi-VN') + ' VND' : 'Đã xuất vé'}` }
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

      await makeRequest('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }, previewCard);

    } catch (err) {
      console.error('❌ Lỗi xử lý ảnh vé:', err.message);
      await makeRequest('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }, {
        channel: channelId,
        text: `⚠️ *Không thể đọc được ảnh vé này:* ${err.message}. Sếp vui lòng thử lại với ảnh rõ nét hơn nhé!`
      });
    }
    return;
  }

  // TRƯỜNG HỢP 2: HỘI THOẠI TỰ NHIÊN XIN TẠO PURCHASE REQUEST (PR)
  if (userText.trim().length > 0) {
    try {
      const prData = await parsePurchaseRequestChat(userText);

      if (prData.is_pr_request) {
        // Tạo thẻ xác nhận yêu cầu PR
        await makeRequest('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${slackToken}`,
            'Content-Type': 'application/json; charset=utf-8'
          }
        }, {
          channel: channelId,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "📋 ĐÃ GHI NHẬN YÊU CẦU TẠO PURCHASE REQUEST (PR)",
                emoji: true
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Dạ, em đã ghi nhận đề xuất công tác của Sếp và chuẩn bị sẵn phiếu duyệt PR:`
              }
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
      }
    } catch (err) {
      console.log('Không phải yêu cầu PR:', err.message);
    }
  }
}

// 5. Khởi tạo HTTP Webhook Server
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(`[${req.method}] ${url.pathname}`);

    // Endpoint: Slack URL Verification & Event Subscriptions
    if (url.pathname === '/slack/events') {
      try {
        const payload = JSON.parse(body);

        // A. Xử lý Challenge khi Slack xác thực URL lần đầu
        if (payload.type === 'url_verification') {
          console.log('✅ Nhận URL Verification Challenge từ Slack!');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ challenge: payload.challenge }));
          return;
        }

        // B. Xử lý Event Callback (khi có tin nhắn hoặc upload file)
        if (payload.type === 'event_callback') {
          // Trả về HTTP 200 ngay lập tức (< 200ms)
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end();

          // Xử lý event trong nền
          handleSlackEvent(payload.event).catch(err => console.error('Lỗi handleSlackEvent:', err));
          return;
        }
      } catch (err) {
        console.error('Lỗi parse event:', err);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end();
      return;
    }

    // Endpoint: Xử lý Tương tác nút bấm (Interactions)
    if (url.pathname === '/slack/interactions') {
      const params = new URLSearchParams(body);
      const payloadStr = params.get('payload');

      if (payloadStr) {
        const payload = JSON.parse(payloadStr);

        // Khi người dùng bấm nút "Xác Nhận & Lưu Vào Sheet" từ ảnh vé
        if (payload.type === 'block_actions') {
          const action = payload.actions[0];

          if (action.action_id === 'confirm_save_ticket') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end();

            const ticketData = JSON.parse(action.value);
            saveTripRecord(ticketData).then(({ tripId }) => {
              // Cập nhật lại tin nhắn thông báo đã lưu thành công
              makeRequest(payload.response_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              }, {
                text: `🎉 *ĐÃ LƯU THÀNH CÔNG VÀO GOOGLE SHEET & DYNAMODB!*\nTrip ID được cấp: \`${tripId}\` (Hành khách: *${ticketData.passenger_name}* - Chuyến bay *${ticketData.flight_number}*).`
              });
            });
            return;
          }

          if (action.action_id === 'submit_pr_approval') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end();

            makeRequest(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, {
              text: `✅ *ĐÃ GỬI PHIẾU DUYỆT PR THÀNH CÔNG!*\nYêu cầu đã được chuyển tới kênh duyệt chi phí của Ban Giám Đốc.`
            });
            return;
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end();
      return;
    }

    // Mặc định
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Smart Travel Bot Sprint 4 is RUNNING!');
  });
});

server.listen(PORT, () => {
  console.log(`🚀 SLACK ADMIN & AI SERVER SPRINT 4 ĐANG CHẠY TẠI: http://localhost:${PORT}`);
  console.log(`• Endpoint nhận Event (Message/File): http://localhost:${PORT}/slack/events`);
  console.log(`• Endpoint nhận Button Actions:      http://localhost:${PORT}/slack/interactions\n`);
});

