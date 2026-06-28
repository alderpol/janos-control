import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const root = "C:/Users/HunterPC/Downloads/Nueva carpeta";
const outputDir = "C:/Users/HunterPC/Documents/New project/outputs/contactos";
const contacts = JSON.parse(await fs.readFile("C:/Users/HunterPC/Documents/New project/tmp/pdfs/quinta-contactos/contacts.json", "utf8"));
const sources = [
  { salon: "quinta", file: `${root}/clientes_janos_quinta_importar.csv` },
  { salon: "pilar", file: `${root}/clientes_janos_importar.csv` },
];

function parseSemicolon(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(";");
  return { headers, rows: lines.map(line => line.split(";")) };
}

const outputHeaders = ["codigo", "fecha_evento", "salon", "tipo", "homenajeado", "cliente", "whatsapp", "invitados", "pack_upgrades", "adicionales", "servicios_flex", "observaciones"];
const combined = [];
const missing = [];

for (const source of sources) {
  const parsed = parseSemicolon(await fs.readFile(source.file, "utf8"));
  const indexes = Object.fromEntries(parsed.headers.map((header, index) => [header, index]));
  const rowsByCode = new Map(parsed.rows.map(row => [String(row[indexes.codigo] || "").trim(), row]));
  for (const contact of contacts[source.salon]) {
    const row = rowsByCode.get(contact.code);
    if (!row) {
      missing.push(`${source.salon}:${contact.code}`);
      continue;
    }
    combined.push([
      contact.code,
      row[indexes.fecha_evento],
      row[indexes.salon],
      row[indexes.tipo],
      row[indexes.homenajeado],
      row[indexes.cliente],
      contact.phone,
      row[indexes.invitados],
      row[indexes.pack_upgrades],
      row[indexes.adicionales],
      row[indexes.servicios_flex],
      row[indexes.observaciones],
    ]);
  }
}

if (missing.length) throw new Error(`Codes missing from source CSV: ${missing.join(", ")}`);
if (new Set(combined.map(row => row[0])).size !== combined.length) throw new Error("Duplicate event codes in combined output");

const escapeCell = (value, delimiter) => {
  const text = String(value ?? "");
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const makeCsv = (delimiter) => [outputHeaders, ...combined].map(row => row.map(value => escapeCell(value, delimiter)).join(delimiter)).join("\r\n") + "\r\n";

await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "clientes_janos_quinta_y_pilar_con_whatsapp.csv");
await fs.writeFile(outputPath, `\uFEFF${makeCsv(";")}`, "utf8");

const workbook = await Workbook.fromCSV(makeCsv(","), { sheetName: "Contactos" });
const sheet = workbook.worksheets.getItem("Contactos");
sheet.getRange("A1:L84").format.autofitColumns();
sheet.getRange("G2:G84").format.numberFormat = "0";
sheet.getRange("A1:L1").format = { fill: "#5B2A86", font: { bold: true, color: "#FFFFFF" } };
sheet.getRange("A1:L84").format.rowHeight = 22;
const inspection = await workbook.inspect({
  kind: "table",
  range: "Contactos!A1:L12",
  include: "values",
  tableMaxRows: 12,
  tableMaxCols: 12,
  maxChars: 10000,
});
const preview = await workbook.render({ sheetName: "Contactos", range: "A1:L12", scale: 1.2, format: "png" });
await fs.writeFile(path.join(outputDir, "contactos_preview.png"), new Uint8Array(await preview.arrayBuffer()));
console.log(JSON.stringify({ outputPath, rows: combined.length, quinta: contacts.quinta.length, pilar: contacts.pilar.length, inspection: inspection.ndjson }, null, 2));
