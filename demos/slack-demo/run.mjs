/**
 * Smart Travel Assistant - Slack demo (silent, English captions burned in post).
 *
 * Run from the project root:
 *   node demos/slack-demo/run.mjs                 # dry take: rounds 0,1,2,3,5,6,9 (writes nothing to Sheet/DynamoDB)
 *   node demos/slack-demo/run.mjs --save          # full take: adds 4 (confirm save), 7 (edit saved trip), 8 (24h reminder)
 *   node demos/slack-demo/run.mjs --rounds=1,2    # custom rounds
 *   node demos/slack-demo/run.mjs --headed        # watch it live
 *
 * Session: demos/.auth/slack.json (created by demos/_lib/slack-login.mjs).
 * Captions: timeline events type "caption" (text in label); burned by demos/_lib/burn-captions.mjs.
 */
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'
import { loadConfig } from '../_engine/config.mjs'
import { createTimeline } from '../_engine/timeline.mjs'
import { createFilmContext, prepareFilmPage, startFilmRecording, finishFilmRecording } from '../_engine/record.mjs'
import { click, focus, wide, appear, done, settle } from '../_engine/actions.mjs'
import { pause } from '../_engine/motion.mjs'
import { nextRenderDir, initRunLog, logRun } from '../_lib/paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const config = loadConfig(process.cwd())
const args = process.argv.slice(2)
const SAVE = args.includes('--save')
const HEADED = args.includes('--headed')
const roundsArg = args.find((a) => a.startsWith('--rounds='))
const ROUNDS = roundsArg
  ? roundsArg.slice(9).split(',').map(Number)
  : SAVE
    ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 9]
    : [0, 1, 2, 3, 5, 6, 9]

const TEAM = 'T0CH1BR89PC'
const CH_TRAVEL = 'C0CH1CC22FL'
const CH_ADMIN = 'C0CGLFPNW7R'
const url = (ch) => `https://app.slack.com/client/${TEAM}/${ch}`
const TICKET = join(__dirname, 'fixtures', 'ticket_han_vca.png')
const AUTH = join(__dirname, '..', '.auth', 'slack.json')

// ---------- captions (English) ----------
let timelineRef
const cap = (text) => timelineRef.mark('caption', text)
const capEnd = () => timelineRef.mark('caption-end', '')
// Narration clips (demos/slack-demo/audio/manifest.json, made by demos/_lib/tts-easyvoice.mjs).
// narrate(text, fn): marks the caption, runs the on-screen work fn(), then holds until the clip has finished
// (+0.3s), measured in FINAL-video time (waits compressed by the speed-up pass do not count in full).
// Back-to-back narrate() calls therefore give continuous speech with no dead air.
const TOOL_MAX = 4 // must match --speedup toolWaitMax in the compose step
let CLIPS = {}
try {
  CLIPS = JSON.parse(readFileSync(join(__dirname, 'audio', 'manifest.json'), 'utf8'))
} catch {}
let savedSec = 0 // seconds the speed-up pass will remove from bracketed bot waits
const noteWait = (realSec) => {
  if (realSec > TOOL_MAX + 0.5) savedSec += realSec - TOOL_MAX
}
async function narrate(text, fn = async () => {}) {
  cap(text)
  const clip = CLIPS[text]
  if (!clip) logRun(`WARNING no audio clip for: ${text.slice(0, 50)}`)
  const t0 = Date.now()
  const s0 = savedSec
  await fn()
  const effective = (Date.now() - t0) / 1000 - (savedSec - s0)
  const need = (clip ? clip.dur : 4) + 0.3 - effective
  if (need > 0) await pause(need * 1000)
}

// ---------- page cosmetics: hide personal data / promo banners ----------
const COSMETIC = `
(() => {
  const NAMES = /^(Kai Nguyen|Quốc Hào Triệu|Ánh Lê Hồng|Quoc Hao)$/i;
  const EMAIL = /[\\w.+-]+@[\\w-]+\\.[\\w.]+/;
  const BANNER = /Stay up to date from anywhere|days? left in trial/i;
  const apply = () => {
    for (const el of document.querySelectorAll('span,div,a,b,strong')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 90) continue;
      if (EMAIL.test(t)) el.style.filter = 'blur(6px)';
      else if (NAMES.test(t) && el.closest('.p-channel_sidebar, [data-qa="channel_sidebar"]')) el.style.filter = 'blur(7px)';
      else if (BANNER.test(t) && !el.dataset.hid) {
        el.dataset.hid = '1';
        let top = el;
        for (let i = 0; i < 7; i++) {
          const p = top.parentElement;
          if (!p || p.getBoundingClientRect().height > 100) break;
          top = p;
        }
        top.style.display = 'none';
      }
    }
  };
  const start = () => {
    // keepalive: a 2px element whose colour flips every frame keeps the compositor (and the CDP screencast) producing frames while the page is otherwise static
    const k = document.createElement('div');
    k.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;z-index:2147483647;pointer-events:none;animation:__ka 0.066s steps(1) infinite';
    const st = document.createElement('style');
    st.textContent = '@keyframes __ka{0%{background:#010101}50%{background:#020202}}';
    document.head.appendChild(st);
    document.body.appendChild(k);
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
    setInterval(apply, 1500);
    apply();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
`

// ---------- Slack helpers ----------
const mainComposer = (page) => page.locator('[data-qa="message_input"] [contenteditable="true"]').first()
const pane = (page) => page.locator('[data-qa="threads_flexpane"]').first()
const threadComposer = (page) => pane(page).locator('[data-qa="message_input"] [contenteditable="true"]').first()

async function openChannel(page, ch) {
  await page.goto(url(ch), { waitUntil: 'domcontentloaded' })
  await mainComposer(page).waitFor({ timeout: 45000 })
  await page.waitForTimeout(2500)
  await page.locator('[data-qa="message_pane"] .c-scrollbar__hider').first().evaluate((el) => (el.scrollTop = el.scrollHeight)).catch(() => {})
  await page.waitForTimeout(800)
}

/** Type "@Travel Assistant" via autocomplete (Tab selects the first suggestion). */
async function mentionBot(page, timeline, composer) {
  await click(page, timeline, composer, 'composer')
  await page.keyboard.type('@Travel', { delay: 90 })
  await page.waitForTimeout(1200)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  await page.keyboard.type(' ', { delay: 40 })
}

async function typeHuman(page, text, delay = 28) {
  await page.keyboard.type(text, { delay })
}

const scrollBottom = (page) =>
  page.locator('[data-qa="message_pane"] .c-scrollbar__hider').first().evaluate((el) => (el.scrollTop = el.scrollHeight)).catch(() => {})

async function send(page) {
  await scrollBottom(page)
  await page.waitForTimeout(500)
  tsBefore = await newestTs(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
}

/** Waits for a bot result inside the thread pane, bracketed so speed-up compresses the wait. */
async function waitBot(page, timeline, label, locatorFn, timeout = 150000) {
  const box = await pane(page).boundingBox().catch(() => null)
  const t0 = Date.now()
  await appear(page, timeline, label, box)
  await locatorFn().first().waitFor({ state: 'visible', timeout })
  await page.waitForTimeout(800)
  await done(page, timeline, label, box)
  noteWait((Date.now() - t0) / 1000)
}

/**
 * New-message tracking by Slack timestamp (data-msg-ts) - robust against the virtualised message list and
 * against older threads that already contain similar bot replies. The thread pane re-uses data-qa, so it is excluded.
 */
let tsBefore = 0
const newestTs = (page) =>
  page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('[data-msg-ts]')]
        .filter((e) => !e.closest('[data-qa="threads_flexpane"], [data-qa="flexpane"]'))
        .map((e) => parseFloat(e.getAttribute('data-msg-ts'))),
    ),
  )
/** Waits until a message newer than the one before send() has a reply bar (= the bot answered); tags that bar. */
async function waitLastBar(page, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    await scrollBottom(page) // the list is virtualised: the new message is only in the DOM when scrolled to the bottom
    const ok = await page.evaluate((before) => {
      document.querySelectorAll('[data-demo-bar]').forEach((e) => e.removeAttribute('data-demo-bar'))
      const msgs = [...document.querySelectorAll('[data-msg-ts]')]
        .filter((e) => !e.closest('[data-qa="threads_flexpane"], [data-qa="flexpane"]'))
        .filter((e) => parseFloat(e.getAttribute('data-msg-ts')) > before)
      for (const m of msgs) {
        const bar = m.querySelector('[data-qa="reply_bar_count"]')
        if (bar) {
          bar.setAttribute('data-demo-bar', '1')
          return true
        }
      }
      return false
    }, tsBefore)
    if (ok) return true
    await page.waitForTimeout(1500)
  }
  return false
}

/** Bot latency bracket (appear/done) so the speed-up pass compresses the wait. */
async function botWait(page, timeline, label, timeout) {
  const t0 = Date.now()
  await appear(page, timeline, label, null)
  await waitLastBar(page, timeout)
  await page.waitForTimeout(1500)
  await done(page, timeline, label, null)
  noteWait((Date.now() - t0) / 1000)
}

/** A sub-rectangle of the thread pane (fractions of its height) - a zone small enough to zoom into. */
async function paneBox(page, topFrac, heightFrac) {
  const b = await pane(page).boundingBox()
  return { x: b.x, y: b.y + b.height * topFrac, width: b.width, height: b.height * heightFrac }
}

async function openLatestThread(page, timeline) {
  if (!(await waitLastBar(page, 60000))) throw new Error('bot reply bar for the new message never appeared')
  const bar = page.locator('[data-demo-bar]').first()
  await click(page, timeline, bar, 'open-thread')
  await pane(page).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)
}

/** Close the thread pane (if open) without reloading anything. */
async function closePane(page) {
  const btn = page.locator('[data-qa="close_flexpane"]').first()
  if (await btn.count()) await btn.click().catch(() => {})
  await page.waitForTimeout(500)
}
/** Switch channel by clicking the sidebar (no reload, so no blank loading screen on camera). */
async function switchChannel(page, timeline, name) {
  await closePane(page)
  const link = page.locator('[data-qa="channel-sidebar-channel"]', { hasText: name }).first()
  await click(page, timeline, link, `to-${name}`)
  await mainComposer(page).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1200)
  await scrollBottom(page)
  await page.waitForTimeout(600)
}

// ---------- rounds ----------
const R = {}
let lastTripId = null
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1bdDs54cT0lADf29fp9HM2D0V5cfleJFj_UmjOnO1im0/edit?usp=sharing'

R[0] = async (page, timeline) => {
  await narrate('Smart Travel Assistant automates corporate travel booking inside Slack, from reading a flight ticket to reporting and reminders.')
  await narrate('There are two channels with two permission levels: one for employees, and one for HR.', async () => {
    const adminLink = page.locator('[data-qa="channel-sidebar-channel"]', { hasText: 'biz-admin-alerts' }).first()
    await click(page, timeline, adminLink, 'to-admin')
    await pause(1800)
    const travelLink = page.locator('[data-qa="channel-sidebar-channel"]', { hasText: 'travel-booking' }).first()
    await click(page, timeline, travelLink, 'back-travel')
    await page.waitForTimeout(1500)
    await page.locator('[data-qa="message_pane"] .c-scrollbar__hider').first().evaluate((el) => (el.scrollTop = el.scrollHeight)).catch(() => {})
  })
}

R[1] = async (page, timeline) => {
  await narrate('An employee drops a flight ticket photo into the booking channel, and mentions the assistant.', async () => {
    const composer = mainComposer(page)
    await page.locator('input[type="file"]').first().setInputFiles(TICKET)
    await pause(1200)
    await mentionBot(page, timeline, composer)
    await pause(600)
    await send(page)
  })
  await narrate('Vision AI reads the passenger, flight, route, departure time and booking code.', async () => {
    await botWait(page, timeline, 'reply1', 150000)
  })
  await narrate('It also turns airport codes into city names, and flags any price it cannot find.', async () => {
    await openLatestThread(page, timeline)
    await waitBot(page, timeline, 'ocr', () => pane(page).getByText('KẾT QUẢ ĐỌC VÉ MÁY BAY'))
  })
  await narrate('A draft preview comes first. Nothing is saved until the user confirms.', async () => {
    await focus(page, timeline, await paneBox(page, 0.12, 0.55), 'preview-card')
  })
  await wide(page, timeline, 'after-preview')
}

R[2] = async (page, timeline) => {
  await narrate('Something wrong? Fix it with one plain sentence in the thread.', async () => {
    await click(page, timeline, threadComposer(page), 'thread-composer')
    await typeHuman(page, 'Đổi phòng ban thành Marketing, mục đích là gặp khách hàng đối tác')
    await pause(400)
    await send(page)
  })
  await narrate('The assistant understands the request, updates the draft and posts a fresh preview.', async () => {
    await waitBot(page, timeline, 'correction', () => pane(page).getByText(/Marketing/))
  })
  await narrate('The new preview shows the corrected department and purpose.', async () => {
    await focus(page, timeline, await paneBox(page, 0.1, 0.6), 'updated-preview')
  })
  await wide(page, timeline, 'after-correction')
}

R[3] = async (page, timeline) => {
  await narrate('Prefer a form? Open the full edit modal, with fourteen fields.', async () => {
    const editBtn = pane(page).getByRole('button', { name: 'Chỉnh sửa' }).last()
    await editBtn.scrollIntoViewIfNeeded().catch(() => {})
    await click(page, timeline, editBtn, 'open-modal')
    const dialog = page.locator('[role="dialog"]').first()
    await dialog.waitFor({ timeout: 15000 })
    await pause(1000)
    await focus(page, timeline, dialog, 'modal')
  })
  await narrate('Saving the form locks the previous preview, so nobody clicks a stale draft by mistake.', async () => {
    const dialog = page.locator('[role="dialog"]').first()
    await pause(1500)
    const submit = dialog.locator('button.c-button--primary, [data-qa="wizard_modal_next"], [data-qa="submit-button"]').last()
    await click(page, timeline, submit, 'modal-save')
    await wide(page, timeline, 'after-modal')
  })
}

R[4] = async (page, timeline) => {
  await narrate('On confirm, the trip gets an ID and is written to two stores at once.', async () => {
    const confirmBtn = pane(page).getByRole('button', { name: 'Xác nhận' }).last()
    await confirmBtn.scrollIntoViewIfNeeded().catch(() => {})
    await click(page, timeline, confirmBtn, 'confirm-save')
    await waitBot(page, timeline, 'saved', () => pane(page).getByText(/TRIP-\d{6}-\d+/))
    const txt = await pane(page).innerText().catch(() => '')
    lastTripId = (txt.match(/TRIP-\d{6}-\d+/g) || []).pop() || null
    logRun(`Saved trip id: ${lastTripId}`)
  })
  await narrate('DynamoDB is the source of truth, with a SHA-256 row hash for audit.', async () => {
    await focus(page, timeline, await paneBox(page, 0.1, 0.6), 'trip-id')
  })
  await wide(page, timeline, 'after-save')
}

R[5] = async (page, timeline) => {
  await narrate('Permissions follow the channel. Back in the employee channel, a report request is not allowed.', async () => {
    await switchChannel(page, timeline, 'travel-booking')
    await mentionBot(page, timeline, mainComposer(page))
    await typeHuman(page, 'Tổng chi phí vé tháng này của cả công ty là bao nhiêu?')
    await pause(300)
    await send(page)
  })
  await narrate('The assistant declines politely, and points to the HR channel.', async () => {
    await botWait(page, timeline, 'reply2', 90000)
    await openLatestThread(page, timeline)
  })
  await narrate('The rule is enforced in code, by channel, not by trusting the user.', async () => {
    await focus(page, timeline, await paneBox(page, 0.1, 0.6), 'refusal')
  })
  await wide(page, timeline, 'after-refusal')
}

R[6] = async (page, timeline) => {
  await narrate('In the admin channel, HR asks a question in plain Vietnamese.', async () => {
    await switchChannel(page, timeline, 'biz-admin-alerts')
    await mentionBot(page, timeline, mainComposer(page))
    await typeHuman(page, 'Thống kê chi phí công tác theo phòng ban và cảnh báo bất thường')
    await pause(300)
    await send(page)
  })
  await narrate('The AI only plans a read-only query. The numbers are computed in deterministic code, so there is no math hallucination.', async () => {
    await botWait(page, timeline, 'reply3', 120000)
    await openLatestThread(page, timeline)
    await waitBot(page, timeline, 'bi', () => pane(page).getByText('BÁO CÁO PHÂN TÍCH CÔNG TÁC'))
  })
  await narrate('The report shows totals, a breakdown by department, anomalies such as missing prices, and a short insight.', async () => {
    await focus(page, timeline, await paneBox(page, 0.1, 0.6), 'bi-report')
  })
  await wide(page, timeline, 'after-bi')
}

R[7] = async (page, timeline) => {
  await narrate('Admins can also edit a saved trip with a single sentence, for example filling in the missing ticket price.', async () => {
    await switchChannel(page, timeline, 'biz-admin-alerts')
    await mentionBot(page, timeline, mainComposer(page))
    await typeHuman(page, lastTripId ? `Đổi giá vé của ${lastTripId} thành 2.500.000` : 'Đổi giá vé của chuyến Le Dang Hieu thành 2.500.000')
    await send(page)
  })
  await narrate('The change is applied to both Google Sheets and DynamoDB.', async () => {
    await botWait(page, timeline, 'reply4', 120000)
    await openLatestThread(page, timeline)
    await waitBot(page, timeline, 'edit', () => pane(page).getByText('CẬP NHẬT LỊCH TRÌNH THÀNH CÔNG'))
  })
  await narrate('And the assistant confirms exactly what was updated.', async () => {
    await focus(page, timeline, await paneBox(page, 0.1, 0.6), 'edit-result')
  })
  await wide(page, timeline, 'after-edit')
}

R[8] = async (page, timeline) => {
  await narrate('Every morning at eight, a scheduled job scans for flights departing within twenty-four hours.', async () => {
    await closePane(page)
    await page.getByText(/NHẮC LỊCH BAY 24H/).last().scrollIntoViewIfNeeded().catch(() => {})
    await pause(800)
  })
  await narrate('It posts an alert with an AI-written checklist, then marks the trip as sent so it never repeats.', async () => {
    const alert = page.getByText(/NHẮC LỊCH BAY 24H/).last()
    const ab = await alert.boundingBox()
    await focus(page, timeline, { x: ab.x - 30, y: ab.y - 20, width: 760, height: 360 }, 'reminder')
  })
  await wide(page, timeline, 'after-reminder')
}

R[10] = async (page, timeline) => {
  await narrate('Google Sheets mirrors it for finance: 23 columns, one new row.', async () => {
    const t0 = Date.now()
    await appear(page, timeline, 'sheet-load', null)
    await page.goto(SHEET_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    // blur the e-mail / Slack-username columns (F:G) - the grid is a canvas, so overlay a blur layer
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.style.cssText = 'position:fixed;left:548px;top:166px;width:210px;height:190px;backdrop-filter:blur(9px);background:rgba(255,255,255,0.35);z-index:2147483646;pointer-events:none'
      document.body.appendChild(d)
    })
    await done(page, timeline, 'sheet-load', null)
    noteWait((Date.now() - t0) / 1000)
    await focus(page, timeline, { x: 45, y: 165, width: 650, height: 175 }, 'sheet-row')
  })
  await wide(page, timeline, 'sheet-wide')
}

R[9] = async () => {
  await narrate('All of this runs serverless on AWS, with near-zero cost when idle. That is Smart Travel Assistant.')
  capEnd()
}

// ---------- main ----------
async function main() {
  const { dir: renderDir } = nextRenderDir(__dirname)
  initRunLog(renderDir)
  logRun(`Rounds: ${ROUNDS.join(',')}  save=${SAVE}`, renderDir)

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  })
  const context = await createFilmContext(browser, renderDir, { storageState: AUTH })
  const page = await context.newPage()
  await context.addInitScript(COSMETIC)
  await prepareFilmPage(page, config.cursor)

  // Preload off-camera
  await openChannel(page, CH_TRAVEL)
  await settle(page)

  const timeline = createTimeline()
  timelineRef = timeline
  const recorder = await startFilmRecording(page, renderDir, timeline)

  await wide(page, timeline, 'establish')
  let failed = null
  for (const n of ROUNDS) {
    logRun(`Round ${n}`, renderDir)
    try {
      await R[n](page, timeline)
    } catch (err) {
      failed = { round: n, err }
      logRun(`Round ${n} FAILED: ${err.message.split('\n')[0]}`, renderDir)
      await page.screenshot({ path: join(renderDir, `fail-round-${n}.png`) }).catch(() => {})
      break
    }
  }
  await pause(2000)

  timeline.dump(join(renderDir, 'timeline.json'))
  const rec = await finishFilmRecording(context, page, renderDir, recorder)
  await browser.close()
  if (!rec.ok) {
    console.error('raw.mp4 not produced')
    process.exit(1)
  }
  console.log(`Recorded ${renderDir} (${rec.capturedFps} fps)`)
  if (failed) {
    console.error(`FAILED in round ${failed.round}:`, failed.err.message.split('\n')[0])
    process.exit(2)
  }
  const frame = config.frame ?? {}
  const rd = renderDir.split('\\').join('/')
  console.log(`1) Compose : node demos/_engine/compose.mjs "${rd}" --preset ${frame.preset ?? 'macos-dark'} --speedup idleGapMin=9999,toolWaitMax=4,preToolWaitMax=2,tailHold=3`)
  console.log(`2) Captions: node demos/_lib/burn-captions.mjs "${rd}"`)
  console.log(`3) Voice   : node demos/_lib/mix-narration.mjs "${rd}"`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
