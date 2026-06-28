const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

const START_URL = "https://fotografia.janosgroup.com/rendicion/";
const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, ".perfil-chrome");
const OUTPUT_DIR = path.join(ROOT, "relevamiento");

function waitForEnter(message) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => input.question(message, () => {
    input.close();
    resolve();
  }));
}

function safeName(value) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "pagina";
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const fields = [...document.querySelectorAll("input, select, textarea, button")]
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || "",
        name: element.getAttribute("name") || "",
        id: element.id || "",
        label: element.labels ? [...element.labels].map((label) => label.innerText.trim()).join(" | ") : "",
        placeholder: element.getAttribute("placeholder") || "",
        value: element.tagName === "SELECT" ? element.value : "",
        options: element.tagName === "SELECT"
          ? [...element.options].map((option) => ({ value: option.value, text: option.text.trim() }))
          : [],
        text: element.tagName === "BUTTON" ? element.innerText.trim() : "",
      }));

    const forms = [...document.forms].map((form) => ({
      action: form.action,
      method: form.method,
      id: form.id,
      fields: [...form.elements].map((element) => element.name || element.id).filter(Boolean),
    }));

    const tables = [...document.querySelectorAll("table")].map((table) =>
      [...table.rows].map((row) => [...row.cells].map((cell) => cell.innerText.trim()))
    );

    const links = [...document.querySelectorAll("a[href]")].map((link) => ({
      text: link.innerText.trim(),
      href: link.href,
    }));

    return {
      title: document.title,
      url: location.href,
      headings: [...document.querySelectorAll("h1, h2, h3")].map((item) => item.innerText.trim()),
      forms,
      fields,
      tables,
      links,
      visibleText: document.body.innerText,
    };
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  console.log("\nInicia sesion directamente en la ventana de Chrome.");
  console.log("Ninguna contrasena se guarda en los archivos del relevamiento.");
  await waitForEnter("Cuando veas la pantalla principal, vuelve aqui y presiona Enter... ");

  if (/login\.php/i.test(page.url())) {
    throw new Error("La pagina sigue en el inicio de sesion.");
  }

  const origin = new URL(page.url()).origin;
  const queue = [page.url()];
  const visited = new Set();
  const results = [];
  const blockedWords = /logout|salir|cerrar|delete|eliminar|borrar|cancelar|anular/i;

  while (queue.length > 0 && visited.size < 40) {
    const url = queue.shift();
    if (visited.has(url) || blockedWords.test(url)) continue;
    visited.add(url);

    await page.goto(url, { waitUntil: "domcontentloaded" });
    const data = await inspectPage(page);
    results.push(data);

    const name = safeName(data.url);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.html`), await page.content(), "utf8");
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });

    for (const link of data.links) {
      try {
        const candidate = new URL(link.href);
        candidate.hash = "";
        if (candidate.origin !== origin || blockedWords.test(candidate.href) || blockedWords.test(link.text)) continue;
        if (!["http:", "https:"].includes(candidate.protocol)) continue;
        if (!visited.has(candidate.href)) queue.push(candidate.href);
      } catch {
        // Ignore malformed or script-only links.
      }
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "mapa.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(`\nRelevamiento terminado: ${results.length} pagina(s).`);
  console.log(path.join(OUTPUT_DIR, "mapa.json"));
  await context.close();
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
