import { contactStatusLabels, leadStatusLabels } from "@/lib/constants";
import { atencionDeLead, type CambioDeEstado } from "@/lib/leads/atencion";
import { CONSULTAS_POR_CERRAR, diasDesde, LEADS_POR_CERRAR, pideCerrarse, ultimoCambio } from "@/lib/por-cerrar";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { InquiryStatus, LeadStatus } from "@/lib/types";

/*
  Lo que un comercial tiene pendiente: los leads que siguen sin tocar y lo que
  dejó a medio camino.

  Lo leen tres sitios: los dos avisos que salen al entrar y la campana que se
  queda abajo a la derecha. Sale de aquí para los tres, para que nunca digan
  cosas distintas del mismo lead: con la cuenta copiada en cada uno, bastaba
  que uno cambiara para que la campana dijera cinco y el aviso, cuatro.

  Las dos consultas van directas a la base desde el navegador, sin pasar por
  el servidor de la web: repetirlas cada pocos minutos no cuesta tráfico de
  Vercel.
*/

/** Un lead suyo que sigue en «nuevo» y ya se pasó del plazo para atenderlo. */
export type LeadSinAtender = { id: string; nombre: string; empresa: string | null; horas: number };

/** Un lead o una consulta suya contactados o interesados que llevan días sin moverse. */
export type PorCerrar = {
  /** «lead:…» o «consulta:…», para no confundir un id de una tabla con el de la otra. */
  clave: string;
  tipo: "lead" | "consulta";
  enlace: string;
  nombre: string;
  empresa: string | null;
  estado: string;
  dias: number;
};

/**
 * Sus leads sin atender, el que más lleva esperando primero.
 *
 * Con las mismas reglas que la insignia «Sin atender» de la tabla de leads:
 * horas laborables, sin fines de semana. Si la consulta falla, una lista
 * vacía: un aviso que no sale es mejor que una pantalla que se rompe.
 */
export async function cargarSinAtender(userId: string): Promise<LeadSinAtender[]> {
  // Un lead puede llevarlo más de una persona: los suyos salen de la tabla de
  // responsables, no del lead.
  const { data } = await createClient()
    .from("lead_assignees")
    .select("leads!inner(id, contact_name, client_company_name, created_at, status, lead_status_history(new_status, changed_at))")
    .eq("profile_id", userId)
    .eq("leads.status", "new");

  const ahora = new Date().toISOString();
  const tarde: LeadSinAtender[] = [];
  for (const fila of (data ?? []) as unknown as { leads: Record<string, unknown> }[]) {
    const lead = fila.leads;
    if (!lead) continue;
    const historia = (Array.isArray(lead.lead_status_history) ? lead.lead_status_history : []) as Record<string, unknown>[];
    const atencion = atencionDeLead({
      createdAt: String(lead.created_at),
      status: String(lead.status),
      statusHistory: historia.map((cambio): CambioDeEstado => ({ newStatus: String(cambio.new_status), changedAt: String(cambio.changed_at) })),
    }, ahora);
    if (atencion.estado !== "sin-atender") continue;
    tarde.push({
      id: String(lead.id),
      nombre: (lead.contact_name as string | null) || (lead.client_company_name as string | null) || "Sin nombre",
      empresa: (lead.client_company_name as string | null) ?? null,
      horas: atencion.horas,
    });
  }
  return tarde.sort((a, b) => b.horas - a.horas);
}

/**
 * Lo suyo por cerrar: leads y consultas contactados o interesados que llevan
 * una semana o más sin cambiar de estado. El que más lleva parado, primero.
 */
export async function cargarPorCerrar(userId: string): Promise<{ leads: PorCerrar[]; consultas: PorCerrar[] }> {
  const supabase = createClient();
  const ahora = new Date();
  const [deLeads, deConsultas] = await Promise.all([
    fetchAllPages((from, to) => supabase
      .from("lead_assignees")
      .select("lead_id, leads!inner(id, contact_name, client_company_name, created_at, status, lead_status_history(changed_at))")
      .eq("profile_id", userId)
      .in("leads.status", LEADS_POR_CERRAR)
      .order("lead_id")
      .range(from, to)),
    // Las consultas son de quien las apunta: es el comercial que las atiende.
    fetchAllPages<Record<string, unknown>>((from, to) => supabase
      .from("inquiries")
      .select("id, contact_name, company_name, created_at, status, inquiry_log(kind, created_at)")
      .eq("created_by", userId)
      .neq("entry_mode", "weekly")
      .in("status", [...CONSULTAS_POR_CERRAR])
      .order("id")
      .range(from, to)),
  ]);

  const leads: PorCerrar[] = [];
  // El lead de cada fila es uno solo, aunque la librería lo tipe como lista.
  for (const fila of (deLeads.data ?? []) as unknown as { leads: Record<string, unknown> | null }[]) {
    const lead = fila.leads;
    if (!lead) continue;
    const historia = (Array.isArray(lead.lead_status_history) ? lead.lead_status_history : []) as { changed_at?: string }[];
    const dias = diasDesde(ultimoCambio(String(lead.created_at), historia.map((cambio) => cambio.changed_at)), ahora);
    if (!pideCerrarse(dias)) continue;
    leads.push({
      clave: `lead:${String(lead.id)}`,
      tipo: "lead",
      enlace: `/leads?lead=${String(lead.id)}`,
      nombre: (lead.contact_name as string | null) || (lead.client_company_name as string | null) || "Sin nombre",
      empresa: (lead.client_company_name as string | null) ?? null,
      estado: leadStatusLabels[lead.status as LeadStatus] ?? String(lead.status),
      dias,
    });
  }

  const consultas: PorCerrar[] = [];
  for (const consulta of deConsultas.data ?? []) {
    // Solo cuentan los cambios de estado: corregir un teléfono no es mover la consulta.
    const registro = (Array.isArray(consulta.inquiry_log) ? consulta.inquiry_log : []) as { kind?: string; created_at?: string }[];
    const cambios = registro.filter((linea) => linea.kind === "estado").map((linea) => linea.created_at);
    const dias = diasDesde(ultimoCambio(String(consulta.created_at), cambios), ahora);
    if (!pideCerrarse(dias)) continue;
    consultas.push({
      clave: `consulta:${String(consulta.id)}`,
      tipo: "consulta",
      enlace: `/consultas?consulta=${String(consulta.id)}`,
      nombre: (consulta.contact_name as string | null) || (consulta.company_name as string | null) || "Sin nombre",
      empresa: (consulta.company_name as string | null) ?? null,
      estado: contactStatusLabels[consulta.status as InquiryStatus] ?? String(consulta.status),
      dias,
    });
  }

  return {
    leads: leads.sort((a, b) => b.dias - a.dias),
    consultas: consultas.sort((a, b) => b.dias - a.dias),
  };
}
