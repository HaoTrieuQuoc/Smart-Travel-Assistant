/**
 * EasyVoice TTS (OpenAI-compatible): POST https://easyvoice.ae/api/v1/audio/speech
 * Usage:
 *   node demos/_lib/tts-easyvoice.mjs --text "Hello" --voice af_heart --out demos/slack-demo/audio/test.mp3
 *   node demos/_lib/tts-easyvoice.mjs --manifest demos/slack-demo/narration.json --voice af_heart --outdir demos/slack-demo/audio
 * Reads EASYVOICE_API_KEY from .env (project root). Free plan: 5,000 chars/day, 20 req/min.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const KEY = env.EASYVOICE_API_KEY
if (!KEY) throw new Error('EASYVOICE_API_KEY missing in .env')

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : d
}
const voice = arg('voice', 'af_heart')
const speed = Number(arg('speed', '1.0'))

async function tts(text, out) {
  mkdirSync(dirname(out), { recursive: true })
  const res = await fetch('https://easyvoice.ae/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'kokoro-82m', input: text, voice, response_format: 'mp3', speed }),
  })
  if (!res.ok) throw new Error(`EasyVoice ${res.status}: ${(await res.text()).slice(0, 300)}`)
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
}
const dur = (f) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

if (arg('manifest')) {
  const lines = JSON.parse(readFileSync(arg('manifest'), 'utf8')) // [{id, text}]
  const outdir = arg('outdir', 'demos/slack-demo/audio')
  const manifestPath = join(outdir, 'manifest.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  for (const { id, text } of lines) {
    const hash = createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 10)
    const file = join(outdir, `${id}.mp3`)
    if (manifest[text]?.hash === hash && existsSync(file)) continue // reuse: free plan is char-limited
    await tts(text, file)
    manifest[text] = { id, file, hash, voice, dur: dur(file) }
    console.log(`${id}  ${manifest[text].dur.toFixed(2)}s  ${text.slice(0, 60)}`)
    await new Promise((r) => setTimeout(r, 3200)) // stay under 20 req/min
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('manifest ->', manifestPath)
} else {
  const out = arg('out', 'demos/slack-demo/audio/test.mp3')
  await tts(arg('text'), out)
  console.log(`${out}  ${dur(out).toFixed(2)}s  voice=${voice}`)
}
