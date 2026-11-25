/**
 * Removes long silent stretches between narration lines by time-lapsing the (silent) screen action in
 * those gaps (typing, loading, channel switches), so speech runs back-to-back.
 *
 *   node demos/_lib/tighten.mjs <renderDir> [--min-gap 2.0] [--max-speed 6]
 *
 * Input : <renderDir>/final.mp4 + timeline.json (caption events, final-video time) + audio/manifest.json
 * Output: <renderDir>/tight/final.mp4 + tight/timeline.json (caption times remapped).
 * Then:   node demos/_lib/burn-captions.mjs <renderDir>/tight   and   node demos/_lib/mix-narration.mjs <renderDir>/tight
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

const renderDir = process.argv[2]
if (!renderDir) throw new Error('usage: tighten.mjs <renderDir>')
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? Number(process.argv[i + 1]) : d
}
const MIN_GAP = arg('min-gap', 2.0) // silence (s) above which the action is time-lapsed
const MAX_SPEED = arg('max-speed', 6)
const KEEP = 0.3 // natural pause kept after each line

const manifest = JSON.parse(readFileSync('demos/slack-demo/audio/manifest.json', 'utf8'))
const { events } = JSON.parse(readFileSync(join(renderDir, 'timeline.json'), 'utf8'))
const cues = events.filter((e) => e.type === 'caption' && manifest[e.label]).sort((a, b) => a.t - b.t)
const input = join(renderDir, 'final.mp4')
const D = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], { encoding: 'utf8' }).trim())

// pieces: {a, b, f}
const pieces = []
let cursor = 0
for (let i = 0; i < cues.length - 1; i++) {
  const silentStart = cues[i].t + manifest[cues[i].label].dur + KEEP
  const silentEnd = cues[i + 1].t
  const gap = silentEnd - silentStart
  if (gap > MIN_GAP) {
    const f = Math.min(MAX_SPEED, gap / 0.9)
    pieces.push({ a: cursor, b: silentStart, f: 1 })
    pieces.push({ a: silentStart, b: silentEnd, f })
    cursor = silentEnd
  }
}
pieces.push({ a: cursor, b: D, f: 1 })
const keep = pieces.filter((p) => p.b - p.a > 0.02)

const outDir = join(renderDir, 'tight')
mkdirSync(outDir, { recursive: true })
const parts = keep.map((p, i) => `[0:v]trim=start=${p.a.toFixed(3)}:end=${p.b.toFixed(3)},setpts=(PTS-STARTPTS)/${p.f.toFixed(3)}[v${i}]`)
const fc = `${parts.join(';')};${keep.map((_, i) => `[v${i}]`).join('')}concat=n=${keep.length}:v=1:a=0[vout]`
execFileSync('ffmpeg', ['-y', '-i', input, '-filter_complex', fc, '-map', '[vout]', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', join(outDir, 'final.mp4')], { stdio: ['ignore', 'ignore', 'inherit'] })

// remap caption times through the same piece map
let acc = 0
const map = keep.map((p) => {
  const m = { a: p.a, b: p.b, f: p.f, out0: acc }
  acc += (p.b - p.a) / p.f
  return m
})
const remap = (t) => {
  const m = map.find((x) => t >= x.a && t < x.b) ?? map[map.length - 1]
  return m.out0 + (t - m.a) / m.f
}
const outEvents = events.filter((e) => e.type === 'caption' || e.type === 'caption-end').map((e) => ({ ...e, t: remap(e.t) }))
writeFileSync(join(outDir, 'timeline.json'), JSON.stringify({ events: outEvents, cursor: [] }, null, 2))

let worst = 0
const oc = outEvents.filter((e) => e.type === 'caption' && manifest[e.label]).sort((a, b) => a.t - b.t)
for (let i = 0; i < oc.length - 1; i++) worst = Math.max(worst, oc[i + 1].t - (oc[i].t + manifest[oc[i].label].dur))
console.log(`video ${D.toFixed(1)}s -> ${acc.toFixed(1)}s; max silence between lines now ${worst.toFixed(2)}s; ${keep.filter((p) => p.f > 1).length} stretches time-lapsed`)
