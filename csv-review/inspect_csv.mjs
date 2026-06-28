import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const file = "C:/Users/HunterPC/Downloads/Nueva carpeta/clientes_janos_importar de quinta.csv";
const text = (await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "");
const normalized = text.replaceAll(";", ",");
const workbook = await Workbook.fromCSV(normalized, { sheetName: "Clientes" });
const result = await workbook.inspect({
  kind: "table",
  range: "Clientes!A1:Z20",
  include: "values",
  tableMaxRows: 20,
  tableMaxCols: 26,
  tableMaxCellChars: 120,
  maxChars: 16000,
});
console.log(result.ndjson);

const lines = text.split(/\r?\n/).filter(Boolean);
const headers = lines[0].split(";").map(value => value.trim());
const rows = lines.slice(1).map(line => line.split(";"));
const phoneIndex = headers.findIndex(header => /whatsapp|telefono|celular/i.test(header));
const codeIndex = headers.findIndex(header => /codigo/i.test(header));
const nameIndex = headers.findIndex(header => /^cliente$/i.test(header));
const phoneRows = rows.map(row => ({ code: row[codeIndex], name: row[nameIndex], phone: row[phoneIndex] || "" }));
const missing = phoneRows.filter(row => !row.phone.trim());
const invalid = phoneRows.filter(row => row.phone.trim() && !/^\+?\d[\d\s()-]{7,20}$/.test(row.phone.trim()));
const duplicateCodes = phoneRows.filter((row,index,all) => all.findIndex(other => other.code === row.code) !== index);
console.log(JSON.stringify({ headers, rowCount: rows.length, phoneColumn: headers[phoneIndex] || null, missing, invalid, duplicateCodes, phoneRows }, null, 2));
