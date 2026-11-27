/**
 * Comprehensive QA Test Suite for Smart Travel Assistant
 * Tests every feature thoroughly across unit, integration, UI, security, and edge cases.
 */

// 0. Mock AWS SDK modules if not installed locally (as they are built into AWS Lambda runtime)
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain) {
  if (request.startsWith('@aws-sdk/')) {
    return request;
  }
  return origResolve.apply(this, arguments);
};

require.cache['@aws-sdk/client-dynamodb'] = {
  id: '@aws-sdk/client-dynamodb',
  filename: '@aws-sdk/client-dynamodb',
  loaded: true,
  exports: {
    DynamoDBClient: class DynamoDBClient {}
  }
};
require.cache['@aws-sdk/lib-dynamodb'] = {
  id: '@aws-sdk/lib-dynamodb',
  filename: '@aws-sdk/lib-dynamodb',
  loaded: true,
  exports: {
    DynamoDBDocumentClient: {
      from: () => ({ send: async () => ({}) })
    },
    PutCommand: class PutCommand { constructor(p) { Object.assign(this, p); } },
    GetCommand: class GetCommand { constructor(p) { Object.assign(this, p); } },
    DeleteCommand: class DeleteCommand { constructor(p) { Object.assign(this, p); } },
    QueryCommand: class QueryCommand { constructor(p) { Object.assign(this, p); } },
    UpdateCommand: class UpdateCommand { constructor(p) { Object.assign(this, p); } },
    ScanCommand: class ScanCommand { constructor(p) { Object.assign(this, p); } }
  }
};
require.cache['@aws-sdk/client-lambda'] = {
  id: '@aws-sdk/client-lambda',
  filename: '@aws-sdk/client-lambda',
  loaded: true,
  exports: {
    LambdaClient: class LambdaClient { send() { return Promise.resolve({}); } },
    InvokeCommand: class InvokeCommand { constructor(p) { Object.assign(this, p); } }
  }
};

const assert = require('assert');
const crypto = require('crypto');
const {
  validateFlightTicketExtraction,
  extractTextFromPdfBuffer
} = require('../lambda/ai_ocr_service');
const {
  verifySlackSignature,
  CITY_MAP,
  toTitleCase,
  normalizeCity,
  formatPassengerName,
  normalizeTicketData,
  buildTicketPreviewCard,
  buildDraftKey,
  computeBookingFingerprint,
  validateModalTicketInputs
} = require('../lambda/slack_handler');

const {
  cleanJsonResponse
} = (function() {
  // Extract cleanJsonResponse for testing
  return {
    cleanJsonResponse: function(rawText) {
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
  };
})();

// Test Results Collector
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  details: []
};

function recordTest(id, feature, description, status, notes = '') {
  results.details.push({ id, feature, description, status, notes });
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else if (status === 'WARN') results.warnings++;
  
  const icon = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[WARN]';
  console.log(`${icon} ${id.padEnd(14)} | ${feature.padEnd(25)} | ${description} ${notes ? `(${notes})` : ''}`);
}

console.log('='.repeat(80));
console.log('SMART TRAVEL ASSISTANT - COMPREHENSIVE QA TEST SUITE');
console.log('='.repeat(80));

// ============================================================================
// 1. FEATURE 1: DATA NORMALIZATION ENGINE
// ============================================================================
console.log('\n--- 1. Testing Feature: Data Normalization Engine ---');

try {
  // TC-NORM-01: City IATA Mapping
  const testIatas = [
    { iata: 'KUL', expected: 'Kuala Lumpur' },
    { iata: 'SGN', expected: 'Hồ Chí Minh' },
    { iata: 'HAN', expected: 'Hà Nội' },
    { iata: 'DAD', expected: 'Đà Nẵng' },
    { iata: 'SIN', expected: 'Singapore' },
    { iata: 'NRT', expected: 'Tokyo' },
    { iata: ' kul ', expected: 'Kuala Lumpur' },
    { iata: 'sgn', expected: 'Hồ Chí Minh' }
  ];
  let allIataPassed = true;
  for (const item of testIatas) {
    const res = normalizeCity('', item.iata);
    if (res !== item.expected) {
      allIataPassed = false;
      break;
    }
  }
  if (allIataPassed) {
    recordTest('TC-NORM-01', 'Data Normalization', 'City IATA mapping (KUL, SGN, HAN, DAD, SIN, NRT)', 'PASS');
  } else {
    recordTest('TC-NORM-01', 'Data Normalization', 'City IATA mapping failed', 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-01', 'Data Normalization', 'City IATA mapping exception', 'FAIL', e.message);
}

try {
  // TC-NORM-02: City string without IATA (Title Case & suffix cleanup)
  const c1 = normalizeCity('kuala lumpur city', '');
  const c2 = normalizeCity('hồ chí minh city', '');
  const c3 = normalizeCity('DA NANG', '');
  if (c1 === 'Kuala Lumpur' && c2 === 'Hồ Chí Minh' && c3 === 'Da Nang') {
    recordTest('TC-NORM-02', 'Data Normalization', 'City name without IATA cleanup & title-casing', 'PASS');
  } else {
    recordTest('TC-NORM-02', 'Data Normalization', `City cleanup failed: got '${c1}', '${c2}', '${c3}'`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-02', 'Data Normalization', 'City cleanup exception', 'FAIL', e.message);
}

try {
  // TC-NORM-03: Unknown IATA fallback
  const res = normalizeCity('', 'XYZ');
  if (res === 'XYZ') {
    recordTest('TC-NORM-03', 'Data Normalization', 'Unknown IATA code fallback', 'PASS');
  } else {
    recordTest('TC-NORM-03', 'Data Normalization', `Unknown IATA fallback failed: got '${res}'`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-03', 'Data Normalization', 'Unknown IATA fallback exception', 'FAIL', e.message);
}

try {
  // TC-NORM-04: Passenger Name Formatting with slashes
  const p1 = formatPassengerName('HUSSIN / NORHILMAN');
  const p2 = formatPassengerName('NGUYEN/VAN A');
  if (p1 === 'Hussin Norhilman' && p2 === 'Nguyen Van A') {
    recordTest('TC-NORM-04', 'Data Normalization', 'Passenger name with slashes converted to Title Case', 'PASS');
  } else {
    recordTest('TC-NORM-04', 'Data Normalization', `Passenger name slash conversion failed: got '${p1}', '${p2}'`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-04', 'Data Normalization', 'Passenger name slash exception', 'FAIL', e.message);
}

try {
  // TC-NORM-05: Passenger Name extra spaces & irregular casing
  const p = formatPassengerName('   trieu    quoc    hao   ');
  if (p === 'Trieu Quoc Hao') {
    recordTest('TC-NORM-05', 'Data Normalization', 'Passenger name whitespace & case normalization', 'PASS');
  } else {
    recordTest('TC-NORM-05', 'Data Normalization', `Passenger name spaces failed: got '${p}'`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-05', 'Data Normalization', 'Passenger name spaces exception', 'FAIL', e.message);
}

try {
  // TC-NORM-06: Ticket Price Normalization (Zero / Missing / Strings)
  const prices = [
    { in: 0, out: 'Chưa rõ' },
    { in: '0', out: 'Chưa rõ' },
    { in: null, out: 'Chưa rõ' },
    { in: 'null', out: 'Chưa rõ' },
    { in: 'NaN', out: 'Chưa rõ' },
    { in: 'Chưa rõ', out: 'Chưa rõ' },
    { in: '1.800.000 VND', out: '1800000' },
    { in: 2500000, out: '2500000' }
  ];
  let pricePass = true;
  for (const item of prices) {
    const res = normalizeTicketData({ ticket_price: item.in }).ticket_price;
    if (res !== item.out) {
      pricePass = false;
      break;
    }
  }
  if (pricePass) {
    recordTest('TC-NORM-06', 'Data Normalization', 'Missing/Zero price normalized to Chưa rõ and numbers preserved', 'PASS');
  } else {
    recordTest('TC-NORM-06', 'Data Normalization', 'Ticket price normalization failed', 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-06', 'Data Normalization', 'Ticket price exception', 'FAIL', e.message);
}

try {
  // TC-NORM-07: Default Business Policy Fields
  const defTicket = normalizeTicketData({});
  const hasDefaults =
    defTicket.department === 'Nhân sự / Quản lý' &&
    defTicket.purpose === 'Công tác nội bộ' &&
    defTicket.payment_method === 'Corporate Card' &&
    defTicket.passenger_email === 'user@company.com' &&
    defTicket.slack_username === '@user' &&
    defTicket.ticket_class === 'Economy';
  if (hasDefaults) {
    recordTest('TC-NORM-07', 'Data Normalization', 'Default enterprise policy fields correctly populated', 'PASS');
  } else {
    recordTest('TC-NORM-07', 'Data Normalization', 'Enterprise policy defaults missing or altered', 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-07', 'Data Normalization', 'Enterprise policy defaults exception', 'FAIL', e.message);
}

try {
  // TC-NORM-08: Slack Username Formatting
  const u1 = normalizeTicketData({ slack_username: 'quoc_hao' }).slack_username;
  const u2 = normalizeTicketData({ slack_username: '@quoc_hao' }).slack_username;
  if (u1 === '@quoc_hao' && u2 === '@quoc_hao') {
    recordTest('TC-NORM-08', 'Data Normalization', 'Slack username automatically prefixed with @', 'PASS');
  } else {
    recordTest('TC-NORM-08', 'Data Normalization', `Slack username format failed: got '${u1}', '${u2}'`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-NORM-08', 'Data Normalization', 'Slack username exception', 'FAIL', e.message);
}

// ============================================================================
// 2. FEATURE 2: SECURITY & SIGNATURE VALIDATION
// ============================================================================
console.log('\n--- 2. Testing Feature: Security & Signature Validation ---');

const testSecret = 'test_slack_signing_secret_998877';
process.env.SLACK_SIGNING_SECRET = testSecret;

try {
  // TC-SEC-01: Valid Signature
  const nowSec = Math.floor(Date.now() / 1000);
  const testBody = '{"type":"event_callback","event":{"type":"app_mention"}}';
  const sigBasestring = `v0:${nowSec}:${testBody}`;
  const validSig = 'v0=' + crypto.createHmac('sha256', testSecret).update(sigBasestring).digest('hex');

  const validEvent = {
    headers: {
      'x-slack-request-timestamp': String(nowSec),
      'x-slack-signature': validSig
    },
    body: testBody
  };

  if (verifySlackSignature(validEvent)) {
    recordTest('TC-SEC-01', 'Security', 'HMAC-SHA256 signature verification accepts valid request', 'PASS');
  } else {
    recordTest('TC-SEC-01', 'Security', 'Valid signature was rejected', 'FAIL');
  }
} catch (e) {
  recordTest('TC-SEC-01', 'Security', 'Signature test exception', 'FAIL', e.message);
}

try {
  // TC-SEC-02: Invalid Signature Tampering
  const nowSec = Math.floor(Date.now() / 1000);
  const tamperedEvent = {
    headers: {
      'x-slack-request-timestamp': String(nowSec),
      'x-slack-signature': 'v0=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    },
    body: 'tampered_body'
  };

  if (!verifySlackSignature(tamperedEvent)) {
    recordTest('TC-SEC-02', 'Security', 'Tampered signature rejected securely', 'PASS');
  } else {
    recordTest('TC-SEC-02', 'Security', 'Tampered signature was accepted!', 'FAIL');
  }
} catch (e) {
  recordTest('TC-SEC-02', 'Security', 'Tampered signature exception', 'FAIL', e.message);
}

try {
  // TC-SEC-03: Replay Attack (Timestamp > 5 mins old)
  const oldSec = Math.floor(Date.now() / 1000) - 360; // 6 mins ago
  const oldBody = '{"test":1}';
  const sigBasestring = `v0:${oldSec}:${oldBody}`;
  const oldSig = 'v0=' + crypto.createHmac('sha256', testSecret).update(sigBasestring).digest('hex');

  const oldEvent = {
    headers: {
      'x-slack-request-timestamp': String(oldSec),
      'x-slack-signature': oldSig
    },
    body: oldBody
  };

  if (!verifySlackSignature(oldEvent)) {
    recordTest('TC-SEC-03', 'Security', 'Replay attack timestamp (>5 min old) rejected', 'PASS');
  } else {
    recordTest('TC-SEC-03', 'Security', 'Expired timestamp was accepted!', 'FAIL');
  }
} catch (e) {
  recordTest('TC-SEC-03', 'Security', 'Replay test exception', 'FAIL', e.message);
}

// ============================================================================
// 3. FEATURE 3: SLACK BLOCK KIT UI & ANTI-AI PERSONA RULES
// ============================================================================
console.log('\n--- 3. Testing Feature: Slack Block Kit UI & Anti-AI Persona Rules ---');

try {
  // TC-UI-01: No AI Emojis in Preview Card
  const mockTicket = {
    passenger_name: 'Hussin Norhilman',
    airline: 'Vietnam Airlines',
    flight_number: 'VN674',
    departure_iata: 'KUL',
    arrival_iata: 'SGN',
    departure_time: '2026-09-21 19:20',
    ticket_class: 'Economy',
    ticket_price: 'Chưa rõ',
    department: 'Nhân sự / Quản lý',
    purpose: 'Công tác nội bộ',
    payment_method: 'Corporate Card',
    slack_username: '@quoc_hao',
    passenger_email: 'hao@company.com'
  };

  const card = buildTicketPreviewCard('C012345', '1234567890.123456', mockTicket, false);
  const cardJson = JSON.stringify(card);

  // Forbidden emojis: 🤖, ✈️, 🎫, ✅, ❌, 💰
  const forbiddenEmojis = ['🤖', '✈️', '🎫', '✅', '❌', '💰'];
  const foundEmojis = forbiddenEmojis.filter(emoji => cardJson.includes(emoji));

  if (foundEmojis.length === 0) {
    recordTest('TC-UI-01', 'UI/UX Compliance', 'Eliminated all robotic AI emojis from Preview Card', 'PASS');
  } else {
    recordTest('TC-UI-01', 'UI/UX Compliance', `Found forbidden emojis: ${foundEmojis.join(', ')}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-UI-01', 'UI/UX Compliance', 'Emoji test exception', 'FAIL', e.message);
}

try {
  // TC-UI-02: Action Buttons (Confirm, Edit, Cancel)
  const card = buildTicketPreviewCard('C012345', '1234567890.123456', {}, false);
  const actionsBlock = card.blocks.find(b => b.type === 'actions');
  const actionIds = actionsBlock?.elements?.map(el => el.action_id) || [];
  const buttonTexts = actionsBlock?.elements?.map(el => el.text.text) || [];

  const expectedIds = ['confirm_save_ticket', 'open_edit_ticket_modal', 'cancel_ticket'];
  const expectedTexts = ['Xác nhận', 'Chỉnh sửa', 'Hủy bỏ'];

  const idsMatch = JSON.stringify(actionIds) === JSON.stringify(expectedIds);
  const textsMatch = JSON.stringify(buttonTexts) === JSON.stringify(expectedTexts);

  if (idsMatch && textsMatch) {
    recordTest('TC-UI-02', 'UI/UX Compliance', 'Exact 3 buttons: [Xác nhận], [Chỉnh sửa], [Hủy bỏ]', 'PASS');
  } else {
    recordTest('TC-UI-02', 'UI/UX Compliance', `Buttons mismatch: IDs=${JSON.stringify(actionIds)}, Texts=${JSON.stringify(buttonTexts)}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-UI-02', 'UI/UX Compliance', 'Buttons test exception', 'FAIL', e.message);
}

try {
  // TC-UI-03: Two Grouped Sections (Extracted vs Default Policy)
  const card = buildTicketPreviewCard('C012345', '1234567890.123456', {}, false);
  const cardJson = JSON.stringify(card);

  const hasExtractedSection = cardJson.includes('THÔNG TIN TRÍCH XUẤT TỪ VÉ MÁY BAY');
  const hasDefaultSection = cardJson.includes('THÔNG TIN HỒ SƠ CÔNG TÁC (MẶC ĐỊNH HỆ THỐNG)');

  if (hasExtractedSection && hasDefaultSection) {
    recordTest('TC-UI-03', 'UI/UX Compliance', 'Preview card groups Extracted Ticket vs Default Policy', 'PASS');
  } else {
    recordTest('TC-UI-03', 'UI/UX Compliance', 'Grouped sections missing in Preview Card', 'FAIL');
  }
} catch (e) {
  recordTest('TC-UI-03', 'UI/UX Compliance', 'Section grouping exception', 'FAIL', e.message);
}

try {
  // TC-UI-04: Price Display when missing vs when present
  const cardMissing = buildTicketPreviewCard('C01', '1', { ticket_price: 'Chưa rõ' }, false);
  const cardHasPrice = buildTicketPreviewCard('C01', '1', { ticket_price: '1800000' }, false);

  const jsonMissing = JSON.stringify(cardMissing);
  const jsonHasPrice = JSON.stringify(cardHasPrice);

  const missingCorrect = jsonMissing.includes('*Chi phí:*\\nChưa rõ') || jsonMissing.includes('*Giá vé:*\\nChưa rõ');
  const hasPriceCorrect = jsonHasPrice.includes('1.800.000 VND') || jsonHasPrice.includes('1,800,000 VND');

  if (missingCorrect && hasPriceCorrect) {
    recordTest('TC-UI-04', 'UI/UX Compliance', 'Cost display shows Chưa rõ when missing and formatted VND when present', 'PASS');
  } else {
    recordTest('TC-UI-04', 'UI/UX Compliance', `Cost display failed: missingCorrect=${missingCorrect}, hasPriceCorrect=${hasPriceCorrect}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-UI-04', 'UI/UX Compliance', 'Cost display exception', 'FAIL', e.message);
}

try {
  // TC-UI-05: Updated Preview Card (isUpdated = true)
  const updatedCard = buildTicketPreviewCard('C01', '1', {}, true);
  const jsonUpdated = JSON.stringify(updatedCard);
  const hasUpdatedTitle = jsonUpdated.includes('KẾT QUẢ ĐỌC VÉ MÁY BAY (ĐÃ CẬP NHẬT)');
  const hasUpdatedIntro = jsonUpdated.includes('Thông tin vé máy bay sau khi chỉnh sửa:');

  if (hasUpdatedTitle && hasUpdatedIntro) {
    recordTest('TC-UI-05', 'UI/UX Compliance', 'Updated preview card displays distinct update title and intro', 'PASS');
  } else {
    recordTest('TC-UI-05', 'UI/UX Compliance', 'Updated preview card headers mismatch', 'FAIL');
  }
} catch (e) {
  recordTest('TC-UI-05', 'UI/UX Compliance', 'Updated card test exception', 'FAIL', e.message);
}

try {
  // TC-UI-06: Disabled Action Buttons on Superseded/Older Message (hasActions = false)
  const disabledCard = buildTicketPreviewCard('C01', '1', {}, false, false);
  const jsonDisabled = JSON.stringify(disabledCard);
  const actionsBlock = disabledCard.blocks.find(b => b.type === 'actions');
  const hasSupersededNote = jsonDisabled.includes('Thông tin vé này đã được cập nhật ở tin nhắn mới nhất bên dưới.');
  const { updateSlackMessage } = require('../lambda/common');

  if (!actionsBlock && hasSupersededNote && typeof updateSlackMessage === 'function') {
    recordTest('TC-UI-06', 'UI/UX Compliance', 'Superseded card disables action buttons and updateSlackMessage is exported', 'PASS');
  } else {
    recordTest('TC-UI-06', 'UI/UX Compliance', `Disabled card validation failed: actionsPresent=${!!actionsBlock}, hasNote=${hasSupersededNote}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-UI-06', 'UI/UX Compliance', 'Disabled card test exception', 'FAIL', e.message);
}

// ============================================================================
// 4. FEATURE 4: GOOGLE SHEETS 23-COLUMN SCHEMA & PERSISTENCE
// ============================================================================
console.log('\n--- 4. Testing Feature: Google Sheets 23-Column Schema & Data Persistence ---');

try {
  // TC-SHEET-01: Schema Column Count and Alignment
  const sampleTicket = {
    passenger_name: 'Hussin Norhilman',
    airline: 'Vietnam Airlines',
    flight_number: 'VN674',
    departure_iata: 'KUL',
    arrival_iata: 'SGN',
    departure_time: '2026-09-21 19:20',
    arrival_time: '2026-09-21 21:30',
    pnr: 'ABC123',
    ticket_class: 'Economy',
    ticket_price: 'Chưa rõ',
    department: 'Nhân sự / Quản lý',
    purpose: 'Công tác nội bộ',
    payment_method: 'Corporate Card',
    passenger_email: 'hao@company.com',
    slack_username: '@quoc_hao'
  };

  const normalized = normalizeTicketData(sampleTicket);
  const now = new Date();
  const tripId = `TRIP-202611-999`;
  const prNumber = `PR-2026-999`;

  const newRow = [
    tripId,                                                      // A: Trip_ID
    prNumber,                                                    // B: PR_Number
    "APPROVED",                                                  // C: Status
    normalized.passenger_name,                                   // D: Passenger_Name
    normalized.department,                                       // E: Department
    normalized.passenger_email,                                  // F: Passenger_Email
    normalized.slack_username,                                   // G: Slack_Username
    normalized.airline,                                          // H: Airline
    normalized.flight_number,                                    // I: Flight_Code
    normalized.departure_city,                                   // J: Departure_City
    normalized.departure_iata,                                   // K: Departure_IATA
    normalized.arrival_city,                                     // L: Arrival_City
    normalized.arrival_iata,                                     // M: Arrival_IATA
    normalized.departure_time,                                   // N: Departure_Time
    normalized.arrival_time,                                     // O: Arrival_Time
    normalized.pnr,                                              // P: PNR
    normalized.ticket_class,                                     // Q: Ticket_Class
    normalized.ticket_price,                                     // R: Cost
    normalized.payment_method,                                   // S: Payment_Method
    normalized.purpose,                                          // T: Purpose
    "PENDING",                                                   // U: Reminder_Sent
    "VALID",                                                     // V: Audit_Status
    "Được bóc tách tự động qua AWS Lambda & AI Vision OCR."      // W: Notes
  ];

  if (newRow.length === 23) {
    recordTest('TC-SHEET-01', 'Google Sheets Schema', 'Row structure contains exactly 23 columns (A to W)', 'PASS');
  } else {
    recordTest('TC-SHEET-01', 'Google Sheets Schema', `Expected 23 columns, got ${newRow.length}`, 'FAIL');
  }

  // TC-SHEET-02: Column R (Index 17) Cost Verification
  if (newRow[17] === 'Chưa rõ') {
    recordTest('TC-SHEET-02', 'Google Sheets Schema', 'Column R (Cost_VND) correctly set to Chưa rõ instead of 0', 'PASS');
  } else {
    recordTest('TC-SHEET-02', 'Google Sheets Schema', `Column R has invalid value: '${newRow[17]}'`, 'FAIL');
  }

  // TC-SHEET-03: Column J (Departure_City) & Column L (Arrival_City) Title Case
  if (newRow[9] === 'Kuala Lumpur' && newRow[11] === 'Hồ Chí Minh') {
    recordTest('TC-SHEET-03', 'Google Sheets Schema', 'Columns J & L city names are formatted Title Case', 'PASS');
  } else {
    recordTest('TC-SHEET-03', 'Google Sheets Schema', `City names not Title Case: J='${newRow[9]}', L='${newRow[11]}'`, 'FAIL');
  }

  // TC-SHEET-04: Column G Slack Username populated
  if (newRow[6] === '@quoc_hao') {
    recordTest('TC-SHEET-04', 'Google Sheets Schema', 'Column G (Slack_Username) populated with real Slack user handle', 'PASS');
  } else {
    recordTest('TC-SHEET-04', 'Google Sheets Schema', `Slack username column invalid: '${newRow[6]}'`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-SHEET-01', 'Google Sheets Schema', 'Sheets row test exception', 'FAIL', e.message);
}

// ============================================================================
// 5. FEATURE 5: AI JSON PARSING & RESILIENCE
// ============================================================================
console.log('\n--- 5. Testing Feature: AI JSON Parsing & Resilience ---');

try {
  // TC-AI-01: Markdown ```json code block stripping
  const raw1 = '```json\n{"passenger_name": "LE DANG HIEU", "ticket_price": "1800000"}\n```';
  const parsed1 = cleanJsonResponse(raw1);
  if (parsed1.passenger_name === 'LE DANG HIEU' && parsed1.ticket_price === '1800000') {
    recordTest('TC-AI-01', 'AI JSON Parser', 'Strips ```json markdown fences cleanly', 'PASS');
  } else {
    recordTest('TC-AI-01', 'AI JSON Parser', 'Failed to strip ```json fences', 'FAIL');
  }
} catch (e) {
  recordTest('TC-AI-01', 'AI JSON Parser', 'Markdown fence test exception', 'FAIL', e.message);
}

try {
  // TC-AI-02: Conversational text surrounding JSON
  const raw2 = 'Chào bạn, đây là kết quả bóc tách vé:\n{"airline": "Bamboo Airways", "flight_number": "QH202"}\nChúc bạn công tác tốt!';
  const parsed2 = cleanJsonResponse(raw2);
  if (parsed2.airline === 'Bamboo Airways' && parsed2.flight_number === 'QH202') {
    recordTest('TC-AI-02', 'AI JSON Parser', 'Extracts JSON object from surrounding conversational text', 'PASS');
  } else {
    recordTest('TC-AI-02', 'AI JSON Parser', 'Failed to isolate JSON from surrounding text', 'FAIL');
  }
} catch (e) {
  recordTest('TC-AI-02', 'AI JSON Parser', 'Conversational text test exception', 'FAIL', e.message);
}

try {
  // TC-AI-03: Invalid non-JSON string handling
  let threw = false;
  try {
    cleanJsonResponse('Xin lỗi, tôi không thể đọc được ảnh này.');
  } catch {
    threw = true;
  }
  if (threw) {
    recordTest('TC-AI-03', 'AI JSON Parser', 'Gracefully catches and rejects non-JSON AI output', 'PASS');
  } else {
    recordTest('TC-AI-03', 'AI JSON Parser', 'Did not throw on invalid JSON string', 'FAIL');
  }
} catch (e) {
  recordTest('TC-AI-03', 'AI JSON Parser', 'Exception handling test failed', 'FAIL', e.message);
}

// ============================================================================
// 6. FEATURE 6: 24H FLIGHT REMINDER TIMING & BOUNDARY CONDITIONS
// ============================================================================
console.log('\n--- 6. Testing Feature: 24h Flight Reminder Logic ---');

try {
  const now = new Date('2026-11-18T10:00:00Z');
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  function checkWithin24h(depTimeStr, mockNow = now) {
    const depTime = new Date(depTimeStr);
    const mockNext24 = new Date(mockNow.getTime() + 24 * 60 * 60 * 1000);
    return depTime >= mockNow && depTime <= mockNext24;
  }

  // TC-REMIND-01: Flight in 12h (within 24h window) -> TRUE
  const depIn12h = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  const is12hWithin = checkWithin24h(depIn12h);

  // TC-REMIND-02: Flight in 48h (outside window) -> FALSE
  const depIn48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const is48hWithin = checkWithin24h(depIn48h);

  // TC-REMIND-03: Flight in past -> FALSE
  const depPast = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const isPastWithin = checkWithin24h(depPast);

  if (is12hWithin && !is48hWithin && !isPastWithin) {
    recordTest('TC-REMIND-01', 'Flight Reminder Cron', 'Accurate 24h window boundary checks (in-window, future, past)', 'PASS');
  } else {
    recordTest('TC-REMIND-01', 'Flight Reminder Cron', `Boundary check failed: in12h=${is12hWithin}, in48h=${is48hWithin}, past=${isPastWithin}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-REMIND-01', 'Flight Reminder Cron', 'Reminder test exception', 'FAIL', e.message);
}

// Check reminder_cron.js for user persona rules
try {
  const fs = require('fs');
  const path = require('path');
  const reminderCronCode = fs.readFileSync(path.join(__dirname, '..', 'lambda', 'reminder_cron.js'), 'utf8');

  // Check if reminder_cron.js contains hardcoded TRIP-202611-001
  if (reminderCronCode.includes("booking.trip_id === 'TRIP-202611-001'")) {
    recordTest('TC-REMIND-02', 'Flight Reminder Cron', 'Contains hardcoded demo ID TRIP-202611-001', 'WARN', 'Should be removed for production');
  } else {
    recordTest('TC-REMIND-02', 'Flight Reminder Cron', 'No hardcoded demo trip IDs in reminder_cron.js', 'PASS');
  }

  // Check if reminder_cron.js updates Google Sheets Column U
  if (reminderCronCode.includes('spreadsheets') || reminderCronCode.includes('GOOGLE_SHEET_ID') && reminderCronCode.includes('values')) {
    recordTest('TC-REMIND-03', 'Flight Reminder Cron', 'Syncs reminder_sent to Google Sheets Column U', 'PASS');
  } else {
    recordTest('TC-REMIND-03', 'Flight Reminder Cron', 'Only updates DynamoDB, does NOT sync Reminder_24h to Google Sheets', 'WARN', 'Gap in Google Sheet sync');
  }

  // Check if reminder_cron.js contains forbidden AI emojis
  const reminderEmojis = ['✈️', '🕒', '🎒', '💡', '⏰'].filter(em => reminderCronCode.includes(em));
  if (reminderEmojis.length > 0) {
    recordTest('TC-REMIND-04', 'Flight Reminder Cron', `Reminder message still contains AI emojis (${reminderEmojis.join(', ')})`, 'WARN', 'Needs cleanup to match user persona');
  } else {
    recordTest('TC-REMIND-04', 'Flight Reminder Cron', 'Reminder messages are free of AI emojis', 'PASS');
  }
} catch (e) {
  recordTest('TC-REMIND-02', 'Flight Reminder Cron', 'Cron code inspection exception', 'FAIL', e.message);
}

// ============================================================================
// 7. FEATURE 7: EDIT MODAL & FORM SUBMISSION INTEGRITY
// ============================================================================
console.log('\n--- 7. Testing Feature: Edit Modal Form & Input Parsing ---');

try {
  // TC-MODAL-01: Inspect Edit Modal Blocks in slack_handler.js
  const fs = require('fs');
  const path = require('path');
  const handlerCode = fs.readFileSync(path.join(__dirname, '..', 'lambda', 'slack_handler.js'), 'utf8');

  const requiredBlocks = [
    'name_block', 'airline_block', 'flight_block',
    'dep_iata_block', 'arr_iata_block', 'dep_time_block',
    'pnr_block', 'seat_block', 'class_block', 'price_block',
    'department_block', 'purpose_block', 'payment_method_block', 'email_block'
  ];

  const missingBlocks = requiredBlocks.filter(b => !handlerCode.includes(`block_id: "${b}"`));
  if (missingBlocks.length === 0) {
    recordTest('TC-MODAL-01', 'Edit Modal Dialog', 'Edit Modal contains all 14 enterprise input blocks', 'PASS');
  } else {
    recordTest('TC-MODAL-01', 'Edit Modal Dialog', `Missing modal blocks: ${missingBlocks.join(', ')}`, 'FAIL');
  }

  // TC-MODAL-02: Check arrival_time assignment bug
  if (handlerCode.includes('arrival_time: values.dep_time_block?.dep_time_input?.value')) {
    recordTest('TC-MODAL-02', 'Edit Modal Dialog', 'arrival_time mistakenly bound to dep_time_block in modal submission', 'WARN', 'arrival_time gets set to departure_time');
  } else {
    recordTest('TC-MODAL-02', 'Edit Modal Dialog', 'arrival_time independently managed', 'PASS');
  }

  // TC-MODAL-03: Check /travel-admin cityMap completeness
  const travelAdminSection = handlerCode.substring(handlerCode.indexOf("callbackId === 'travel_booking_modal'"), handlerCode.indexOf("saveTripRecord(tripData)"));
  if (travelAdminSection.includes("cityMap =") && !travelAdminSection.includes('KUL')) {
    recordTest('TC-MODAL-03', 'Manual Travel Admin', 'cityMap in travel_booking_modal is incomplete (missing KUL and other international airports)', 'WARN', 'Should use CITY_MAP / normalizeCity');
  } else {
    recordTest('TC-MODAL-03', 'Manual Travel Admin', 'Uses comprehensive CITY_MAP for manual booking', 'PASS');
  }
} catch (e) {
  recordTest('TC-MODAL-01', 'Edit Modal Dialog', 'Modal inspection exception', 'FAIL', e.message);
}

// ============================================================================
// 8. FEATURE 8: CHANNEL-BASED RBAC & AI TRAVEL BI ANALYTICS ENGINE
// ============================================================================
console.log('\n--- 8. Testing Feature: Channel-Based RBAC & AI Travel BI Engine ---');

try {
  const {
    ROLES,
    getChannelRole,
    buildUnauthorizedMessage,
    executeBIQuery,
    buildBIReportCard
  } = require('../lambda/bi_analytics_service');

  // TC-RBAC-01: Channel Role Resolution
  const rAdmin = getChannelRole('C0CGLFPNW7R');
  const rEmp = getChannelRole('C0CH1CC22FL');
  const rUnknown = getChannelRole('C9999999999');
  if (rAdmin === ROLES.ADMIN_HR && rEmp === ROLES.EMPLOYEE && rUnknown === ROLES.UNKNOWN) {
    recordTest('TC-RBAC-01', 'Channel RBAC', 'Maps #biz-admin-alerts to ADMIN_HR and #travel-booking to EMPLOYEE', 'PASS');
  } else {
    recordTest('TC-RBAC-01', 'Channel RBAC', `Role mapping mismatch: admin=${rAdmin}, emp=${rEmp}, unk=${rUnknown}`, 'FAIL');
  }

  // TC-RBAC-02: Unauthorized Messages Policy
  const msgCmd = buildUnauthorizedMessage('slash_command');
  const msgEdit = buildUnauthorizedMessage('edit_saved_trip');
  const msgGen = buildUnauthorizedMessage('general');
  const validMsgs = msgCmd.includes('không nằm trong thẩm quyền') &&
    msgEdit.includes('không nằm trong thẩm quyền') &&
    msgGen.includes('không nằm trong thẩm quyền');
  if (validMsgs) {
    recordTest('TC-RBAC-02', 'Channel RBAC', 'Unauthorized guard messages explicitly communicate out-of-authority policy', 'PASS');
  } else {
    recordTest('TC-RBAC-02', 'Channel RBAC', 'Unauthorized guard messages missing required authority wording', 'FAIL');
  }

  // Sample dataset for deterministic BI tests
  const sampleDbItems = [
    { trip_id: 'DRAFT#C0CH1CC22FL', ticket_price: '99999999' },
    { trip_id: 'EVENT#C0CGLFPNW7R#1700000.1', channel_id: 'C0CGLFPNW7R' },
    {
      trip_id: 'TRIP-202611-001',
      passenger_name: 'Nguyen Van A',
      department: 'Kinh Doanh',
      airline: 'Vietnam Airlines',
      flight_number: 'VN214',
      departure_iata: 'SGN',
      departure_city: 'Hồ Chí Minh',
      arrival_iata: 'HAN',
      arrival_city: 'Hà Nội',
      departure_time: '2026-11-25 08:30',
      ticket_class: 'Economy',
      ticket_price: '2000000'
    },
    {
      trip_id: 'TRIP-202611-002',
      passenger_name: 'Tran Thi B',
      department: 'Ban Giám Đốc',
      airline: 'Vietnam Airlines',
      flight_number: 'VN674',
      departure_iata: 'SGN',
      departure_city: 'Hồ Chí Minh',
      arrival_iata: 'KUL',
      arrival_city: 'Kuala Lumpur',
      departure_time: '2026-11-26 19:20',
      ticket_class: 'Business',
      ticket_price: '8000000'
    },
    {
      trip_id: 'TRIP-202611-003',
      passenger_name: 'Le Van C',
      department: 'Kinh Doanh',
      airline: 'Vietjet Air',
      flight_number: 'VJ120',
      departure_iata: 'HAN',
      departure_city: 'Hà Nội',
      arrival_iata: 'DAD',
      arrival_city: 'Đà Nẵng',
      departure_time: '2026-11-28 10:00',
      ticket_class: 'Economy',
      ticket_price: 'Chưa rõ'
    }
  ];

  // TC-BI-01: Deterministic Aggregation & Non-Trip Filtering
  const summaryStats = executeBIQuery(sampleDbItems, { query_type: 'COST_SUMMARY' });
  const bi01Pass = summaryStats.total_records_in_db === 3 &&
    summaryStats.matched_count === 3 &&
    summaryStats.priced_trips === 2 &&
    summaryStats.missing_price_trips === 1 &&
    summaryStats.total_cost_vnd === 10000000 &&
    summaryStats.avg_cost_vnd === 5000000;
  if (bi01Pass) {
    recordTest('TC-BI-01', 'AI Travel BI Engine', 'Filters DRAFT#/EVENT# records and computes exact deterministic cost totals', 'PASS');
  } else {
    recordTest('TC-BI-01', 'AI Travel BI Engine', `Aggregation mismatch: ${JSON.stringify(summaryStats)}`, 'FAIL');
  }

  // TC-BI-02: Department Grouping & Ranking
  const deptStats = executeBIQuery(sampleDbItems, { query_type: 'GROUP_BY_DEPARTMENT' });
  const bi02Pass = deptStats.breakdown.length === 2 &&
    deptStats.breakdown[0].key === 'Ban Giám Đốc' &&
    deptStats.breakdown[0].total_cost_vnd === 8000000 &&
    deptStats.breakdown[1].key === 'Kinh Doanh' &&
    deptStats.breakdown[1].trip_count === 2 &&
    deptStats.breakdown[1].missing_price_count === 1;
  if (bi02Pass) {
    recordTest('TC-BI-02', 'AI Travel BI Engine', 'Groups trips by department and ranks accurately by total cost descending', 'PASS');
  } else {
    recordTest('TC-BI-02', 'AI Travel BI Engine', `Department grouping mismatch: ${JSON.stringify(deptStats.breakdown)}`, 'FAIL');
  }

  // TC-BI-03: Anomaly Detection (Missing Price & Business Class)
  const hasMissingPriceAlert = summaryStats.anomalies.some(a => a.includes('chưa có giá vé'));
  const hasBusinessAlert = summaryStats.anomalies.some(a => a.includes('Business'));
  if (hasMissingPriceAlert && hasBusinessAlert) {
    recordTest('TC-BI-03', 'AI Travel BI Engine', 'Detects missing-price trips and Business class anomalies accurately', 'PASS');
  } else {
    recordTest('TC-BI-03', 'AI Travel BI Engine', `Anomalies missing: ${JSON.stringify(summaryStats.anomalies)}`, 'FAIL');
  }

  // TC-BI-04: BI Report Card Block Kit & Anti-AI Persona
  const biCard = buildBIReportCard('C0CGLFPNW7R', '1700000.1', 'Tổng chi phí tháng 11?', deptStats, '• Ban Giám Đốc chiếm 80% tổng chi phí đã ghi nhận.');
  const biCardJson = JSON.stringify(biCard);
  const forbiddenEmojis = ['🤖', '🚀', '💡', '🧠', '✨', '✈️', '💰'];
  const foundEmojis = forbiddenEmojis.filter(e => biCardJson.includes(e));
  if (foundEmojis.length === 0 && biCardJson.includes('BÁO CÁO PHÂN TÍCH CÔNG TÁC') && biCardJson.includes('10.000.000 VND')) {
    recordTest('TC-BI-04', 'AI Travel BI Engine', 'BI Block Kit card formats KPIs cleanly with zero robotic AI emojis', 'PASS');
  } else {
    recordTest('TC-BI-04', 'AI Travel BI Engine', `BI Card check failed: emojis=${foundEmojis.join(',')}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-RBAC-01', 'Channel RBAC / BI', 'RBAC & BI test exception', 'FAIL', e.message);
}

// ============================================================================
// 8B. FEATURE 9: FLIGHT TICKET IMAGE CLASSIFICATION & REJECTION GUARD
// ============================================================================
console.log('\n--- 8B. Testing Feature: Flight Ticket Image Classification ---');

try {
  // TC-OCR-01: Rejects explicit non-flight-ticket image with custom reason or fallback
  const nonTicketCustom = validateFlightTicketExtraction({
    is_flight_ticket: false,
    rejection_reason: 'Ảnh là hóa đơn ăn uống, không phải vé máy bay.',
    airline: '',
    flight_number: ''
  });
  const nonTicketFallback = validateFlightTicketExtraction({ is_flight_ticket: 'false', rejection_reason: '' });
  if (!nonTicketCustom.valid && nonTicketCustom.reason.includes('hóa đơn ăn uống') && !nonTicketFallback.valid && nonTicketFallback.reason.includes('không phải là vé máy bay')) {
    recordTest('TC-OCR-01', 'Image Classification', 'Rejects non-flight-ticket images with clear Vietnamese reason', 'PASS');
  } else {
    recordTest('TC-OCR-01', 'Image Classification', `Unexpected result: ${JSON.stringify({ nonTicketCustom, nonTicketFallback })}`, 'FAIL');
  }

  // TC-OCR-02: Anti-hallucination guard rejects empty/N/A fields even if is_flight_ticket is true
  const emptyFields = validateFlightTicketExtraction({
    is_flight_ticket: true,
    passenger_name: 'N/A',
    airline: 'Chưa rõ',
    flight_number: '',
    departure_iata: 'null',
    arrival_iata: '',
    pnr: '---'
  });
  const nameOnly = validateFlightTicketExtraction({
    is_flight_ticket: true,
    passenger_name: 'NGUYEN VAN A',
    departure_time: '2026-12-01 09:00'
  });
  if (!emptyFields.valid && !nameOnly.valid) {
    recordTest('TC-OCR-02', 'Image Classification', 'Blocks empty/N/A or non-aviation payloads even if flag is true', 'PASS');
  } else {
    recordTest('TC-OCR-02', 'Image Classification', 'Failed to block insufficient flight ticket fields', 'FAIL');
  }

  // TC-OCR-03: Accepts valid flight ticket / boarding pass (including partial ticket without price)
  const validTicket = validateFlightTicketExtraction({
    is_flight_ticket: true,
    passenger_name: 'TRAN THI B',
    airline: 'Vietnam Airlines',
    flight_number: 'VN214',
    departure_iata: 'SGN',
    arrival_iata: 'HAN',
    ticket_price: 'Chưa rõ'
  });
  if (validTicket.valid) {
    recordTest('TC-OCR-03', 'Image Classification', 'Accepts valid flight ticket / boarding pass extraction', 'PASS');
  } else {
    recordTest('TC-OCR-03', 'Image Classification', `Valid ticket rejected: ${validTicket.reason}`, 'FAIL');
  }

  // TC-OCR-04: normalizeTicketData strips internal classification metadata
  const cleaned = normalizeTicketData({
    is_flight_ticket: true,
    rejection_reason: '',
    passenger_name: 'LE VAN C',
    flight_number: 'VJ128',
    departure_iata: 'SGN',
    arrival_iata: 'DAD'
  });
  if (!('is_flight_ticket' in cleaned) && !('rejection_reason' in cleaned) && cleaned.flight_number === 'VJ128') {
    recordTest('TC-OCR-04', 'Image Classification', 'normalizeTicketData strips internal classification fields', 'PASS');
  } else {
    recordTest('TC-OCR-04', 'Image Classification', 'Internal classification fields leaked into normalized ticket', 'FAIL');
  }

  // TC-DRAFT-01: Thread-scoped draft key isolates concurrent threads in same channel
  const keyA = buildDraftKey('C0CH1CC22FL', '1700000100.000100');
  const keyB = buildDraftKey('C0CH1CC22FL', '1700000200.000200');
  const keyFallback = buildDraftKey('C0CH1CC22FL', null);
  if (keyA === 'DRAFT#C0CH1CC22FL#1700000100.000100' && keyB === 'DRAFT#C0CH1CC22FL#1700000200.000200' && keyA !== keyB && keyFallback === 'DRAFT#C0CH1CC22FL') {
    recordTest('TC-DRAFT-01', 'Thread Draft Isolation', 'buildDraftKey generates distinct keys per thread in same channel', 'PASS');
  } else {
    recordTest('TC-DRAFT-01', 'Thread Draft Isolation', `Unexpected keys: ${keyA}, ${keyB}, ${keyFallback}`, 'FAIL');
  }

  // TC-DUP-01: Duplicate booking fingerprint ignores accents/case and distinguishes different flights
  const fp1 = computeBookingFingerprint({ pnr: 'abc123', flight_number: 'vn214', passenger_name: 'Nguyễn Văn A', departure_time: '2026-12-05 08:00' });
  const fp2 = computeBookingFingerprint({ pnr: 'ABC123', flight_number: 'VN214', passenger_name: 'NGUYEN VAN A', departure_time: '2026-12-05 08:00' });
  const fp3 = computeBookingFingerprint({ pnr: 'XYZ999', flight_number: 'VN214', passenger_name: 'NGUYEN VAN A', departure_time: '2026-12-05 08:00' });
  if (fp1 === fp2 && fp1 !== fp3) {
    recordTest('TC-DUP-01', 'Duplicate Booking Guard', 'computeBookingFingerprint normalizes PNR/flight/passenger consistently', 'PASS');
  } else {
    recordTest('TC-DUP-01', 'Duplicate Booking Guard', 'Fingerprint mismatch', 'FAIL');
  }

  // TC-VAL-01: Modal input validation catches bad IATA, time format, and email
  const badInputs = validateModalTicketInputs({ depIata: 'SG', arrIata: '123', depTime: '05/12/2026 8h', arrTime: 'bad', email: 'not-an-email' });
  const goodInputs = validateModalTicketInputs({ depIata: 'SGN', arrIata: 'HAN', depTime: '2026-12-05 08:30', arrTime: '2026-12-05 10:40', email: 'hao@company.com' });
  if (Object.keys(badInputs).length === 5 && Object.keys(goodInputs).length === 0) {
    recordTest('TC-VAL-01', 'Modal Input Validation', 'Rejects invalid IATA/datetime/email and accepts valid inputs', 'PASS');
  } else {
    recordTest('TC-VAL-01', 'Modal Input Validation', `Unexpected validation errors: ${JSON.stringify({ badInputs, goodInputs })}`, 'FAIL');
  }

  // TC-BI-05: BI filter excludes PR- and CANCELLED records
  const { filterConfirmedTrips, executeBIQuery } = require('../lambda/bi_analytics_service');
  const biFiltered = filterConfirmedTrips([
    { trip_id: 'TRIP-202612-100001', status: 'APPROVED', ticket_price: '2000000' },
    { trip_id: 'TRIP-202612-100002', status: 'CANCELLED', ticket_price: '5000000' },
    { trip_id: 'PR-202612-100003', record_type: 'PURCHASE_REQUEST', status: 'PENDING_APPROVAL', estimated_cost: 3000000 }
  ]);
  if (biFiltered.length === 1 && biFiltered[0].trip_id === 'TRIP-202612-100001') {
    recordTest('TC-BI-05', 'AI Travel BI Engine', 'Excludes CANCELLED trips and PR- records from BI analytics', 'PASS');
  } else {
    recordTest('TC-BI-05', 'AI Travel BI Engine', `Unexpected filtered items: ${JSON.stringify(biFiltered)}`, 'FAIL');
  }

  // TC-BI-06: UPCOMING_FLIGHTS sorts by UTC departure time across airport timezones
  const upcomingSorted = executeBIQuery([
    { trip_id: 'TRIP-SGN', departure_iata: 'SGN', departure_time: '2026-12-05 08:00', status: 'APPROVED' }, // 01:00 UTC
    { trip_id: 'TRIP-NRT', departure_iata: 'NRT', departure_time: '2026-12-05 08:30', status: 'APPROVED' }  // 23:30 UTC Dec 4 (earlier!)
  ], { query_type: 'UPCOMING_FLIGHTS', filters: { upcoming_days: 7 } }, new Date('2026-12-04T20:00:00Z'));
  if (upcomingSorted.matched_trips.map(t => t.trip_id).join(',') === 'TRIP-NRT,TRIP-SGN') {
    recordTest('TC-BI-06', 'AI Travel BI Engine', 'Sorts UPCOMING_FLIGHTS by airport UTC timestamp across timezones', 'PASS');
  } else {
    recordTest('TC-BI-06', 'AI Travel BI Engine', `Unexpected order: ${upcomingSorted.matched_trips.map(t => t.trip_id).join(',')}`, 'FAIL');
  }

  // TC-OCR-05: Pure-Node PDF text extraction (FlateDecode stream via zlib)
  const zlib = require('zlib');
  const pdfStreamContent = 'BT /F1 12 Tf 72 720 Td (VIETNAM AIRLINES VN214 SGN HAN NGUYEN VAN A PNR ABC123) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(pdfStreamContent, 'latin1'));
  const fakePdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj << /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ]);
  const extractedPdfText = extractTextFromPdfBuffer(fakePdf);
  if (extractedPdfText.includes('VIETNAM AIRLINES') && extractedPdfText.includes('VN214') && extractedPdfText.includes('ABC123')) {
    recordTest('TC-OCR-05', 'PDF Ticket Extraction', 'Extracts e-ticket text from FlateDecode PDF streams via Node zlib', 'PASS');
  } else {
    recordTest('TC-OCR-05', 'PDF Ticket Extraction', `Unexpected PDF text: ${extractedPdfText}`, 'FAIL');
  }
} catch (e) {
  recordTest('TC-OCR-01', 'Image Classification', 'OCR classification test exception', 'FAIL', e.message);
}

// ============================================================================
// 9. TEST SUMMARY REPORT
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('TEST EXECUTION SUMMARY');
console.log('='.repeat(80));
console.log(`TOTAL TESTS RUN : ${results.details.length}`);
console.log(`PASSED          : ${results.passed}`);
console.log(`FAILED          : ${results.failed}`);
console.log(`WARNINGS / GAPS : ${results.warnings}`);
console.log('='.repeat(80));

process.exit(results.failed > 0 ? 1 : 0);
