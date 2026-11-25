/**
 * Renders the animated intro/outro to MP4 (deterministic: every CSS animation is seeked to the frame time).
 *
 *   node demos/_lib/render-brand-video.mjs [intro|outro|both] [--fps 30]
 *
 * Needs: ffmpeg on PATH, and demos/slack-demo/brand/{intro,outro}.wav (python demos/_lib/make-brand-music.py).
 * Output: demos/slack-demo/brand/{intro,outro}.mp4 (1920x1080, H.264 + AAC 48 kHz stereo).
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { execFileSync } from 'child_process'

const here = dirname(fileURLToPath(import.meta.url))
const brand = join(here, '..', 'slack-demo', 'brand')
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'both'
const fpsIdx = process.argv.indexOf('--fps')
const FPS = fpsIdx > 0 ? Number(process.argv[fpsIdx + 1]) : 30
const SPECS = { intro: { dur: 5.4, still: 3.4 }, outro: { dur: 7.0, still: 4.6 } }

async function seek(page, ms) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = t
    }
  }, ms)
}

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()

for (const name of which === 'both' ? ['intro', 'outro'] : [which]) {
  const { dur, still } = SPECS[name]
  await page.goto(pathToFileURL(join(brand, `${name}.html`)).href, { waitUntil: 'networkidle' }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)

  // still image (animations seeked to a representative moment)
  await seek(page, still * 1000)
  await page.screenshot({ path: join(brand, `${name}.png`) })

  // frames
  const frames = join(here, '..', '.auth', `frames-${name}`)
  if (existsSync(frames)) rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames, { recursive: true })
  const n = Math.round(dur * FPS)
  for (let i = 0; i < n; i++) {
    await seek(page, (i / FPS) * 1000)
    await page.screenshot({ path: join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 })
  }
  const wav = join(brand, `${name}.wav`)
  execFileSync(
    'ffmpeg',
    [
      '-y', '-framerate', String(FPS), '-i', join(frames, '%05d.jpg'), '-i', wav,
      '-af', 'loudnorm=I=-18:TP=-1.5:LRA=7', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(dur), '-movflags', '+faststart',
      join(brand, `${name}.mp4`),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  rmSync(frames, { recursive: true, force: true })
  console.log(`wrote ${name}.mp4 (${dur}s, ${n} frames) and ${name}.png`)
}
await browser.close()
