import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildWeeklyDigestEmail, type WeeklyBlock } from "@/lib/notification-emails";
import { HORAS_PARA_ATENDER, atencionDeLead } from "@/lib/leads/atencion";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

/*
  El resumen de la semana para dirección, los lunes por la mañana.

  Dirección no entra todos los días en el Hub, y un dato que hay que ir a buscar
  no se mira. Esto manda lo necesario —cómo fue en ventas, cuántos leads
  entraron y cuántos siguen sin contactar, cuántas consultas— sin pedir que
  nadie abra nada.

  Mira la semana cerrada, de lunes a domingo, no los últimos siete días: "la
  semana pasada" es una cosa que todo el mundo entiende igual.
*/

const euros = (valor: number) => `${valor.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`;
const numero = (valor: number) => valor.toLocaleString("es-ES");
const porcentaje = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %` : "—");

/** El lunes y el domingo de la semana anterior a la de ese día. */
function semanaPasada(hoy: Date): { desde: string; hasta: string } {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const dia = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dia - 6);
  const desde = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { desde, hasta: d.toISOString().slice(0, 10) };
}

const etiqueta = (desde: string, hasta: string) => {
  const f = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "long", timeZone: "UTC" });
  return `la semana del ${f(desde)} al ${f(hasta)}`;
};

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const { desde, hasta } = semanaPasada(new Date());
  const finDia = `${hasta}T23:59:59.999Z`;

  const [ventas, anterior, leads, consultas, personas] = await Promise.all([
    admin.rpc("sage_sales_summary", { p_from: desde, p_to: hasta, p_basis: "albaran" }),
    admin.rpc("sage_sales_summary", {
      p_from: new Date(new Date(`${desde}T00:00:00Z`).getTime() - 7 * 86400000).toISOString().slice(0, 10),
      p_to: new Date(new Date(`${hasta}T00:00:00Z`).getTime() - 7 * 86400000).toISOString().slice(0, 10),
      p_basis: "albaran",
    }),
    fetchAllPages<{ id: string; status: string; created_at: string; sale_value: number | null }>((from, to) => admin
      .from("leads").select("id, status, created_at, sale_value")
      .gte("created_at", `${desde}T00:00:00Z`).lte("created_at", finDia).order("id").range(from, to)),
    fetchAllPages<{ count: number }>((from, to) => admin
      .from("inquiries").select("count")
      .gte("created_at", `${desde}T00:00:00Z`).lte("created_at", finDia).order("id").range(from, to)),
    admin.from("profiles").select("full_name, email").eq("is_active", true).eq("is_preview", false).overlaps("roles", ["direction", "owner"]).not("email", "is", null),
  ]);

  const suma = (filas: { net_amount?: number }[] | null) => (filas ?? []).reduce((total, fila) => total + Number(fila.net_amount ?? 0), 0);
  const ventasSemana = suma(ventas.data as { net_amount?: number }[] | null);
  const ventasAnterior = suma(anterior.data as { net_amount?: number }[] | null);
  const variacion = ventasAnterior > 0 ? ((ventasSemana - ventasAnterior) / ventasAnterior) * 100 : null;

  const nuevos = leads.data;
  const sinContactar = nuevos.filter((lead) => lead.status === "new").length;

  // Cuánto tardaron en dar la primera señal a los que entraron esa semana. Es
  // la diferencia entre "no entraron leads" y "entraron y nadie los cogió", que
  // desde arriba se confunden y no son lo mismo ni de lejos.
  const { data: historial } = nuevos.length === 0
    ? { data: [] }
    : await admin.from("lead_status_history").select("lead_id, new_status, changed_at").in("lead_id", nuevos.map((lead) => lead.id));
  const cambios = (historial ?? []) as { lead_id: string; new_status: string; changed_at: string }[];
  const atenciones = nuevos.map((lead) => atencionDeLead({
    createdAt: lead.created_at,
    status: lead.status,
    statusHistory: cambios.filter((cambio) => cambio.lead_id === lead.id).map((cambio) => ({ newStatus: cambio.new_status, changedAt: cambio.changed_at })),
  }, finDia));
  const atendidosTarde = atenciones.filter((atencion) => atencion.estado === "tarde").length;
  const atendidos = atenciones.filter((atencion) => atencion.estado === "tarde" || atencion.estado === "a-tiempo").length;
  const ganados = nuevos.filter((lead) => lead.status === "won");
  const consultasSemana = consultas.data.reduce((total, fila) => total + Number(fila.count ?? 1), 0);

  // Los que siguen sin contactar, sean de la semana que sean: eso es lo que
  // de verdad preocupa a quien mira el negocio desde arriba.
  const { count: pendientesTotal } = await admin
    .from("leads").select("id", { count: "exact", head: true })
    .eq("status", "new").lt("created_at", new Date(Date.now() - 3 * 86400000).toISOString());

  const blocks: WeeklyBlock[] = [
    {
      title: "Ventas",
      rows: [
        { label: "Facturado según Sage", value: euros(ventasSemana), note: ventas.error ? "no se pudo leer" : undefined },
        { label: "La semana anterior", value: euros(ventasAnterior) },
        { label: "Variación", value: variacion === null ? "—" : `${variacion >= 0 ? "+" : ""}${variacion.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %` },
      ],
    },
    {
      title: "Leads",
      rows: [
        { label: "Entraron", value: numero(nuevos.length) },
        { label: "Siguen sin contactar", value: numero(sinContactar), note: `${porcentaje(sinContactar, nuevos.length)} de los que entraron` },
        { label: "Ganados", value: numero(ganados.length), note: ganados.length ? euros(ganados.reduce((t, l) => t + Number(l.sale_value ?? 0), 0)) : undefined },
        { label: "Atendidos tarde", value: numero(atendidosTarde), note: `de ${numero(atendidos)} atendidos · más de ${HORAS_PARA_ATENDER} h laborables desde que entraron` },
        { label: "Sin contactar desde hace más de 3 días", value: numero(pendientesTotal ?? 0), note: "de cualquier fecha" },
      ],
    },
    {
      title: "Consultas",
      rows: [{ label: "Registradas", value: numero(consultasSemana) }],
    },
  ];

  const gente = (personas.data ?? []) as { full_name: string | null; email: string }[];
  if (gente.length === 0) return NextResponse.json({ skipped: "Sin destinatarios." });

  const url = `${appOrigin(request)}/dashboard`;
  const periodLabel = etiqueta(desde, hasta);
  let sent = 0;
  for (const persona of gente) {
    const ok = await sendEmail({ to: persona.email, ...buildWeeklyDigestEmail({ recipientName: persona.full_name, periodLabel, blocks, url }) });
    if (ok) sent++;
  }

  return NextResponse.json({ sent, desde, hasta, ventas: ventasSemana, leads: nuevos.length, atendidosTarde, consultas: consultasSemana });
}
