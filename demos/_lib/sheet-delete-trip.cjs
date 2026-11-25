// Deletes the single sheet row whose column A equals the given trip id (service account from .env).
// Usage: node demos/_lib/sheet-delete-trip.cjs TRIP-202611-404 [--yes]
const fs = require('fs')
const path = require('path')
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const crypto = require('crypto')
const sa = JSON.parse(fs.readFileSync(path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_FILE), 'utf8'))
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', typ: 'JWT' })
  const claim = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key, 'base64url')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200))
  return j.access_token
}
async function makeRequest(url, opts = {}, body) {
  const r = await fetch(url, { ...opts, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const id = process.argv[2]
const yes = process.argv.includes('--yes')
const SID = process.env.GOOGLE_SHEET_ID
const TAB = process.env.GOOGLE_SHEET_TAB_NAME || 'Lịch_Trình_Công_Tác'
;(async () => {
  const token = await getGoogleAccessToken()
  const H = { Authorization: `Bearer ${token}` }
  const vals = await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SID}/values/${encodeURIComponent(TAB)}!A:A`, { method: 'GET', headers: H })
  const rows = vals.data?.values || []
  const hits = rows.map((r, i) => [r[0], i]).filter(([v]) => (v || '').trim().toUpperCase() === id.toUpperCase()).map(([, i]) => i)
  console.log('rows in col A:', rows.length, ' matches for', id, ':', hits.map((i) => i + 1))
  if (hits.length !== 1) return console.log('Not exactly one match, nothing deleted.')
  if (!yes) return console.log('dry run (add --yes to delete)')
  const meta = await makeRequest(`https://sheets.googleapis.com/v4/spreadsheets/${SID}?fields=sheets.properties`, { method: 'GET', headers: H })
  const sheet = meta.data.sheets.find((s) => s.properties.title === TAB)
  const idx = hits[0]
  const res = await makeRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${SID}:batchUpdate`,
    { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' } },
    { requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }] },
  )
  console.log('delete status', res.status)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
