import json
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
documents = []

for source in sorted(ROOT.glob("*.pdf")):
    pages = []
    with pdfplumber.open(source) as pdf:
        for number, page in enumerate(pdf.pages, start=1):
            pages.append({
                "page": number,
                "text": page.extract_text(x_tolerance=2, y_tolerance=3) or "",
                "tables": page.extract_tables(),
            })

    rendered = pdfium.PdfDocument(source)
    tiles = []
    for index, page in enumerate(rendered):
        image = page.render(scale=1.1).to_pil().convert("RGB")
        image.thumbnail((620, 860))
        tile = Image.new("RGB", (650, 910), "white")
        tile.paste(image, ((650 - image.width) // 2, 35))
        ImageDraw.Draw(tile).text((12, 10), f"Página {index + 1}", fill="black")
        tiles.append(tile)

    cols = 3 if len(tiles) > 4 else 2 if len(tiles) > 1 else 1
    rows = (len(tiles) + cols - 1) // cols
    contact = Image.new("RGB", (cols * 650, rows * 910), "#D9D9D9")
    for index, tile in enumerate(tiles):
        contact.paste(tile, ((index % cols) * 650, (index // cols) * 910))
    preview = ROOT / f"{source.stem}_contact.png"
    contact.save(preview)

    documents.append({"file": source.name, "pages": pages, "preview": str(preview)})

(ROOT / "extracted.json").write_text(
    json.dumps({"documents": documents}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print(json.dumps([
    {"file": item["file"], "pages": len(item["pages"]), "tables": [len(page["tables"]) for page in item["pages"]]}
    for item in documents
], ensure_ascii=False, indent=2))
