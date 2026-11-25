/**
 * Mixes narration clips into a captioned video, placing each clip at its caption's start time.
 * Caption times come from <renderDir>/timeline.json (already remapped to final-video time by compose).
 * Usage: node demos/_lib/mix-narration.mjs <renderDir> [--video final-captioned.mp4] [--out final-narrated.mp4]
 * Run from the project root. Reports overlaps (a clip still playing when the next one starts).
 */
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'

const renderDir = process.argv[2]
if (!renderDir) throw new Error('usage: mix-narration.mjs <renderDir> [--video f] [--out f]')
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : d
}
const video = join(renderDir, arg('video', 'final-captioned.mp4'))
const out = join(renderDir, arg('out', 'final-narrated.mp4'))
const manifest = JSON.parse(readFileSync('demos/slack-demo/audio/manifest.json', 'utf8'))
const { events } = JSON.parse(readFileSync(join(renderDir, 'timeline.json'), 'utf8'))

const cues = events
  .filter((e) => e.type === 'caption' && manifest[e.label])
  .sort((a, b) => a.t - b.t)
  .map((e) => ({ t: e.t, file: resolve(manifest[e.label].file), dur: manifest[e.label].dur, text: e.label }))
if (!cues.length) throw new Error('no caption events matched the manifest')

let overlaps = 0
for (let i = 0; i < cues.length - 1; i++) {
  const over = cues[i].t + cues[i].dur - cues[i + 1].t
  if (over > 0.05) {
    overlaps++
    console.warn(`OVERLAP ${over.toFixed(2)}s: "${cues[i].text.slice(0, 40)}" runs into the next line`)
  }
}

const inputs = cues.flatMap((c) => ['-i', c.file])
const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.t * 1000)}|${Math.round(c.t * 1000)},volume=1.0[a${i}]`)
const mix = `${delays.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
execFileSync(
  'ffmpeg',
  ['-y', '-i', video, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', out],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)
console.log(`${cues.length} clips mixed, ${overlaps} overlaps -> ${out}`)
