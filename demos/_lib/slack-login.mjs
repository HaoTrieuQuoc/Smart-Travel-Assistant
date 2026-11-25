/**
 * One-time Slack login. Opens a visible Chromium window with a persistent profile
 * (demos/.auth/profile). The user logs in by hand (password / 2FA are never typed by
 * automation). Done only when the Slack web client is really loaded (URL
 * app.slack.com/client/<TEAM>/... or the channel sidebar is visible). Then the session is
 * saved to demos/.auth/slack.json. The URL trail is logged so failures can be diagnosed.
 *
 * Usage: node demos/_lib/slack-login.mjs [workspace-url]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const authDir = join(__dirname, '..', '.auth')
const out = join(authDir, 'slack.json')
mkdirSync(authDir, { recursive: true })

const url = process.argv[2] ?? 'https://smarttravelassistant.slack.com/'
const context = await chromium.launchPersistentContext(join(authDir, 'profile'), {
  headless: false,
  viewport: null,
  args: ['--start-maximized'],
})
const page = context.pages()[0] ?? (await context.newPage())
let last = ''
page.on('framenavigated', (f) => {
  if (f !== page.mainFrame()) return
  const u = f.url().replace(/\?.*$/, '')
  if (u !== last) {
    last = u
    console.log('[nav]', u)
  }
})
await page.goto(url).catch(() => {})
console.log('Dang nhap Slack trong cua so vua mo, KHONG dong cua so (toi da 15 phut).')

const SIDEBAR = '[data-qa="channel_sidebar"], .p-channel_sidebar, [data-qa="slack_kit_scrollbar"]'
const isClient = () => /app\.slack\.com\/client\/[A-Z0-9]+/.test(page.url())
const deadline = Date.now() + 15 * 60 * 1000
let ok = false
while (Date.now() < deadline && !page.isClosed()) {
  const hasSidebar = await page.locator(SIDEBAR).first().isVisible().catch(() => false)
  if (isClient() || hasSidebar) {
    ok = true
    break
  }
  await page.waitForTimeout(2000).catch(() => {})
}
if (!ok) {
  console.error('Khong thay Slack client (cua so bi dong hoac het gio). URL cuoi:', last)
  await context.close().catch(() => {})
  process.exit(1)
}

await page.waitForTimeout(4000).catch(() => {})
await context.storageState({ path: out })
console.log('Da luu phien:', out)
console.log('URL cuoi:', page.url())
await context.close()
