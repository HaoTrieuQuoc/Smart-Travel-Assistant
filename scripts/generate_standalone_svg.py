import re
from pathlib import Path

SVG_PATH = Path("docs/diagrams/smart-travel-assistant/smart-travel-assistant.svg")
HTML_PATH = Path("docs/diagrams/smart-travel-assistant/smart-travel-assistant.html")

html = HTML_PATH.read_text(encoding="utf-8")
start = html.find('<svg id="dia"')
end = html.find('</svg>', start) + len('</svg>')
raw_svg = html[start:end]

# Embed complete standalone SVG styles inside <defs>
css = """
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;display=swap');
    text { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .gl { font-size: 13px; font-weight: 600; fill: #232F3E; }
    .gs { font-size: 12px; fill: #545B64; }
    .nl { font-size: 13px; font-weight: 600; fill: #16202B; }
    .ns { font-size: 11.5px; fill: #545B64; }
    .hit { fill: transparent; }
    .flow { fill: none; stroke-width: 2.2; }
    path.f-ocr { stroke: #2563EB; fill: none; }
    .mk-ocr { fill: #2563EB; }
    .b-ocr { fill: #2563EB; }
    .c-ocr { fill: #2563EB; }
    path.f-confirm { stroke: #E07A00; fill: none; }
    .mk-confirm { fill: #E07A00; }
    .b-confirm { fill: #E07A00; }
    .c-confirm { fill: #E07A00; }
    path.f-remind { stroke: #0E8F7E; fill: none; }
    .mk-remind { fill: #0E8F7E; }
    .b-remind { fill: #0E8F7E; }
    .c-remind { fill: #0E8F7E; }
    .flbox { fill: none; stroke: none; }
    .flabel { font-size: 12px; font-weight: 600; paint-order: stroke; stroke: #FFFFFF; stroke-width: 4px; stroke-linejoin: round; }
    .badge circle { stroke: #FFFFFF; stroke-width: 2; }
    .bt { font-size: 12px; font-weight: 700; fill: #FFFFFF; }
  </style>
"""

# Insert style into <defs>
raw_svg = raw_svg.replace('<defs>', '<defs>' + css, 1)

# In addition, add inline presentation attributes directly to elements as bulletproof fallback:
raw_svg = raw_svg.replace('class="hit"', 'class="hit" fill="none"')
raw_svg = raw_svg.replace('class="flow ocr f-ocr"', 'class="flow ocr f-ocr" fill="none" stroke="#2563EB" stroke-width="2.2"')
raw_svg = raw_svg.replace('class="flow confirm f-confirm"', 'class="flow confirm f-confirm" fill="none" stroke="#E07A00" stroke-width="2.2"')
raw_svg = raw_svg.replace('class="flow remind f-remind"', 'class="flow remind f-remind" fill="none" stroke="#0E8F7E" stroke-width="2.2"')
raw_svg = raw_svg.replace('class="flow"', 'class="flow" fill="none" stroke="#7D8998" stroke-width="1.2"')
raw_svg = raw_svg.replace('class="flbox"', 'class="flbox" fill="none" stroke="none"')
raw_svg = raw_svg.replace('class="flabel c-ocr"', 'class="flabel c-ocr" fill="#2563EB"')
raw_svg = raw_svg.replace('class="flabel c-confirm"', 'class="flabel c-confirm" fill="#E07A00"')
raw_svg = raw_svg.replace('class="flabel c-remind"', 'class="flabel c-remind" fill="#0E8F7E"')

SVG_PATH.write_text(raw_svg, encoding="utf-8")
print(f"Wrote self-contained SVG to {SVG_PATH}, size: {len(raw_svg)}")
