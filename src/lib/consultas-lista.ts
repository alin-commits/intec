import type { InquiryEntryMode, InquiryRecord, InquiryStatus, InquiryType } from "@/lib/types";

/*
  Qué consultas se ven en la lista y en qué orden.

  Está aquí y no dentro de la pantalla porque son reglas, no pintura: que
  filtrar por estado deje fuera los recuentos semanales, o que dos consultas
  del mismo día no bailen de sitio al repintar, son decisiones que conviene
  poder leer y probar sin montar media aplicación.
*/

/** Por qué columna se ordena la lista de consultas. */
export type OrdenConsultas = "fecha" | "unidad" | "contacto" | "canal" | "estado" | "origen" | "cantidad" | "valor";

export type FiltrosDeConsultas = {
  /** Lo que se ha escrito en el buscador. */
  texto: string;
  marca: string | "all";
  canal: InquiryType | "all";
  estado: InquiryStatus | "all";
  origen: InquiryEntryMode | "all";
};

export type ComoSeOrdena = { columna: OrdenConsultas; desc: boolean };

/**
 * Lo que la lista necesita saber de fuera: cómo se llama cada marca y cada
 * canal o estado (para ordenar por lo que se lee, no por el código que hay
 * debajo) y cuánto vale una consulta.
 */
export type NombresYValores = {
  marcaDe: (businessUnitId: string) => string;
  canalDe: (canal: InquiryType) => string;
  estadoDe: (estado: InquiryStatus) => string;
  valorDe: (record: InquiryRecord) => number;
};

/** El estado que se le supone a una consulta que no lo tiene guardado. */
export const ESTADO_POR_DEFECTO: InquiryStatus = "contactado";

const enMinusculas = (valor: string | null | undefined) => (valor ?? "").toLocaleLowerCase("es");

/** Si lo escrito aparece en alguno de los campos de la ficha. */
function encaja(record: InquiryRecord, texto: string): boolean {
  if (!texto) return true;
  return [record.contactName, record.companyName, record.phone, record.email, record.productInterest, record.notes]
    .some((campo) => enMinusculas(campo).includes(texto));
}

export function filtrarConsultas(records: InquiryRecord[], filtros: FiltrosDeConsultas): InquiryRecord[] {
  const texto = enMinusculas(filtros.texto).trim();
  return records.filter((record) => {
    if (!encaja(record, texto)) return false;
    if (filtros.marca !== "all" && record.businessUnitId !== filtros.marca) return false;
    if (filtros.canal !== "all" && record.inquiryType !== filtros.canal) return false;
    if (filtros.origen !== "all" && record.entryMode !== filtros.origen) return false;
    /*
      El estado solo lo tienen las individuales: un recuento semanal es una
      cifra, no una consulta con ficha. Así que filtrar por estado es además
      quedarse con las individuales, que es lo que espera quien lo pulsa —si
      no, pedir «ganado» seguiría devolviendo semanales sin estado.
    */
    if (filtros.estado !== "all") {
      if (record.entryMode !== "single") return false;
      if ((record.status ?? ESTADO_POR_DEFECTO) !== filtros.estado) return false;
    }
    return true;
  });
}

export function ordenarConsultas(records: InquiryRecord[], orden: ComoSeOrdena, nombres: NombresYValores): InquiryRecord[] {
  const signo = orden.desc ? -1 : 1;
  const comparar = (a: InquiryRecord, b: InquiryRecord): number => {
    switch (orden.columna) {
      case "unidad": return nombres.marcaDe(a.businessUnitId).localeCompare(nombres.marcaDe(b.businessUnitId), "es");
      case "contacto": return enMinusculas(a.contactName).localeCompare(enMinusculas(b.contactName), "es");
      case "canal": return nombres.canalDe(a.inquiryType).localeCompare(nombres.canalDe(b.inquiryType), "es");
      case "estado": return nombres.estadoDe(a.status ?? ESTADO_POR_DEFECTO).localeCompare(nombres.estadoDe(b.status ?? ESTADO_POR_DEFECTO), "es");
      case "origen": return a.entryMode.localeCompare(b.entryMode);
      case "cantidad": return a.count - b.count;
      case "valor": return nombres.valorDe(a) - nombres.valorDe(b);
      default: return a.createdAt.localeCompare(b.createdAt);
    }
  };
  /*
    A igualdad, por identificador.

    Sin esto, dos consultas del mismo día —o dos del mismo estado— cambian de
    sitio entre repintados, y la fila que ibas a pulsar se mueve. El desempate
    va con el mismo signo que el resto para que al invertir el orden la lista
    quede exactamente del revés.
  */
  return records.slice().sort((a, b) => (comparar(a, b) || a.id.localeCompare(b.id)) * signo);
}

/** Filtrar y ordenar de una vez, que es como lo usa la pantalla. */
export function listaDeConsultas(
  records: InquiryRecord[],
  filtros: FiltrosDeConsultas,
  orden: ComoSeOrdena,
  nombres: NombresYValores,
): InquiryRecord[] {
  return ordenarConsultas(filtrarConsultas(records, filtros), orden, nombres);
}

/** Si hay algún filtro de columna puesto (el buscador no cuenta: se ve solo). */
export function hayFiltrosPuestos(filtros: FiltrosDeConsultas): boolean {
  return filtros.marca !== "all" || filtros.canal !== "all" || filtros.estado !== "all" || filtros.origen !== "all";
}
