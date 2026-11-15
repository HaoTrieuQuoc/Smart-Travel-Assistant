/**
 * Common Helpers for AWS Lambda Handlers
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize AWS DynamoDB Document Client
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-southeast-2'
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

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

function base64Url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Google Sheets Token Manager
let cachedGoogleToken = null;
let googleTokenExpiry = 0;

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && now < googleTokenExpiry - 60) {
    return cachedGoogleToken;
  }

  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not defined');
  }

  let sa;
  try {
    sa = JSON.parse(rawJson);
  } catch {
    // Attempt base64 decode if passed encoded
    sa = JSON.parse(Buffer.from(rawJson, 'base64').toString('utf8'));
  }

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

  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await makeRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (!res.data || !res.data.access_token) {
    throw new Error(`Google OAuth2 Error: ${JSON.stringify(res.data || res.raw)}`);
  }

  cachedGoogleToken = res.data.access_token;
  googleTokenExpiry = now + (res.data.expires_in || 3600);
  return cachedGoogleToken;
}

// Download private file from Slack
function downloadSlackFile(urlStr) {
  return new Promise((resolve, reject) => {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const url = new URL(urlStr);
    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${slackToken}`
      }
    };

    https.get(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return https.get(res.headers.location, (redirectRes) => {
          const chunks = [];
          redirectRes.on('data', c => chunks.push(c));
          redirectRes.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        }).on('error', reject);
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    }).on('error', reject);
  });
}

// Get detailed info for a Slack file
async function getSlackFileInfo(fileId) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const res = await makeRequest(`https://slack.com/api/files.info?file=${fileId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${slackToken}` }
  });
  return res.data?.file || null;
}

// Post Slack Message
async function postSlackMessage(channel, textOrBlocks) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const payload = {
    channel: channel
  };

  if (typeof textOrBlocks === 'string') {
    payload.text = textOrBlocks;
  } else if (Array.isArray(textOrBlocks)) {
    payload.blocks = textOrBlocks;
    payload.text = 'Notification from Smart Travel Assistant';
  } else if (textOrBlocks && typeof textOrBlocks === 'object') {
    Object.assign(payload, textOrBlocks);
  }

  return makeRequest('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${slackToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  }, payload);
}

module.exports = {
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
  postSlackMessage
};

