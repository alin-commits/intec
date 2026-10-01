import "server-only";
import { getAll, graphCall, type MetaCampaign } from "./ads-client";

/**
 * Lo de Meta que hace falta para los formularios de clientes potenciales: las
 * páginas de Facebook de cada portfolio, sus formularios y los leads.
 *
 * Todo sale del token de cada portfolio (el mismo del gasto), que para esto
 * necesita además los permisos de páginas y de leads (pages_show_list,
 * pages_read_engagement, pages_manage_metadata y leads_retrieval). Los leads se
 * piden con el token de la página, que se saca del de portfolio.
 */

export type MetaPage = { id: string; name: string; accessToken: string | null };

/** Las páginas a las que llega el token del portfolio. */
export async function listPages(token: string): Promise<MetaPage[]> {
  const rows = await getAll("me/accounts", { fields: "id,name,access_token" }, token);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? row.id), accessToken: row.access_token ? String(row.access_token) : null }));
}

/** El token de una página, sacado del del portfolio. */
export async function pageAccessToken(pageId: string, token: string): Promise<string> {
  const page = await graphCall(pageId, { fields: "access_token" }, token);
  if (!page.access_token) throw new Error("Meta no da el token de la página: falta el permiso sobre ella.");
  return String(page.access_token);
}

/** Pide a Meta que avise a la aplicación de cada formulario nuevo de la página. */
export async function subscribePage(pageId: string, pageToken: string): Promise<void> {
  await graphCall(`${pageId}/subscribed_apps`, { subscribed_fields: "leadgen" }, pageToken, "POST");
}

export type MetaLead = {
  id: string;
  createdTime: string | null;
  fields: { name: string; values?: string[] }[];
  campaignId: string | null;
  adName: string | null;
  formId: string | null;
  platform: string | null;
};

const LEAD_FIELDS = "id,created_time,field_data,campaign_id,ad_name,form_id,platform";

function aLead(row: Record<string, unknown>): MetaLead {
  return {
    id: String(row.id),
    createdTime: row.created_time ? String(row.created_time) : null,
    fields: Array.isArray(row.field_data) ? row.field_data as MetaLead["fields"] : [],
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    adName: row.ad_name ? String(row.ad_name) : null,
    formId: row.form_id ? String(row.form_id) : null,
    platform: row.platform ? String(row.platform) : null,
  };
}

/** Un lead por su identificador. */
export async function fetchLead(leadgenId: string, pageToken: string): Promise<MetaLead> {
  return aLead(await graphCall(leadgenId, { fields: LEAD_FIELDS }, pageToken));
}

/** Los formularios de una página. */
export async function listForms(pageId: string, pageToken: string): Promise<{ id: string; name: string }[]> {
  const rows = await getAll(`${pageId}/leadgen_forms`, { fields: "id,name" }, pageToken);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? row.id) }));
}

/** Los leads de un formulario desde un momento (en segundos, como los cuenta Meta). */
export async function listFormLeads(formId: string, pageToken: string, sinceSeconds: number): Promise<MetaLead[]> {
  const rows = await getAll(`${formId}/leads`, {
    fields: LEAD_FIELDS,
    filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceSeconds }]),
  }, pageToken);
  return rows.map(aLead);
}

/** El nombre de un formulario, para las observaciones del lead. */
export async function fetchFormName(formId: string, pageToken: string): Promise<string | null> {
  try {
    const form = await graphCall(formId, { fields: "name" }, pageToken);
    return form.name ? String(form.name) : null;
  } catch {
    return null;
  }
}

/**
 * Una campaña que aún no está en la aplicación (se lanzó hoy y la
 * sincronización de la mañana todavía no la ha visto), con su cuenta.
 */
export async function fetchCampaignWithAccount(campaignId: string, token: string): Promise<(MetaCampaign & { accountId: string }) | null> {
  try {
    const row = await graphCall(campaignId, { fields: "id,name,objective,status,start_time,stop_time,account_id" }, token);
    return {
      id: String(row.id),
      name: String(row.name ?? "(sin nombre)"),
      objective: row.objective ? String(row.objective) : null,
      status: row.status ? String(row.status) : null,
      startedAt: row.start_time ? String(row.start_time) : null,
      stoppedAt: row.stop_time ? String(row.stop_time) : null,
      accountId: String(row.account_id ?? "").replace(/^act_/, ""),
    };
  } catch {
    return null;
  }
}
