/*
  Abre TurtlePass en una ventana de navegador para que inicies sesión tú, y
  guarda esa sesión en un archivo para que los scripts puedan leer el gestor
  antiguo sin que tengas que darle a nadie tu usuario ni tu contraseña.

  Qué hace exactamente: abre la ventana, espera a que entres, y en cuanto la
  aplicación pide sus datos al servidor (es la señal de que ya estás dentro)
  guarda las cookies en el archivo que le digas y cierra el navegador.

  El archivo que genera vale para entrar en el gestor antiguo mientras la sesión
  siga viva: guárdalo fuera del proyecto y bórralo al terminar.

  Uso:
    node scripts/turtlepass-session.mts --out "C:\\ruta\\session.json"
*/
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
/** Playwright está instalado a mano, fuera del proyecto. */
function loadPlaywright(): typeof import("playwright") {
  for (const candidate of ["playwright", "C:/Users/Tienda/AppData/Roaming/npm/node_modules/playwright"]) {
    try {
      return require(candidate) as typeof import("playwright");
    } catch {
      continue;
    }
  }
  throw new Error("No encuentro Playwright. Instálalo con: npm i -g playwright");
}

const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const out = flag("--out");
const BASE = flag("--base") ?? "https://induxperience.com/passwords/web";
if (!out) {
  console.error('Uso: node scripts/turtlepass-session.mts --out "C:\\ruta\\session.json"');
  process.exit(1);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

// La aplicación pide sus carpetas nada más entrar: esa llamada es la señal de
// que la sesión ya está iniciada de verdad y no solo la pantalla de login.
let signedIn = false;
page.on("request", (request) => {
  if (request.url().includes("/api/passwordgroups")) signedIn = true;
});

console.log(`Abriendo ${BASE}`);
console.log("Inicia sesión en la ventana que se ha abierto. En cuanto entres, guardo la sesión y la cierro.\n");
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});

const deadline = Date.now() + 5 * 60 * 1000;
while (!signedIn && Date.now() < deadline) {
  if (page.isClosed()) break;
  await page.waitForTimeout(1000);
}

if (!signedIn) {
  await browser.close();
  throw new Error("No he visto que llegaras a entrar (cinco minutos). Vuelve a lanzarlo y prueba otra vez.");
}

// Un par de segundos más: al entrar, la aplicación termina de asentar sus cookies.
await page.waitForTimeout(2000).catch(() => {});
await context.storageState({ path: out });
await browser.close();
console.log(`Sesión guardada en ${out}`);
console.log("Ese archivo da acceso al gestor antiguo: bórralo cuando terminemos.");
