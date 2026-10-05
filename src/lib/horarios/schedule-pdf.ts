import { cellLines, type DayCell } from "@/lib/horarios/model";
import type { RGB } from "@/lib/pdf-report";

/*
  El cuadrante en PDF, dibujado para que salga como el papel de siempre: el mes
  arriba en su recuadro, la banda de la semana con su aviso en rojo, la cabecera
  verde, los departamentos agrupados a la izquierda y una celda por día con la
  mañana encima y la tarde debajo.

  Va a mano con rectángulos y texto en vez de con autoTable, porque aquí hay
  celdas de dos líneas, departamentos que ocupan varias filas y colores por
  estado: pelearse con una tabla automática para eso sale más caro que dibujarlo.
*/

export type SchedulePdfRow = {
  department: string;
  person: string;
  cells: DayCell[];
  /** El día que libra por la tarde, ya en mayúsculas ("VIERNES"), o "". */
  tardeLibre: string;
};

export type SchedulePdfWeek = {
  number: number;
  range: string;
  note: string;
  days: string[];
  rows: SchedulePdfRow[];
};

export type SchedulePdfOptions = {
  monthLabel: string;
  weeks: SchedulePdfWeek[];
  filename: string;
};

const VERDE: RGB = [198, 224, 180];
const ROJO: RGB = [255, 0, 0];
const AMARILLO: RGB = [255, 255, 0];
const GRIS: RGB = [191, 191, 191];
const GRIS_SUAVE: RGB = [233, 233, 233];
const CREMA: RGB = [252, 228, 214];
const AZUL: RGB = [0, 112, 192];
const NEGRO: RGB = [0, 0, 0];
const BLANCO: RGB = [255, 255, 255];
const BORDE: RGB = [128, 128, 128];

const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];

/** El color de fondo de una celda según lo que ponga. */
function fondoDe(cell: DayCell): RGB | null {
  if (cell.kind === "festivo" || cell.kind === "ausencia") return ROJO;
  if (cell.kind === "libre") return GRIS;
  return cell.tardeLibre ? AMARILLO : null;
}

export async function buildSchedulePdf(options: SchedulePdfOptions) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  const margen = 12;
  const ancho = pdf.internal.pageSize.getWidth() - margen * 2;
  const anchoDepartamento = 34;
  const anchoPersona = 22;
  const anchoTardeLibre = 26;
  const anchoDia = (ancho - anchoDepartamento - anchoPersona - anchoTardeLibre) / 5;
  const altoFila = 7;
  const altoCabecera = 6;

  const x0 = margen;
  const xPersona = x0 + anchoDepartamento;
  const xDias = xPersona + anchoPersona;
  const xTardeLibre = xDias + anchoDia * 5;

  let y = margen;

  const caja = (x: number, yy: number, w: number, h: number, fondo: RGB | null) => {
    if (fondo) { pdf.setFillColor(...fondo); pdf.rect(x, yy, w, h, "F"); }
    pdf.setDrawColor(...BORDE);
    pdf.setLineWidth(0.1);
    pdf.rect(x, yy, w, h);
  };
  const texto = (t: string, x: number, yy: number, opciones: { size?: number; color?: RGB; bold?: boolean; align?: "left" | "center" } = {}) => {
    pdf.setFontSize(opciones.size ?? 6);
    pdf.setFont("helvetica", opciones.bold ? "bold" : "normal");
    pdf.setTextColor(...(opciones.color ?? NEGRO));
    pdf.text(t, x, yy, { align: opciones.align ?? "left" });
  };

  options.weeks.forEach((week, indice) => {
    const altoBloque = altoCabecera * 2 + 9 + week.rows.length * altoFila;
    if (indice > 0 && y + altoBloque > pdf.internal.pageSize.getHeight() - margen) {
      pdf.addPage();
      y = margen;
    }

    // El mes, en su recuadro.
    caja(x0, y, 48, 9, BLANCO);
    texto(options.monthLabel, x0 + 3, y + 6.3, { size: 13, bold: true });
    y += 9;

    // La banda de la semana: número, fechas y el aviso en rojo si lo hay.
    caja(x0, y, anchoDepartamento, altoCabecera, BLANCO);
    texto(`SEMANA ${week.number}`, x0 + anchoDepartamento / 2, y + 4, { size: 5.5, bold: true, color: ROJO, align: "center" });
    caja(xPersona, y, anchoPersona + anchoDia * 0.6, altoCabecera, BLANCO);
    texto(week.range, xPersona + 1.5, y + 4, { size: 4.6, bold: true, color: ROJO });
    const xAviso = xPersona + anchoPersona + anchoDia * 0.6;
    caja(xAviso, y, ancho - (xAviso - x0), altoCabecera, week.note ? CREMA : BLANCO);
    if (week.note) texto(week.note, xAviso + (ancho - (xAviso - x0)) / 2, y + 4, { size: 6.5, bold: true, color: ROJO, align: "center" });
    y += altoCabecera;

    // La cabecera verde.
    caja(x0, y, anchoDepartamento + anchoPersona, altoCabecera, VERDE);
    texto("DEPARTAMENTO", x0 + (anchoDepartamento + anchoPersona) / 2, y + 4, { size: 6, bold: true, color: AZUL, align: "center" });
    DIAS.forEach((dia, i) => {
      caja(xDias + anchoDia * i, y, anchoDia, altoCabecera, VERDE);
      texto(dia, xDias + anchoDia * (i + 0.5), y + 4, { size: 6, bold: true, align: "center" });
    });
    caja(xTardeLibre, y, anchoTardeLibre, altoCabecera, VERDE);
    texto("TARDE LIBRE", xTardeLibre + anchoTardeLibre / 2, y + 4, { size: 6, bold: true, align: "center" });
    y += altoCabecera;

    // Las filas, con el departamento agrupado a la izquierda.
    const yInicio = y;
    week.rows.forEach((row, i) => {
      const yFila = yInicio + i * altoFila;
      const primeroDelGrupo = i === 0 || week.rows[i - 1].department !== row.department;
      if (primeroDelGrupo) {
        const cuantos = week.rows.filter((r) => r.department === row.department).length;
        caja(x0, yFila, anchoDepartamento, altoFila * cuantos, GRIS_SUAVE);
        texto(row.department, x0 + anchoDepartamento / 2, yFila + (altoFila * cuantos) / 2 + 1, { size: 6.5, bold: true, color: AZUL, align: "center" });
      }
      caja(xPersona, yFila, anchoPersona, altoFila, GRIS_SUAVE);
      texto(row.person, xPersona + anchoPersona / 2, yFila + altoFila / 2 + 1, { size: 4.8, bold: true, align: "center" });

      row.cells.forEach((cell, d) => {
        const x = xDias + anchoDia * d;
        caja(x, yFila, anchoDia, altoFila, fondoDe(cell));
        const lineas = cellLines(cell);
        const destacado = cell.kind === "festivo" || cell.kind === "ausencia";
        if (lineas.length === 1) {
          texto(lineas[0], x + anchoDia / 2, yFila + altoFila / 2 + 1, { size: destacado ? 5.5 : 5, bold: true, color: destacado ? BLANCO : NEGRO, align: "center" });
        } else if (lineas.length === 2) {
          texto(lineas[0], x + anchoDia / 2, yFila + 3, { size: 5, bold: true, align: "center" });
          texto(lineas[1], x + anchoDia / 2, yFila + 6, { size: 5, bold: true, align: "center" });
        }
      });

      caja(xTardeLibre, yFila, anchoTardeLibre, altoFila, row.tardeLibre ? null : GRIS);
      if (row.tardeLibre) texto(row.tardeLibre, xTardeLibre + anchoTardeLibre / 2, yFila + altoFila / 2 + 1, { size: 5.5, bold: true, color: AZUL, align: "center" });
    });

    y = yInicio + week.rows.length * altoFila + 8;
  });

  return pdf;
}

export async function exportSchedulePdf(options: SchedulePdfOptions): Promise<void> {
  const pdf = await buildSchedulePdf(options);
  pdf.save(options.filename);
}
