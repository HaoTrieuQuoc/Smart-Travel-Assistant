const fs = require('fs');
const path = require('path');
const https = require('https');

// Đọc cấu hình từ .env (hỗ trợ gọi từ root hoặc từ thư mục scripts/)
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
// Ưu tiên dùng model Vision free của NVIDIA trên OpenRouter
const visionModel = 'nvidia/nemotron-3.5-super-vl:free';

// Helper HTTP POST
function postJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(bodyObj));
    req.end();
  });
}

/**
 * 1. Bóc tách thông tin từ ảnh vé máy bay bằng Multimodal Vision AI
 */
async function extractTicketFromBase64(base64Image, mimeType = 'image/png') {
  console.log(`• Đang gọi Multimodal Vision AI (${visionModel}) để đọc ảnh vé máy bay...`);

  const promptText = `Bạn là hệ thống AI trích xuất vé máy bay doanh nghiệp (Flight Ticket OCR Specialist).
Hãy phân tích ảnh vé máy bay / thẻ lên tàu bay (boarding pass) / e-ticket này và trích xuất chính xác các trường thông tin.
BẮT BUỘC chỉ trả về 1 chuỗi JSON thuần túy (không kèm giải thích, không markdown code fence \`\`\`json):
{
  "passenger_name": "Họ và tên hành khách (in hoa hoặc có dấu)",
  "airline": "Hãng hàng không (Vietnam Airlines, Vietjet, Bamboo, v.v.)",
  "flight_number": "Số hiệu chuyến bay (VD: VN214, VJ128)",
  "pnr": "Mã đặt chỗ vé (6 ký tự, ví dụ: XYZ123)",
  "departure_city": "Thành phố cất cánh",
  "departure_iata": "Mã IATA 3 ký tự sân bay đi (VD: SGN, HAN, DAD)",
  "arrival_city": "Thành phố hạ cánh",
  "arrival_iata": "Mã IATA 3 ký tự sân bay đến (VD: HAN, NRT, SIN)",
  "departure_time": "Ngày giờ cất cánh theo format YYYY-MM-DD HH:mm (nếu không có năm thì lấy năm 2026)",
  "arrival_time": "Ngày giờ hạ cánh theo format YYYY-MM-DD HH:mm",
  "ticket_class": "Hạng vé (Economy, Business, Eco...)",
  "ticket_price": "Giá vé nếu có hiển thị (chỉ lấy số, nếu không thấy thì để 'Chưa rõ', tuyệt đối không để 0)"
}`;

  const requestBody = {
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`
            }
          }
        ]
      }
    ],
    temperature: 0.1,
    reasoning: { effort: 'none' },
    max_tokens: 1000
  };

  const res = await postJson('https://openrouter.ai/api/v1/chat/completions', {
    'Authorization': `Bearer ${openrouterKey}`,
    'HTTP-Referer': 'https://smart-travel-assistant.local',
    'X-Title': 'Smart Travel Assistant'
  }, requestBody);

  if (!res.data || !res.data.choices || res.data.choices.length === 0) {
    throw new Error(`Lỗi Vision OCR: ${JSON.stringify(res.data || res.raw)}`);
  }

  let text = res.data.choices[0].message.content.trim();
  // Xóa markdown \`\`\`json nếu model vô tình thêm vào
  text = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(text);
    console.log('✅ Bóc tách thành công thông tin vé từ AI:');
    console.log(JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (err) {
    console.error('Lỗi parse JSON từ kết quả AI:', text);
    throw new Error('AI không trả về JSON hợp lệ: ' + text);
  }
}

/**
 * 2. Phân tích tin nhắn tự nhiên để tạo Purchase Request (PR)
 */
async function parsePurchaseRequestChat(userMessage) {
  console.log(`• Đang phân tích hội thoại tạo PR: "${userMessage}"...`);

  const promptText = `Bạn là Trợ lý Quản lý Công tác Thông minh (Travel Assistant).
Người dùng đang gửi một yêu cầu tạo Purchase Request (PR) cho chuyến đi công tác.
Hãy phân tích tin nhắn và trích xuất thông tin thành 1 JSON thuần:
{
  "is_pr_request": true/false (người dùng có phải đang muốn tạo PR hay xin đi công tác không),
  "destination": "Điểm đến (Thành phố / Quốc gia)",
  "departure_date": "Ngày đi dự kiến (nếu có, format YYYY-MM-DD)",
  "estimated_cost": "Chi phí dự trù bằng VND (chỉ lấy số, nếu không nói thì để 0)",
  "purpose": "Mục đích chuyến đi tóm tắt",
  "missing_info": "Các thông tin còn thiếu cần hỏi lại người dùng"
}`;

  const res = await postJson('https://openrouter.ai/api/v1/chat/completions', {
    'Authorization': `Bearer ${openrouterKey}`,
    'HTTP-Referer': 'https://smart-travel-assistant.local',
    'X-Title': 'Smart Travel Assistant'
  }, {
    model: env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: "system", content: "Chỉ trả về JSON thuần túy không kèm giải thích." },
      { role: "user", content: `${promptText}\n\nTin nhắn người dùng: "${userMessage}"` }
    ],
    temperature: 0.2
  });

  let text = res.data.choices[0].message.content.trim();
  text = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(text);
}

/**
 * Cập nhật thông tin vé đang trong quá trình xác nhận (Pre-save Draft)
 */
async function applyConversationalCorrection(currentData, userCorrection) {
  const prompt = `Bạn là trợ lý cập nhật dữ liệu vé máy bay doanh nghiệp.
Dữ liệu vé máy bay hiện tại (JSON):
${JSON.stringify(currentData, null, 2)}

Yêu cầu chỉnh sửa của người dùng: "${userCorrection}"

Hãy cập nhật các trường thông tin mà người dùng muốn sửa (ví dụ: họ tên, số hiệu chuyến bay, hãng bay, giờ bay, mã IATA sân bay, mã PNR, giá vé, v.v.). Giữ nguyên các trường còn lại.
Chỉ trả về DUY NHẤT một chuỗi JSON hợp lệ với đầy đủ các trường:
{
  "passenger_name": "...",
  "airline": "...",
  "flight_number": "...",
  "departure_city": "...",
  "departure_iata": "...",
  "arrival_city": "...",
  "arrival_iata": "...",
  "departure_time": "...",
  "arrival_time": "...",
  "pnr": "...",
  "ticket_class": "...",
  "ticket_price": "..."
}`;

  const res = await postJson('https://openrouter.ai/api/v1/chat/completions', {
    'Authorization': `Bearer ${openrouterKey}`,
    'HTTP-Referer': 'https://smart-travel-assistant.local',
    'X-Title': 'Smart Travel Assistant'
  }, {
    model: env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: "system", content: "Chỉ trả về JSON thuần túy không kèm giải thích." },
      { role: "user", content: prompt }
    ],
    temperature: 0.1
  });

  let text = res.data.choices[0].message.content.trim();
  text = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(text);
}

/**
 * Phân tích yêu cầu chỉnh sửa chuyến bay ĐÃ LƯU trong Google Sheet & DynamoDB
 */
async function parseEditSavedTripRequest(userText, existingTrip) {
  const prompt = `Bạn là trợ lý chỉnh sửa lịch trình công tác đã lưu trên hệ thống.
Thông tin chuyến công tác hiện tại:
${JSON.stringify(existingTrip, null, 2)}

Yêu cầu sửa của người dùng: "${userText}"

Hãy phân tích và trả về các trường cần sửa đổi thành JSON thuần (không kèm markdown):
{
  "is_edit_request": true/false,
  "updated_fields": {
    "passenger_name": "giá trị mới nếu có đổi",
    "airline": "giá trị mới nếu có đổi",
    "flight_number": "giá trị mới nếu có đổi",
    "departure_iata": "giá trị mới nếu có đổi",
    "arrival_iata": "giá trị mới nếu có đổi",
    "departure_time": "giá trị mới nếu có đổi",
    "arrival_time": "giá trị mới nếu có đổi",
    "pnr": "giá trị mới nếu có đổi",
    "ticket_class": "giá trị mới nếu có đổi",
    "ticket_price": "giá trị mới nếu có đổi"
  },
  "explanation": "Tóm tắt ngắn gọn các thông tin đã sửa (tiếng Việt)"
}`;

  const res = await postJson('https://openrouter.ai/api/v1/chat/completions', {
    'Authorization': `Bearer ${openrouterKey}`,
    'HTTP-Referer': 'https://smart-travel-assistant.local',
    'X-Title': 'Smart Travel Assistant'
  }, {
    model: env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: "system", content: "Always return strict valid JSON only without markdown explanation." },
      { role: "user", content: prompt }
    ],
    temperature: 0.1
  });

  let text = res.data.choices[0].message.content.trim();
  text = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(text);
}

module.exports = {
  extractTicketFromBase64,
  parsePurchaseRequestChat,
  applyConversationalCorrection,
  parseEditSavedTripRequest
};
