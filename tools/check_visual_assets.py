#!/usr/bin/env python3
"""Static checks for the CommsAtlas images and the refreshed styles.
Run with: python3 tools/check_visual_assets.py
Checks that every local image the page, the style sheets and the scripts name exists, that the page loads the refresh style sheet, and that the
refresh covers dark mode, small screens, reduced motion and print. It does not judge how anything looks: that needs a person and a browser.
"""
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
issues = []


def check(ok, message):
    if not ok:
        issues.append(message)


html = (SRC / "index.html").read_text(encoding="utf-8")
refresh = (SRC / "visual-refresh.css").read_text(encoding="utf-8")
sources = {"index.html": html, "visual-refresh.css": refresh, "styles.css": (SRC / "styles.css").read_text(encoding="utf-8")}
for js in sorted((SRC / "js").glob("*.js")):
    sources[f"js/{js.name}"] = js.read_text(encoding="utf-8")

check("/visual-refresh.css" in html, "index.html does not load /visual-refresh.css")
check("\\n  <link" not in html, "Found a literal escaped newline in the HTML head")
check('data-theme="dark"' in refresh, "visual-refresh.css has no dark-mode styling")
check("max-width:767px" in refresh, "visual-refresh.css has no small-screen breakpoint")
check("prefers-reduced-motion" in refresh, "visual-refresh.css has no reduced-motion rule")
check("@media print" in refresh, "visual-refresh.css has no print rule")

# Every image named by an address in the page, a style sheet or a script must exist (uploads and generated data are not named like this).
for name, text in sources.items():
    for asset in re.findall(r"/img/([A-Za-z0-9_.-]+\.(?:svg|png|jpg|jpeg|webp|ico))", text):
        check((SRC / "img" / asset).is_file(), f"{name} names an image that is missing: img/{asset}")

# Any SVG that is shipped must be well formed.
for svg in sorted((SRC / "img").glob("*.svg")):
    try:
        check(ET.parse(svg).getroot().tag.endswith("svg"), f"Not an SVG: {svg.name}")
    except ET.ParseError as error:
        issues.append(f"Invalid SVG {svg.name}: {error}")

if issues:
    for issue in sorted(set(issues)):
        print("FAIL:", issue, file=sys.stderr)
    sys.exit(1)

print("Image reference and style checks passed.")
