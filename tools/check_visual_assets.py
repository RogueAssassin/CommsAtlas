#!/usr/bin/env python3
"""Static checks for the CommsAtlas visual assets and the refreshed UI.
Run with: python3 tools/check_visual_assets.py
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
css = (SRC / "visual-refresh.css").read_text(encoding="utf-8")
util = (SRC / "js" / "util.js").read_text(encoding="utf-8")

for path in ("img/atlas-symbol.svg", "img/atlas-wordmark.svg", "img/atlas-infrastructure.svg"):
    file = SRC / path
    check(file.is_file(), f"Missing artwork: {path}")
    if file.is_file():
        try:
            tree = ET.parse(file)
            check(tree.getroot().tag.endswith("svg"), f"Not SVG: {path}")
        except ET.ParseError as error:
            issues.append(f"Invalid SVG {path}: {error}")

for asset in ("visual-refresh.css", "img/atlas-symbol.svg"):
    check(("/" + asset) in html, f"HTML does not reference {asset}")

for asset in ("img/atlas-symbol.svg", "img/atlas-wordmark.svg"):
    check(("/" + asset) in util, f"JS branding does not reference {asset}")

check("url('/img/atlas-infrastructure.svg')" in css,
      "Login background does not use the new infrastructure artwork")
check("data-theme=\"dark\"" in css, "Missing dark-mode styling")
check("max-width:767px" in css, "Missing mobile breakpoint")
check("grid-template-areas:" in css, "Missing responsive grid area definitions")
check("\\n  <link" not in html, "Found literal escaped newline in HTML head")

# Verify local images used in CSS or HTML are present; user uploads and
# runtime-generated data URLs are intentionally outside this test.
for text in (html, css):
    for asset in re.findall(r"/img/([A-Za-z0-9_.-]+(?:\.svg|\.png|\.jpg|\.webp))", text):
        check((SRC / "img" / asset).is_file(), f"Referenced image missing: {asset}")

if issues:
    for issue in sorted(set(issues)):
        print("FAIL:", issue, file=sys.stderr)
    sys.exit(1)

print("Visual asset and reference checks passed.")
