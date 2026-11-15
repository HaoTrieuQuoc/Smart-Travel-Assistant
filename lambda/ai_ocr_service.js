/**
 * AI OCR & PR Service for AWS Lambda & Node.js
 */
const https = require('https');

function callOpenRouter(payload) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured in environment');
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/smart-travel-assistant',
        'X-Title': 'Smart Travel Assistant',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            return reject(new Error(`OpenRouter Error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
          }
          const content = parsed.choices?.[0]?.message?.content;
          if (!content) {
            return reject(new Error(`No content returned: ${body.substring(0, 200)}`));
          }
          resolve(content);
        } catch (err) {
          reject(new Error(`Parse JSON error: ${err.message} - Body: ${body.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function cleanJsonResponse(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

async function extractTicketFromBase64(base64Image, mimeType = 'image/jpeg') {
  const prompt = `Bạn là chuyên gia bóc tách dữ liệu vé máy bay (Air Ticket OCR Expert).
Hãy trích xuất thông tin từ ảnh vé máy bay/boarding pass này và trả về DUY NHẤT một JSON hợp lệ (không kèm markdown ngoài json):
{
  "passenger_name": "Tên đầy đủ hành khách in hoa không dấu",
  "airline": "Tên hãng bay (Vietnam Airlines, Vietjet Air, Bamboo, v.v.)",
  "flight_number": "Mã chuyến bay (ví dụ: VN214, VJ123)",
  "departure_city": "Tên thành phố đi",
  "departure_iata": "Mã sân bay đi 3 ký tự (ví dụ: SGN, HAN, DAD)",
  "arrival_city": "Tên thành phố đến",
  "arrival_iata": "Mã sân bay đến 3 ký tự (ví dụ: HAN, NRT, HND)",
  "departure_time": "YYYY-MM-DD HH:mm (nếu không có năm thì lấy năm 2026)",
  "arrival_time": "YYYY-MM-DD HH:mm",
  "pnr": "Mã đặt chỗ 6 ký tự",
  "ticket_class": "Hạng vé (Economy/Business)",
  "ticket_price": "Giá vé số nguyên (nếu có, nếu không thì 0)"
}`;

  const payload = {
    model: 'nvidia/nemotron-3.5-super-vl:free',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
          }
        ]
      }
    ],
    reasoning: { effort: 'none' },
    temperature: 0.1,
    max_tokens: 1000
  };

  const raw = await callOpenRouter(payload);
  return cleanJsonResponse(raw);
}

async function parsePurchaseRequestChat(userMessage) {
  const prompt = `Bạn là trợ lý ảo doanh nghiệp phụ trách tiếp nhận yêu cầu công tác (Purchase Request - PR) qua chat.
Người dùng vừa gửi tin nhắn: "${userMessage}"

Hãy phân tích và trả về DUY NHẤT một JSON hợp lệ (không kèm markdown giải thích):
{
  "is_pr_request": true/false (đúng nếu người dùng muốn xin đi công tác/đặt vé/tạo PR),
  "destination": "Thành phố hoặc địa điểm đến",
  "departure_date": "YYYY-MM-DD (dự đoán hoặc trích xuất, mặc định 2026 nếu thiếu năm)",
  "return_date": "YYYY-MM-DD hoặc null",
  "purpose": "Mục đích công tác ngắn gọn",
  "estimated_cost": Số nguyên chi phí dự trù VND (hoặc 0 nếu không nhắc đến)
}`;

  const payload = {
    model: process.env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: 'system', content: 'You are an enterprise flight PR assistant. Always respond with strict valid JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  };

  const raw = await callOpenRouter(payload);
  return cleanJsonResponse(raw);
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

  const payload = {
    model: process.env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: 'system', content: 'You are an air ticket data editor. Always return strict JSON only without explanation.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  };

  const raw = await callOpenRouter(payload);
  return cleanJsonResponse(raw);
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

  const payload = {
    model: process.env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: 'system', content: 'Always return strict valid JSON only without markdown explanation.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  };

  const raw = await callOpenRouter(payload);
  return cleanJsonResponse(raw);
}

module.exports = {
  extractTicketFromBase64,
  parsePurchaseRequestChat,
  applyConversationalCorrection,
  parseEditSavedTripRequest,
  callOpenRouter
};

