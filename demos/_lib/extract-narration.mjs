// Extracts the say('...') lines from demos/slack-demo/run.mjs into demos/slack-demo/narration.json
import { readFileSync, writeFileSync } from 'fs'
const src = readFileSync('demos/slack-demo/run.mjs', 'utf8')
const re = /\bsay\('([^']+)',\s*[\d.]+\)/g
const out = []
let m
while ((m = re.exec(src))) out.push({ id: 'n' + String(out.length + 1).padStart(2, '0'), text: m[1] })
writeFileSync('demos/slack-demo/narration.json', JSON.stringify(out, null, 2))
console.log(out.length, 'lines,', out.reduce((a, b) => a + b.text.length, 0), 'chars')
for (const o of out) console.log(o.id, o.text)
