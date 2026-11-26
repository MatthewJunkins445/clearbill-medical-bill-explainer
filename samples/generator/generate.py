"""Regenerate every synthetic sample bill under samples/bills/.

    python samples/generator/generate.py

Deterministic: same code + same pinned dependencies -> byte-identical output.
ALL DATA IS SYNTHETIC.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bills import all_bills  # noqa: E402
from common import approx_tokens, finalize, money, us_date  # noqa: E402

SAMPLES = HERE.parent
BILLS_DIR = SAMPLES / "bills"


def _keep_list(bill, text):
    keep = []
    seen = set()

    def add(value, reason):
        if value and value not in seen and value != "0.00":
            seen.add(value)
            keep.append({"value": value, "reason": reason})

    for line in bill["lines"]:
        add(line.code, f"{line.system} code")
    for line in bill["lines"]:
        add(us_date(line.date), "service date")
    for line in bill["lines"]:
        add(money(line.charge), "line charge")
    t = bill["totals"]
    if t:
        for key in ("charges", "adjustments", "insurancePaid", "patientResponsibility"):
            add(money(t[key]), f"total {key}")
    for value, reason in bill["keep"]:
        add(value, reason)
    missing = [k["value"] for k in keep if k["value"] not in text]
    if missing:
        raise ValueError(f"{bill['id']}: mustKeep values not in text: {missing}")
    return keep


def write_pdf(text, path, title):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    lines = text.split("\n")
    per_page = 72
    c = canvas.Canvas(str(path), pagesize=letter, invariant=1, pageCompression=1)
    c.setTitle(title)
    c.setAuthor("ClearBill synthetic sample generator")
    c.setSubject("SYNTHETIC DATA - not a real bill")
    _, height = letter
    for start in range(0, len(lines), per_page):
        c.setFont("Courier", 8)
        y = height - 36
        for ln in lines[start:start + per_page]:
            c.drawString(36, y, ln)
            y -= 10
        c.showPage()
    c.save()


def write_png(text, path):
    import reportlab
    from PIL import Image, ImageDraw, ImageFont

    font_path = os.path.join(os.path.dirname(reportlab.__file__), "fonts", "com_____.pfb")
    font = ImageFont.truetype(font_path, 16)
    lines = text.split("\n")
    cw, lh, margin = 10, 20, 40
    width = margin * 2 + cw * max(len(ln) for ln in lines)
    height = margin * 2 + lh * len(lines)
    img = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(img)
    for i, ln in enumerate(lines):
        draw.text((margin, margin + i * lh), ln, fill=0, font=font)
    img.save(path, format="PNG", optimize=True)


def build(bill):
    text, pii = finalize(bill["template"])
    out = BILLS_DIR / bill["id"]
    out.mkdir(parents=True, exist_ok=True)
    (out / "bill.txt").write_bytes(text.encode("ascii"))
    files = {"text": "bill.txt", "pdf": "bill.pdf"}
    write_pdf(text, out / "bill.pdf", f"Synthetic sample bill {bill['id']}")
    if bill["png"]:
        write_png(text, out / "bill.png")
        files["image"] = "bill.png"

    t = bill["totals"]
    gt = {
        "schemaVersion": 1,
        "id": bill["id"],
        "synthetic": True,
        "kind": bill["kind"],
        "description": bill["description"],
        "files": files,
        "approxTokens": approx_tokens(text),
        "pii": pii,
        "mustKeep": _keep_list(bill, text),
        "lineItems": [l.ground_truth() for l in bill["lines"]],
        "totals": None if t is None else {k: v / 100 for k, v in t.items()},
        "plantedIssues": [{"type": ty, "lineIndexes": idx, "note": note}
                          for ty, idx, note in bill["issues"]],
        "tags": bill["tags"],
    }
    (out / "ground-truth.json").write_text(json.dumps(gt, indent=2) + "\n", encoding="ascii",
                                           newline="\n")
    return gt


def main():
    if BILLS_DIR.exists():
        shutil.rmtree(BILLS_DIR)
    BILLS_DIR.mkdir()
    for bill in all_bills():
        gt = build(bill)
        print(f"{gt['id']:<34} {gt['kind']:<18} tokens~{gt['approxTokens']:<6} "
              f"pii={len(gt['pii']):<3} lines={len(gt['lineItems']):<4} "
              f"issues={','.join(i['type'] for i in gt['plantedIssues']) or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
