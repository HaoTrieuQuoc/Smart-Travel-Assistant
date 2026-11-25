/**
 * Burns English captions into <renderDir>/final.mp4 using caption events from timeline.json
 * (timestamps already remapped to final-video time by compose).
 * Usage: node demos/_lib/burn-captions.mjs <renderDir> [--out path.mp4]
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

const renderDir = process.argv[2]
if (!renderDir) throw new Error('usage: burn-captions.mjs <renderDir> [--out file]')
const outIdx = process.argv.indexOf('--out')
const out = outIdx > 0 ? process.argv[outIdx + 1] : join(renderDir, 'final-captioned.mp4')

const { events } = JSON.parse(readFileSync(join(renderDir, 'timeline.json'), 'utf8'))
const marks = events.filter((e) => e.type === 'caption' || e.type === 'caption-end').sort((a, b) => a.t - b.t)
const cues = []
for (let i = 0; i < marks.length; i++) {
  if (marks[i].type !== 'caption') continue
  const next = marks[i + 1]
  const end = next ? Math.max(marks[i].t + 1.5, next.t - 0.05) : marks[i].t + 4
  cues.push({ start: marks[i].t, end, text: marks[i].label })
}
const ts = (s) => {
  const ms = Math.round(s * 1000)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
const srt = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n')
writeFileSync(join(renderDir, 'captions.srt'), srt, 'utf8')
console.log(`${cues.length} cues -> ${join(renderDir, 'captions.srt')}`)

const style = 'FontName=Arial,FontSize=10,Bold=1,PrimaryColour=&H00FFFFFF&,OutlineColour=&H80000000&,BackColour=&H80000000&,BorderStyle=3,Outline=1,Shadow=0,MarginV=14,Alignment=2'
// run ffmpeg with cwd = renderDir so the subtitles path has no drive-letter escaping issues
execFileSync(
  'ffmpeg',
  ['-y', '-i', 'final.mp4', '-vf', `subtitles=captions.srt:force_style='${style}'`, '-c:a', 'copy', '-pix_fmt', 'yuv420p', out.startsWith('/') || /^[A-Za-z]:/.test(out) ? out : join(process.cwd(), out)],
  { cwd: renderDir, stdio: 'inherit' },
)
console.log('Wrote', out)
