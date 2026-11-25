# STA brand assets (Smart Travel Assistant)

| File | What it is |
|---|---|
| `logo.svg`, `logo.png` | STA bot logo: a bot wearing glasses, paper-plane antenna. SVG is the source; PNG is 1024px, transparent |
| `intro.html`, `outro.html` | Animated 1920x1080 slides (pure HTML/CSS, Plus Jakarta Sans). Colours: navy `#0A2342`, amber `#FFB547`, teal `#3DE0C5` |
| `intro.png`, `outro.png` | Still images of the two slides |
| `intro.wav`, `outro.wav` | Background music, synthesised by `demos/_lib/make-brand-music.py` (no samples or third-party tracks, so no licence issues) |
| `intro.mp4` (5.4 s), `outro.mp4` (7.0 s) | Final videos: 1920x1080, 30 fps, H.264 + AAC 48 kHz stereo, fade-out at the end |

Regenerate (from the project root, ffmpeg on PATH):

```powershell
python demos/_lib/make-brand-music.py          # intro.wav, outro.wav
node demos/_lib/render-brand-video.mjs both    # intro.mp4, outro.mp4 and the PNG stills
```

Join with the demo video (example, re-encoding to a common format):

```powershell
ffmpeg -i intro.mp4 -i ../final/smart-travel-assistant-slack-demo.mp4 -i outro.mp4 `
  -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]" -map "[v]" -map "[a]" full.mp4
```
