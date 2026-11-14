const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// 1. Đọc cấu hình từ file .env (hỗ trợ gọi từ root hoặc scripts/)
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
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        config[key] = val;
      }
    }
  });
  return config;
}

const env = loadEnv();
const spreadsheetId = env.GOOGLE_SHEET_ID;
const tabName = env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác';
const slackToken = env.SLACK_BOT_TOKEN;
const slackChannel = env.SLACK_ADMIN_CHANNEL_ID;
const serviceAccountPath = fs.existsSync(path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE))
  ? path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE)
  : path.resolve(__dirname, '..', env.GOOGLE_SERVICE_ACCOUNT_FILE);

console.log('--- KHỞI TẠO HỆ THỐNG SMART TRAVEL ASSISTANT ---');
console.log(`• Google Sheet ID: ${spreadsheetId}`);
console.log(`• Tab Name: ${tabName}`);
console.log(`• Slack Channel: ${slackChannel}`);

// Helper: HTTP Request dùng Promise
function httpRequest(urlStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
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

// Base64URL helper
function base64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// 2. Lấy Access Token từ Google Service Account bằng RSA-SHA256
async function getGoogleAccessToken() {
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Không tìm thấy file credentials tại: ${serviceAccountPath}`);
  }

  const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const headerB64 = base64Url(JSON.stringify(header));
  const claimB64 = base64Url(JSON.stringify(claim));
  const signInput = `${headerB64}.${claimB64}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(sa.private_key);
  const sigB64 = base64Url(signature);

  const jwt = `${signInput}.${sigB64}`;

  const postBody = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
  const res = await httpRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, postBody);

  if (!res.data || !res.data.access_token) {
    throw new Error(`Lỗi xác thực Google: ${JSON.stringify(res.data || res.raw)}`);
  }

  console.log('✅ Xác thực Google Service Account thành công!');
  return res.data.access_token;
}

// 3. Chuẩn bị 23 cột Header và 6 dòng dữ liệu mẫu
const headers = [
  "Trip_ID",
  "PR_Number",
  "Approval_Status",
  "Passenger_Name",
  "Title_Department",
  "Passenger_Email",
  "Slack_Username",
  "Airline",
  "Flight_Code",
  "Departure_City",
  "Departure_IATA",
  "Arrival_City",
  "Arrival_IATA",
  "Departure_Time",
  "Arrival_Time",
  "PNR",
  "Ticket_Class",
  "Cost_VND",
  "Payment_Method",
  "Purpose",
  "Reminder_24h",
  "Audit_Status",
  "Audit_Notes"
];

const rows = [
  [
    "TRIP-202611-001",
    "PR-2026-088",
    "APPROVED",
    "Trần Quốc Bảo",
    "Managing Director (CEO)",
    "bao.tran@company.com",
    "@bao.tran",
    "Vietnam Airlines",
    "VN300",
    "Hồ Chí Minh",
    "SGN",
    "Tokyo (Narita)",
    "NRT",
    "2026-11-13 00:15",
    "2026-11-13 07:45",
    "VNA892K",
    "Business",
    "28500000",
    "Corporate Card",
    "Gặp đối tác chiến lược SoftBank & ký kết MOU",
    "PENDING",
    "VALID",
    "Dữ liệu hợp lệ. Sẵn sàng gửi thông báo 24h kèm cẩm nang Tokyo."
  ],
  [
    "TRIP-202611-002",
    "PR-2026-085",
    "APPROVED",
    "Nguyễn Tuấn Hào",
    "Chief Technology Officer (CTO)",
    "hao.nguyen@company.com",
    "@hao.nguyen",
    "Vietnam Airlines",
    "VN214",
    "Hồ Chí Minh",
    "SGN",
    "Hà Nội",
    "HAN",
    "2026-11-15 08:30",
    "2026-11-15 10:45",
    "XYZ789A",
    "Economy Flex",
    "4850000",
    "Corporate Card",
    "Tham dự AWS Community Day Vietnam 2026",
    "NOT_DUE",
    "VALID",
    "Đã đối soát với hóa đơn đỏ điện tử."
  ],
  [
    "TRIP-202611-003",
    "PR-2026-089",
    "APPROVED",
    "Lê Thị Thu Thảo",
    "Head of People & Culture",
    "thao.le@company.com",
    "@thao.le",
    "Vietjet Air",
    "VJ628",
    "Hồ Chí Minh",
    "SGN",
    "Đà Nẵng",
    "DAD",
    "2026-11-18 14:00",
    "2026-11-18 15:20",
    "VJ99182",
    "Eco",
    "2450000",
    "Reimbursement",
    "Tổ chức Townhall quý 4 cho chi nhánh Miền Trung",
    "NOT_DUE",
    "VALID",
    "Dữ liệu trích xuất tự động qua Slack Bedrock OCR."
  ],
  [
    "TRIP-202611-004",
    "PR-2026-090",
    "APPROVED",
    "Phạm Hoàng Nam",
    "Head of Sales",
    "nam.pham@company.com",
    "@nam.pham",
    "Bamboo Airways",
    "QH202",
    "Hồ Chí Minh",
    "SGN",
    "Hà Nội",
    "HAN",
    "20/11/2026 8h30", // LỖI SAI FORMAT!
    "20/11/2026 10h45",
    "QH77189",
    "Economy",
    "3900000",
    "Corporate Card",
    "Thương thảo hợp đồng khách hàng Viettel",
    "NOT_DUE",
    "INVALID_DATETIME",
    "[CẢNH BÁO BOT] Sai format ngày khởi hành. Cần nhập chuẩn: YYYY-MM-DD HH:mm."
  ],
  [
    "TRIP-202611-005",
    "PR-2026-091",
    "PENDING",
    "Đỗ Minh Khang",
    "Product Lead",
    "khang.do@company.com",
    "@khang.do",
    "Singapore Airlines",
    "SQ178",
    "Hồ Chí Minh",
    "SGN",
    "Singapore",
    "SINGAPORE", // LỖI SAI MÃ IATA
    "2026-11-25 12:15",
    "2026-11-25 15:25",
    "", // LỖI THIẾU PNR
    "Economy",
    "6200000",
    "Admin ứng trước",
    "Khảo sát thị trường Fintech Singapore Festival",
    "NOT_DUE",
    "MISSING_FIELD",
    "[CẢNH BÁO BOT] Thiếu mã vé PNR; Mã IATA 'SINGAPORE' không đúng chuẩn 3 ký tự (cần là SIN)."
  ],
  [
    "TRIP-202611-006",
    "", // THIẾU PR
    "REJECTED",
    "Vũ Hải Đăng",
    "Senior DevOps Engineer",
    "", // THIẾU EMAIL
    "@dang.vu",
    "Vietjet Air",
    "VJ150",
    "Hồ Chí Minh",
    "SGN",
    "Hà Nội",
    "HAN",
    "2026-11-28 06:00",
    "2026-11-28 08:10",
    "VJ33810",
    "Eco",
    "1850000",
    "Chưa thanh toán",
    "Khắc phục sự cố On-premise Data Center đối tác",
    "NOT_DUE",
    "INVALID_FORMAT",
    "[CẢNH BÁO BOT] Thiếu Email nhân sự (không thể gửi email thông báo 24h); Chưa có mã PR."
  ]
];

// 4. Khởi tạo Google Sheet
async function initGoogleSheet(accessToken) {
  // Lấy thông tin sheet hiện tại
  const metaRes = await httpRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (metaRes.status !== 200) {
    throw new Error(`Lỗi mở Google Sheet (Hãy chắc chắn đã Share quyền Editor cho email Service Account): ${JSON.stringify(metaRes.data || metaRes.raw)}`);
  }

  const sheets = metaRes.data.sheets || [];
  const firstSheetTitle = sheets[0]?.properties?.title || 'Sheet1';
  console.log(`• Tab hiện tại trong file: "${firstSheetTitle}"`);

  // Nếu tab đầu tiên chưa đổi tên thành tabName, ta đổi tên cho đẹp
  if (firstSheetTitle !== tabName) {
    console.log(`• Đang đổi tên tab thành "${tabName}"...`);
    const renameBody = {
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: sheets[0].properties.sheetId,
            title: tabName
          },
          fields: 'title'
        }
      }]
    };
    await httpRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }, renameBody);
  }

  // Đẩy toàn bộ headers và dữ liệu vào
  const allValues = [headers, ...rows];
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1:W${allValues.length}?valueInputOption=USER_ENTERED`;

  console.log(`• Đang ghi ${allValues.length} dòng (1 header + ${rows.length} rows) vào Google Sheet...`);
  const writeRes = await httpRequest(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }, { values: allValues });

  if (writeRes.status !== 200) {
    throw new Error(`Lỗi ghi dữ liệu vào Sheet: ${JSON.stringify(writeRes.data || writeRes.raw)}`);
  }

  console.log('✅ ĐÃ KHỞI TẠO XONG DỮ LIỆU GOOGLE SHEET!');
}

// 5. Gửi thông báo chào mừng & Báo cáo kết quả lên Slack
async function sendSlackNotification() {
  console.log(`• Đang gửi tin nhắn báo cáo lên Slack Channel ${slackChannel}...`);

  const messagePayload = {
    channel: slackChannel,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚀 Smart Travel Bot: Khởi Tạo Thành Công!",
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Chào anh *Nguyễn Tuấn Hào*! Bot *Travel Assistant* đã kết nối thành công với Google Sheet và Slack Workspace *Smart_Travel_Assistant*.\n\n📊 *Trạng thái đồng bộ ban đầu:*`
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: "*Google Sheet:*\n✅ Đã nạp 23 cột chuẩn"
          },
          {
            type: "mrkdwn",
            text: "*Tổng số chuyến đi:*\n`6 chuyến` công tác"
          },
          {
            type: "mrkdwn",
            text: "*Chuyến đi hợp lệ:*\n`3 chuyến` (Tokyo, Hà Nội, Đà Nẵng)"
          },
          {
            type: "mrkdwn",
            text: "*Lỗi kiểm toán phát hiện:*\n⚠️ `3 chuyến` vi phạm format"
          }
        ]
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🔍 *Chi tiết các dòng vi phạm kiểm toán (Audit Alert):*\n• *Dòng 5 (TRIP-202611-004):* Sai định dạng ngày khởi hành (`20/11/2026 8h30` ➔ Cần `YYYY-MM-DD HH:mm`).\n• *Dòng 6 (TRIP-202611-005):* Thiếu mã PNR & Mã sân bay `SINGAPORE` sai chuẩn IATA (cần `SIN`).\n• *Dòng 7 (TRIP-202611-006):* Thiếu Email nhân sự & chưa có mã Purchase Request (PR)."
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "🤖 *Smart Travel Assistant* | Powered by AWS Serverless & OpenRouter AI"
          }
        ]
      }
    ]
  };

  const res = await httpRequest('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${slackToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  }, messagePayload);

  if (!res.data || !res.data.ok) {
    throw new Error(`Lỗi gửi tin nhắn Slack: ${JSON.stringify(res.data || res.raw)}`);
  }

  console.log('✅ ĐÃ GỬI BÁO CÁO THÀNH CÔNG VÀO SLACK CHANNEL #biz-admin-alerts!');
}

// 6. Thực thi quy trình
async function run() {
  try {
    const accessToken = await getGoogleAccessToken();
    await initGoogleSheet(accessToken);
    await sendSlackNotification();
    console.log('\n🎉 HOÀN TẤT KIỂM TRA SPRINT 1! Anh hãy mở Google Sheet và Slack để kiểm tra kết quả nhé!');
  } catch (err) {
    console.error('\n❌ XẢY RA LỖI:', err.message);
    process.exit(1);
  }
}

run();


