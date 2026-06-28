from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "source_docs"
OUT = ROOT / "pdf_previews"
OUT.mkdir(exist_ok=True)

for source in sorted(DOCS.glob("*.pdf")):
    pdf = pdfium.PdfDocument(source)
    thumbs = []
    for index, page in enumerate(pdf):
        image = page.render(scale=0.7).to_pil().convert("RGB")
        image.thumbnail((420, 580))
        tile = Image.new("RGB", (440, 620), "white")
        tile.paste(image, ((440 - image.width) // 2, 28))
        ImageDraw.Draw(tile).text((12, 8), f"Page {index + 1}", fill="black")
        thumbs.append(tile)

    cols = 4 if len(thumbs) > 4 else 2
    rows = (len(thumbs) + cols - 1) // cols
    contact = Image.new("RGB", (cols * 440, rows * 620), "#D9D9D9")
    for index, thumb in enumerate(thumbs):
        contact.paste(thumb, ((index % cols) * 440, (index // cols) * 620))
    contact.save(OUT / f"{source.stem}_contact.png")
    print(OUT / f"{source.stem}_contact.png")
