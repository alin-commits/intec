"use client";

import { createClient } from "@/lib/supabase/client";
import { latestSnapshot, type SnapshotRow } from "@/lib/sage-panel";
import type { SalesContext } from "./sales-context";
import { useSageQuery } from "./sales-ui";

/*
  Lo que varias páginas piden a la base de datos, con los filtros del panel.
*/

export type CustomerCounts = {
  activos: number;
  nuevos: number;
  recurrentes: number;
  recuperados: number;
  perdidos: number;
  sin_compra_30: number;
  sin_compra_60: number;
  sin_compra_90: number;
  neto_activos: number;
  neto_recurrentes: number;
  neto_perdidos: number;
};

/**
 * Las cifras de clientes del periodo y los filtros (necesita el detalle nuevo
 * de Sage). Con `previous`, las del periodo con el que se compara; si no se
 * compara, no se pregunta nada.
 */
export function useCustomerCounts(ctx: SalesContext, previous = false) {
  const range = previous ? ctx.period.compare : ctx.period;
  const args = { p_from: range?.from ?? "", p_to: range?.to ?? "", ...ctx.rpc };
  const key = ctx.detail.customers && range ? JSON.stringify([args, ctx.reloadKey]) : null;
  return useSageQuery<CustomerCounts>(key, async () => {
    const { data, error } = await createClient().rpc("sage_customer_counts", args);
    const row = ((data ?? []) as Record<string, number | string>[])[0];
    if (error || !row) return { data: null, error };
    const numbers = Object.fromEntries(Object.entries(row).map(([name, value]) => [name, Number(value)])) as CustomerCounts;
    return { data: numbers, error: null };
  });
}

type MonthlyCustomers = { company_code: number; month: string; active_customers: number; new_customers: number };

/**
 * Lo que ya había antes del detalle nuevo: clientes con compra y nuevos por
 * mes (totales por sociedad) y la foto de los que han dejado de comprar. Sin
 * nombres, pero mejor que un hueco mientras llega lo demás.
 */
export function useCustomerTotals(ctx: SalesContext) {
  // Del periodo y de lo que se le pone al lado, para poder comparar mes a mes.
  const from = ctx.period.baseCompare && ctx.period.baseCompare.from < ctx.period.base.from ? ctx.period.baseCompare.from : ctx.period.base.from;
  const to = ctx.period.base.to;
  const key = JSON.stringify([from, to, ctx.reloadKey]);
  return useSageQuery<{ monthly: MonthlyCustomers[]; firstMonth: string | null; snapshots: SnapshotRow[] }>(key, async () => {
    const supabase = createClient();
    const [monthly, first, snapshots] = await Promise.all([
      supabase.from("sage_customers_monthly").select("company_code, month, active_customers, new_customers")
        .gte("month", `${from.slice(0, 7)}-01`).lte("month", to),
      supabase.from("sage_customers_monthly").select("month").order("month").limit(1),
      supabase.from("sage_snapshots").select("taken_on, company_code, metric, rep_code, count, amount").order("taken_on", { ascending: false }).limit(1000),
    ]);
    const error = monthly.error ?? first.error ?? snapshots.error;
    if (error) return { data: null, error };
    return {
      data: {
        monthly: (monthly.data ?? []) as MonthlyCustomers[],
        firstMonth: ((first.data ?? [])[0] as { month: string } | undefined)?.month ?? null,
        snapshots: (snapshots.data ?? []) as SnapshotRow[],
      },
      error: null,
    };
  });
}

/** La última foto de una métrica, en la sociedad elegida. */
export function snapshotTotal(snapshots: SnapshotRow[], metric: SnapshotRow["metric"], company: number | null) {
  const latest = latestSnapshot(snapshots, metric);
  if (!latest.takenOn) return null;
  const rows = latest.rows.filter((row) => company === null || row.company_code === company);
  return {
    takenOn: latest.takenOn,
    rows,
    count: rows.reduce((sum, row) => sum + Number(row.count), 0),
    amount: rows.reduce((sum, row) => sum + Number(row.amount), 0),
  };
}
