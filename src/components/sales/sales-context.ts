import type { Company, Rep, RepIdentity, SalesFilters, SalesModel, SalesTarget, SummaryRow } from "@/lib/sales-model";
import type { PeriodChoice, SalesPeriod } from "@/lib/sales-period";

/*
  Lo que la carcasa del cuadro de mando de ventas reparte a cada página: los
  datos ya cargados, los filtros y cómo cambiarlos, y cómo abrir una lista.
*/

export type SalesPageKey = "resumen" | "ventas" | "comercial" | "productos" | "clientes" | "comparador" | "objetivos";
export type SalesDimension = "company" | "channel" | "rep" | "month" | "family";

/**
 * Las páginas y los filtros que respeta cada una. Un filtro que una página no
 * puede aplicar (los artículos no llevan comercial, la venta total no se parte
 * por familia) sigue puesto, pero su etiqueta sale en gris diciendo por qué.
 */
export const salesPages: { key: SalesPageKey; label: string; applies: SalesDimension[] }[] = [
  { key: "resumen", label: "Resumen", applies: ["company", "channel", "rep", "month"] },
  { key: "ventas", label: "Ventas y margen", applies: ["company", "channel", "rep", "month"] },
  { key: "comercial", label: "Comercial", applies: ["company", "channel", "rep", "month"] },
  { key: "productos", label: "Productos", applies: ["company", "month", "family"] },
  { key: "clientes", label: "Clientes", applies: ["company", "channel", "rep", "month", "family"] },
  // El comparador vive de lo marcado: todos los filtros se aplican, porque son
  // justo lo que compara.
  { key: "comparador", label: "Comparador", applies: ["company", "channel", "rep", "month", "family"] },
  { key: "objetivos", label: "Objetivos", applies: ["company", "rep", "month"] },
];

export type CustomerKind = "activos" | "nuevos" | "recurrentes" | "recuperados" | "perdidos" | "sin_compra";

/**
 * Los perdidos son los habituales del año anterior que en el año en curso no
 * han comprado nada; el año en curso es el del final del periodo que se mira.
 */
export function lostCustomers(period: SalesPeriod) {
  const year = Number(period.to.slice(0, 4));
  const previous = year - 1;
  return {
    year,
    previous,
    title: `Clientes de ${previous} que en ${year} no han comprado`,
    description: `Clientes habituales de ${previous} (compraron en 2 días o más) que en ${year} todavía no han comprado nada. Son los primeros a los que llamar. Los de una sola compra no cuentan.`,
  };
}
export type OfferKind = "todas" | "vivas" | "convertidas" | "rechazadas" | "caducadas";
export type OrderKind = "todos" | "pendientes" | "tarde";

/** Una lista que se abre al pulsar una cifra: quién está detrás de ese número. */
export type ListRequest =
  | { type: "clientes"; kind: CustomerKind; days?: number; title: string; description: string }
  | { type: "ofertas"; kind: OfferKind; title: string; description: string }
  | { type: "pedidos"; kind: OrderKind; title: string; description: string };

export type FamilyName = { company_code: number; code: string; name: string };

/** Un cliente de Sage, para abrir su ficha. El nombre, si se sabe, sale mientras carga. */
export type CustomerRef = { company_code: number; customer_code: string; name?: string | null };

/** Qué detalle ha mandado ya el agente de Sage (hasta que lo mande, se avisa). */
export type SageDetail = { customers: boolean; articles: boolean; offers: boolean; orders: boolean; incidents: boolean };

/**
 * Los filtros del panel tal como los piden las funciones de la base.
 *
 * `p_months` son los meses marcados ("2026-09"). Va a nulo cuando no hay
 * ninguno, que para la base significa "el tramo entero": así las funciones se
 * comportan como siempre y solo recortan cuando hace falta, que es cuando los
 * meses marcados dejan huecos.
 */
export type SalesRpcArgs = {
  p_reps: string[] | null;
  p_series: string[] | null;
  /**
   * Estos tres solo están cuando hay algo marcado.
   *
   * No es por ahorrar: son los parámetros que añaden las migraciones de los
   * filtros de varios, y mandar uno que la función todavía no tiene es un
   * error de la base. Dejándolos fuera mientras no se usan, el panel sigue
   * funcionando igual que siempre aunque la migración no esté puesta, y solo
   * hace falta para filtrar por varias cosas a la vez.
   */
  p_companies?: number[];
  p_families?: string[];
  p_months?: string[];
};

export type SalesContext = {
  basis: "albaran" | "factura";
  /**
   * El periodo de las filas cargadas y con qué se compara (mientras llega otro
   * se sigue enseñando este), con el mes elegido ya aplicado.
   */
  period: SalesPeriod;
  /** Cómo se llama lo que se mira en una frase: "2026", "agosto", "todos los años"... */
  periodName: string;
  /** Cambia el periodo (la página de Objetivos lleva a un año). */
  choosePeriod: (choice: PeriodChoice) => void;
  /** Los filtros que de verdad se aplican (sin los que no existen en el periodo). */
  filters: SalesFilters;
  setFilters: (patch: Partial<SalesFilters>) => void;
  /** Pone un filtro, o lo quita si ya estaba puesto con ese valor. */
  toggle: <K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) => void;
  /**
   * Marca o desmarca un mes sin tocar los demás.
   *
   * Es lo que hace pulsar una barra del gráfico: con la tecla de mayúsculas
   * —o pulsando otra barra— se van sumando, que es lo que uno espera de un
   * filtro de varios. Pasar null los quita todos.
   */
  toggleMonth: (key: string | null) => void;
  /** Marca o desmarca un comercial sin tocar los demás. Null los quita todos. */
  toggleRep: (key: string | null) => void;
  /**
   * Lo mismo para cualquier filtro: marca el valor si no estaba y lo quita si
   * estaba. Es lo que hace pulsar una barra o una fila de un gráfico.
   */
  toggleEnLista: <K extends keyof SalesFilters>(key: K, value: SalesFilters[K][number]) => void;
  companies: Company[];
  reps: Rep[];
  families: FamilyName[];
  familyName: (code: string) => string;
  repOf: (companyCode: number, repCode: number | null) => RepIdentity;
  repName: (key: string) => string;
  rows: SummaryRow[];
  previousRows: SummaryRow[];
  model: SalesModel;
  /** Los filtros tal como los piden las funciones de la base de datos. */
  rpc: SalesRpcArgs;
  /**
   * Lo mismo, pero con los meses del periodo con el que se compara.
   *
   * Hace falta porque los meses marcados viajan a la base: la consulta del
   * periodo lleva septiembre y octubre de 2026 y la de al lado, los de 2025.
   */
  rpcCompare: SalesRpcArgs;
  companyLabel: string;
  /** "frente a 2025", "frente al mismo tramo de 2025", o por qué no se compara. */
  comparisonHelper: string;
  /** Si hay con qué comparar el total del periodo. */
  comparisonAvailable: boolean;
  reloadKey: number;
  today: Date;
  targets: SalesTarget[];
  reloadTargets: () => void;
  detail: SageDetail;
  openList: (request: ListRequest) => void;
  /** Abre la ficha de un cliente: su evolución de compra, sus pedidos y ofertas. */
  openCustomer: (customer: CustomerRef) => void;
  goTo: (page: SalesPageKey) => void;
  canSeeLeads: boolean;
};
