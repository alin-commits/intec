import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyNewLead } from "@/lib/lead-notify";
import { tokenFor } from "./ads-client";
import { comparablePhone, leadFromFields, leadNotes } from "./leadgen";
import {
  fetchCampaignWithAccount,
  fetchFormName,
  fetchLead,
  listFormLeads,
  listForms,
  listPages,
  pageAccessToken,
  subscribePage,
  type MetaLead,
} from "./pages-client";

/*
  Los formularios de Meta, dentro de Leads.

  Entran por dos caminos: el aviso que manda Meta en cuanto alguien rellena un
  formulario (al momento) y la revisión de cada mañana, que repasa los
  formularios de cada página por si algún aviso se perdió. Los dos acaban en
  importMetaLead, que no mete dos veces el mismo lead.
*/

type Page = { page_id: string; name: string; token_key: string; business_unit_id: string | null };
type Result = { ok: boolean; message: string; leadId?: string; created?: boolean };

/** Los tokens de página ya pedidos en esta ejecución, para no pedirlos dos veces. */
export type PageTokens = Map<string, string>;

async function pageTokenFor(page: Page, cache: PageTokens): Promise<string> {
  const cached = cache.get(page.page_id);
  if (cached) return cached;
  const token = tokenFor(page.token_key);
  if (!token) throw new Error(`Falta META_ADS_TOKEN_${page.token_key}`);
  const pageToken = await pageAccessToken(page.page_id, token);
  cache.set(page.page_id, pageToken);
  return pageToken;
}

const DAY_MS = 86_400_000;
/** Las fechas de Meta llegan como "2026-09-30T14:05:00+0000": se pone el huso como "+00:00". */
const metaTime = (value: string) => value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String((cause as { message: unknown }).message) : "Error desconocido");

export async function importMetaLead(admin: SupabaseClient, input: {
  leadgenId: string;
  pageId: string | null;
  via: "aviso" | "revision";
  /** La dirección de la aplicación, para el enlace del correo. */
  origin: string;
  /** El lead, si ya se tiene (la revisión los trae de la lista del formulario). */
  lead?: MetaLead;
  formName?: string | null;
}, cache: PageTokens): Promise<Result> {
  const log = async (ok: boolean, message: string, leadId?: string, created = false): Promise<Result> => {
    await admin.from("meta_lead_events").insert({
      via: input.via,
      leadgen_id: input.leadgenId,
      page_id: input.pageId,
      form_id: input.lead?.formId ?? null,
      ok,
      message: message.slice(0, 500),
      lead_id: leadId ?? null,
    });
    return { ok, message, leadId, created };
  };

  try {
    // 1. Si ya entró (Meta puede avisar dos veces, y la revisión vuelve a verlo).
    const { data: existing } = await admin.from("leads").select("id").eq("meta_lead_id", input.leadgenId).maybeSingle();
    if (existing) {
      // En la revisión es lo normal: no se apunta, para no llenar el registro.
      if (input.via === "revision") return { ok: true, message: "Ya estaba en Leads.", leadId: existing.id as string };
      return log(true, "Ya estaba en Leads.", existing.id as string);
    }

    // 2. La página, que dice qué token usar y de qué marca es.
    if (!input.pageId) return log(false, "El aviso no dice de qué página viene.");
    const { data: page } = await admin.from("meta_pages").select("page_id, name, token_key, business_unit_id").eq("page_id", input.pageId).maybeSingle();
    if (!page) return log(false, `La página ${input.pageId} no está dada de alta. La revisión de la mañana la da de alta sola si el token del portfolio llega a ella.`);
    const pageToken = await pageTokenFor(page as Page, cache);

    // 3. El lead y el nombre de su formulario.
    const lead = input.lead ?? await fetchLead(input.leadgenId, pageToken);
    const formName = input.formName !== undefined ? input.formName : lead.formId ? await fetchFormName(lead.formId, pageToken) : null;

    // 4. Su campaña. Si se lanzó hoy, la sincronización de la mañana aún no la
    // conoce: se trae ahora y se une (o se crea) en el momento.
    type MetaCampaignRow = { meta_id: string; campaign_id: string | null; account_id: string };
    const readCampaign = async (metaId: string) =>
      (await admin.from("meta_campaigns").select("meta_id, campaign_id, account_id").eq("meta_id", metaId).maybeSingle()).data as MetaCampaignRow | null;
    let metaCampaign = lead.campaignId ? await readCampaign(lead.campaignId) : null;
    if (lead.campaignId && !metaCampaign) {
      const systemToken = tokenFor((page as Page).token_key);
      const found = systemToken ? await fetchCampaignWithAccount(lead.campaignId, systemToken) : null;
      if (found) {
        const { data: account } = await admin.from("meta_ad_accounts").select("account_id").eq("account_id", found.accountId).maybeSingle();
        if (account) {
          await admin.from("meta_campaigns").upsert({
            account_id: found.accountId,
            meta_id: found.id,
            name: found.name,
            objective: found.objective,
            status: found.status,
            started_at: found.startedAt,
            stopped_at: found.stoppedAt,
            updated_at: new Date().toISOString(),
          }, { onConflict: "meta_id" });
          await admin.rpc("meta_reconcile_campaigns");
          metaCampaign = await readCampaign(found.id);
        }
      }
    }

    // 5. La marca: la de su campaña en la aplicación; si no, la de su cuenta
    // publicitaria; si no, la de la página.
    let unit = (page as Page).business_unit_id;
    if (metaCampaign) {
      const { data: account } = await admin.from("meta_ad_accounts").select("business_unit_id").eq("account_id", metaCampaign.account_id).maybeSingle();
      let campaignUnit: string | null = null;
      if (metaCampaign.campaign_id) {
        const { data: campaign } = await admin.from("campaigns").select("business_unit_id").eq("id", metaCampaign.campaign_id).maybeSingle();
        campaignUnit = (campaign?.business_unit_id as string | undefined) ?? null;
      }
      unit = campaignUnit ?? (account?.business_unit_id as string | undefined) ?? unit;
    }
    if (!unit) return log(false, `No se sabe de qué marca es: la página «${(page as Page).name}» no tiene marca asignada.`);

    // 6. Lo que contestó. Si alguien ya lo metió a mano (mismo correo o
    // teléfono, misma marca, últimos 60 días), se une a ese en vez de duplicarlo.
    const draft = leadFromFields(lead.fields);
    const phone = comparablePhone(draft.phone);
    const { data: recent } = await admin.from("leads")
      .select("id, email, phone, campaign_id")
      .eq("business_unit_id", unit)
      .is("meta_lead_id", null)
      .gte("created_at", new Date(Date.now() - 60 * DAY_MS).toISOString());
    const same = (recent ?? []).find((row) =>
      (draft.email && String(row.email ?? "").trim().toLowerCase() === draft.email)
      || (phone && comparablePhone(row.phone as string | null) === phone));
    const fromMeta = leadNotes(draft, { formName, adName: lead.adName, platform: lead.platform, createdTime: lead.createdTime });
    const fresh = !lead.createdTime || Date.now() - new Date(metaTime(lead.createdTime)).getTime() < 2 * DAY_MS;
    if (same) {
      await admin.from("leads").update({
        meta_lead_id: lead.id,
        meta_campaign_id: lead.campaignId,
        ...(same.campaign_id ? {} : { campaign_id: metaCampaign?.campaign_id ?? null }),
      }).eq("id", same.id);
      await admin.from("lead_log").insert({ lead_id: same.id, kind: "meta", text: `${fromMeta}\n(Ya estaba metido a mano: se unió a este.)` });
      // Si nadie lo llevaba y su campaña tiene comerciales, se les asigna y se les avisa.
      const { data: assigned } = await admin.rpc("assign_lead_from_campaign", { p_lead: same.id });
      if (fresh && Array.isArray(assigned) && assigned.length > 0) {
        await notifyNewLead(admin, { leadId: same.id as string, avisarA: assigned as string[], createdByName: "Meta Ads (formulario)", origin: input.origin }).catch(() => null);
      }
      return log(true, "Ya estaba metido a mano: se ha unido al de Meta.", same.id as string);
    }

    // 7. Se guarda como un lead más. Lo que llegó de Meta va a su registro, que
    // nadie puede tocar; las observaciones quedan libres para el comercial.
    const { data: created, error } = await admin.from("leads").insert({
      business_unit_id: unit,
      campaign_id: metaCampaign?.campaign_id ?? null,
      contact_name: draft.contactName,
      client_company_name: draft.company,
      email: draft.email,
      phone: draft.phone,
      location: draft.location,
      product_interest: draft.interest,
      status: "new",
      source: "META ADS",
      notes: null,
      meta_lead_id: lead.id,
      meta_campaign_id: lead.campaignId,
      created_by: null,
    }).select("id").single();
    if (error) {
      // Otro aviso del mismo lead lo ha guardado a la vez: ya está dentro.
      if (error.code === "23505") return { ok: true, message: "Ya estaba en Leads." };
      throw error;
    }

    const leadId = created.id as string;
    await admin.from("lead_log").insert({ lead_id: leadId, kind: "meta", text: fromMeta });

    // 8. Sus responsables: los comerciales de su campaña, si los tiene (a todos
    // o por turnos). Si no, se queda sin responsable y administración lo reparte.
    const { data: assigned, error: assignError } = await admin.rpc("assign_lead_from_campaign", { p_lead: leadId });
    const assignees = Array.isArray(assigned) ? assigned.length : 0;

    // 9. El aviso por correo, como con un lead de la web: a sus responsables o,
    // si no tiene, a administración. Los que rescata la revisión con más de dos
    // días no avisan: serían correos de algo viejo.
    if (fresh) await notifyNewLead(admin, { leadId, createdByName: "Meta Ads (formulario)", origin: input.origin }).catch(() => null);
    const who = assignError ? ` No se pudo asignar: ${assignError.message}.`
      : assignees > 0 ? ` Asignado por su campaña a ${assignees === 1 ? "1 comercial" : `${assignees} comerciales`}.` : "";
    return log(true, (fresh ? "Lead creado y avisado." : "Lead creado (antiguo: sin aviso por correo).") + who, leadId, true);
  } catch (cause) {
    return log(false, errorText(cause));
  }
}

/**
 * La revisión de cada mañana: da de alta las páginas a las que llega el token
 * de cada portfolio, pide a Meta que avise de sus formularios y trae los leads
 * de los últimos días que no hayan entrado ya.
 */
export async function syncPagesAndLeads(admin: SupabaseClient, origin: string): Promise<string[]> {
  const summary: string[] = [];
  const [{ data: accounts }, { data: units }] = await Promise.all([
    admin.from("meta_ad_accounts").select("token_key, business_unit_id").eq("is_active", true),
    admin.from("business_units").select("id, name").eq("is_active", true),
  ]);
  const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Lo que falle queda en el registro de formularios, no solo en la respuesta:
  // así se ve qué permiso le falta a qué portfolio sin buscar en Vercel.
  const fail = async (pageId: string | null, message: string) => {
    summary.push(message);
    await admin.from("meta_lead_events").insert({ via: "revision", page_id: pageId, ok: false, message: message.slice(0, 500) });
  };

  // ---- Las páginas de cada portfolio ----
  const tokenKeys = [...new Set((accounts ?? []).map((row) => row.token_key as string))];
  for (const key of tokenKeys) {
    const token = tokenFor(key);
    if (!token) {
      await fail(null, `${key}: falta el token`);
      continue;
    }
    try {
      const pages = await listPages(token);
      // La marca: si el portfolio solo tiene una, esa; si no, la que aparece en el nombre de la página.
      const tokenUnits = [...new Set((accounts ?? []).filter((row) => row.token_key === key).map((row) => row.business_unit_id as string | null).filter(Boolean))] as string[];
      for (const page of pages) {
        const { data: known } = await admin.from("meta_pages").select("page_id").eq("page_id", page.id).maybeSingle();
        if (known) {
          await admin.from("meta_pages").update({ name: page.name, token_key: key, updated_at: new Date().toISOString() }).eq("page_id", page.id);
          continue;
        }
        const byName = (units ?? []).filter((unit) => {
          const unitName = plain(unit.name as string);
          const pageName = plain(page.name);
          return unitName.length >= 3 && (pageName.includes(unitName) || unitName.includes(pageName));
        });
        const guessed = tokenUnits.length === 1 ? tokenUnits[0] : byName.length === 1 ? byName[0].id as string : null;
        await admin.from("meta_pages").insert({ page_id: page.id, name: page.name, token_key: key, business_unit_id: guessed });
      }
      summary.push(`${key}: ${pages.length} páginas`);
    } catch (cause) {
      await fail(null, `${key}: no se pudieron leer sus páginas (${errorText(cause).slice(0, 300)})`);
    }
  }

  // ---- Los formularios de cada página ----
  const { data: pages } = await admin.from("meta_pages").select("page_id, name, token_key, business_unit_id, subscribed_at, last_leads_check").eq("is_active", true);
  const cache: PageTokens = new Map();
  for (const page of pages ?? []) {
    try {
      const pageToken = await pageTokenFor(page as Page, cache);
      if (!page.subscribed_at) {
        await subscribePage(page.page_id as string, pageToken);
        await admin.from("meta_pages").update({ subscribed_at: new Date().toISOString() }).eq("page_id", page.page_id);
      }
      // Desde la última revisión, con un día de margen; la primera vez, la última semana.
      const since = page.last_leads_check ? new Date(page.last_leads_check as string).getTime() - DAY_MS : Date.now() - 7 * DAY_MS;
      const startedAt = new Date().toISOString();
      const forms = await listForms(page.page_id as string, pageToken);
      let created = 0;
      for (const form of forms) {
        const leads = await listFormLeads(form.id, pageToken, Math.floor(since / 1000));
        for (const lead of leads) {
          const result = await importMetaLead(admin, { leadgenId: lead.id, pageId: page.page_id as string, via: "revision", origin, lead, formName: form.name }, cache);
          if (result.created) created += 1;
        }
      }
      await admin.from("meta_pages").update({ last_leads_check: startedAt }).eq("page_id", page.page_id);
      summary.push(`${page.name}: ${forms.length} formularios, ${created} leads nuevos`);
    } catch (cause) {
      await fail(page.page_id as string, `${page.name}: ${errorText(cause).slice(0, 300)}`);
    }
  }
  return summary;
}
