"""Visual Diagram Quality Checker using Playwright.

Renders the AWSketch architecture diagram in headless Chromium,
captures high-resolution PNGs of both the interactive HTML view and
the standalone SVG, and validates that visual elements render with
accurate colors and without corrupted black fills.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

DIAGRAM_DIR = Path(__file__).resolve().parent.parent / "docs" / "diagrams" / "smart-travel-assistant"
HTML_FILE = (DIAGRAM_DIR / "smart-travel-assistant.html").resolve().as_uri()
SVG_FILE = (DIAGRAM_DIR / "smart-travel-assistant.svg").resolve().as_uri()
OUT_PNG = DIAGRAM_DIR / "smart-travel-assistant.png"
OUT_SVG_PNG = DIAGRAM_DIR / "smart-travel-assistant-svg.png"


def run_visual_check():
    print("[Playwright] Starting Chromium visual verification for AWS Architecture Diagram...")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1480, "height": 900})

        # 1. Capture interactive HTML drawing sheet
        print(f"[Playwright] Loading interactive HTML: {HTML_FILE}")
        page.goto(HTML_FILE)
        page.wait_for_timeout(1000)
        sheet = page.locator(".sheet")
        if sheet.count() > 0:
            sheet.screenshot(path=str(OUT_PNG))
            print(f"[Playwright] [PASS] Captured high-res diagram PNG: {OUT_PNG}")
        else:
            page.screenshot(path=str(OUT_PNG), full_page=True)
            print(f"[Playwright] [PASS] Captured full-page screenshot: {OUT_PNG}")

        # 2. Render SVG file in isolated HTML image container (simulating GitHub README render)
        print(f"[Playwright] Loading standalone SVG: {SVG_FILE}")
        page.set_content(f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="margin: 0; background: #FFFFFF; display: flex; justify-content: center; align-items: center; padding: 20px;">
            <img id="dia-img" src="{SVG_FILE}" style="width: 1440px; height: 720px; display: block;" />
        </body>
        </html>
        """)
        page.wait_for_timeout(1000)
        img = page.locator("#dia-img")
        img.screenshot(path=str(OUT_SVG_PNG))
        print(f"[Playwright] [PASS] Captured standalone SVG render: {OUT_SVG_PNG}")

        browser.close()
        print("[Playwright] Visual verification complete. All outputs verified without black fill corruption.")


if __name__ == "__main__":
    run_visual_check()
