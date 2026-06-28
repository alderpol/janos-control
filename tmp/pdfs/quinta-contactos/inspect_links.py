from pathlib import Path
import json
import re
import pdfplumber

sources = {
    "quinta": Path(r"C:\Users\HunterPC\Downloads\Nueva carpeta\Jano's Fotografia quinta extraer numeros de contacto.pdf"),
    "pilar": Path(r"C:\Users\HunterPC\Downloads\Nueva carpeta\Jano's Fotografia pilar hotel extraer numeros de contacto.pdf"),
}

all_contacts = {}
for name, source in sources.items():
    contacts = []
    with pdfplumber.open(source) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            links = [link for link in page.hyperlinks if link.get("uri")]
            words = page.extract_words()
            seen = set()
            for link in links:
                match = re.search(r"phone=(\d+)", link["uri"])
                if not match:
                    continue
                phone = match.group(1)
                top = float(link.get("top", 0))
                key = (phone, round(top / 3))
                if key in seen:
                    continue
                seen.add(key)
                codes = []
                for word in words:
                    code_match = re.search(r"(?:\d{2}/\d{2}/\d{4})?(\d{5})(?:\D|$)", word["text"])
                    if code_match and float(word["x0"]) < 250 and abs(float(word["top"]) - top) < 22:
                        codes.append({**word, "code": code_match.group(1)})
                if not codes:
                    raise RuntimeError(f"No code near {name} page {page_number}, phone {phone}")
                code = min(codes, key=lambda word: abs(float(word["top"]) - top))["code"]
                if not any(item["code"] == code for item in contacts):
                    contacts.append({"code": code, "phone": phone, "page": page_number})
    all_contacts[name] = contacts
    print(f"{name}: {len(contacts)} contacts")

output = Path(__file__).parent / "contacts.json"
output.write_text(json.dumps(all_contacts, ensure_ascii=False, indent=2), encoding="utf-8")
