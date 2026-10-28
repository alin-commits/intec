/*
  Los municipios de la Comunidad Valenciana, de TopoJSON a trazados SVG.

  Uso:
    node scripts/mapa/municipios-cv.mjs <municipalities.json> <salida.ts>

  El TopoJSON de es-atlas (MIT, Martín González) trae el código INE de cada
  municipio en «id», así que no hay que casar ni un nombre: ese código es el
  mismo al que llega un cliente por su código postal.

  Para ampliarlo a otra comunidad, se cambia PROVINCIAS y se vuelve a
  ejecutar. El fichero de salida es generado y no se edita a mano.
*/
import { readFileSync, writeFileSync } from "node:fs";

/** Alicante, Castellón y Valencia. */
const PROVINCIAS = ["03", "12", "46"];
const TOLERANCIA = 0.0022;   // en grados, ~200 m
const AREA_MINIMA = 0.00002; // islotes que a este tamaño no se ven

const [, , entrada, salida] = process.argv;
const topo = JSON.parse(readFileSync(entrada, "utf8"));

// --- TopoJSON: de arcos cuantizados a coordenadas ------------------------
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
const arcos = topo.arcs.map((arco) => {
  let x = 0, y = 0;
  return arco.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});
// Un índice negativo quiere decir «este arco, del revés».
const arcoDe = (i) => (i < 0 ? arcos[~i].slice().reverse() : arcos[i]);
const anilloDe = (indices) => {
  const puntos = [];
  for (const i of indices) {
    const trozo = arcoDe(i);
    // El último punto de un arco es el primero del siguiente: se quita uno.
    puntos.push(...(puntos.length ? trozo.slice(1) : trozo));
  }
  return puntos;
};

// --- Simplificación ------------------------------------------------------
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

// --- 1. Recoger los municipios que tocan ---------------------------------
const municipios = [];
for (const g of topo.objects.municipalities.geometries) {
  const ine = String(g.id).padStart(5, "0");
  if (!PROVINCIAS.includes(ine.slice(0, 2))) continue;
  const poligonos = g.type === "Polygon" ? [g.arcs] : g.arcs;
  const anillos = [];
  for (const poligono of poligonos) {
    for (const indices of poligono) {
      const simple = simplificar(anilloDe(indices), TOLERANCIA);
      if (simple.length >= 4 && areaDe(simple) >= AREA_MINIMA) anillos.push(simple);
    }
  }
  /*
    Ningún municipio se queda fuera del mapa, por pequeño que sea.

    Seis de la comunidad —Emperador, Llocnou de la Corona, Rafal, Geldo,
    Benirredrà y l'Alqueria d'Asnar, los más pequeños— vienen en el TopoJSON
    con anillos de dos o tres puntos: no es la simplificación, es que el
    origen no trae un polígono dibujable. Para esos se pinta una marca
    cuadrada de unos 400 m en el sitio donde están. Es una marca, no su
    contorno, y así se pueden ver y pulsar como los demás.
  */
  let marcados = false;
  if (anillos.length === 0) {
    let mayor = null, mejor = -1;
    for (const poligono of poligonos) for (const indices of poligono) {
      const puntos = anilloDe(indices);
      const a = areaDe(puntos);
      if (a > mejor || mayor === null) { mejor = a; mayor = puntos; }
    }
    if (mayor && mayor.length >= 4) {
      anillos.push(mayor);
    } else if (mayor && mayor.length >= 2) {
      const cx = mayor.reduce((s, p) => s + p[0], 0) / mayor.length;
      const cy = mayor.reduce((s, p) => s + p[1], 0) / mayor.length;
      const r = 0.002;
      anillos.push([[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx - r, cy - r]]);
      marcados = true;
    }
  }
  if (anillos.length === 0) {
    console.warn(`  aviso: ${ine} ${g.properties?.name} se queda sin contorno`);
    continue;
  }
  if (marcados) console.log(`  ${ine} ${g.properties?.name}: sin polígono en el origen, va como marca`);
  municipios.push({ ine, name: g.properties?.name ?? ine, anillos });
}

// --- 2. Proyectar --------------------------------------------------------
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const m of municipios) for (const anillo of m.anillos) for (const [lon, lat] of anillo) {
  if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
  if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
}
const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
const ALTO = 1000;
const escala = ALTO / (maxLat - minLat);
const ANCHO = Math.round((maxLon - minLon) * k * escala);
const px = (lon) => (lon - minLon) * k * escala;
const py = (lat) => (maxLat - lat) * escala;
const red = (n) => Math.round(n * 10) / 10;

let puntos = 0;
const salidas = municipios.map((m) => {
  const d = m.anillos.map((anillo) => {
    puntos += anillo.length;
    return "M" + anillo.map(([lon, lat]) => `${red(px(lon))} ${red(py(lat))}`).join("L") + "Z";
  }).join("");
  return { ine: m.ine, name: m.name, d };
}).sort((a, b) => a.ine.localeCompare(b.ine));

// --- 3. Escribir el módulo -----------------------------------------------
const escapar = (t) => t.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const cuerpo = salidas.map((m) => `  { ine: "${m.ine}", name: "${escapar(m.name)}", d: "${m.d}" },`).join("\n");
const texto = `/*
  El contorno de los ${salidas.length} municipios de la Comunidad Valenciana.

  Generado por scripts/mapa/municipios-cv.mjs. No se edita a mano.

  · Origen: es-atlas (https://github.com/martgnz/es-atlas), licencia MIT,
    Copyright (c) 2016-2018 Martín González. Su TopoJSON trae el código INE
    de cada municipio, que es al que llega un cliente desde su código postal:
    así no hay que casar ningún nombre, que es justo lo que no funciona con
    los municipios escritos a mano en Sage.
  · Proyección equirectangular con la corrección del coseno de la latitud
    media, y simplificado a ~200 m.
  · Solo Alicante, Castellón y Valencia: es donde está el grueso de la
    cartera. Para ampliarlo, se cambia PROVINCIAS en el script.

  ${puntos} puntos.
*/

export const MAPA_CV_ANCHO = ${ANCHO};
export const MAPA_CV_ALTO = ${ALTO};

export type TrazadoDeMunicipio = { ine: string; name: string; d: string };

export const MUNICIPIOS_CV_SVG: TrazadoDeMunicipio[] = [
${cuerpo}
];
`;
writeFileSync(salida, texto, "utf8");
console.log(`municipios: ${salidas.length}`);
console.log(`puntos: ${puntos}`);
console.log(`lienzo: ${ANCHO} x ${ALTO}`);
console.log(`tamaño: ${Math.round(texto.length / 1024)} KB`);
