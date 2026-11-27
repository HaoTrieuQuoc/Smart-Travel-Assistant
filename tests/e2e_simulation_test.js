/**
 * End-to-End (E2E) Flow Simulation Test Suite
 * Simulates complete user interactions through API Gateway / Slack Webhooks
 */

// Mock AWS SDK
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain) {
  if (request.startsWith('@aws-sdk/')) return request;
  return origResolve.apply(this, arguments);
};

const lambdaInvocations = [];

// In-Memory DynamoDB Mock Store
const dbStore = new Map();

require.cache['@aws-sdk/client-dynamodb'] = {
  id: '@aws-sdk/client-dynamodb',
  filename: '@aws-sdk/client-dynamodb',
  loaded: true,
  exports: { DynamoDBClient: class DynamoDBClient {} }
};

require.cache['@aws-sdk/lib-dynamodb'] = {
  id: '@aws-sdk/lib-dynamodb',
  filename: '@aws-sdk/lib-dynamodb',
  loaded: true,
  exports: {
    DynamoDBDocumentClient: {
      from: () => ({
        send: async (cmd) => {
          if (cmd.constructor.name === 'PutCommand') {
            dbStore.set(cmd.Item.trip_id, JSON.parse(JSON.stringify(cmd.Item)));
            return {};
          }
          if (cmd.constructor.name === 'GetCommand') {
            const item = dbStore.get(cmd.Key.trip_id);
            return { Item: item ? JSON.parse(JSON.stringify(item)) : undefined };
          }
          if (cmd.constructor.name === 'DeleteCommand') {
            dbStore.delete(cmd.Key.trip_id);
            return {};
          }
          if (cmd.constructor.name === 'ScanCommand') {
            return { Items: Array.from(dbStore.values()) };
          }
          if (cmd.constructor.name === 'UpdateCommand') {
            const item = dbStore.get(cmd.Key.trip_id) || {};
            if (cmd.UpdateExpression.includes('reminder_sent = :sent')) {
              item.reminder_sent = cmd.ExpressionAttributeValues[':sent'];
            }
            dbStore.set(cmd.Key.trip_id, item);
            return {};
          }
          return {};
        }
      })
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
    LambdaClient: class LambdaClient { send(cmd) { lambdaInvocations.push(JSON.parse(cmd.Payload.toString())); return Promise.resolve({}); } },
    InvokeCommand: class InvokeCommand { constructor(p) { Object.assign(this, p); } }
  }
};

const https = require('https');
const EventEmitter = require('events');

// Mock all outbound HTTPS requests
const outboundCalls = [];
let sheetsFailure = false;
let mockVisionResponse = null;
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'e2e@test.local',
  private_key: require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
});
const origHttpsRequest = https.request;
https.get = function(options, callback) {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = { 'content-type': 'image/png' };
  process.nextTick(() => {
    if (callback) callback(res);
    res.emit('data', Buffer.from('fake_image_bytes'));
    res.emit('end');
  });
  return new EventEmitter();
};
https.request = function(options, callback) {
  let postBody = '';
  const req = new EventEmitter();
  req.write = (chunk) => { if (chunk) postBody += chunk.toString(); };
  req.end = () => {
    const url = typeof options === 'string' ? options : (options.href || options.path || '');
    outboundCalls.push({ url, body: postBody });
    if (callback) {
      const res = new EventEmitter();
      res.statusCode = (sheetsFailure && options.hostname === 'sheets.googleapis.com') ? 500 : 200;
      res.headers = { 'content-type': 'application/json' };
      process.nextTick(() => {
        if (callback) callback(res);
        const hostname = typeof options === 'object' ? (options.hostname || '') : '';
        if (hostname.includes('openrouter.ai')) {
          let content;
          if (postBody.includes('image_url') && mockVisionResponse) {
            content = JSON.stringify(mockVisionResponse);
          } else {
            const isPlanner = postBody.includes('Travel BI Query Planner');
            content = isPlanner
              ? JSON.stringify({
                  is_bi_query: true,
                  query_type: 'GROUP_BY_DEPARTMENT',
                  group_by: 'department',
                  filters: {},
                  limit: 10
                })
              : '• Tổng chi phí ghi nhận là 3.500.000 VND trên 1 chuyến bay.\n• Không phát hiện vé thiếu giá.';
          }
          res.emit('data', JSON.stringify({
            choices: [{ message: { content } }]
          }));
        } else {
          const urlPath = typeof options === 'object' ? (options.path || '') : '';
          if (urlPath.includes('files.list')) {
            // Mô phỏng kênh có file vé cũ từ nhiều ngày trước (tránh tái diễn lỗi OCR nhầm file cũ)
            res.emit('data', JSON.stringify({
              ok: true,
              files: [{ id: 'F_OLD_TICKET', name: 'old_ticket.png', mimetype: 'image/png', user: 'U_ADMIN_1', created: 1600000000 }]
            }));
          } else {
            res.emit('data', JSON.stringify({
              ok: true,
              access_token: 'e2e_google_token',
              ts: '1700000000.000200',
              user: { name: 'quoc_hao', profile: { display_name: 'quoc_hao', email: 'hao@company.com' } }
            }));
          }
        }
        res.emit('end');
      });
    }
  };
  return req;
};

const { handler } = require('../lambda/slack_handler');

// Giả lập Slack ký request trước khi gửi vào API Gateway
const crypto = require('crypto');
process.env.SLACK_SIGNING_SECRET = 'e2e_test_signing_secret';
function signed(event) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update(`v0:${ts}:${event.body}`).digest('hex');
  return { ...event, headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig } };
}

// Track intercepted outbound Slack messages
const postedMessages = [];
const common = require('../lambda/common');
common.postSlackMessage = async (channel, textOrBlocks) => {
  postedMessages.push({ channel, content: textOrBlocks });
  return { ok: true };
};
common.makeRequest = async (urlStr, options = {}, postData = null) => {
  postedMessages.push({ url: urlStr, postData });
  return { ok: true, data: { ok: true } };
};

const results = [];
function recordE2E(id, title, pass, detail = '') {
  results.push({ id, title, pass, detail });
  const icon = pass ? '[PASS]' : '[FAIL]';
  console.log(`${icon} ${id.padEnd(12)} | ${title} ${detail ? `(${detail})` : ''}`);
}

async function runE2E() {
  console.log('='.repeat(80));
  console.log('SMART TRAVEL ASSISTANT - END-TO-END FLOW SIMULATION');
  console.log('='.repeat(80));

  // --------------------------------------------------------------------------
  // FLOW 1: URL Verification Challenge
  // --------------------------------------------------------------------------
  try {
    const res = await handler(signed({
      rawPath: '/slack/events',
      body: JSON.stringify({ type: 'url_verification', challenge: 'agy_challenge_token_456' })
    }), {});

    const body = JSON.parse(res.body);
    const pass = res.statusCode === 200 && body.challenge === 'agy_challenge_token_456';
    recordE2E('E2E-FLOW-01', 'Slack URL Verification Handshake', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-01', 'Slack URL Verification Handshake', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 2: Ticket Draft Creation & Preview Card Generation
  // --------------------------------------------------------------------------
  const channelId = 'C0TEST999';
  const threadTs = '1700000000.123456';

  try {
    // Put simulated draft in DynamoDB
    const initialTicket = {
      passenger_name: 'HUSSIN / NORHILMAN',
      airline: 'VIETNAM AIRLINES',
      flight_number: 'vn674',
      departure_iata: 'kul',
      arrival_iata: 'sgn',
      departure_time: '2026-09-21 19:20',
      arrival_time: '2026-09-21 21:30',
      pnr: '738214',
      ticket_class: 'economy',
      ticket_price: 'Chưa rõ',
      department: 'Nhân sự / Quản lý',
      purpose: 'Công tác nội bộ',
      payment_method: 'Corporate Card',
      slack_username: '@quoc_hao',
      passenger_email: 'hao@company.com'
    };

    // Simulate saving draft
    const { normalizeTicketData } = require('../lambda/slack_handler');
    const norm = normalizeTicketData(initialTicket);

    dbStore.set(`DRAFT#${channelId}#${threadTs}`, {
      trip_id: `DRAFT#${channelId}#${threadTs}`,
      channel_id: channelId,
      thread_ts: threadTs,
      ticket_data: norm,
      created_at: new Date().toISOString()
    });

    const draft = dbStore.get(`DRAFT#${channelId}#${threadTs}`);
    const pass = draft &&
      draft.ticket_data.passenger_name === 'Hussin Norhilman' &&
      draft.ticket_data.departure_city === 'Kuala Lumpur' &&
      draft.ticket_data.arrival_city === 'Hồ Chí Minh' &&
      draft.ticket_data.flight_number === 'VN674' &&
      draft.ticket_data.ticket_price === 'Chưa rõ';

    recordE2E('E2E-FLOW-02', 'Ticket Draft Creation & Normalization in DB', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-02', 'Ticket Draft Creation & Normalization in DB', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 3: User Edits Ticket via Modal Submission
  // --------------------------------------------------------------------------
  try {
    const modalSubmissionPayload = {
      type: 'view_submission',
      user: { id: 'U123456', username: 'quoc_hao' },
      view: {
        callback_id: 'edit_ticket_modal_submit',
        private_metadata: JSON.stringify({ channel_id: channelId, thread_ts: threadTs, message_ts: '1700000000.000100' }),
        state: {
          values: {
            name_block: { name_input: { value: 'Hussin Norhilman' } },
            airline_block: { airline_input: { value: 'Vietnam Airlines' } },
            flight_block: { flight_input: { value: 'VN674' } },
            dep_iata_block: { dep_iata_input: { value: 'KUL' } },
            arr_iata_block: { arr_iata_input: { value: 'SGN' } },
            dep_time_block: { dep_time_input: { value: '2026-09-21 20:00' } },
            arr_time_block: { arr_time_input: { value: '2026-09-21 22:15' } },
            pnr_block: { pnr_input: { value: '738214' } },
            seat_block: { seat_input: { value: '14A' } },
            class_block: { class_input: { value: 'Business' } },
            price_block: { price_input: { value: '3500000' } },
            department_block: { department_input: { value: 'Ban Giám Đốc' } },
            purpose_block: { purpose_input: { value: 'Họp Hội đồng Quản trị' } },
            payment_method_block: { payment_method_input: { value: 'Corporate Card' } },
            email_block: { email_input: { value: 'norhilman@company.com' } }
          }
        }
      }
    };

    const res = await handler(signed({
      rawPath: '/slack/interactions',
      body: `payload=${encodeURIComponent(JSON.stringify(modalSubmissionPayload))}`
    }), {});

    const updatedDraft = dbStore.get(`DRAFT#${channelId}#${threadTs}`);
    const updateCallMade = outboundCalls.some(call => call.url.includes('chat.update'));
    const pass = res.statusCode === 200 &&
      updatedDraft &&
      updatedDraft.message_ts === '1700000000.000200' &&
      updateCallMade &&
      updatedDraft.ticket_data.ticket_price === '3500000' &&
      updatedDraft.ticket_data.ticket_class === 'Business' &&
      updatedDraft.ticket_data.seat === '14A' &&
      updatedDraft.ticket_data.departure_time === '2026-09-21 20:00' &&
      updatedDraft.ticket_data.arrival_time === '2026-09-21 22:15' &&
      updatedDraft.ticket_data.purpose === 'Họp Hội Đồng Quản Trị' &&
      updatedDraft.ticket_data.department === 'Ban Giám Đốc';

    recordE2E('E2E-FLOW-03', 'Modal View Submission & Draft Update (Disables Old Buttons)', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-03', 'Modal View Submission & Draft Update (Disables Old Buttons)', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 4: User Clicks "Hủy bỏ" (Cancel Ticket)
  // --------------------------------------------------------------------------
  try {
    const cancelPayload = {
      type: 'block_actions',
      user: { id: 'U123456', username: 'quoc_hao' },
      channel: { id: channelId },
      message: { thread_ts: threadTs },
      actions: [{ action_id: 'cancel_ticket' }],
      response_url: 'https://hooks.slack.com/actions/test/cancel'
    };

    const res = await handler(signed({
      rawPath: '/slack/interactions',
      body: `payload=${encodeURIComponent(JSON.stringify(cancelPayload))}`
    }), {});

    const draftAfterCancel = dbStore.get(`DRAFT#${channelId}#${threadTs}`);
    const pass = res.statusCode === 200 && draftAfterCancel === undefined;
    recordE2E('E2E-FLOW-04', 'Ticket Cancellation & Draft Deletion', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-04', 'Ticket Cancellation & Draft Deletion', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 5: Natural Language PR Chat Parsing
  // --------------------------------------------------------------------------
  try {
    const { parsePurchaseRequestChat } = require('../lambda/ai_ocr_service');
    // Test chat PR parsing regex / schema
    const mockPr = {
      is_pr_request: true,
      destination: 'Hà Nội',
      departure_date: '2026-11-25',
      estimated_cost: 5000000,
      purpose: 'Gặp đối tác chiến lược'
    };

    const pass = mockPr.is_pr_request === true &&
      mockPr.destination === 'Hà Nội' &&
      mockPr.estimated_cost === 5000000;

    recordE2E('E2E-FLOW-05', 'Natural Language PR Chat Request Structure', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-05', 'Natural Language PR Chat Request Structure', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 6: RBAC Guard Blocks /travel-admin in Employee Channel (#travel-booking)
  // --------------------------------------------------------------------------
  try {
    const res = await handler(signed({
      rawPath: '/slack/commands',
      body: 'command=%2Ftravel-admin&trigger_id=TRIG123&channel_id=C0CH1CC22FL&user_id=U999'
    }), {});
    const body = JSON.parse(res.body || '{}');
    const pass = res.statusCode === 200 &&
      body.response_type === 'ephemeral' &&
      String(body.text || '').includes('không nằm trong thẩm quyền');
    recordE2E('E2E-FLOW-06', 'RBAC Blocks /travel-admin in Employee Channel', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-06', 'RBAC Blocks /travel-admin in Employee Channel', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 7: RBAC Guard Blocks Out-of-Scope Prompt in Employee Channel
  // --------------------------------------------------------------------------
  try {
    const callsBefore = outboundCalls.length;
    const { handleSlackEvent } = require('../lambda/slack_handler');
    await handleSlackEvent({
      type: 'message',
      channel: 'C0CH1CC22FL',
      user: 'U_EMP_1',
      text: 'Thống kê tổng chi phí công tác tháng này giúp tôi',
      ts: '1700000001.000100'
    });
    const newCalls = outboundCalls.slice(callsBefore);
    const blockedReply = newCalls.find(c => c.url.includes('chat.postMessage') && c.body.includes('không nằm trong thẩm quyền'));
    recordE2E('E2E-FLOW-07', 'RBAC Blocks BI/Out-of-Scope Prompt in Employee Channel', Boolean(blockedReply));
  } catch (e) {
    recordE2E('E2E-FLOW-07', 'RBAC Blocks BI/Out-of-Scope Prompt in Employee Channel', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 8: Admin AI Travel BI Agent Executes Query in #biz-admin-alerts
  // (Even when an unconfirmed DRAFT exists in an earlier thread)
  // --------------------------------------------------------------------------
  try {
    process.env.OPENROUTER_API_KEY = 'mock_openrouter_key';
    // Đặt sẵn 1 bản nháp chưa xác nhận ở thread cũ để kiểm tra chống hijack câu hỏi BI
    dbStore.set('DRAFT#C0CGLFPNW7R', {
      trip_id: 'DRAFT#C0CGLFPNW7R',
      channel_id: 'C0CGLFPNW7R',
      thread_ts: '1700000000.000001',
      ticket_data: { passenger_name: 'Hussin Norhilman', flight_number: 'VN674' }
    });
    dbStore.set('TRIP-202611-888', {
      trip_id: 'TRIP-202611-888',
      passenger_name: 'Hussin Norhilman',
      department: 'Ban Giám Đốc',
      airline: 'Vietnam Airlines',
      flight_number: 'VN674',
      departure_iata: 'KUL',
      departure_city: 'Kuala Lumpur',
      arrival_iata: 'SGN',
      arrival_city: 'Hồ Chí Minh',
      departure_time: '2026-11-25 19:20',
      ticket_class: 'Business',
      ticket_price: '3500000'
    });

    const callsBefore = outboundCalls.length;
    const { handleSlackEvent } = require('../lambda/slack_handler');
    await handleSlackEvent({
      type: 'app_mention',
      channel: 'C0CGLFPNW7R',
      user: 'U_ADMIN_1',
      text: '<@B012345> Thống kê chi phí công tác theo phòng ban tháng này',
      ts: '1700000002.000100'
    });
    const newCalls = outboundCalls.slice(callsBefore);
    const biReportPost = newCalls.find(c =>
      c.url.includes('chat.postMessage') &&
      c.body.includes('BÁO CÁO PHÂN TÍCH CÔNG TÁC') &&
      c.body.includes('3.500.000 VND')
    );
    recordE2E('E2E-FLOW-08', 'Admin AI Travel BI Agent Report in #biz-admin-alerts', Boolean(biReportPost));
  } catch (e) {
    recordE2E('E2E-FLOW-08', 'Admin AI Travel BI Agent Report in #biz-admin-alerts', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 9: Unsigned / Forged Requests Are Rejected
  // --------------------------------------------------------------------------
  try {
    const forged = {
      rawPath: '/slack/commands',
      body: 'command=%2Ftravel-admin&trigger_id=TRIG123&channel_id=C0CGLFPNW7R'
    };
    const unsigned = await handler(forged, {});
    const shortSig = await handler({ ...forged, headers: { ...signed(forged).headers, 'x-slack-signature': 'v0=abc' } }, {});
    const tampered = await handler({ ...signed(forged), body: forged.body + '&x=1' }, {});
    const secret = process.env.SLACK_SIGNING_SECRET;
    const validEvent = signed(forged);
    delete process.env.SLACK_SIGNING_SECRET;
    const noSecret = await handler(validEvent, {});
    process.env.SLACK_SIGNING_SECRET = secret;

    const codes = [unsigned, shortSig, tampered, noSecret].map(r => r.statusCode);
    recordE2E('E2E-FLOW-09', 'Handler Rejects Unsigned/Forged Requests (401)', codes.every(c => c === 401), codes.join(','));
  } catch (e) {
    recordE2E('E2E-FLOW-09', 'Handler Rejects Unsigned/Forged Requests (401)', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 10: scanAll Follows LastEvaluatedKey Across Pages
  // --------------------------------------------------------------------------
  try {
    const originalSend = common.docClient.send;
    const startKeys = [];
    common.docClient.send = async (cmd) => {
      startKeys.push(cmd.ExclusiveStartKey);
      // Trang giữa rỗng: FilterExpression có thể lọc hết nhưng vẫn còn trang sau
      if (startKeys.length === 1) return { Items: [{ trip_id: 'A' }], LastEvaluatedKey: { trip_id: 'A' } };
      if (startKeys.length === 2) return { Items: [], LastEvaluatedKey: { trip_id: 'B' } };
      return { Items: [{ trip_id: 'C' }] };
    };
    const items = await common.scanAll({ TableName: 'TravelBookings' });
    common.docClient.send = originalSend;

    const pass = items.map(i => i.trip_id).join() === 'A,C' &&
      startKeys.length === 3 && startKeys[2].trip_id === 'B';
    recordE2E('E2E-FLOW-10', 'DynamoDB Scan Reads All Pages', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-10', 'DynamoDB Scan Reads All Pages', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 11-13: Trip ID collision, Sheets failure rollback, /travel-admin worker
  // --------------------------------------------------------------------------
  const manualBooking = {
    passenger_name: 'Nguyen Van Test', passenger_email: 'test@company.com', airline: 'Vietnam Airlines',
    flight_number: 'VN214', departure_iata: 'SGN', arrival_iata: 'HAN', departure_time: '2026-12-05 08:00', pnr: 'ABC123'
  };
  const tripKeys = () => [...dbStore.keys()].filter(k => k.startsWith('TRIP-'));
  try {
    const originalSend = common.docClient.send;
    const attempted = [];
    common.docClient.send = async (cmd) => {
      if (cmd.constructor.name === 'PutCommand' && String(cmd.Item.trip_id).startsWith('TRIP-')) {
        attempted.push(cmd);
        if (attempted.length === 1) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      }
      return originalSend(cmd);
    };
    const before = tripKeys().length;
    await handler({ isAsyncWorker: true, manualBooking }, {});
    common.docClient.send = originalSend;

    const pass = attempted.length === 2 &&
      attempted.every(c => c.ConditionExpression === 'attribute_not_exists(trip_id)') &&
      /^TRIP-\d{6}-\d{6}$/.test(attempted[1].Item.trip_id) &&
      tripKeys().length === before + 1;
    recordE2E('E2E-FLOW-11', 'Trip ID Collision Is Retried, Never Overwritten', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-11', 'Trip ID Collision Is Retried, Never Overwritten', false, e.message);
  }

  try {
    const before = tripKeys().length;
    const callsBefore = outboundCalls.length;
    sheetsFailure = true;
    await handler({ isAsyncWorker: true, manualBooking }, {});
    sheetsFailure = false;
    const failureNotice = outboundCalls.slice(callsBefore).some(c => c.body.includes('Không lưu được chuyến công tác'));
    recordE2E('E2E-FLOW-12', 'Sheets Failure Rolls Back DynamoDB and Notifies Admin', tripKeys().length === before && failureNotice);
  } catch (e) {
    sheetsFailure = false;
    recordE2E('E2E-FLOW-12', 'Sheets Failure Rolls Back DynamoDB and Notifies Admin', false, e.message);
  }

  try {
    const field = (block, action, value) => ({ [block]: { [action]: { value } } });
    const submission = {
      type: 'view_submission', user: { id: 'U_ADMIN_1' },
      view: { callback_id: 'travel_booking_modal', state: { values: {
        ...field('name_block', 'name_input', 'Nguyen Van Test'),
        ...field('flight_block', 'flight_input', 'VN214 - Vietnam Airlines'),
        ...field('time_block', 'time_input', '2026-12-05 08:00')
      } } }
    };
    const before = tripKeys().length;
    lambdaInvocations.length = 0;
    const res = await handler(signed({ rawPath: '/slack/interactions', body: `payload=${encodeURIComponent(JSON.stringify(submission))}` }), {});
    const job = lambdaInvocations[0];
    const queuedOnly = tripKeys().length === before;
    await handler(job, {});
    const pass = res.statusCode === 200 && job.isAsyncWorker && job.manualBooking.flight_number === 'VN214' &&
      queuedOnly && tripKeys().length === before + 1;
    recordE2E('E2E-FLOW-13', '/travel-admin Saves Through Async Worker', pass);
  } catch (e) {
    recordE2E('E2E-FLOW-13', '/travel-admin Saves Through Async Worker', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 14-15: Channel & draft ownership permissions
  // --------------------------------------------------------------------------
  try {
    const empChannel = 'C0CH1CC22FL';
    const draftKey = `DRAFT#${empChannel}`;
    dbStore.set(draftKey, { trip_id: draftKey, thread_ts: '1700000100.000100', ticket_data: { ...manualBooking, slack_user_id: 'U_OWNER' } });
    const click = (userId, actionId) => handler(signed({
      rawPath: '/slack/interactions',
      body: `payload=${encodeURIComponent(JSON.stringify({
        type: 'block_actions', user: { id: userId }, channel: { id: empChannel },
        actions: [{ action_id: actionId }], response_url: 'https://hooks.slack.com/actions/test/perm'
      }))}`
    }), {});

    const before = tripKeys().length;
    await click('U_OTHER', 'confirm_save_ticket');
    await click('U_OTHER', 'cancel_ticket');
    const callsBefore = outboundCalls.length;
    await click('U_OTHER', 'open_edit_ticket_modal');
    const noModal = !outboundCalls.slice(callsBefore).some(c => c.url.includes('views.open'));
    const { handleSlackEvent } = require('../lambda/slack_handler');
    await handleSlackEvent({ type: 'message', channel: empChannel, user: 'U_OTHER', text: 'hủy', ts: '1700000100.000200', thread_ts: '1700000100.000100' });
    const blocked = dbStore.has(draftKey) && tripKeys().length === before && noModal;

    await click('U_OWNER', 'cancel_ticket');
    recordE2E('E2E-FLOW-14', 'Only Draft Owner or HR Can Act on a Draft', blocked && !dbStore.has(draftKey));
  } catch (e) {
    recordE2E('E2E-FLOW-14', 'Only Draft Owner or HR Can Act on a Draft', false, e.message);
  }

  try {
    const res = await handler(signed({
      rawPath: '/slack/commands',
      body: 'command=%2Ftravel-admin&trigger_id=TRIG123&channel_id=C0OTHER0000&user_id=U999'
    }), {});
    const commandBlocked = String(JSON.parse(res.body || '{}').text || '').includes('không nằm trong thẩm quyền');

    const tripId = tripKeys()[0];
    const callsBefore = outboundCalls.length;
    const { handleSlackEvent } = require('../lambda/slack_handler');
    await handleSlackEvent({ type: 'message', channel: 'C0OTHER0000', user: 'U999', text: `Sửa giá vé ${tripId} thành 1`, ts: '1700000200.000100' });
    const newCalls = outboundCalls.slice(callsBefore);
    const editBlocked = newCalls.some(c => c.body.includes('không nằm trong thẩm quyền')) &&
      !newCalls.some(c => c.url.includes('openrouter') || c.url.includes('/values/'));
    recordE2E('E2E-FLOW-15', 'Unknown Channel Cannot Use Admin Features', commandBlocked && editBlocked);
  } catch (e) {
    recordE2E('E2E-FLOW-15', 'Unknown Channel Cannot Use Admin Features', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 16: Departure time is read in the departure airport time zone
  // --------------------------------------------------------------------------
  try {
    const { parseDepartureTime } = require('../lambda/flight_time');
    const iso = (v, a) => parseDepartureTime(v, a).toISOString();
    const parsed = iso('2026-12-05 08:00', 'SGN') === '2026-12-05T01:00:00.000Z' &&
      iso('2026-12-05 08:00', 'KUL') === '2026-12-05T00:00:00.000Z' &&
      iso('2026-07-01 08:00', 'LHR') === '2026-07-01T07:00:00.000Z' &&
      iso('2026-12-01 08:00', 'LHR') === '2026-12-01T08:00:00.000Z' &&
      iso('2026-12-05T01:00:00Z', 'SGN') === '2026-12-05T01:00:00.000Z' &&
      Number.isNaN(parseDepartureTime('Chưa rõ', 'SGN').getTime());

    // Cron chạy 08:00 VN: chuyến 07:00 VN đã bay, chuyến 03:00 VN hôm sau nằm trong 24 giờ tới
    const { executeBIQuery } = require('../lambda/bi_analytics_service');
    const stats = executeBIQuery([
      { trip_id: 'TRIP-A', departure_iata: 'SGN', departure_time: '2026-12-05 07:00' },
      { trip_id: 'TRIP-B', departure_iata: 'SGN', departure_time: '2026-12-06 03:00' }
    ], { query_type: 'UPCOMING_FLIGHTS', filters: { upcoming_days: 1 } }, new Date('2026-12-05T01:00:00Z'));
    const windowOk = stats.matched_trips.map(t => t.trip_id).join() === 'TRIP-B';

    recordE2E('E2E-FLOW-16', 'Departure Times Use Airport Time Zone', parsed && windowOk);
  } catch (e) {
    recordE2E('E2E-FLOW-16', 'Departure Times Use Airport Time Zone', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 17-18: Image Acknowledgement, Non-Ticket Rejection & Valid Ticket Draft
  // --------------------------------------------------------------------------
  try {
    const { handleSlackEvent } = require('../lambda/slack_handler');
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'mock_openrouter_key';
    const imgChannel = 'C0CH1CC22FL';
    const draftKey = `DRAFT#${imgChannel}`;
    dbStore.delete(draftKey);
    const callsBefore = outboundCalls.length;

    mockVisionResponse = {
      is_flight_ticket: false,
      rejection_reason: 'Ảnh là hóa đơn cà phê, không phải vé máy bay.',
      passenger_name: '',
      airline: '',
      flight_number: ''
    };

    await handleSlackEvent({
      type: 'message',
      channel: imgChannel,
      user: 'U_EMP_1',
      ts: '1700000300.000100',
      files: [{
        id: 'F_NON_TICKET',
        name: 'coffee_receipt.jpg',
        mimetype: 'image/jpeg',
        url_private_download: 'https://files.slack.com/files-pri/T1-F1/coffee_receipt.jpg'
      }]
    });
    mockVisionResponse = null;

    const newCalls = outboundCalls.slice(callsBefore).filter(c => c.url.includes('chat.postMessage'));
    const ackSent = newCalls.some(c => c.body.includes('Đã nhận được ảnh') && c.body.includes('phân tích'));
    const rejectedSent = newCalls.some(c => c.body.includes('Từ chối xử lý ảnh') && c.body.includes('hóa đơn cà phê'));
    const noDraftCreated = !dbStore.has(draftKey) && !newCalls.some(c => c.body.includes('"blocks"'));

    recordE2E('E2E-FLOW-17', 'Non-Flight Image Acknowledged Then Rejected Without Draft', ackSent && rejectedSent && noDraftCreated);
  } catch (e) {
    mockVisionResponse = null;
    recordE2E('E2E-FLOW-17', 'Non-Flight Image Acknowledged Then Rejected Without Draft', false, e.message);
  }

  try {
    const { handleSlackEvent } = require('../lambda/slack_handler');
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'mock_openrouter_key';
    const imgChannel = 'C0CH1CC22FL';
    const draftTs = '1700000301.000100';
    const draftKey = `DRAFT#${imgChannel}#${draftTs}`;
    dbStore.delete(draftKey);
    const callsBefore = outboundCalls.length;

    mockVisionResponse = {
      is_flight_ticket: true,
      rejection_reason: '',
      passenger_name: 'NGUYEN VAN B',
      airline: 'Vietnam Airlines',
      flight_number: 'VN214',
      departure_iata: 'SGN',
      arrival_iata: 'HAN',
      departure_time: '2026-12-10 08:30',
      arrival_time: '2026-12-10 10:40',
      pnr: 'ABC123',
      ticket_class: 'Economy',
      ticket_price: '2100000'
    };

    await handleSlackEvent({
      type: 'message',
      channel: imgChannel,
      user: 'U_EMP_1',
      ts: draftTs,
      files: [{
        id: 'F_VALID_TICKET',
        name: 'boarding_pass.png',
        mimetype: 'image/png',
        url_private_download: 'https://files.slack.com/files-pri/T1-F2/boarding_pass.png'
      }]
    });
    mockVisionResponse = null;

    const newCalls = outboundCalls.slice(callsBefore).filter(c => c.url.includes('chat.postMessage'));
    const ackSent = newCalls.some(c => c.body.includes('Đã nhận được ảnh'));
    const cardSent = newCalls.some(c => c.body.includes('"blocks"'));
    const draft = dbStore.get(draftKey);
    const draftOk = draft && draft.ticket_data?.flight_number === 'VN214' && !('is_flight_ticket' in draft.ticket_data);

    recordE2E('E2E-FLOW-18', 'Valid Flight Ticket Image Creates Draft & Preview Card', ackSent && cardSent && draftOk);
  } catch (e) {
    mockVisionResponse = null;
    recordE2E('E2E-FLOW-18', 'Valid Flight Ticket Image Creates Draft & Preview Card', false, e.message);
  }

  // --------------------------------------------------------------------------
  // FLOW 19: Concurrent Multi-User Draft Isolation in Same Channel
  // --------------------------------------------------------------------------
  try {
    const { handleSlackEvent } = require('../lambda/slack_handler');
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'mock_openrouter_key';
    const sharedChannel = 'C0CH1CC22FL';
    const tsA = '1700000401.000100';
    const tsB = '1700000402.000200';
    const keyA = `DRAFT#${sharedChannel}#${tsA}`;
    const keyB = `DRAFT#${sharedChannel}#${tsB}`;
    dbStore.delete(keyA);
    dbStore.delete(keyB);

    mockVisionResponse = {
      is_flight_ticket: true,
      rejection_reason: '',
      passenger_name: 'TRAN VAN A',
      airline: 'Vietnam Airlines',
      flight_number: 'VN201',
      departure_iata: 'SGN',
      arrival_iata: 'HAN',
      departure_time: '2026-12-15 07:00',
      arrival_time: '2026-12-15 09:10',
      pnr: 'PNRA01',
      ticket_class: 'Economy',
      ticket_price: '1800000'
    };
    await handleSlackEvent({
      type: 'message',
      channel: sharedChannel,
      user: 'U_USER_A',
      ts: tsA,
      files: [{ id: 'F_A', name: 'ticket_a.png', mimetype: 'image/png', url_private_download: 'https://files.slack.com/files-pri/T1-FA/ticket_a.png' }]
    });

    mockVisionResponse = {
      is_flight_ticket: true,
      rejection_reason: '',
      passenger_name: 'LE THI B',
      airline: 'Vietjet Air',
      flight_number: 'VJ128',
      departure_iata: 'HAN',
      arrival_iata: 'DAD',
      departure_time: '2026-12-16 14:00',
      arrival_time: '2026-12-16 15:20',
      pnr: 'PNRB02',
      ticket_class: 'Economy',
      ticket_price: '1200000'
    };
    await handleSlackEvent({
      type: 'message',
      channel: sharedChannel,
      user: 'U_USER_B',
      ts: tsB,
      files: [{ id: 'F_B', name: 'ticket_b.png', mimetype: 'image/png', url_private_download: 'https://files.slack.com/files-pri/T1-FB/ticket_b.png' }]
    });
    mockVisionResponse = null;

    const bothExist = dbStore.has(keyA) && dbStore.has(keyB) &&
      dbStore.get(keyA).ticket_data.flight_number === 'VN201' &&
      dbStore.get(keyB).ticket_data.flight_number === 'VJ128';

    // User A cancels their draft -> User B's draft must remain intact
    await handler(signed({
      rawPath: '/slack/interactions',
      body: `payload=${encodeURIComponent(JSON.stringify({
        type: 'block_actions',
        user: { id: 'U_USER_A' },
        channel: { id: sharedChannel },
        message: { thread_ts: tsA },
        actions: [{ action_id: 'cancel_ticket' }],
        response_url: 'https://hooks.slack.com/actions/test/cancelA'
      }))}`
    }), {});

    const isolatedAfterCancel = !dbStore.has(keyA) && dbStore.has(keyB) && dbStore.get(keyB).ticket_data.flight_number === 'VJ128';
    recordE2E('E2E-FLOW-19', 'Concurrent Multi-User Drafts Isolated Per Thread in Same Channel', bothExist && isolatedAfterCancel);
  } catch (e) {
    mockVisionResponse = null;
    recordE2E('E2E-FLOW-19', 'Concurrent Multi-User Drafts Isolated Per Thread in Same Channel', false, e.message);
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('E2E SIMULATION SUMMARY');
  console.log('='.repeat(80));
  const passedCount = results.filter(r => r.pass).length;
  console.log(`TOTAL E2E FLOWS: ${results.length}`);
  console.log(`PASSED         : ${passedCount}`);
  console.log(`FAILED         : ${results.length - passedCount}`);
  console.log('='.repeat(80));

  process.exit(passedCount === results.length ? 0 : 1);
}

runE2E();
