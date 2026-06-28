import json
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "formato clientes.pdf"

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
    image = page.render(scale=1.35).to_pil().convert("RGB")
    image.thumbnail((900, 1250))
    tile = Image.new("RGB", (930, 1300), "white")
    tile.paste(image, ((930 - image.width) // 2, 35))
    ImageDraw.Draw(tile).text((12, 10), f"Página {index + 1}", fill="black")
    tiles.append(tile)

cols = 2 if len(tiles) > 1 else 1
rows = (len(tiles) + cols - 1) // cols
contact = Image.new("RGB", (cols * 930, rows * 1300), "#D9D9D9")
for index, tile in enumerate(tiles):
    contact.paste(tile, ((index % cols) * 930, (index // cols) * 1300))
contact.save(ROOT / "contact.png")

print(json.dumps({"pages": len(pages), "tables": [len(page["tables"]) for page in pages]}, indent=2))
