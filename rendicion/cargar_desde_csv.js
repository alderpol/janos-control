const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

const BASE_URL = "https://fotografia.janosgroup.com/rendicion/";
const PROFILE_DIR = path.join(__dirname, ".perfil-chrome");
const PREVIEW_DIR = path.join(__dirname, "vista_previa");

function question(message) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => input.question(message, (answer) => {
    input.close();
    resolve(answer.trim());
  }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((header) => header.toLowerCase());
  return rows.map((cells, rowIndex) => {
    const item = Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
    return { ...item, _line: rowIndex + 2 };
  });
}

async function selectByText(page, selector, text) {
  const option = page.locator(`${selector} option`).filter({ hasText: text }).first();
  if (await option.count() === 0) throw new Error(`No existe la opcion "${text}" en ${selector}.`);
  const value = await option.getAttribute("value");
  await page.selectOption(selector, value);
}

async function main() {
  const csvPath = process.argv.find((argument) => argument.toLowerCase().endsWith(".csv"));
  const confirm = process.argv.includes("--confirmar");
  if (!csvPath || !fs.existsSync(csvPath)) throw new Error("Indica un archivo CSV existente.");

  const records = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const required = ["categoria", "fecha", "salon", "trabajo"];
  if (!records.length || required.some((field) => !(field in records[0]))) {
    throw new Error(`El CSV debe incluir: ${required.join(", ")} y opcionalmente observaciones.`);
  }
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });
  const page = await context.newPage();
  for (const oldPage of context.pages()) {
    if (oldPage !== page) await oldPage.close().catch(() => {});
  }
  await page.goto(`${BASE_URL}nueva.php`, { waitUntil: "domcontentloaded" });

  let formReady = await page.locator("#categoria option").first().waitFor({ state: "attached", timeout: 3000 }).then(() => true).catch(() => false);
  for (let attempt = 0; !formReady && attempt < 5; attempt += 1) {
    const reingresar = page.locator('a:has-text("Reingresar")');
    if (/login\.php/i.test(page.url()) || (await reingresar.count()) > 0) {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      console.log("Inicia sesion directamente en Chrome (la sesion anterior expiro).");
      await question("Cuando termine el ingreso, presiona Enter aqui... ");
    } else {
      await question("No se encontro el formulario todavia. Revisa la ventana de Chrome y presiona Enter para reintentar... ");
    }
    await page.goto(`${BASE_URL}nueva.php`, { waitUntil: "domcontentloaded" });
    formReady = await page.locator("#categoria option").first().waitFor({ state: "attached", timeout: 20000 }).then(() => true).catch(() => false);
    if (!formReady) {
      console.log(`Diagnostico: url actual = ${page.url()}`);
      fs.writeFileSync(path.join(__dirname, "debug_pagina.html"), await page.content(), "utf8");
    }
  }
  if (!formReady) {
    throw new Error("No se pudo cargar el formulario despues de varios intentos. Revisa la ventana de Chrome.");
  }

  for (const record of records) {
    try {
      await selectByText(page, "#categoria", record.categoria);
      await page.locator("#trabajo option").first().waitFor({ state: "attached", timeout: 10000 });
      await selectByText(page, 'select[name="salon"]', record.salon);
      await selectByText(page, "#trabajo", record.trabajo);
      await page.locator("#fechaOperacion").evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, record.fecha);
      await page.fill("#observaciones", record.observaciones || "");

      const screenshot = path.join(PREVIEW_DIR, `fila_${record._line}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(`Fila ${record._line} preparada: ${record.fecha} | ${record.salon} | ${record.trabajo}`);

      if (!confirm) continue;
      const answer = await question("Enviar esta rendicion? Escribe SI para confirmar: ");
      if (answer !== "SI") {
        console.log("Omitida.");
        continue;
      }
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        page.locator('input[type="submit"]').click(),
      ]);
      await page.goto(`${BASE_URL}nueva.php`, { waitUntil: "domcontentloaded" });
    } catch (error) {
      console.error(`Fila ${record._line}: ${error.message}`);
    }
  }

  console.log(confirm ? "Proceso terminado." : `Vista previa terminada. Revisa ${PREVIEW_DIR}`);
  await context.close();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
