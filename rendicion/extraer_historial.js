const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (/[ÃÂâ]/.test(text)) text = Buffer.from(text, "latin1").toString("utf8");
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const source = process.argv[2];
  const target = process.argv[3] || path.join(__dirname, "historial.csv");
  if (!source || !fs.existsSync(source)) {
    throw new Error("Indica la ruta del archivo mis.html guardado por el navegador.");
  }

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(source, "utf8"));
  const rows = await page.locator("table tr").evaluateAll((items) =>
    items.map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.innerText.trim()))
  );
  await browser.close();

  if (rows.length < 2) throw new Error("No se encontro una tabla de rendiciones.");
  fs.writeFileSync(target, rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), "utf8");
  console.log(`Se exportaron ${rows.length - 1} rendiciones a ${target}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
