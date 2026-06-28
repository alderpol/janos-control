import csv
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT.parents[1] / "output"
SOURCE = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else ROOT / "Nueva carpeta" / "Jano's Fotografia_files" / "seguimiento.html"
)
OUTPUT = (
    Path(sys.argv[2]).resolve()
    if len(sys.argv) > 2
    else OUTPUT_DIR / "clientes_janos_importar.csv"
)
AUDIT = OUTPUT.with_name(f"{OUTPUT.stem}_auditoria.json")

CSV_HEADERS = [
    "codigo",
    "fecha_evento",
    "salon",
    "tipo",
    "homenajeado",
    "cliente",
    "invitados",
    "pack_upgrades",
    "adicionales",
    "servicios_flex",
    "observaciones",
]


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


class FirstTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.table_depth = 0
        self.finished = False
        self.in_cell = False
        self.cell_parts = []
        self.row = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "table" and not self.finished:
            self.table_depth += 1
        elif self.table_depth == 1 and tag == "tr":
            self.row = []
        elif self.table_depth == 1 and tag in {"th", "td"}:
            self.in_cell = True
            self.cell_parts = []
        elif self.in_cell and tag == "br":
            self.cell_parts.append(" | ")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.table_depth == 1 and tag in {"th", "td"}:
            self.row.append(clean("".join(self.cell_parts)))
            self.in_cell = False
            self.cell_parts = []
        elif self.table_depth == 1 and tag == "tr":
            if self.row:
                self.rows.append(self.row)
            self.row = []
        elif tag == "table" and self.table_depth:
            self.table_depth -= 1
            if self.table_depth == 0:
                self.finished = True

    def handle_data(self, data):
        if self.in_cell:
            self.cell_parts.append(data)


def normalize_salon(value):
    return re.sub(r"^\d+\s*-\s*", "", clean(value))


def normalize_photography(photography):
    tags = [clean(part) for part in photography.split("|") if clean(part)]
    return " ".join(tags).strip()


parser = FirstTableParser()
source_bytes = SOURCE.read_bytes()
try:
    source_text = source_bytes.decode("utf-8")
    source_encoding = "utf-8"
except UnicodeDecodeError:
    source_text = source_bytes.decode("windows-1252")
    source_encoding = "windows-1252"
parser.feed(source_text)

if not parser.rows:
    raise RuntimeError("No se encontro la tabla de clientes")

headers = parser.rows[0]
expected_headers = [
    "Fecha Evento",
    "Codigo Evento",
    "Tipo",
    "Pack",
    "Salon",
    "Zona",
    "Invitados",
    "Fotografia",
    "Cliente",
    "Celular",
    "Homenajead@",
    "Contacto",
    "Fecha de entrega online video",
    "Fecha entrega online fotos",
    "Fecha de alta contrato",
    "Book",
    "Ultimo cambio",
    "Dias",
]
if headers != expected_headers:
    raise RuntimeError(f"Encabezados inesperados: {headers!r}")

records = []
source_rows = []
for row_number, cells in enumerate(parser.rows[1:], start=2):
    if len(cells) != len(headers):
        raise RuntimeError(
            f"Fila HTML {row_number}: se esperaban {len(headers)} columnas y hay {len(cells)}"
        )
    source = dict(zip(headers, cells))
    source_rows.append(source)
    honoree = source["Homenajead@"]
    if honoree in {"", "-"}:
        honoree = source["Cliente"]
    observations = []
    if source["Pack"]:
        observations.append(f"Pack contratado: {source['Pack']}")
    if source["Zona"]:
        observations.append(f"Zona: {source['Zona']}")
    records.append(
        {
            "codigo": source["Codigo Evento"],
            "fecha_evento": source["Fecha Evento"],
            "salon": normalize_salon(source["Salon"]),
            "tipo": source["Tipo"],
            "homenajeado": honoree,
            "cliente": source["Cliente"],
            "invitados": source["Invitados"],
            "pack_upgrades": normalize_photography(source["Fotografia"]),
            "adicionales": "",
            "servicios_flex": "",
            "observaciones": ". ".join(observations),
        }
    )

codes = [record["codigo"] for record in records]
duplicates = sorted({code for code in codes if codes.count(code) > 1})
invalid_dates = [
    record["fecha_evento"]
    for record in records
    if not re.fullmatch(r"\d{2}/\d{2}/\d{4}", record["fecha_evento"])
]
if duplicates or invalid_dates:
    raise RuntimeError(
        f"Validacion fallida. Codigos duplicados={duplicates}; fechas invalidas={invalid_dates}"
    )

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
with OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=CSV_HEADERS, delimiter=";")
    writer.writeheader()
    writer.writerows(records)

AUDIT.write_text(
    json.dumps(
        {
            "source": str(SOURCE),
            "source_encoding": source_encoding,
            "row_count": len(records),
            "codes": codes,
            "records": records,
            "source_rows": source_rows,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

print(
    json.dumps(
        {
            "output": str(OUTPUT),
            "source_encoding": source_encoding,
            "rows": len(records),
            "first_code": codes[0],
            "last_code": codes[-1],
        },
        ensure_ascii=False,
    )
)
