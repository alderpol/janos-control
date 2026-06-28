import json
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "7. UPGRADE MINI FLEX o FLEX Lista abr24 (1).pdf"

pages = []
with pdfplumber.open(SOURCE) as pdf:
    for number, page in enumerate(pdf.pages, start=1):
        pages.append({
            "page": number,
            "text": page.extract_text(x_tolerance=2, y_tolerance=3) or "",
            "tables": page.extract_tables(),
        })

(ROOT / "flex_extracted.json").write_text(
    json.dumps({"file": SOURCE.name, "pages": pages}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

pdf = pdfium.PdfDocument(SOURCE)
for index, page in enumerate(pdf):
    page.render(scale=1.8).to_pil().convert("RGB").save(ROOT / f"flex_page_{index + 1}.png")

print(json.dumps({"pages": len(pages), "tables": [len(page["tables"]) for page in pages]}, indent=2))
