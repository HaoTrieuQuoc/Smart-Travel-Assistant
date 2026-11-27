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

function isMeaningfulField(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim().toLowerCase();
  return s !== '' && !['n/a', 'na', 'none', 'null', 'undefined', 'chưa rõ', 'unknown', 'không rõ', '-', '--', '---', '...'].includes(s);
}

/**
 * Kiểm tra xem kết quả OCR từ Vision AI có thực sự là vé máy bay hợp lệ hay không
 */
function validateFlightTicketExtraction(rawTicket) {
  if (!rawTicket || typeof rawTicket !== 'object') {
    return { valid: false, reason: 'Không trích xuất được dữ liệu hợp lệ từ ảnh.' };
  }

  if (rawTicket.is_flight_ticket === false || String(rawTicket.is_flight_ticket).trim().toLowerCase() === 'false') {
    const customReason = isMeaningfulField(rawTicket.rejection_reason)
      ? String(rawTicket.rejection_reason).trim()
      : 'Ảnh tải lên không phải là vé máy bay hoặc thẻ lên tàu bay (boarding pass).';
    return { valid: false, reason: customReason };
  }

  const hasFlightNumber = isMeaningfulField(rawTicket.flight_number);
  const hasAirline = isMeaningfulField(rawTicket.airline);
  const hasRoute =
    isMeaningfulField(rawTicket.departure_iata) ||
    isMeaningfulField(rawTicket.arrival_iata) ||
    isMeaningfulField(rawTicket.departure_city) ||
    isMeaningfulField(rawTicket.arrival_city);
  const hasPnr = isMeaningfulField(rawTicket.pnr);
  const hasPassenger = isMeaningfulField(rawTicket.passenger_name);
  const hasDepTime = isMeaningfulField(rawTicket.departure_time);

  const signalCount = [hasFlightNumber, hasAirline, hasRoute, hasPnr, hasPassenger, hasDepTime].filter(Boolean).length;
  const hasAviationSignal = hasFlightNumber || hasAirline || hasRoute || hasPnr;

  if (signalCount < 2 || !hasAviationSignal) {
    const fallbackReason = isMeaningfulField(rawTicket.rejection_reason)
      ? String(rawTicket.rejection_reason).trim()
      : 'Ảnh không chứa đầy đủ thông tin nhận diện vé máy bay (hãng bay, số hiệu chuyến bay, hành trình hoặc mã đặt chỗ).';
    return { valid: false, reason: fallbackReason };
  }

  return { valid: true, reason: '' };
}

async function extractTicketFromBase64(base64Image, mimeType = 'image/jpeg') {
  const prompt = `Bạn là chuyên gia kiểm duyệt và bóc tách dữ liệu vé máy bay (Air Ticket OCR & Classification Expert).
Bước 1: Kiểm tra xem ảnh có phải là vé máy bay, e-ticket, xác nhận đặt vé máy bay, hoặc thẻ lên tàu bay (boarding pass) hay không.
- Nếu KHÔNG phải vé máy bay (ví dụ: ảnh cá nhân, phong cảnh, hóa đơn ăn uống/mua sắm, vé xe/vé tàu, ảnh chụp màn hình chat không có thông tin chuyến bay, ảnh mờ không đọc được), đặt "is_flight_ticket": false, ghi ngắn gọn lý do bằng tiếng Việt vào "rejection_reason" (không dùng emoji), và để trống "" các trường còn lại (tuyệt đối không tự bịa dữ liệu).
- Nếu ĐÚNG là vé máy bay/boarding pass, đặt "is_flight_ticket": true, "rejection_reason": "", và trích xuất chính xác các trường bên dưới.

Trả về DUY NHẤT một JSON hợp lệ (không kèm markdown ngoài json):
{
  "is_flight_ticket": true,
  "rejection_reason": "",
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
  "ticket_price": "Giá vé số nguyên nếu có hiển thị rõ (ví dụ: 1800000). Nếu trên vé/boarding pass không có giá vé thì để 'Chưa rõ', tuyệt đối không điền số 0"
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
  const parsed = cleanJsonResponse(raw);
  if (typeof parsed.is_flight_ticket === 'string') {
    parsed.is_flight_ticket = parsed.is_flight_ticket.trim().toLowerCase() === 'true';
  }
  if (!parsed.ticket_price || parsed.ticket_price === '0' || parsed.ticket_price === 0 || String(parsed.ticket_price).toLowerCase() === 'null') {
    parsed.ticket_price = 'Chưa rõ';
  }
  return parsed;
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
  const parsed = cleanJsonResponse(raw);
  if (!parsed.ticket_price || parsed.ticket_price === '0' || parsed.ticket_price === 0 || String(parsed.ticket_price).toLowerCase() === 'null') {
    parsed.ticket_price = 'Chưa rõ';
  }
  return parsed;
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
  const parsed = cleanJsonResponse(raw);
  if (parsed.updated_fields && (parsed.updated_fields.ticket_price === '0' || parsed.updated_fields.ticket_price === 0)) {
    parsed.updated_fields.ticket_price = 'Chưa rõ';
  }
  return parsed;
}

/**
 * AI Query Planner: Chuyển câu hỏi quản trị tự nhiên thành kế hoạch truy vấn JSON an toàn (Read-Only)
 */
async function planBIQuery(userQuestion) {
  const prompt = `Bạn là chuyên gia phân tích dữ liệu công tác doanh nghiệp (Travel BI Query Planner).
Câu hỏi của quản trị viên HR: "${userQuestion}"

Hãy phân tích câu hỏi và trả về DUY NHẤT một JSON hợp lệ (không kèm markdown giải thích):
{
  "is_bi_query": true/false (đúng nếu là câu hỏi thống kê, báo cáo, tổng chi phí, liệt kê chuyến bay, tìm nhân sự bay, đối soát vé thiếu giá),
  "query_type": "COST_SUMMARY" | "GROUP_BY_DEPARTMENT" | "GROUP_BY_AIRLINE" | "GROUP_BY_DESTINATION" | "MISSING_PRICE_AUDIT" | "UPCOMING_FLIGHTS" | "LIST_TRIPS" | "GENERAL_STATS",
  "group_by": "department" | "airline" | "arrival_city" | "month" | null,
  "filters": {
    "month": "YYYY-MM nếu hỏi theo tháng cụ thể (mặc định năm 2026 nếu thiếu năm), hoặc null",
    "department": "Tên phòng ban nếu có, hoặc null",
    "destination": "Tên thành phố hoặc mã IATA điểm đến nếu có, hoặc null",
    "airline": "Tên hãng hàng không nếu có, hoặc null",
    "passenger_name": "Tên hành khách hoặc username nếu có, hoặc null",
    "ticket_class": "Economy hoặc Business nếu có, hoặc null",
    "missing_price_only": true/false (true nếu hỏi về vé thiếu giá / chưa rõ giá),
    "upcoming_days": số ngày tới (ví dụ 7, 14, 30) nếu hỏi chuyến sắp bay, hoặc null
  },
  "limit": 10
}`;

  const payload = {
    model: process.env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: 'system', content: 'You are an enterprise BI query planner. Always return strict valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  };

  const raw = await callOpenRouter(payload);
  return cleanJsonResponse(raw);
}

/**
 * AI Executive Synthesizer: Viết nhận định quản trị ngắn gọn dựa trên số liệu đã được code tính toán chính xác
 */
async function synthesizeBIInsights(userQuestion, stats) {
  const prompt = `Bạn là chuyên gia phân tích tài chính & vận hành công tác (Corporate Travel FinOps Analyst).
Câu hỏi của quản trị viên: "${userQuestion}"

Số liệu thống kê chính xác từ hệ thống DynamoDB:
${JSON.stringify({
    matched_count: stats.matched_count,
    total_records_in_db: stats.total_records_in_db,
    total_cost_vnd: stats.total_cost_vnd,
    avg_cost_vnd: stats.avg_cost_vnd,
    missing_price_trips: stats.missing_price_trips,
    breakdown: stats.breakdown.slice(0, 5),
    anomalies: stats.anomalies
  }, null, 2)}

Hãy viết 2 đến 3 gạch đầu dòng nhận định ngắn gọn, khách quan bằng tiếng Việt dành cho HR/Ban Giám đốc.
Quy tắc bắt buộc:
- Chỉ sử dụng chính xác các con số trong dữ liệu trên, tuyệt đối không tự bịa số liệu.
- Không sử dụng bất kỳ emoji nào (không dùng biểu tượng cảm xúc).
- Ngắn gọn dưới 80 từ.`;

  const payload = {
    model: process.env.AI_MODEL || '@preset/free-model-stack',
    messages: [
      { role: 'system', content: 'You are a concise Vietnamese enterprise FinOps analyst. Never use emojis. Never invent numbers.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 300
  };

  const raw = await callOpenRouter(payload);
  return String(raw || '').trim();
}

module.exports = {
  extractTicketFromBase64,
  validateFlightTicketExtraction,
  parsePurchaseRequestChat,
  applyConversationalCorrection,
  parseEditSavedTripRequest,
  planBIQuery,
  synthesizeBIInsights,
  callOpenRouter
};

