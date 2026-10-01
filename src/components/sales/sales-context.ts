import type { Company, Rep, RepIdentity, SalesFilters, SalesModel, SalesTarget, SummaryRow } from "@/lib/sales-model";
import type { PeriodChoice, SalesPeriod } from "@/lib/sales-period";

/*
  Lo que la carcasa del cuadro de mando de ventas reparte a cada página: los
  datos ya cargados, los filtros y cómo cambiarlos, y cómo abrir una lista.
*/

export type SalesPageKey = "resumen" | "ventas" | "comercial" | "productos" | "clientes" | "objetivos";
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
  rpc: { p_company: number | null; p_reps: string[] | null; p_series: string[] | null; p_family: string | null };
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
