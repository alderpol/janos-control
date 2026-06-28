from pathlib import Path
import pdfplumber

sources = {
    "quinta": Path(r"C:\Users\HunterPC\Downloads\Nueva carpeta\Jano's Fotografia quinta extraer numeros de contacto.pdf"),
    "pilar": Path(r"C:\Users\HunterPC\Downloads\Nueva carpeta\Jano's Fotografia pilar hotel extraer numeros de contacto.pdf"),
}

for name, source in sources.items():
    pages = []
    with pdfplumber.open(source) as pdf:
        print(f"{name}_pages={len(pdf.pages)}")
        for number, page in enumerate(pdf.pages, start=1):
            pages.append(f"\n--- PAGE {number} ---\n{page.extract_text(layout=True) or ''}")
    output = Path(__file__).parent / f"{name}.txt"
    output.write_text("\n".join(pages), encoding="utf-8")
