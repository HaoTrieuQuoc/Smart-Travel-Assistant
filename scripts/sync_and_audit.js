const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// 1. Đọc file .env (hỗ trợ gọi từ root hoặc scripts/)
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
const localstackUrl = env.LOCALSTACK_ENDPOINT || 'http://127.0.0.1:4566';
const spreadsheetId = env.GOOGLE_SHEET_ID;
const tabName = env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác';
const slackToken = env.SLACK_BOT_TOKEN;
const slackChannel = env.SLACK_ADMIN_CHANNEL_ID;
const serviceAccountPath = fs.existsSync(path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE))
  ? path.resolve(__dirname, env.GOOGLE_SERVICE_ACCOUNT_FILE)
  : path.resolve(__dirname, '..', env.GOOGLE_SERVICE_ACCOUNT_FILE);

console.log('================================================================');
console.log('   SMART TRAVEL ASSISTANT: LOCALSTACK DYNAMODB & SYNC WORKER    ');
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

// 2. DynamoDB API Client cho LocalStack
async function callDynamoDB(target, payload) {
  const res = await makeRequest(localstackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'x-amz-target': `DynamoDB_20120810.${target}`,
      'Authorization': 'AWS4-HMAC-SHA256 Credential=test/20261112/us-east-1/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-target, Signature=test'
    }
  }, payload);

  return res.data;
}

// Tạo bảng TravelBookings nếu chưa có
async function ensureDynamoDBTable() {
  console.log('• Kiểm tra bảng TravelBookings trên LocalStack...');
  const list = await callDynamoDB('ListTables', {});
  const tables = list?.TableNames || [];

  if (!tables.includes('TravelBookings')) {
    console.log('• Đang tạo bảng DynamoDB TravelBookings...');
    await callDynamoDB('CreateTable', {
      TableName: 'TravelBookings',
      KeySchema: [
        { AttributeName: 'trip_id', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'trip_id', AttributeType: 'S' },
        { AttributeName: 'reminder_sent', AttributeType: 'S' },
        { AttributeName: 'departure_time', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'DepartureTimeIndex',
          KeySchema: [
            { AttributeName: 'reminder_sent', KeyType: 'HASH' },
            { AttributeName: 'departure_time', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' }
        }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    });
    console.log('✅ Đã tạo thành công bảng TravelBookings với GSI DepartureTimeIndex!');
  } else {
    console.log('✅ Bảng TravelBookings đã tồn tại và sẵn sàng.');
  }
}

// 3. Lấy Google Access Token
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

// 4. Data Validator & Calculate Hash
function validateRow(row) {
  const tripId = row[0] || '';
  const passengerName = row[3] || '';
  const passengerEmail = row[5] || '';
  const flightCode = row[8] || '';
  const arrivalIata = (row[12] || '').trim();
  const departureTime = (row[13] || '').trim();
  const pnr = (row[15] || '').trim();

  const errors = [];

  // Validate format ngày giờ YYYY-MM-DD HH:mm
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/;
  if (!isoDateRegex.test(departureTime)) {
    errors.push(`Sai format ngày khởi hành "${departureTime}" (Cần: YYYY-MM-DD HH:mm)`);
  }

  // Validate mã sân bay IATA (3 chữ cái in hoa)
  if (!/^[A-Z]{3}$/.test(arrivalIata)) {
    errors.push(`Mã IATA điểm đến "${arrivalIata}" không đúng 3 ký tự`);
  }

  // Validate PNR
  if (!pnr) {
    errors.push('Thiếu mã đặt chỗ PNR');
  }

  // Validate Email
  if (!passengerEmail || !passengerEmail.includes('@')) {
    errors.push('Thiếu hoặc sai email nhân sự');
  }

  let status = 'VALID';
  let notes = 'Hợp lệ';

  if (errors.length > 0) {
    if (errors.some(e => e.includes('format ngày'))) status = 'INVALID_DATETIME';
    else if (errors.some(e => e.includes('IATA'))) status = 'INVALID_IATA';
    else status = 'MISSING_FIELD';
    notes = `[BOT AUDIT] ${errors.join('; ')}`;
  }

  // Tính mã băm SHA-256 để kiểm tra Diff
  const hashString = `${tripId}|${passengerName}|${passengerEmail}|${flightCode}|${arrivalIata}|${departureTime}|${pnr}`;
  const rowHash = crypto.createHash('sha256').update(hashString).digest('hex');

  return { status, notes, rowHash, errors };
}

// 5. Luồng chính: Đồng bộ Google Sheets -> DynamoDB
async function runSync() {
  try {
    // A. Khởi tạo LocalStack
    await ensureDynamoDBTable();

    // B. Đọc dữ liệu từ Google Sheets
    console.log('• Đang đọc dữ liệu từ Google Sheet...');
    const accessToken = await getGoogleAccessToken();
    const sheetDataRes = await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A2:W50`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const rows = sheetDataRes.data.values || [];
    console.log(`• Tìm thấy ${rows.length} dòng dữ liệu trên Google Sheet.`);

    let updatedCount = 0;
    let skippedCount = 0;
    const auditUpdates = [];
    const newErrors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tripId = row[0];
      if (!tripId) continue;

      const { status, notes, rowHash, errors } = validateRow(row);
      auditUpdates.push({ rowIdx: i + 2, status, notes });

      if (errors.length > 0) {
        newErrors.push({ rowNum: i + 2, tripId, errors: errors.join(', ') });
      }

      // Đọc item hiện tại trong DynamoDB để check diff
      const existing = await callDynamoDB('GetItem', {
        TableName: 'TravelBookings',
        Key: { trip_id: { S: tripId } }
      });

      const existingHash = existing?.Item?.row_hash?.S;

      if (existingHash === rowHash) {
        skippedCount++;
      } else {
        // Có thay đổi -> Cập nhật vào DynamoDB
        await callDynamoDB('PutItem', {
          TableName: 'TravelBookings',
          Item: {
            trip_id: { S: tripId },
            passenger_name: { S: row[3] || '' },
            passenger_email: { S: row[5] || '' },
            flight_code: { S: row[8] || '' },
            departure_iata: { S: row[10] || '' },
            arrival_iata: { S: row[12] || '' },
            departure_time: { S: row[13] || '' },
            pnr: { S: row[15] || '' },
            reminder_sent: { S: row[20] === 'SENT' ? 'SENT' : 'PENDING' },
            audit_status: { S: status },
            row_hash: { S: rowHash },
            last_synced_at: { S: new Date().toISOString() }
          }
        });
        updatedCount++;
      }
    }

    console.log(`• Kết quả đồng bộ: ${updatedCount} dòng cập nhật vào DynamoDB, ${skippedCount} dòng không đổi (Diff Match).`);

    // C. Cập nhật lại cột Audit_Status và Audit_Notes trên Google Sheet
    console.log('• Đang cập nhật trạng thái kiểm toán lên Google Sheet...');
    const auditValues = auditUpdates.map(u => [u.status, u.notes]);
    await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!V2:W${auditValues.length + 1}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }, { values: auditValues });

    console.log('✅ Đã cập nhật trạng thái kiểm toán trực tiếp lên Google Sheet!');
    console.log('\n🎉 ĐỒNG BỘ HOÀN TẤT THÀNH CÔNG RỰC RỠ!');
  } catch (err) {
    console.error('\n❌ XẢY RA LỖI:', err.message);
  }
}

runSync();


