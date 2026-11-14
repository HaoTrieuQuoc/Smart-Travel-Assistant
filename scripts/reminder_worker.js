const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

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
const openrouterKey = env.OPENROUTER_API_KEY;
const aiModel = env.AI_MODEL || '@preset/free-model-stack';
const slackToken = env.SLACK_BOT_TOKEN;
const slackChannel = env.SLACK_ADMIN_CHANNEL_ID;
const spreadsheetId = env.GOOGLE_SHEET_ID;
const tabName = env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác';
const localstackUrl = env.LOCALSTACK_ENDPOINT || 'http://127.0.0.1:4566';
const serviceAccountPath = fs.existsSync(path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE))
  ? path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE)
  : path.resolve(__dirname, '..', env.GOOGLE_SERVICE_ACCOUNT_FILE);

console.log('================================================================');
console.log('  SMART TRAVEL BOT - SPRINT 3: 24H REMINDER & AI TRAVEL GUIDE   ');
console.log('================================================================');
console.log(`• AI Model: ${aiModel}`);
console.log(`• Slack Channel: ${slackChannel}`);

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

// 2. Lấy Access Token từ Google Service Account
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

// 3. Gọi OpenRouter AI sinh Cẩm Nang Điểm Đến (IATA Guide & Checklist)
async function generateAiTravelGuide(trip) {
  console.log(`\n• ĐANG GỌI AI (${aiModel}) ĐỂ TẠO CẨM NANG CHO ĐIỂM ĐẾN: ${trip.arrival_iata} (${trip.destination_city})...`);

  const systemPrompt = `Bạn là Trợ lý Du lịch & Công tác Cao cấp của Doanh nghiệp (Smart Travel AI Assistant).
Nhiệm vụ của bạn là tạo một bản hướng dẫn chuẩn bị công tác và cẩm nang ngắn gọn, tinh tế, sang trọng dành riêng cho Lãnh đạo cấp cao (C-Level/Managing Director) trước chuyến bay 24 giờ.
Hãy trả về văn bản định dạng Markdown ngắn gọn, súc tích, chuyên nghiệp bằng tiếng Việt.`;

  const userPrompt = `Thông tin chuyến công tác:
- Người đi: ${trip.passenger_name}
- Chuyến bay: ${trip.flight_code} (${trip.departure_iata} ✈️ ${trip.arrival_iata} - ${trip.destination_city})
- Thời gian cất cánh: ${trip.departure_time}
- Mục đích: ${trip.purpose}

Hãy tạo nội dung gồm 3 phần:
1. 🎒 **CHECKLIST HÀNH LÝ & GIẤY TỜ THIẾT YẾU**: Các giấy tờ bắt buộc (hộ chiếu, visa/e-visa), loại ổ cắm điện tại điểm đến, trang phục gợi ý theo mùa.
2. 🍜 **TOP 3 ĐẶC SẢN ẨM THỰC KHÔNG NÊN BỎ LỠ**: 3 món ăn nổi tiếng nhất tại điểm đáp kèm gợi ý nhanh.
3. 🏙️ **GỢI Ý 2 ĐỊA ĐIỂM GẶP GỠ / THƯ GIÃN**: Địa điểm danh lam thắng cảnh hoặc quán cafe/nhà hàng phù hợp tiếp khách.
4. 🚕 **LƯU Ý DI CHUYỂN TỪ SÂN BAY**: Cách di chuyển thuận tiện nhất từ sân bay ${trip.arrival_iata} về trung tâm thành phố.`;

  const res = await makeRequest('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://smart-travel-assistant.local',
      'X-Title': 'Smart Travel Assistant'
    }
  }, {
    model: aiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 1200
  });

  if (!res.data || !res.data.choices || res.data.choices.length === 0) {
    throw new Error(`Lỗi gọi OpenRouter AI: ${JSON.stringify(res.data || res.raw)}`);
  }

  const aiContent = res.data.choices[0].message.content;
  console.log('✅ AI đã tạo xong Cẩm nang du lịch cá nhân hóa thành công!');
  return aiContent;
}

// 4. Lấy ID tài khoản Slack của người dùng hiện tại để gửi Direct Message
async function getSlackUserId() {
  try {
    const res = await makeRequest('https://slack.com/api/users.list', {
      headers: { 'Authorization': `Bearer ${slackToken}` }
    });
    const members = res.data?.members || [];
    // Tìm user thật không phải bot
    const realUser = members.find(m => !m.is_bot && !m.deleted && m.name !== 'slackbot');
    if (realUser) {
      return realUser.id;
    }
  } catch (err) {
    console.log('⚠️ Không thể tìm user ID:', err.message);
  }
  return null;
}

// 5. Gửi Direct Message (DM) và Báo cáo vào Channel
async function sendReminderSlackDM(trip, aiGuideContent) {
  console.log(`• Đang chuẩn bị gửi thông báo nhắc lịch cho ${trip.passenger_name}...`);

  // Tìm ID user để mở DM riêng
  const userId = await getSlackUserId();
  let dmChannelId = null;

  if (userId) {
    try {
      const openDmRes = await makeRequest('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }, { users: userId });

      if (openDmRes.data?.ok) {
        dmChannelId = openDmRes.data.channel.id;
        console.log(`✅ Đã mở kênh Direct Message riêng (DM ID: ${dmChannelId}) với Sếp!`);
      }
    } catch (err) {
      console.log('⚠️ Không mở được DM riêng, sẽ gửi vào channel chính.');
    }
  }

  // Khung Block Kit sang trọng
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "✈️ THÔNG BÁO CHUYẾN BAY TRƯỚC 24H",
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Kính gửi *${trip.passenger_name}*,\nChuyến công tác của Sếp sẽ cất cánh trong vòng *24 giờ tới*. Dưới đây là thông tin chi tiết lịch trình và cẩm nang du lịch do *AI Assistant* chuẩn bị riêng cho Sếp:`
      }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Chuyến bay:*\n✈️ *${trip.flight_code}* (${trip.airline})` },
        { type: "mrkdwn", text: `*Hành trình:*\n${trip.departure_iata} ➔ *${trip.arrival_iata}* (${trip.destination_city})` },
        { type: "mrkdwn", text: `*Giờ cất cánh:*\n🕒 *${trip.departure_time}*` },
        { type: "mrkdwn", text: `*Mã đặt chỗ (PNR):*\n🎫 \`${trip.pnr}\`` },
        { type: "mrkdwn", text: `*Hạng vé:*\n${trip.ticket_class}` },
        { type: "mrkdwn", text: `*Mục đích:*\n${trip.purpose}` }
      ]
    },
    {
      type: "divider"
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🤖 *CẨM NANG ĐIỂM ĐẾN & CHECKLIST (Powered by AI)*\n\n${aiGuideContent}`
      }
    },
    {
      type: "divider"
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "✨ *Chúc Sếp có một chuyến công tác thuận lợi, gặt hái nhiều thành công!* | Smart Travel Assistant"
        }
      ]
    }
  ];

  // Gửi vào DM riêng của Sếp (nếu mở được)
  if (dmChannelId) {
    await makeRequest('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    }, {
      channel: dmChannelId,
      blocks: blocks
    });
    console.log('✅ ĐÃ GỬI THÀNH CÔNG DIRECT MESSAGE (DM RIÊNG) CHO SẾP TRÊN SLACK!');
  }

  // Đồng thời bắn 1 thông báo ngắn vào kênh Admin để Biz Admin biết bot đã tự động nhắc sếp
  await makeRequest('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${slackToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  }, {
    channel: slackChannel,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🔔 *[HỆ THỐNG TỰ ĐỘNG BẮN NHẮC LỊCH 24H]*\nBot vừa gửi thông báo cất cánh kèm cẩm nang AI du lịch *${trip.destination_city} (${trip.arrival_iata})* trực tiếp cho Sếp *${trip.passenger_name}* (Chuyến bay *${trip.flight_code}* cất cánh lúc *${trip.departure_time}*).`
        }
      }
    ]
  });
  console.log('✅ Đã cập nhật trạng thái nhắc lịch vào kênh #biz-admin-alerts!');
}

// 6. Cập nhật cờ Reminder_24h = SENT trên Google Sheet và DynamoDB
async function markReminderSent(tripId, rowIndex, accessToken) {
  console.log(`• Cập nhật trạng thái Reminder_24h = "SENT" cho ${tripId}...`);

  // Cập nhật Google Sheet (Cột U - Cột số 21)
  await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!U${rowIndex}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, { values: [["SENT"]] });

  // Cập nhật DynamoDB LocalStack
  try {
    await makeRequest(localstackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'x-amz-target': 'DynamoDB_20120810.UpdateItem',
        'Authorization': 'AWS4-HMAC-SHA256 Credential=test/20261112/us-east-1/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-target, Signature=test'
      }
    }, {
      TableName: 'TravelBookings',
      Key: { trip_id: { S: tripId } },
      UpdateExpression: 'SET reminder_sent = :sent',
      ExpressionAttributeValues: { ':sent': { S: 'SENT' } }
    });
    console.log('✅ Đã cập nhật cờ reminder_sent = SENT trên DynamoDB LocalStack!');
  } catch (err) {
    console.log('⚠️ Bỏ qua update DynamoDB:', err.message);
  }
}

// 7. Quy trình chính của Sprint 3
async function runReminderSprint() {
  try {
    const accessToken = await getGoogleAccessToken();

    // Đọc Google Sheet tìm chuyến bay có Reminder_24h = PENDING
    console.log('• Đang quét danh sách chuyến bay trên Google Sheet...');
    const sheetRes = await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A2:W50`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const rows = sheetRes.data?.values || [];
    console.log(`• Tìm thấy ${rows.length} chuyến đi trong hệ thống.`);

    // Tìm chuyến bay đầu tiên có trạng thái PENDING
    let targetTrip = null;
    let targetRowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const reminderStatus = r[20] || ''; // Cột U
      const auditStatus = r[21] || '';   // Cột V

      if (reminderStatus === 'PENDING' && auditStatus === 'VALID') {
        targetTrip = {
          trip_id: r[0],
          passenger_name: r[3],
          passenger_email: r[5],
          airline: r[7],
          flight_code: r[8],
          departure_iata: r[10],
          destination_city: r[11],
          arrival_iata: r[12],
          departure_time: r[13],
          pnr: r[15],
          ticket_class: r[16],
          purpose: r[19]
        };
        targetRowIndex = i + 2;
        break;
      }
    }

    if (!targetTrip) {
      console.log('ℹ️ Không có chuyến bay nào đang ở trạng thái PENDING & VALID để nhắc lịch.');
      return;
    }

    console.log(`\n🎯 PHÁT HIỆN CHUYẾN BAY CẦN NHẮC LỊCH 24H:`);
    console.log(`   • Trip ID: ${targetTrip.trip_id}`);
    console.log(`   • Người đi: ${targetTrip.passenger_name}`);
    console.log(`   • Lộ trình: ${targetTrip.departure_iata} ✈️ ${targetTrip.arrival_iata} (${targetTrip.destination_city})`);
    console.log(`   • Giờ bay:  ${targetTrip.departure_time}`);

    // Gọi AI OpenRouter tạo cẩm nang
    const aiGuide = await generateAiTravelGuide(targetTrip);

    // Bắn tin nhắn Slack DM cho Sếp và Báo cáo Channel
    await sendReminderSlackDM(targetTrip, aiGuide);

    // Cập nhật trạng thái SENT
    await markReminderSent(targetTrip.trip_id, targetRowIndex, accessToken);

    console.log('\n🎉 HOÀN THÀNH XUẤT SẮC SPRINT 3! Anh hãy kiểm tra tin nhắn riêng của Bot và kênh #biz-admin-alerts trên Slack nhé!');
  } catch (err) {
    console.error('\n❌ XẢY RA LỖI TẠI SPRINT 3:', err.message);
  }
}

runReminderSprint();


