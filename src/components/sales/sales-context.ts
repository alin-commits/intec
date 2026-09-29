import type { Company, Rep, RepIdentity, SalesFilters, SalesModel, SalesTarget, SummaryRow } from "@/lib/sales-model";

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
export type OfferKind = "todas" | "vivas" | "convertidas" | "rechazadas" | "caducadas";
export type OrderKind = "todos" | "pendientes" | "tarde";

/** Una lista que se abre al pulsar una cifra: quién está detrás de ese número. */
export type ListRequest =
  | { type: "clientes"; kind: CustomerKind; days?: number; title: string; description: string }
  | { type: "ofertas"; kind: OfferKind; title: string; description: string }
  | { type: "pedidos"; kind: OrderKind; title: string; description: string };

export type FamilyName = { company_code: number; code: string; name: string };

/** El periodo que se mira y el mismo tramo del año anterior. */
export type SalesPeriod = { from: string; to: string; partial: boolean; previousFrom: string; previousTo: string };

/** Qué detalle ha mandado ya el agente de Sage (hasta que lo mande, se avisa). */
export type SageDetail = { customers: boolean; articles: boolean; offers: boolean; orders: boolean; incidents: boolean };

export type SalesContext = {
  /** El año elegido y el de las filas cargadas (mientras carga no coinciden). */
  year: number;
  shownYear: number;
  basis: "albaran" | "factura";
  /** Los filtros que de verdad se aplican (sin los que no existen este año). */
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
  period: SalesPeriod;
  /** Los filtros tal como los piden las funciones de la base de datos. */
  rpc: { p_company: number | null; p_reps: string[] | null; p_series: string[] | null; p_family: string | null };
  companyLabel: string;
  comparisonHelper: string;
  comparisonAvailable: boolean;
  comparisonIsPartial: boolean;
  reloadKey: number;
  today: Date;
  targets: SalesTarget[];
  reloadTargets: () => void;
  detail: SageDetail;
  openList: (request: ListRequest) => void;
  goTo: (page: SalesPageKey) => void;
  canSeeLeads: boolean;
};
