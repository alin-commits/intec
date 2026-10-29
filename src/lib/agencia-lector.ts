import { z } from "zod";

/*
  Leer con IA el presupuesto que manda la agencia (PDF o Excel) y pasarlo a
  partidas del panel.

  Como el motivo de pérdida: la IA no decide, propone. Devuelve las partidas
  con los nombres del Hub —nuestras marcas tal cual, los conceptos de siempre,
  los meses como «2026-10»— y quien lo carga las revisa antes de guardarlas.
  Cada una dice de dónde la sacó, para poder comprobarla en el documento.

  Aquí van la pregunta y la limpieza de la respuesta, sin llamar a nadie, para
  poder probarlas. La llamada está en agencia-lector-ia.ts.
*/

/** La opción de marca para lo que es de todas o no dice de cuál. */
export const TODAS_LAS_MARCAS = "Todas, sin repartir";

/** Lo que tiene que devolver la IA. Las marcas, solo las nuestras: no puede inventarse una. */
export function esquemaDeLectura(marcas: string[]) {
  const opciones: [string, ...string[]] = [TODAS_LAS_MARCAS, ...marcas];
  return z.object({
    resumen: z.string(),
    partidas: z.array(z.object({
      marca: z.enum(opciones),
      concepto: z.string(),
      importe_mensual: z.number(),
      una_vez: z.boolean(),
      desde: z.string(),
      hasta: z.string().nullable(),
      notas: z.string().nullable(),
      de_donde: z.string(),
    })),
    avisos: z.array(z.string()),
  });
}

export type LecturaDeLaIa = z.infer<ReturnType<typeof esquemaDeLectura>>;

export function construirPregunta(input: { marcas: string[]; conceptos: string[]; hoy: string; archivo: string }): string {
  const mesActual = input.hoy.slice(0, 7);
  return `Llevas el control del gasto de marketing de un grupo de empresas. Te paso el presupuesto que nos ha mandado la agencia de marketing digital (archivo «${input.archivo}»). Sácalo en partidas para nuestro panel, con nuestros nombres.

Hoy es ${input.hoy}.

MARCAS. Usa estos nombres exactos: ${input.marcas.map((marca) => `«${marca}»`).join(", ")}.
- Si el documento llama a una marca de otra forma (abreviada, con el nombre de la empresa, con su web), usa la nuestra que le corresponda.
- Si una línea es para todas, o no dice de cuál es, usa «${TODAS_LAS_MARCAS}» y dilo en avisos.
- Si una línea cubre varias marcas con el importe repartido, una partida por marca. Si no dice cómo se reparte, «${TODAS_LAS_MARCAS}».

CONCEPTOS. Cuando encajen, usa estos nombres: ${input.conceptos.map((concepto) => `«${concepto}»`).join(", ")}.
- «SEM (gestión)» es lo que cobra la agencia por llevar las campañas; «Google Ads (inversión)», lo que se paga a Google por los anuncios. Si el documento no los separa, «SEM (gestión)» y dilo en avisos.
- Si no encaja ninguno, un nombre corto en español, de una a cuatro palabras.

CADA PARTIDA:
- importe_mensual: euros SIN IVA que se pagan cada mes. Si una cifra viene con IVA y también sin él, usa la de sin IVA. Si solo viene con IVA, quítale el 21 % y dilo en avisos. Si da un total anual de algo que se paga cada mes, divídelo entre los meses que cubre y dilo en notas.
- una_vez: true si se paga una sola vez (un alta, un proyecto, una web nueva). Entonces «desde» y «hasta» son el mismo mes: el del pago.
- desde y hasta: meses con la forma AAAA-MM. «hasta» es null si sigue sin fecha de fin. Si no dice cuándo empieza, usa ${mesActual} y dilo en avisos.
- Si el importe de un servicio cambia de un mes a otro, una partida por cada tramo de meses con el mismo importe.
- notas: en una línea, qué incluye si el documento lo dice; si no, null.
- de_donde: dónde está en el documento (hoja y fila, o página y línea), para que alguien lo pueda comprobar.

NO INVENTES. Si una cifra no está clara, déjala fuera y explica por qué en avisos. No metas como partidas los totales, subtotales ni el IVA: solo las líneas de gasto.

resumen: una frase con qué es el documento (de qué agencia, qué periodo cubre y cuánto suma al mes o en total, si lo dice).
avisos: frases cortas con lo que hay que revisar. Vacío si todo está claro.`;
}

/** Una partida propuesta, ya con las marcas del Hub y lista para revisar. */
export type PartidaPropuesta = {
  businessUnitId: string | null;
  concept: string;
  monthlyAmount: number;
  startMonth: string;
  endMonth: string | null;
  notes: string | null;
  deDonde: string;
};

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Lo que devuelve la IA, comprobado antes de enseñarlo. Lo que no se sostiene
 * —un mes que no es un mes, un importe negativo, un concepto vacío— no se
 * propone: va a los avisos, con lo que se ha quitado y por qué.
 */
export function limpiarLectura(lectura: LecturaDeLaIa, marcas: { id: string; name: string }[]): { resumen: string; partidas: PartidaPropuesta[]; avisos: string[] } {
  const avisos = lectura.avisos.map((aviso) => aviso.trim()).filter(Boolean).slice(0, 20);
  const partidas: PartidaPropuesta[] = [];
  for (const partida of lectura.partidas) {
    const concepto = partida.concepto.trim().replace(/\s+/g, " ").slice(0, 80);
    const desde = partida.desde.trim();
    const hasta = partida.una_vez ? desde : partida.hasta?.trim() || null;
    const etiqueta = concepto || "una partida sin concepto";
    if (!concepto) {
      avisos.push("Se ha quitado una partida sin concepto.");
      continue;
    }
    if (!Number.isFinite(partida.importe_mensual) || partida.importe_mensual < 0) {
      avisos.push(`Se ha quitado «${etiqueta}»: el importe no es válido.`);
      continue;
    }
    if (partida.importe_mensual === 0) continue;
    if (!MES.test(desde) || (hasta !== null && !MES.test(hasta))) {
      avisos.push(`Se ha quitado «${etiqueta}»: no se entiende desde o hasta qué mes va.`);
      continue;
    }
    if (hasta !== null && hasta < desde) {
      avisos.push(`Se ha quitado «${etiqueta}»: acaba antes de empezar.`);
      continue;
    }
    const marca = partida.marca === TODAS_LAS_MARCAS ? null : marcas.find((unidad) => unidad.name === partida.marca) ?? null;
    partidas.push({
      businessUnitId: marca?.id ?? null,
      concept: concepto,
      monthlyAmount: Math.round(partida.importe_mensual * 100) / 100,
      startMonth: desde,
      endMonth: hasta,
      notes: partida.notas?.trim().slice(0, 500) || null,
      deDonde: partida.de_donde.trim().slice(0, 200),
    });
  }
  return { resumen: lectura.resumen.trim().slice(0, 400), partidas, avisos };
}
