/*
  De GeoJSON a trazados SVG: proyecta, simplifica y coloca Canarias en su
  recuadro. Imprime un modulo TypeScript listo para el repositorio.

  Uso: node geo-a-svg.mjs <geojson> <salida.ts>
*/
import { readFileSync, writeFileSync } from "node:fs";

const [, , entrada, salida] = process.argv;
const geo = JSON.parse(readFileSync(entrada, "utf8"));

// --- Canarias, a su sitio -------------------------------------------------
// Estan a 1.000 km al suroeste; dejadas donde caen, el mapa es casi todo mar.
// DY=5.4 y no mas: con 6.6 el recuadro se comia Ceuta, que esta a 35,17 de
// latitud. Comprobado abajo, que esto es justo lo que no se ve hasta que
// alguien mira el mapa.
const CANARIAS = new Set(["35", "38"]);
const DX = 8.9, DY = 5.4;

// --- Simplificacion (Douglas-Peucker) -------------------------------------
function distanciaACuerda([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const largo = dx * dx + dy * dy;
  if (largo === 0) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / largo;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function simplificar(puntos, tolerancia) {
  if (puntos.length <= 3) return puntos;
  let peor = 0, indice = 0;
  for (let i = 1; i < puntos.length - 1; i++) {
    const d = distanciaACuerda(puntos[i], puntos[0], puntos[puntos.length - 1]);
    if (d > peor) { peor = d; indice = i; }
  }
  if (peor <= tolerancia) return [puntos[0], puntos[puntos.length - 1]];
  return [
    ...simplificar(puntos.slice(0, indice + 1), tolerancia).slice(0, -1),
    ...simplificar(puntos.slice(indice), tolerancia),
  ];
}
const areaDe = (anillo) => {
  let a = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    a += anillo[j][0] * anillo[i][1] - anillo[i][0] * anillo[j][1];
  }
  return Math.abs(a / 2);
};

// --- 1. Recoger anillos, ya movidos los archipielagos ---------------------
const TOLERANCIA = 0.012;   // en grados; ~1 km
const AREA_MINIMA = 0.0016; // islotes y penascos que solo ensucian

const provincias = [];
for (const f of geo.features) {
  const code = String(f.properties.cod_prov).padStart(2, "0");
  const mueve = CANARIAS.has(code);
  const poligonos = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const anillos = [];
  for (const poligono of poligonos) {
    for (const anillo of poligono) {
      const movido = mueve ? anillo.map(([lon, lat]) => [lon + DX, lat + DY]) : anillo;
      const simple = simplificar(movido, TOLERANCIA);
      if (simple.length >= 4 && areaDe(simple) >= AREA_MINIMA) anillos.push(simple);
    }
  }
  // Una provincia nunca se queda sin dibujo: si todo era mas pequeno que el
  // minimo (Ceuta, Melilla), se queda con su anillo mayor sin filtrar.
  if (anillos.length === 0) {
    let mayor = null, mejor = -1;
    for (const poligono of poligonos) for (const anillo of poligono) {
      const movido = mueve ? anillo.map(([lon, lat]) => [lon + DX, lat + DY]) : anillo;
      const a = areaDe(movido);
      if (a > mejor) { mejor = a; mayor = movido; }
    }
    if (mayor) anillos.push(simplificar(mayor, TOLERANCIA / 4));
  }
  provincias.push({ code, name: f.properties.name, anillos });
}

// --- 1b. Que el recuadro de Canarias no pise a nadie ----------------------
const cajaDe = (codes) => {
  const c = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of provincias) {
    if (!codes.includes(p.code)) continue;
    for (const anillo of p.anillos) for (const [lon, lat] of anillo) {
      if (lon < c[0]) c[0] = lon; if (lon > c[1]) c[1] = lon;
      if (lat < c[2]) c[2] = lat; if (lat > c[3]) c[3] = lat;
    }
  }
  return c;
};
const pisa = (a, b) => !(a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]);
const cajaCanarias = cajaDe(["35", "38"]);
for (const [code, nombre] of [["51", "Ceuta"], ["52", "Melilla"], ["11", "Cádiz"], ["21", "Huelva"]]) {
  if (pisa(cajaCanarias, cajaDe([code]))) {
    throw new Error(`El recuadro de Canarias se solapa con ${nombre}: ajusta DX/DY.`);
  }
}

// --- 2. Proyectar ---------------------------------------------------------
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const p of provincias) for (const anillo of p.anillos) for (const [lon, lat] of anillo) {
  if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
  if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
}
// Equirectangular con la correccion del coseno: a esta latitud basta, y evita
// que Espana salga estirada a lo ancho.
const latMedia = ((minLat + maxLat) / 2) * Math.PI / 180;
const k = Math.cos(latMedia);
const ANCHO = 1000;
const escala = ANCHO / ((maxLon - minLon) * k);
const ALTO = Math.round((maxLat - minLat) * escala);
const px = (lon) => (lon - minLon) * k * escala;
const py = (lat) => (maxLat - lat) * escala;
const red = (n) => Math.round(n * 10) / 10;

let puntos = 0;
const salidas = provincias.map((p) => {
  const d = p.anillos.map((anillo) => {
    puntos += anillo.length;
    return "M" + anillo.map(([lon, lat]) => `${red(px(lon))} ${red(py(lat))}`).join("L") + "Z";
  }).join("");
  return { code: p.code, name: p.name, d };
}).sort((a, b) => a.code.localeCompare(b.code));

// --- 3. Escribir el modulo -----------------------------------------------
const cuerpo = salidas.map((p) => `  { code: "${p.code}", d: "${p.d}" },`).join("\n");
const texto = `/*
  El contorno de las 52 provincias de España, en trazados SVG.

  Generado, no escrito a mano. De donde sale y como:

  · Origen: el GeoJSON de provincias de click_that_hood
    (https://github.com/codeforgermany/click_that_hood, datos abiertos), que
    trae el código oficial de cada provincia en «cod_prov». Por eso aquí no
    hay que casar nombres: cada trazado ya viene con su código, el mismo que
    los dos primeros dígitos de un código postal.
  · Proyección equirectangular con la corrección del coseno de la latitud
    media, para que España no salga estirada a lo ancho.
  · Simplificado con Douglas-Peucker a ~1 km, y fuera los islotes de menos de
    ~0,0016 grados cuadrados: a este tamaño no se ven y solo engordan el
    fichero. Ninguna provincia se queda sin dibujo — Ceuta y Melilla se
    simplifican con un cuarto de esa tolerancia para que no desaparezcan.
  · Canarias movida a su recuadro, como en cualquier mapa de España: donde
    cae de verdad, el mapa sería casi todo mar.

  ${salidas.length} provincias, ${puntos} puntos. Si hace falta más detalle, se vuelve a
  generar con otra tolerancia; esto no se edita a mano.
*/

export const MAPA_ANCHO = ${ANCHO};
export const MAPA_ALTO = ${ALTO};

export type TrazadoDeProvincia = { code: string; d: string };

export const PROVINCIAS_SVG: TrazadoDeProvincia[] = [
${cuerpo}
];
`;
writeFileSync(salida, texto, "utf8");
console.log(`provincias: ${salidas.length}`);
console.log(`puntos tras simplificar: ${puntos} (de 30231)`);
console.log(`lienzo: ${ANCHO} x ${ALTO}`);
console.log(`tamaño del modulo: ${Math.round(texto.length / 1024)} KB`);
