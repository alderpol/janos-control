import json
from pathlib import Path

import cv2
import numpy as np
import pypdfium2 as pdfium
from rapidocr_onnxruntime import RapidOCR


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "formato clientes.pdf"
OUT = ROOT / "ocr"
OUT.mkdir(exist_ok=True)

engine = RapidOCR()
pdf = pdfium.PdfDocument(SOURCE)
document = []

for page_index, page in enumerate(pdf):
    image = page.render(scale=3.0).to_pil().convert("RGB")
    image_path = OUT / f"page-{page_index + 1}.png"
    image.save(image_path)

    array = np.asarray(image)
    results, _ = engine(array)
    entries = []
    annotated = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
    for box, text, confidence in results or []:
        points = [[round(float(x), 2), round(float(y), 2)] for x, y in box]
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        entries.append(
            {
                "text": text,
                "confidence": round(float(confidence), 4),
                "box": points,
                "x": round(min(xs), 2),
                "y": round(min(ys), 2),
                "width": round(max(xs) - min(xs), 2),
                "height": round(max(ys) - min(ys), 2),
            }
        )
        cv2.polylines(
            annotated,
            [np.asarray(points, dtype=np.int32)],
            True,
            (0, 0, 255),
            2,
        )

    entries.sort(key=lambda item: (item["y"], item["x"]))
    cv2.imwrite(str(OUT / f"page-{page_index + 1}-boxes.png"), annotated)
    document.append(
        {
            "page": page_index + 1,
            "width": image.width,
            "height": image.height,
            "entries": entries,
        }
    )
    print(f"page {page_index + 1}: {len(entries)} text blocks")

(OUT / "ocr.json").write_text(
    json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
)
