/**
 * AWS Lambda Handler for Slack Webhooks (Events, Commands, Interactions)
 * Triggered by AWS API Gateway HTTP API
 */
const crypto = require('crypto');
const {
  extractTicketFromBase64,
  parsePurchaseRequestChat,
  applyConversationalCorrection,
  parseEditSavedTripRequest
} = require('./ai_ocr_service');
const {
  docClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
  makeRequest,
  getGoogleAccessToken,
  downloadSlackFile,
  getSlackFileInfo,
  getRecentChannelFiles,
  postSlackMessage,
  invokeLambdaAsync
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

// Cập nhật thông tin chuyến đi đã lưu trên cả Google Sheets và DynamoDB
async function updateGoogleSheetAndDynamoTrip(tripId, updatedFields, explanation = '') {
  const accessToken = await getGoogleAccessToken();

  // 1. Đọc sheet tìm rowIndex
  const sheetRes = await makeRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A:W`,
    {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  );

  const rows = sheetRes.data?.values || [];
  let rowIndex = -1;
  let currentRow = null;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toString().trim().toUpperCase() === tripId.toUpperCase()) {
      rowIndex = i + 1; // 1-based index in Google Sheets
      currentRow = [...rows[i]];
      break;
    }
  }

  if (rowIndex === -1 || !currentRow) {
    throw new Error(`Không tìm thấy mã chuyến đi ${tripId} trong Google Sheets tab ${TAB_NAME}`);
  }

  while (currentRow.length < 23) {
    currentRow.push('');
  }

  // Cập nhật các trường tương ứng theo cột
  if (updatedFields.passenger_name) currentRow[3] = updatedFields.passenger_name;
  if (updatedFields.passenger_email) currentRow[5] = updatedFields.passenger_email;
  if (updatedFields.airline) currentRow[7] = updatedFields.airline;
  if (updatedFields.flight_number) currentRow[8] = updatedFields.flight_number;
  if (updatedFields.departure_city) currentRow[9] = updatedFields.departure_city;
  if (updatedFields.departure_iata) currentRow[10] = updatedFields.departure_iata.toUpperCase();
  if (updatedFields.arrival_city) currentRow[11] = updatedFields.arrival_city;
  if (updatedFields.arrival_iata) currentRow[12] = updatedFields.arrival_iata.toUpperCase();
  if (updatedFields.departure_time) currentRow[13] = updatedFields.departure_time;
  if (updatedFields.arrival_time) currentRow[14] = updatedFields.arrival_time;
  if (updatedFields.pnr) currentRow[15] = updatedFields.pnr.toUpperCase();
  if (updatedFields.ticket_class) currentRow[16] = updatedFields.ticket_class;
  if (updatedFields.ticket_price !== undefined) currentRow[17] = String(updatedFields.ticket_price);
  if (updatedFields.purpose) currentRow[19] = updatedFields.purpose;

  currentRow[21] = 'VALID';
  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
  currentRow[22] = `[AI UPDATE ${nowIso}] ${explanation || 'Đã sửa qua Slack'}`;

  // Ghi đè vào dòng trong Google Sheets
  await makeRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A${rowIndex}:W${rowIndex}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    },
    { values: [currentRow] }
  );

  // 2. Cập nhật DynamoDB
  const existingTripRes = await docClient.send(new GetCommand({
    TableName: DYNAMODB_TABLE,
    Key: { trip_id: tripId }
  }));
  const existingTrip = existingTripRes.Item || { trip_id: tripId };

  const mergedTrip = {
    ...existingTrip,
    ...updatedFields,
    trip_id: tripId,
    audit_status: 'VALID',
    last_synced_at: new Date().toISOString()
  };

  const hashString = `${tripId}|${mergedTrip.passenger_name || ''}|${mergedTrip.flight_number || ''}|${mergedTrip.departure_time || ''}`;
  mergedTrip.row_hash = crypto.createHash('sha256').update(hashString).digest('hex');

  await docClient.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: mergedTrip
  }));

  return { tripId, updatedFields, currentRow };
}

// Xây dựng giao diện thẻ xem trước kết quả bóc tách vé máy bay (Ticket Preview Card)
function buildTicketPreviewCard(channelId, threadTs, ticketInfo, isUpdated = false) {
  const title = isUpdated
    ? "KẾT QUẢ ĐỌC VÉ MÁY BAY (ĐÃ CẬP NHẬT)"
    : "KẾT QUẢ ĐỌC VÉ MÁY BAY";

  const introText = isUpdated
    ? "Thông tin vé máy bay sau khi chỉnh sửa:"
    : "Thông tin bóc tách từ vé máy bay:";

  const priceDisplay = ticketInfo.ticket_price && ticketInfo.ticket_price !== '0'
    ? `${Number(ticketInfo.ticket_price).toLocaleString('vi-VN')} VND`
    : (ticketInfo.ticket_number ? `Số vé: ${ticketInfo.ticket_number}` : 'Đã xuất vé (Boarding Pass)');

  return {
    channel: channelId,
    thread_ts: threadTs,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: title, emoji: false }
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: introText }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Hành khách:*\n${ticketInfo.passenger_name || 'N/A'}` },
          { type: "mrkdwn", text: `*Hãng hàng không:*\n${ticketInfo.airline || 'Vietnam Airlines'}` },
          { type: "mrkdwn", text: `*Số hiệu chuyến bay:*\n${ticketInfo.flight_number || 'N/A'}` },
          { type: "mrkdwn", text: `*Mã đặt chỗ (PNR):*\n${ticketInfo.pnr || 'N/A'}` },
          { type: "mrkdwn", text: `*Lộ trình:*\n${ticketInfo.departure_iata || 'HAN'}${ticketInfo.departure_city ? ` (${ticketInfo.departure_city})` : ''} ➔ ${ticketInfo.arrival_iata || 'VCA'}${ticketInfo.arrival_city ? ` (${ticketInfo.arrival_city})` : ''}` },
          { type: "mrkdwn", text: `*Giờ cất cánh:*\n${ticketInfo.departure_time || 'N/A'}` },
          { type: "mrkdwn", text: `*Hạng vé / Ghế:*\n${ticketInfo.ticket_class || 'Economy'}${ticketInfo.seat ? ` (Ghế ${ticketInfo.seat})` : ''}` },
          { type: "mrkdwn", text: `*Chi phí / Số vé:*\n${priceDisplay}` }
        ]
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Xác nhận", emoji: false },
            style: "primary",
            action_id: "confirm_save_ticket",
            value: JSON.stringify(ticketInfo)
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Chỉnh sửa", emoji: false },
            action_id: "open_edit_ticket_modal",
            value: JSON.stringify(ticketInfo)
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Hủy bỏ", emoji: false },
            style: "danger",
            action_id: "cancel_ticket"
          }
        ]
      }
    ]
  };
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

  // Slack API không gửi kèm `files` trong payload `app_mention`!
  // Do đó, nếu rawFiles rỗng, ta chủ động lấy file ảnh vừa tải lên trong channel
  if (rawFiles.length === 0 && channelId) {
    try {
      const recent = await getRecentChannelFiles(channelId, event.user);
      if (recent && recent.length > 0) {
        rawFiles = recent;
      }
    } catch (e) {
      console.error('Error fetching recent files:', e);
    }
  }

  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.heic'];
  const isImageFile = (f) => {
    if (f.mimetype && f.mimetype.startsWith('image/')) return true;
    if (f.filetype && ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(String(f.filetype).toLowerCase())) return true;
    if (f.name && imageExtensions.some(ext => String(f.name).toLowerCase().endsWith(ext))) return true;
    return false;
  };

  const imageFiles = rawFiles.filter(isImageFile);

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 1: Có ảnh vé máy bay đính kèm -> Quét OCR & Hỏi xác nhận
  // -------------------------------------------------------------
  if (imageFiles.length > 0) {
    let file = imageFiles[0];

    // Phản hồi tức thì không dùng icon AI
    await postSlackMessage(channelId, {
      channel: channelId,
      thread_ts: threadTs,
      text: "Đã nhận được ảnh vé máy bay. Đang tiến hành xử lý thông tin..."
    });

    try {
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

      // Lưu bản nháp (Draft) vào DynamoDB để hỗ trợ chỉnh sửa
      await docClient.send(new PutCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          trip_id: `DRAFT#${channelId}`,
          channel_id: channelId,
          thread_ts: threadTs,
          ticket_data: ticketInfo,
          created_at: new Date().toISOString()
        }
      }));

      // Gửi thẻ xem trước
      const card = buildTicketPreviewCard(channelId, threadTs, ticketInfo, false);
      await postSlackMessage(channelId, card);
    } catch (err) {
      console.error('OCR Error:', err);
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: `Không thể đọc được ảnh vé này: ${err.message}. Vui lòng gửi lại ảnh rõ nét hơn.`
      });
    }
    return;
  }

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 2: Người dùng nhắn tin chỉnh sửa chuyến đi ĐÃ LƯU (Google Sheets & DynamoDB)
  // Nhận diện qua mã TRIP-YYYYMM-XXX hoặc từ khóa chỉnh sửa
  // -------------------------------------------------------------
  const tripIdMatch = userText.match(/TRIP-\d{6}-\d{3}/i);
  const isEditAction = /(sửa|đổi|chỉnh|cập nhật|update|thay đổi)/i.test(userText);

  if (tripIdMatch && isEditAction) {
    const tripId = tripIdMatch[0].toUpperCase();
    try {
      const existingTripRes = await docClient.send(new GetCommand({
        TableName: DYNAMODB_TABLE,
        Key: { trip_id: tripId }
      }));

      if (existingTripRes.Item) {
        await postSlackMessage(channelId, {
          channel: channelId,
          thread_ts: threadTs,
          text: `Đang xử lý cập nhật chuyến đi ${tripId}...`
        });

        const editAnalysis = await parseEditSavedTripRequest(userText, existingTripRes.Item);
        if (editAnalysis.is_edit_request && editAnalysis.updated_fields && Object.keys(editAnalysis.updated_fields).length > 0) {
          const result = await updateGoogleSheetAndDynamoTrip(tripId, editAnalysis.updated_fields, editAnalysis.explanation);

          const fieldLabels = {
            passenger_name: 'Họ và tên',
            airline: 'Hãng bay',
            flight_number: 'Số hiệu chuyến',
            departure_iata: 'Sân bay đi',
            arrival_iata: 'Sân bay đến',
            departure_time: 'Giờ cất cánh',
            arrival_time: 'Giờ hạ cánh',
            pnr: 'Mã đặt chỗ (PNR)',
            ticket_class: 'Hạng vé',
            ticket_price: 'Giá vé'
          };

          const changedList = Object.entries(editAnalysis.updated_fields)
            .map(([k, v]) => `• *${fieldLabels[k] || k}:* \`${v}\``)
            .join('\n');

          await postSlackMessage(channelId, {
            channel: channelId,
            thread_ts: threadTs,
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "CẬP NHẬT LỊCH TRÌNH THÀNH CÔNG", emoji: false }
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `Đã cập nhật chuyến \`${tripId}\` trên tab *${TAB_NAME}* và hệ thống:\n\n${changedList}\n\nChi tiết: ${editAnalysis.explanation || 'Đã chỉnh sửa theo yêu cầu.'}`
                }
              }
            ]
          });
          return;
        } else {
          await postSlackMessage(channelId, {
            channel: channelId,
            thread_ts: threadTs,
            text: `Chưa nhận diện rõ trường dữ liệu nào cần sửa cho chuyến \`${tripId}\`. Bạn có thể nhắn rõ hơn, ví dụ: 'Sửa giờ bay của ${tripId} thành 16:00' hoặc 'Đổi giá vé ${tripId} thành 2.500.000'.`
          });
          return;
        }
      }
    } catch (err) {
      console.error('Edit saved trip error:', err);
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: `Lỗi khi cập nhật chuyến đi ${tripId}: ${err.message}`
      });
      return;
    }
  }

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 3: Vòng lặp sửa bản nháp trước khi lưu (Pre-save Draft Loop)
  // Kiểm tra xem có vé nháp đang chờ xác nhận hay không
  // -------------------------------------------------------------
  let currentDraft = null;
  try {
    const draftRes = await docClient.send(new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { trip_id: `DRAFT#${channelId}` }
    }));
    if (draftRes.Item && draftRes.Item.ticket_data) {
      currentDraft = draftRes.Item;
    }
  } catch (e) {
    console.error('Error fetching draft:', e);
  }

  if (currentDraft && userText.length > 0) {
    // Nếu người dùng muốn hủy bản nháp
    if (/(hủy|huỷ|cancel|thôi|bỏ)/i.test(userText)) {
      await docClient.send(new DeleteCommand({
        TableName: DYNAMODB_TABLE,
        Key: { trip_id: `DRAFT#${channelId}` }
      }));
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: "Đã hủy bản nháp vé máy bay."
      });
      return;
    }

    // Nếu người dùng nhắn phản hồi chỉnh sửa thông tin vé
    await postSlackMessage(channelId, {
      channel: channelId,
      thread_ts: threadTs,
      text: "Đang cập nhật lại thông tin vé..."
    });

    try {
      const updatedTicketData = await applyConversationalCorrection(currentDraft.ticket_data, userText);

      // Lưu lại bản nháp mới vào DynamoDB
      await docClient.send(new PutCommand({
        TableName: DYNAMODB_TABLE,
        Item: {
          trip_id: `DRAFT#${channelId}`,
          channel_id: channelId,
          thread_ts: threadTs,
          ticket_data: updatedTicketData,
          created_at: new Date().toISOString()
        }
      }));

      // Gửi lại thẻ thông tin cập nhật
      const updatedCard = buildTicketPreviewCard(channelId, threadTs, updatedTicketData, true);
      await postSlackMessage(channelId, updatedCard);
      return;
    } catch (err) {
      console.error('Error applying correction:', err);
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: `Không thể cập nhật được thông tin: ${err.message}.`
      });
      return;
    }
  }

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 4: Người dùng tag bot nhắc đến vé nhưng chưa có ảnh
  // -------------------------------------------------------------
  const isTicketIntent = /(vé|ticket|boarding|pass|thêm vé|add vé|ảnh vé|scan|ocr|quét|lịch trình)/i.test(userText);
  if (isTicketIntent && imageFiles.length === 0) {
    await postSlackMessage(channelId, {
      channel: channelId,
      thread_ts: threadTs,
      text: "Bạn vừa gửi yêu cầu về vé máy bay nhưng chưa có ảnh đính kèm. Vui lòng gửi kèm ảnh vé máy bay/boarding pass để hệ thống xử lý, hoặc dùng lệnh /travel-admin để tạo thủ công."
    });
    return;
  }

  // -------------------------------------------------------------
  // TRƯỜNG HỢP 5: Natural Language PR Chat (Tạo đề xuất công tác)
  // -------------------------------------------------------------
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
              text: { type: "plain_text", text: "YÊU CẦU TẠO PURCHASE REQUEST (PR)", emoji: false }
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `Đã ghi nhận đề xuất công tác:` }
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Điểm đến:*\n${prData.destination || 'Chưa rõ'}` },
                { type: "mrkdwn", text: `*Ngày đi dự kiến:*\n${prData.departure_date || 'Chưa định ngày'}` },
                { type: "mrkdwn", text: `*Ngân sách dự trù:*\n${Number(prData.estimated_cost || 0).toLocaleString('vi-VN')} VND` },
                { type: "mrkdwn", text: `*Mục đích:*\n${prData.purpose || 'Công tác'}` }
              ]
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Gửi phê duyệt", emoji: false },
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

    // Fallback: Chào hỏi chung
    if (event.type === 'app_mention') {
      await postSlackMessage(channelId, {
        channel: channelId,
        thread_ts: threadTs,
        text: "Smart Travel Assistant - Trợ lý Quản lý Công tác.\n\nCác tính năng hỗ trợ:\n1. Gửi ảnh vé máy bay: Tự động trích xuất thông tin, cho phép kiểm tra, chỉnh sửa qua biểu mẫu và xác nhận lưu.\n2. Chỉnh sửa chuyến đi đã lưu: Nhắn tin yêu cầu (Ví dụ: Sửa giờ bay của TRIP-202611-824 thành 16:30).\n3. Dùng lệnh /travel-admin: Mở form đặt lịch công tác.\n4. Đề xuất công tác: Nhắn tin tự nhiên (Ví dụ: Đề xuất đi Hà Nội ngày 20/11 ngân sách 15 triệu)."
      });
      return;
    }
  }

  // Fallback: Nếu tag bot trống không kèm ảnh hoặc nội dung
  if (event.type === 'app_mention') {
    await postSlackMessage(channelId, {
      channel: channelId,
      thread_ts: threadTs,
      text: "Smart Travel Assistant - Trợ lý Quản lý Công tác.\n\nCác tính năng hỗ trợ:\n1. Gửi ảnh vé máy bay: Tự động trích xuất thông tin, cho phép kiểm tra, chỉnh sửa qua biểu mẫu và xác nhận lưu.\n2. Chỉnh sửa chuyến đi đã lưu: Nhắn tin yêu cầu (Ví dụ: Sửa giờ bay của TRIP-202611-824 thành 16:30).\n3. Dùng lệnh /travel-admin: Mở form đặt lịch công tác.\n4. Đề xuất công tác: Nhắn tin tự nhiên (Ví dụ: Đề xuất đi Hà Nội ngày 20/11 ngân sách 15 triệu)."
    });
  }
}

// Main Lambda Handler for API Gateway
exports.handler = async (event, context) => {
  // A. Nếu đây là async worker (được tự kích hoạt bất đồng bộ để xử lý công việc nặng)
  if (event.isAsyncWorker && event.slackEvent) {
    console.log('Running as async worker for Slack event:', event.slackEvent.type);
    await handleSlackEvent(event.slackEvent);
    return { statusCode: 200, body: 'OK' };
  }

  const headers = event.headers || {};
  // Nếu Slack gửi retry do HTTP timeout trước đó, trả về 200 ngay để tránh xử lý lặp
  if (headers['x-slack-retry-num'] || headers['X-Slack-Retry-Num']) {
    console.log('Slack retry detected, acknowledging immediately to prevent duplicate processing');
    return { statusCode: 200, body: 'OK' };
  }

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

    // B. Slack Event Callback -> Kích hoạt async worker xử lý nền ngay lập tức
    if (payload.type === 'event_callback') {
      try {
        const functionName = context.functionName || 'smart-travel-assistant-slack-handler';
        await invokeLambdaAsync(functionName, {
          isAsyncWorker: true,
          slackEvent: payload.event
        });
      } catch (err) {
        console.error('Async invoke error, falling back to direct handling:', err);
        await handleSlackEvent(payload.event);
      }
      // Phản hồi HTTP 200 OK cho Slack ngay lập tức (<100ms) để không bao giờ bị timeout 3s
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

      // A. Xử lý khi Submit Form Modal
      if (payload.type === 'view_submission') {
        const callbackId = payload.view?.callback_id;

        // 1. Submit modal Chỉnh sửa vé máy bay (Edit Ticket Modal)
        if (callbackId === 'edit_ticket_modal_submit') {
          const values = payload.view.state.values;
          const meta = JSON.parse(payload.view.private_metadata || '{}');
          const channelId = meta.channel_id;
          const threadTs = meta.thread_ts;

          const depIata = (values.dep_iata_block?.dep_iata_input?.value || '').trim().toUpperCase();
          const arrIata = (values.arr_iata_block?.arr_iata_input?.value || '').trim().toUpperCase();

          const cityMap = {
            'SGN': 'Hồ Chí Minh', 'HAN': 'Hà Nội', 'DAD': 'Đà Nẵng', 'VCA': 'Cần Thơ',
            'CXR': 'Nha Trang', 'PQC': 'Phú Quốc', 'HPH': 'Hải Phòng', 'VII': 'Vinh',
            'HUI': 'Huế', 'KUL': 'Kuala Lumpur', 'SIN': 'Singapore', 'BKK': 'Bangkok', 'NRT': 'Tokyo'
          };

          const priceRaw = values.price_block?.price_input?.value || '0';
          const cleanPrice = priceRaw.replace(/[^0-9]/g, '');

          const updatedTicket = {
            passenger_name: values.name_block?.name_input?.value || 'N/A',
            airline: values.airline_block?.airline_input?.value || 'Vietnam Airlines',
            flight_number: values.flight_block?.flight_input?.value || 'N/A',
            departure_iata: depIata,
            departure_city: cityMap[depIata] || depIata,
            arrival_iata: arrIata,
            arrival_city: cityMap[arrIata] || arrIata,
            departure_time: values.dep_time_block?.dep_time_input?.value || '',
            arrival_time: values.dep_time_block?.dep_time_input?.value || '',
            pnr: (values.pnr_block?.pnr_input?.value || '').trim().toUpperCase(),
            seat: values.seat_block?.seat_input?.value || '',
            ticket_class: values.class_block?.class_input?.value || 'Economy',
            ticket_price: cleanPrice || '0'
          };

          // Lưu bản nháp vào DynamoDB
          if (channelId) {
            await docClient.send(new PutCommand({
              TableName: DYNAMODB_TABLE,
              Item: {
                trip_id: `DRAFT#${channelId}`,
                channel_id: channelId,
                thread_ts: threadTs,
                ticket_data: updatedTicket,
                created_at: new Date().toISOString()
              }
            }));

            // Gửi thẻ xem trước đã cập nhật vào kênh
            const updatedCard = buildTicketPreviewCard(channelId, threadTs, updatedTicket, true);
            postSlackMessage(channelId, updatedCard).catch(console.error);
          }

          // Trả về đóng modal ngay lập tức
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response_action: 'clear' })
          };
        }

        // 2. Submit modal đặt lịch thủ công (/travel-admin)
        if (callbackId === 'travel_booking_modal') {
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

          const cityMap = { 'SGN': 'Hồ Chí Minh', 'HAN': 'Hà Nội', 'DAD': 'Đà Nẵng', 'NRT': 'Tokyo', 'SIN': 'Singapore', 'VCA': 'Cần Thơ' };
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

          saveTripRecord(tripData).then(({ tripId }) => {
            postSlackMessage(process.env.SLACK_ADMIN_CHANNEL_ID || 'C0CGLFPNW7R', {
              blocks: [
                {
                  type: "header",
                  text: { type: "plain_text", text: "ĐÃ TẠO CHUYẾN CÔNG TÁC MỚI", emoji: false }
                },
                {
                  type: "section",
                  fields: [
                    { type: "mrkdwn", text: `*Hành khách:*\n${passengerName}` },
                    { type: "mrkdwn", text: `*Chuyến bay:*\n${flightNum} (${airline})` },
                    { type: "mrkdwn", text: `*Lộ trình:*\n${tripData.departure_city} (${tripData.departure_iata}) ➔ ${tripData.arrival_city} (${tripData.arrival_iata})` },
                    { type: "mrkdwn", text: `*Giờ cất cánh:*\n${depTime}` },
                    { type: "mrkdwn", text: `*Trip ID:*\n\`${tripId}\`` },
                    { type: "mrkdwn", text: `*PNR:*\n\`${pnr}\`` }
                  ]
                }
              ]
            }).catch(console.error);
          }).catch(console.error);

          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response_action: 'clear' })
          };
        }
      }

      // B. Xử lý các nút bấm tương tác (Block Actions)
      if (payload.type === 'block_actions') {
        const action = payload.actions?.[0];
        const channelId = payload.channel?.id || payload.container?.channel_id;

        // B1. Người dùng bấm nút "Chỉnh sửa" -> Mở Modal Popup Form
        if (action?.action_id === 'open_edit_ticket_modal') {
          const triggerId = payload.trigger_id;
          const threadTs = payload.message?.thread_ts || payload.message?.ts;

          let ticketData = null;
          if (channelId) {
            try {
              const draftRes = await docClient.send(new GetCommand({
                TableName: DYNAMODB_TABLE,
                Key: { trip_id: `DRAFT#${channelId}` }
              }));
              if (draftRes.Item?.ticket_data) {
                ticketData = draftRes.Item.ticket_data;
              }
            } catch (e) {
              console.log('Error reading draft for edit modal:', e);
            }
          }

          if (!ticketData && action.value) {
            try { ticketData = JSON.parse(action.value); } catch {}
          }
          ticketData = ticketData || {};

          const editModalView = {
            type: "modal",
            callback_id: "edit_ticket_modal_submit",
            title: { type: "plain_text", text: "Chỉnh sửa thông tin vé" },
            submit: { type: "plain_text", text: "Lưu thay đổi" },
            close: { type: "plain_text", text: "Hủy" },
            private_metadata: JSON.stringify({
              channel_id: channelId,
              thread_ts: threadTs
            }),
            blocks: [
              {
                type: "input",
                block_id: "name_block",
                element: {
                  type: "plain_text_input",
                  action_id: "name_input",
                  initial_value: ticketData.passenger_name || ""
                },
                label: { type: "plain_text", text: "Họ và tên hành khách" }
              },
              {
                type: "input",
                block_id: "airline_block",
                element: {
                  type: "plain_text_input",
                  action_id: "airline_input",
                  initial_value: ticketData.airline || "Vietnam Airlines"
                },
                label: { type: "plain_text", text: "Hãng hàng không" }
              },
              {
                type: "input",
                block_id: "flight_block",
                element: {
                  type: "plain_text_input",
                  action_id: "flight_input",
                  initial_value: ticketData.flight_number || ""
                },
                label: { type: "plain_text", text: "Số hiệu chuyến bay" }
              },
              {
                type: "input",
                block_id: "dep_iata_block",
                element: {
                  type: "plain_text_input",
                  action_id: "dep_iata_input",
                  initial_value: ticketData.departure_iata || ""
                },
                label: { type: "plain_text", text: "Sân bay cất cánh (IATA, ví dụ: HAN, SGN)" }
              },
              {
                type: "input",
                block_id: "arr_iata_block",
                element: {
                  type: "plain_text_input",
                  action_id: "arr_iata_input",
                  initial_value: ticketData.arrival_iata || ""
                },
                label: { type: "plain_text", text: "Sân bay hạ cánh (IATA, ví dụ: VCA, DAD)" }
              },
              {
                type: "input",
                block_id: "dep_time_block",
                element: {
                  type: "plain_text_input",
                  action_id: "dep_time_input",
                  initial_value: ticketData.departure_time || ""
                },
                label: { type: "plain_text", text: "Thời gian cất cánh (YYYY-MM-DD HH:mm)" }
              },
              {
                type: "input",
                block_id: "pnr_block",
                element: {
                  type: "plain_text_input",
                  action_id: "pnr_input",
                  initial_value: ticketData.pnr || ""
                },
                label: { type: "plain_text", text: "Mã đặt chỗ (PNR)" }
              },
              {
                type: "input",
                block_id: "seat_block",
                optional: true,
                element: {
                  type: "plain_text_input",
                  action_id: "seat_input",
                  initial_value: ticketData.seat || ""
                },
                label: { type: "plain_text", text: "Số ghế" }
              },
              {
                type: "input",
                block_id: "class_block",
                optional: true,
                element: {
                  type: "plain_text_input",
                  action_id: "class_input",
                  initial_value: ticketData.ticket_class || "Economy"
                },
                label: { type: "plain_text", text: "Hạng vé (Economy/Business)" }
              },
              {
                type: "input",
                block_id: "price_block",
                optional: true,
                element: {
                  type: "plain_text_input",
                  action_id: "price_input",
                  initial_value: String(ticketData.ticket_price || "0")
                },
                label: { type: "plain_text", text: "Giá vé (VND)" }
              }
            ]
          };

          if (triggerId) {
            await makeRequest('https://slack.com/api/views.open', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8'
              }
            }, { trigger_id: triggerId, view: editModalView });
          }
          return { statusCode: 200, body: '' };
        }

        // B2. Người dùng bấm nút "Xác nhận"
        if (action?.action_id === 'confirm_save_ticket') {
          let ticketData = null;

          if (channelId) {
            try {
              const draftRes = await docClient.send(new GetCommand({
                TableName: DYNAMODB_TABLE,
                Key: { trip_id: `DRAFT#${channelId}` }
              }));
              if (draftRes.Item?.ticket_data) {
                ticketData = draftRes.Item.ticket_data;
              }
            } catch (e) {
              console.log('Could not fetch draft on confirm:', e);
            }
          }

          if (!ticketData && action.value) {
            try { ticketData = JSON.parse(action.value); } catch {}
          }

          if (ticketData) {
            const { tripId } = await saveTripRecord(ticketData);

            if (channelId) {
              try {
                await docClient.send(new DeleteCommand({
                  TableName: DYNAMODB_TABLE,
                  Key: { trip_id: `DRAFT#${channelId}` }
                }));
              } catch (e) {}
            }

            if (payload.response_url) {
              await makeRequest(payload.response_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              }, {
                text: `Đã lưu thành công vào lịch trình công tác.\n• Mã chuyến đi: \`${tripId}\`\n• Hành khách: ${ticketData.passenger_name || 'N/A'}\n• Chuyến bay: ${ticketData.flight_number || 'N/A'} (${ticketData.airline || 'N/A'})\n• Giờ cất cánh: ${ticketData.departure_time || 'N/A'}\n\nGhi chú: Để thay đổi thông tin chuyến đi này, bạn có thể nhắn tin yêu cầu sửa bất kỳ lúc nào.`
              });
            }
          }
        } else if (action?.action_id === 'cancel_ticket') {
          if (channelId) {
            try {
              await docClient.send(new DeleteCommand({
                TableName: DYNAMODB_TABLE,
                Key: { trip_id: `DRAFT#${channelId}` }
              }));
            } catch (e) {}
          }
          if (payload.response_url) {
            await makeRequest(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, {
              text: "Đã hủy thông tin vé máy bay."
            });
          }
        } else if (action?.action_id === 'submit_pr_approval') {
          if (payload.response_url) {
            await makeRequest(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, {
              text: "Yêu cầu Purchase Request (PR) đã được chuyển tiếp để phê duyệt."
            });
          }
        }
      }
    }

    return { statusCode: 200, body: '' };
  }

  return { statusCode: 404, body: 'Not Found' };
};
