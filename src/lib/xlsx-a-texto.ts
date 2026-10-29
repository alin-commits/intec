import { strFromU8, unzipSync } from "fflate";

/*
  Un Excel (.xlsx) pasado a texto, para que lo lea la IA.

  La IA lee PDFs, pero no Excel. Un .xlsx es un zip con XML dentro: las hojas,
  los textos compartidos y los estilos. Aquí se saca cada celda con valor, fila
  a fila y con su columna, que es lo que hace falta para entender una tabla de
  presupuesto. Sin fórmulas: el valor que Excel guardó calculado.

  Las fechas de Excel son números (46023 es el 1 de enero de 2026) y solo el
  estilo de la celda dice que son fechas. Un presupuesto suele llevar los
  meses de cabecera, así que se miran los estilos para escribirlas como fecha.

  El .xls antiguo es otro formato, binario: no se lee. Se pide en .xlsx o PDF.
*/

/** Lo más que se le pasa a la IA: un presupuesto cabe sobrado. */
const MAXIMO = 150_000;

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, codigo: string) => {
    if (codigo[0] === "#") {
      const numero = codigo[1].toLowerCase() === "x" ? parseInt(codigo.slice(2), 16) : parseInt(codigo.slice(1), 10);
      return Number.isFinite(numero) ? String.fromCodePoint(numero) : entera;
    }
    return ENTIDADES[codigo.toLowerCase()] ?? entera;
  });
}

function atributos(etiqueta: string): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [, nombre, valor] of etiqueta.matchAll(/([\w:]+)="([^"]*)"/g)) salida[nombre] = decodificar(valor);
  return salida;
}

/** El texto de un trozo de XML: todos sus <t>, sin la fonética japonesa. */
function textoDe(xml: string): string {
  // Perezoso y con «/>» delante: un <t/> vacío no puede tragarse el texto del siguiente.
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map(([, texto = ""]) => decodificar(texto)).join("");
}

/** "AB" → 27 (empezando en 0). */
function columna(referencia: string): number {
  let indice = 0;
  for (const letra of referencia.replace(/\d+$/, "")) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  return indice - 1;
}

const letraDe = (indice: number): string => {
  let resto = indice + 1;
  let letras = "";
  while (resto > 0) {
    const modulo = (resto - 1) % 26;
    letras = String.fromCharCode(65 + modulo) + letras;
    resto = Math.floor((resto - 1) / 26);
  }
  return letras;
};

/** Los formatos de número de Excel que son fechas: los de serie y los propios que llevan d, m o y. */
const FECHAS_DE_SERIE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function esFormatoDeFecha(codigo: string): boolean {
  const limpio = codigo.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmy]/i.test(limpio) && !/^general$/i.test(limpio.trim());
}

/** Qué estilos de celda (por su posición en cellXfs) son de fecha. */
function estilosDeFecha(estilos: string | undefined): Set<number> {
  const deFecha = new Set<number>();
  if (!estilos) return deFecha;
  const propios = new Map<number, string>();
  for (const [etiqueta] of estilos.matchAll(/<numFmt\b[^>]*>/g)) {
    const { numFmtId, formatCode } = atributos(etiqueta);
    if (numFmtId && formatCode !== undefined) propios.set(Number(numFmtId), formatCode);
  }
  const celdas = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilos)?.[1] ?? "";
  [...celdas.matchAll(/<xf\b[^>]*>/g)].forEach(([etiqueta], posicion) => {
    const id = Number(atributos(etiqueta).numFmtId ?? 0);
    const propio = propios.get(id);
    if (propio !== undefined ? esFormatoDeFecha(propio) : FECHAS_DE_SERIE.has(id)) deFecha.add(posicion);
  });
  return deFecha;
}

/** Un número de serie de Excel como fecha "2026-01-01". */
function fechaDeSerie(serie: number, desde1904: boolean): string {
  const base = desde1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.round(serie) * 86_400_000).toISOString().slice(0, 10);
}

/** "1234.5000000001" → "1234.5": el ruido de coma flotante no le dice nada a nadie. */
const numeroLimpio = (valor: string) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? String(Number(numero.toFixed(4))) : valor;
};

export type ExcelEnTexto = { texto: string; hojas: number; celdas: number; recortado: boolean };

/**
 * El Excel entero como texto: una sección por hoja y una línea por fila, con
 * cada celda y su columna ("Fila 3 · A: SEO · B: 500"). Lanza un error con
 * una frase para personas si no es un .xlsx que se pueda leer.
 */
export function xlsxATexto(bytes: Uint8Array): ExcelEnTexto {
  let ficheros: Record<string, Uint8Array>;
  try {
    ficheros = unzipSync(bytes, { filter: (fichero) => fichero.name.startsWith("xl/") });
  } catch {
    throw new Error("El archivo no es un Excel .xlsx que se pueda abrir. Guárdalo como .xlsx o como PDF.");
  }
  const leer = (ruta: string) => (ficheros[ruta] ? strFromU8(ficheros[ruta]) : undefined);
  const libro = leer("xl/workbook.xml");
  if (!libro) throw new Error("El archivo no es un Excel .xlsx que se pueda abrir. Guárdalo como .xlsx o como PDF.");

  const desde1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(libro);
  const compartidos = [...(leer("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map(([, dentro]) => (dentro ? textoDe(dentro) : ""));
  const deFecha = estilosDeFecha(leer("xl/styles.xml"));

  // De cada hoja, dónde está su XML: el libro dice el nombre y la relación, la relación el fichero.
  const destinos = new Map<string, string>();
  for (const [etiqueta] of (leer("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const { Id, Target } = atributos(etiqueta);
    if (Id && Target) destinos.set(Id, Target.startsWith("/") ? Target.slice(1) : `xl/${Target}`);
  }

  const partes: string[] = [];
  let celdas = 0;
  let hojas = 0;
  let largo = 0;
  let recortado = false;
  for (const [etiqueta] of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const hoja = atributos(etiqueta);
    const xml = leer(destinos.get(hoja["r:id"] ?? "") ?? "");
    if (!xml) continue;
    hojas += 1;
    const lineas: string[] = [`## Hoja «${hoja.name ?? `Hoja ${hojas}`}»${hoja.state === "hidden" || hoja.state === "veryHidden" ? " (oculta)" : ""}`];
    // Las filas vacías vienen como <row r="5"/>: sin el «/>» delante, la de
    // después acabaría contada como suya.
    for (const [, atributosDeFila, dentro = ""] of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const numeroDeFila = atributos(atributosDeFila).r ?? "?";
      const valores: string[] = [];
      for (const [, atributosDeCelda, contenido = ""] of dentro.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const { r, t, s } = atributos(atributosDeCelda);
        const crudo = /<v>([\s\S]*?)<\/v>/.exec(contenido)?.[1];
        let valor: string;
        if (t === "s") valor = compartidos[Number(crudo)] ?? "";
        else if (t === "inlineStr") valor = textoDe(contenido);
        else if (crudo === undefined) continue;
        else if (t === "b") valor = crudo === "1" ? "VERDADERO" : "FALSO";
        else if (t === "str" || t === "e") valor = decodificar(crudo);
        else if (s !== undefined && deFecha.has(Number(s)) && Number.isFinite(Number(crudo))) valor = fechaDeSerie(Number(crudo), desde1904);
        else valor = numeroLimpio(crudo);
        valor = valor.replace(/\s+/g, " ").trim();
        if (!valor) continue;
        celdas += 1;
        valores.push(`${r ? r.replace(/\d+$/, "") : letraDe(valores.length)}: ${valor}`);
      }
      if (valores.length > 0) lineas.push(`Fila ${numeroDeFila} · ${valores.join(" · ")}`);
    }
    const bloque = lineas.join("\n");
    if (largo + bloque.length > MAXIMO) {
      partes.push(bloque.slice(0, Math.max(0, MAXIMO - largo)));
      recortado = true;
      break;
    }
    partes.push(bloque);
    largo += bloque.length + 2;
  }
  if (hojas === 0) throw new Error("El Excel no tiene ninguna hoja que se pueda leer.");
  return { texto: partes.join("\n\n"), hojas, celdas, recortado };
}

// Para las pruebas: la letra de una columna y al revés.
export const _columnas = { columna, letraDe };
