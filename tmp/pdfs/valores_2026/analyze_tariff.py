import json
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "5. VALORES FOTOGRAFIA 2026.pdf"

pages = []
with pdfplumber.open(SOURCE) as pdf:
    for number, page in enumerate(pdf.pages, start=1):
        pages.append({
            "page": number,
            "text": page.extract_text(x_tolerance=2, y_tolerance=3) or "",
            "tables": page.extract_tables(),
        })

(ROOT / "extracted.json").write_text(
    json.dumps({"file": SOURCE.name, "pages": pages}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

pdf = pdfium.PdfDocument(SOURCE)
tiles = []
for index, page in enumerate(pdf):
    image = page.render(scale=1.4).to_pil().convert("RGB")
    image.thumbnail((800, 1100))
    tile = Image.new("RGB", (840, 1160), "white")
    tile.paste(image, ((840 - image.width) // 2, 40))
    ImageDraw.Draw(tile).text((15, 12), f"Página {index + 1}", fill="black")
    tiles.append(tile)

cols = 2 if len(tiles) > 1 else 1
rows = (len(tiles) + cols - 1) // cols
contact = Image.new("RGB", (cols * 840, rows * 1160), "#D9D9D9")
for index, tile in enumerate(tiles):
    contact.paste(tile, ((index % cols) * 840, (index // cols) * 1160))
contact.save(ROOT / "contact.png")

print(json.dumps({"pages": len(pages), "tables": [len(page["tables"]) for page in pages]}, indent=2))
