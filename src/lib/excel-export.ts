/*
  Exportar a Excel de verdad (.xlsx), no un CSV con otro nombre.

  El CSV vale para pasar datos a otro programa, pero quien pide "en Excel"
  quiere abrirlo y que las columnas estén separadas, los números sean números
  —sumables, ordenables— y la cabecera se distinga. Un CSV de este panel ya se
  abre torcido en cuanto un cliente lleva una coma en el nombre.

  No hace falta ninguna librería nueva: un .xlsx es un zip con unos cuantos XML
  dentro, y fflate ya estaba aquí para los zips del organizador de posts. Se
  escribe lo mínimo que Excel acepta, con cadenas en línea en vez de la tabla de
  textos compartidos, que es lo que ahorra la mitad del formato.

  La parte que construye los bytes es pura y está probada; la que descarga vive
  abajo y solo existe en el navegador.
*/

export type ExcelValue = string | number | null | undefined;
export type ExcelColumn<T> = {
  header: string;
  value: (row: T) => ExcelValue;
  /** Ancho de la columna en caracteres; si no se dice, se calcula por el contenido. */
  width?: number;
};
export type ExcelSheet<T> = { name: string; columns: ExcelColumn<T>[]; rows: T[] };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** XML no admite ni & sueltos ni caracteres de control; Excel se niega a abrir el archivo entero por uno. */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (caracter) => ESCAPES[caracter]);
}

/** A, B… Z, AA, AB… como las columnas de una hoja. */
export function columnLetter(index: number): string {
  let resto = index;
  let letras = "";
  do {
    letras = String.fromCharCode(65 + (resto % 26)) + letras;
    resto = Math.floor(resto / 26) - 1;
  } while (resto >= 0);
  return letras;
}

/**
 * Excel no deja los caracteres \ / ? * [ ] en el nombre de una hoja, ni más de
 * 31 letras, ni dos hojas iguales. Con cualquiera de las tres cosas el archivo
 * no abre, así que se arreglan aquí en vez de confiar en quien llame.
 */
export function sheetName(name: string, used: Set<string>): string {
  const limpio = (name.replace(/[\\/?*[\]:]/g, " ").trim() || "Hoja").slice(0, 31);
  let final = limpio;
  let numero = 2;
  while (used.has(final.toLowerCase())) {
    const sufijo = ` (${numero++})`;
    final = limpio.slice(0, 31 - sufijo.length) + sufijo;
  }
  used.add(final.toLowerCase());
  return final;
}

function celda(referencia: string, valor: ExcelValue, estilo: number): string {
  if (valor === null || valor === undefined || valor === "") return "";
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${referencia}" s="${estilo}"><v>${valor}</v></c>`;
  }
  return `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(valor))}</t></is></c>`;
}

function hojaXml<T>(hoja: ExcelSheet<T>): string {
  const anchos = hoja.columns.map((columna) => {
    if (columna.width) return columna.width;
    const masLargo = hoja.rows.reduce((maximo, fila) => {
      const valor = columna.value(fila);
      return Math.max(maximo, valor === null || valor === undefined ? 0 : String(valor).length);
    }, columna.header.length);
    // Un poco de aire, y tope para que un campo de notas no haga una columna infinita.
    return Math.min(Math.max(masLargo + 2, 8), 60);
  });

  const cabecera = hoja.columns.map((columna, indice) => celda(`${columnLetter(indice)}1`, columna.header, 1)).join("");
  const filas = hoja.rows.map((fila, numero) => {
    const celdas = hoja.columns.map((columna, indice) => celda(`${columnLetter(indice)}${numero + 2}`, columna.value(fila), 0)).join("");
    return `<row r="${numero + 2}">${celdas}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<cols>${anchos.map((ancho, indice) => `<col min="${indice + 1}" max="${indice + 1}" width="${ancho}" customWidth="1"/>`).join("")}</cols>`
    + `<sheetData><row r="1">${cabecera}</row>${filas}</sheetData>`
    // La cabecera se queda fija al bajar, que es lo primero que echa en falta
    // cualquiera con una tabla de mil filas.
    + `</worksheet>`;
}

/** Los bytes del .xlsx. Puro: no toca el navegador, por eso se puede probar. */
export function buildXlsx(hojas: ExcelSheet<never>[] | ExcelSheet<Record<string, unknown>>[] | ExcelSheet<unknown>[]): Record<string, string> {
  const usados = new Set<string>();
  const nombres = (hojas as ExcelSheet<unknown>[]).map((hoja) => sheetName(hoja.name, usados));

  const archivos: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + nombres.map((_, indice) => `<Override PartName="/xl/worksheets/sheet${indice + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
      + `</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets>${nombres.map((nombre, indice) => `<sheet name="${escapeXml(nombre)}" sheetId="${indice + 1}" r:id="rId${indice + 1}"/>`).join("")}</sheets>`
      + `</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + nombres.map((_, indice) => `<Relationship Id="rId${indice + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${indice + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${nombres.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `</Relationships>`,
    // Lo mínimo: un estilo normal y uno en negrita para la cabecera.
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
      + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
      + `<borders count="1"><border/></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
      + `</styleSheet>`,
  };

  (hojas as ExcelSheet<unknown>[]).forEach((hoja, indice) => {
    archivos[`xl/worksheets/sheet${indice + 1}.xml`] = hojaXml(hoja);
  });
  return archivos;
}

/** Descarga el .xlsx. Solo en el navegador. */
export async function downloadXlsx(filename: string, hojas: ExcelSheet<never>[] | ExcelSheet<Record<string, unknown>>[] | ExcelSheet<unknown>[]): Promise<void> {
  const { zipSync, strToU8 } = await import("fflate");
  const archivos = buildXlsx(hojas);
  const contenido: Record<string, Uint8Array> = {};
  for (const [ruta, xml] of Object.entries(archivos)) contenido[ruta] = strToU8(xml);
  const zip = zipSync(contenido, { level: 6 });
  const blob = new Blob([zip as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  enlace.click();
  URL.revokeObjectURL(url);
}

/**
 * Lo mismo, pero partiendo de las columnas que la pantalla ya tiene escritas
 * para el CSV: una sola lista de columnas por informe, dos formatos de salida.
 */
export async function downloadXlsxFromColumns<T>(
  filename: string,
  sheet: string,
  rows: T[],
  columns: { header: string; value: (row: T) => ExcelValue }[],
): Promise<void> {
  await downloadXlsx(filename, [{ name: sheet, columns, rows }] as ExcelSheet<unknown>[]);
}
