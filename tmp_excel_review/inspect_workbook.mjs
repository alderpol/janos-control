import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = path.resolve("tmp_excel_review");
const source = path.join(root, "Janos Quinta y Pilar Hotel.xlsx");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));

const overview = await workbook.inspect({
  kind: "workbook,sheet,table,definedName,drawing",
  maxChars: 30000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 140,
});

const sheetList = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 10000 });
const names = [...sheetList.ndjson.matchAll(/"name":"([^"]+)"/g)].map((match) => match[1]);
const details = [];

await fs.mkdir(path.join(root, "previews"), { recursive: true });
for (const name of names) {
  const sheet = workbook.worksheets.getItem(name);
  const used = sheet.getUsedRange();
  const address = used?.address ?? null;
  const region = address
    ? await workbook.inspect({
        kind: "region",
        sheetId: name,
        range: address,
        maxChars: 20000,
        tableMaxRows: 80,
        tableMaxCols: 40,
        tableMaxCellChars: 160,
      })
    : null;
  const formulas = address
    ? await workbook.inspect({
        kind: "formula",
        sheetId: name,
        range: address,
        maxChars: 10000,
        options: { maxResults: 300 },
      })
    : null;
  const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
  const safeName = name.replace(/[<>:"/\\|?*]+/g, "_");
  const previewPath = path.join(root, "previews", `${safeName}.png`);
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
  details.push({ name, address, region: region?.ndjson ?? "", formulas: formulas?.ndjson ?? "", previewPath });
}

await fs.writeFile(
  path.join(root, "analysis.json"),
  JSON.stringify({ overview: overview.ndjson, sheets: details }, null, 2),
  "utf8",
);

console.log(JSON.stringify({ sheetNames: names, details: details.map(({ name, address, previewPath }) => ({ name, address, previewPath })) }, null, 2));
