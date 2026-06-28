const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

const BASE_URL = "https://fotografia.janosgroup.com/rendicion/";
const PROFILE_DIR = path.join(__dirname, ".perfil-chrome");

function question(message) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => input.question(message, (answer) => {
    input.close();
    resolve(answer.trim());
  }));
}

async function dumpTrabajo(page, categoriaTexto) {
  const option = page.locator("#categoria option").filter({ hasText: categoriaTexto }).first();
  const value = await option.getAttribute("value");
  await page.selectOption("#categoria", value);
  await page.locator("#trabajo option").first().waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
  const trabajos = await page.locator("#trabajo option").allTextContents();
  console.log(`\nOpciones de #trabajo para "${categoriaTexto}":`);
  trabajos.forEach((texto) => console.log(`  - "${texto.trim()}"`));
}

async function main() {
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

  const reingresar = page.locator('a:has-text("Reingresar")');
  if (/login\.php/i.test(page.url()) || (await reingresar.count()) > 0) {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    console.log("Inicia sesion directamente en Chrome (la sesion anterior expiro).");
    await question("Cuando termine el ingreso, presiona Enter aqui... ");
    await page.goto(`${BASE_URL}nueva.php`, { waitUntil: "domcontentloaded" });
  }

  await page.locator("#categoria option").first().waitFor({ state: "attached", timeout: 15000 });

  await dumpTrabajo(page, "PERSONAL FOTOGRAFIA");
  await dumpTrabajo(page, "PERSONAL VIDEO");

  await context.close();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
