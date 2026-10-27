import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { createClient } from "@/lib/supabase/client";

/**
 * El gasto de Meta repartido por marca, campaña y mes.
 *
 * Existe para que el panel de inicio y la pestaña de Campañas cuenten lo mismo.
 * Antes el inicio leía meta_ads_entries, la tabla que se rellenaba a mano: decía
 * 1.237,33 € y 385 leads donde Meta dice 1.051,42 € y 293, y además colgaba todo
 * el gasto del mes en que empezó la campaña en vez del día en que se gastó.
 *
 * Reglas, las mismas que en la pestaña de Meta Ads:
 *
 *  - Gasto y leads salen de meta_insights_daily, un día por fila.
 *  - Los ingresos los escribe una persona en meta_campaign_extras, porque aquí
 *    se vende por teléfono y por WhatsApp y Meta no ve esas ventas. Como no
 *    llevan fecha, se cuelgan del primer día en que esa campaña gastó, que es
 *    justo lo que hacía la tabla vieja con su start_date.
 *  - La marca la manda la campaña de la aplicación a la que esté atada, y solo
 *    si no está atada a ninguna manda la marca de la cuenta publicitaria:
 *    "Leads | Filtros Línea Jender" se lanzó desde la cuenta de Intec y es de
 *    Jender.
 */
export type MetaSpendRow = {
  businessUnitId: string;
  /** La campaña de la aplicación a la que está atada, si lo está. */
  campaignId: string | null;
  month: string;
  amountSpent: number;
  leads: number;
  revenue: number;
};

type Cliente = ReturnType<typeof createClient>;

export async function loadMetaSpendByMonth(supabase: Cliente): Promise<{ rows: MetaSpendRow[]; error: unknown }> {
  const [cuentasRes, campanasRes, appRes, extrasRes, diasRes] = await Promise.all([
    supabase.from("meta_ad_accounts").select("account_id, business_unit_id"),
    supabase.from("meta_campaigns").select("meta_id, account_id, campaign_id"),
    supabase.from("campaigns").select("id, business_unit_id"),
    supabase.from("meta_campaign_extras").select("meta_campaign_id, revenue, updated_at"),
    // Un año son miles de filas y PostgREST devuelve mil por petición.
    fetchAllPages<{ meta_campaign_id: string; day: string; spend: number; leads: number }>((from, to) =>
      supabase.from("meta_insights_daily").select("meta_campaign_id, day, spend, leads").order("day").order("meta_campaign_id").range(from, to)),
  ]);

  // Los extras son opcionales: si falta su migración, el resto sigue saliendo.
  const error = cuentasRes.error ?? campanasRes.error ?? appRes.error ?? diasRes.error;
  if (error) return { rows: [], error };

  const marcaDeCuenta = new Map((cuentasRes.data ?? []).map((row) => [row.account_id as string, row.business_unit_id as string | null]));
  const marcaDeCampanaApp = new Map((appRes.data ?? []).map((row) => [row.id as string, row.business_unit_id as string]));
  const ficha = new Map((campanasRes.data ?? []).map((row) => [row.meta_id as string, row]));

  const marcaDe = (metaCampaignId: string): string | null => {
    const fila = ficha.get(metaCampaignId);
    if (!fila) return null;
    const atada = fila.campaign_id ? marcaDeCampanaApp.get(fila.campaign_id as string) : undefined;
    return atada ?? marcaDeCuenta.get(fila.account_id as string) ?? null;
  };

  const buckets = new Map<string, MetaSpendRow>();
  const bucket = (businessUnitId: string, campaignId: string | null, month: string): MetaSpendRow => {
    const clave = `${businessUnitId}|${campaignId ?? ""}|${month}`;
    let fila = buckets.get(clave);
    if (!fila) {
      fila = { businessUnitId, campaignId, month, amountSpent: 0, leads: 0, revenue: 0 };
      buckets.set(clave, fila);
    }
    return fila;
  };

  /** Primer día con gasto de cada campaña, para colgar de ahí sus ingresos. */
  const primerDia = new Map<string, string>();
  for (const dia of diasRes.data) {
    const marca = marcaDe(dia.meta_campaign_id);
    if (!marca) continue;
    const mes = String(dia.day).slice(0, 7);
    const fila = bucket(marca, (ficha.get(dia.meta_campaign_id)?.campaign_id as string | null) ?? null, mes);
    fila.amountSpent += Number(dia.spend ?? 0);
    fila.leads += Number(dia.leads ?? 0);
    const actual = primerDia.get(dia.meta_campaign_id);
    if (!actual || String(dia.day) < actual) primerDia.set(dia.meta_campaign_id, String(dia.day));
  }

  for (const extra of extrasRes.data ?? []) {
    const ingreso = Number(extra.revenue ?? 0);
    if (ingreso === 0) continue;
    const metaId = extra.meta_campaign_id as string;
    const marca = marcaDe(metaId);
    if (!marca) continue;
    // Sin ningún día con gasto no hay fecha a la que colgarlo; se usa la del
    // último cambio para que el dinero no desaparezca del panel.
    const mes = (primerDia.get(metaId) ?? String(extra.updated_at ?? "")).slice(0, 7);
    if (mes.length !== 7) continue;
    bucket(marca, (ficha.get(metaId)?.campaign_id as string | null) ?? null, mes).revenue += ingreso;
  }

  return { rows: [...buckets.values()], error: null };
}
