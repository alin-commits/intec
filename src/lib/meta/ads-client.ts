import "server-only";

/**
 * Lo justo de la API de Meta para traerse el gasto de las campañas.
 *
 * Cada cuenta publicitaria vive en un portfolio distinto, y en Meta un token
 * pertenece a un portfolio, así que cada cuenta dice de qué variable sale el
 * suyo: META_ADS_TOKEN_<token_key>. El token nunca sale de aquí ni aparece en
 * un error: si se cuela en un log, se cuela en un log para siempre.
 */

const VERSION = "v26.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

export type MetaCampaign = {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
};

export type MetaDailyInsight = {
  campaignId: string;
  day: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
};

export class MetaAdsError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "MetaAdsError";
  }
}

export function tokenFor(tokenKey: string): string | null {
  return process.env[`META_ADS_TOKEN_${tokenKey}`]?.trim() || null;
}

/**
 * Una llamada a Meta, siguiendo la paginación hasta el final.
 *
 * El token va en la cabecera y no en la dirección: en la dirección acabaría en
 * los registros del servidor y en cualquier traza de error.
 */
async function getAll(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let url: string | null = `${BASE}/${path}?${new URLSearchParams({ ...params, limit: "200" })}`;
  // Un tope duro de páginas: si algo va mal, mejor quedarse corto que dar
  // vueltas para siempre contra la API de otro.
  for (let page = 0; url && page < 50; page++) {
    const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({})) as {
      data?: Record<string, unknown>[];
      paging?: { next?: string };
      error?: { message?: string; code?: number };
    };
    if (!response.ok || body.error) {
      throw new MetaAdsError(body.error?.message ?? `Meta respondió ${response.status}`, body.error?.code);
    }
    rows.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return rows;
}

const CAMPOS_CAMPANA = "id,name,objective,status,start_time,stop_time";

function aCampana(row: Record<string, unknown>): MetaCampaign {
  return {
    id: String(row.id),
    name: String(row.name ?? "(sin nombre)"),
    objective: row.objective ? String(row.objective) : null,
    status: row.status ? String(row.status) : null,
    startedAt: row.start_time ? String(row.start_time) : null,
    stoppedAt: row.stop_time ? String(row.stop_time) : null,
  };
}

/**
 * Las campañas de una cuenta.
 *
 * Se piden también las archivadas y las borradas: por defecto Meta solo
 * devuelve las vivas, pero una campaña apagada hace meses sigue teniendo su
 * gasto en el histórico, y sin su ficha ese gasto se quedaría fuera.
 */
export async function fetchCampaigns(accountId: string, token: string): Promise<MetaCampaign[]> {
  const rows = await getAll(`act_${accountId}/campaigns`, {
    fields: CAMPOS_CAMPANA,
    filtering: JSON.stringify([{
      field: "campaign.effective_status",
      operator: "IN",
      value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"],
    }]),
  }, token);
  return rows.map(aCampana);
}

/**
 * Campañas sueltas por su identificador. Es la red de seguridad: si aun así
 * aparece gasto de una campaña que el listado no devolvió, se pide su ficha en
 * vez de tirar el dato.
 */
export async function fetchCampaignsByIds(ids: string[], token: string): Promise<MetaCampaign[]> {
  const encontradas: MetaCampaign[] = [];
  // Meta acepta varios objetos por llamada, pero no cientos.
  for (let i = 0; i < ids.length; i += 40) {
    const lote = ids.slice(i, i + 40);
    const response = await fetch(`${BASE}/?ids=${lote.join(",")}&fields=${CAMPOS_CAMPANA}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string } };
    // Que una ficha no se pueda recuperar no debe tumbar la sincronización.
    if (!response.ok || body.error) continue;
    for (const valor of Object.values(body)) {
      if (valor && typeof valor === "object" && "id" in valor) encontradas.push(aCampana(valor as Record<string, unknown>));
    }
  }
  return encontradas;
}

/**
 * Meta no devuelve los leads y las compras como columnas, sino dentro de una
 * lista de "acciones" donde cada tipo es una fila.
 *
 * Y el mismo hecho aparece varias veces con nombres distintos: en estas cuentas
 * `lead` y `onsite_conversion.lead_grouped` valen los dos 290, porque son los
 * mismos 290 leads contados por dos caminos. Sumarlos daría 580. Así que no se
 * suman: se coge el primero de la lista que exista, de más general a más
 * concreto, y los específicos solo entran si el general no viene.
 */
const LEADS_POR_ORDEN = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const COMPRAS_POR_ORDEN = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

function primeraAccion(acciones: unknown, porOrden: string[]): number {
  if (!Array.isArray(acciones)) return 0;
  const porTipo = new Map<string, number>();
  for (const accion of acciones as { action_type?: string; value?: string }[]) {
    if (accion.action_type) porTipo.set(accion.action_type, Number(accion.value ?? 0));
  }
  for (const tipo of porOrden) {
    const valor = porTipo.get(tipo);
    if (valor !== undefined) return valor;
  }
  return 0;
}

/** El gasto y los resultados de cada campaña, un día por fila. */
export async function fetchDailyInsights(
  accountId: string,
  token: string,
  from: string,
  to: string,
): Promise<MetaDailyInsight[]> {
  const rows = await getAll(`act_${accountId}/insights`, {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: from, until: to }),
    fields: "campaign_id,date_start,spend,impressions,reach,clicks,actions,action_values",
  }, token);
  return rows.map((row) => ({
    campaignId: String(row.campaign_id),
    day: String(row.date_start),
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    clicks: Number(row.clicks ?? 0),
    leads: primeraAccion(row.actions, LEADS_POR_ORDEN),
    purchases: primeraAccion(row.actions, COMPRAS_POR_ORDEN),
    revenue: primeraAccion(row.action_values, COMPRAS_POR_ORDEN),
  }));
}
