import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { fetchCampaigns, fetchCampaignsByIds, fetchDailyInsights, MetaAdsError, tokenFor, type MetaCampaign } from "@/lib/meta/ads-client";
import { syncPagesAndLeads } from "@/lib/meta/leads-import";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Trae de Meta el gasto de cada campaña, un día por fila; después une cada
 * campaña con la de la aplicación (o la crea) y revisa los formularios de
 * clientes potenciales por si algún aviso de Meta se perdió.
 *
 * Se vuelve a pasar por los últimos días en cada ejecución, no solo por el de
 * ayer: Meta sigue ajustando sus cifras durante días, y un dato que se guardó
 * una vez y no se vuelve a mirar se queda mal para siempre.
 *
 * Para rellenar histórico se puede llamar a mano con ?desde=2026-01-01, y con
 * ?cuenta= para hacer solo una. La ventana se parte en trozos porque pedir dos
 * años de golpe con detalle diario hace que Meta corte la respuesta.
 */

const DIAS_QUE_SE_REPASAN = 7;
const DIAS_POR_PETICION = 45;
export const maxDuration = 300;

const clave = (fecha: Date) => fecha.toISOString().slice(0, 10);

function ventanas(desde: string, hasta: string): { from: string; to: string }[] {
  const trozos: { from: string; to: string }[] = [];
  const fin = new Date(`${hasta}T00:00:00Z`);
  let inicio = new Date(`${desde}T00:00:00Z`);
  while (inicio <= fin) {
    const corte = new Date(inicio);
    corte.setUTCDate(corte.getUTCDate() + DIAS_POR_PETICION - 1);
    trozos.push({ from: clave(inicio), to: clave(corte > fin ? fin : corte) });
    inicio = new Date(corte);
    inicio.setUTCDate(inicio.getUTCDate() + 1);
  }
  return trozos;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const hoy = new Date();
  const hasta = params.get("hasta") ?? clave(hoy);
  const desde = params.get("desde") ?? clave(new Date(hoy.getTime() - DIAS_QUE_SE_REPASAN * 86400000));
  const soloCuenta = params.get("cuenta");

  const { data: cuentas, error: errorCuentas } = await admin
    .from("meta_ad_accounts")
    .select("account_id, name, token_key")
    .eq("is_active", true)
    .order("name");
  if (errorCuentas) {
    console.error("Cron meta-ads: no se pudieron leer las cuentas", errorCuentas);
    return NextResponse.json({ error: "No se pudieron leer las cuentas." }, { status: 500 });
  }

  const elegidas = (cuentas ?? []).filter((cuenta) => !soloCuenta || cuenta.account_id === soloCuenta);
  const resumen: Record<string, string>[] = [];
  /** Campañas de la aplicación que se dan por finalizadas porque Meta las archivó. */
  let finalizadas = 0;

  for (const cuenta of elegidas) {
    const empezado = new Date().toISOString();
    let filas = 0;
    try {
      const token = tokenFor(cuenta.token_key);
      // Sin token no se falla la ejecución entera: las demás cuentas sí pueden
      // sincronizarse, y así se ve cuál es la que falta.
      if (!token) throw new MetaAdsError(`Falta META_ADS_TOKEN_${cuenta.token_key}`);

      // Las campañas primero: los datos diarios apuntan a ellas.
      const conocidas = new Set<string>();
      const guardarCampanas = async (lista: MetaCampaign[]) => {
        if (lista.length === 0) return;
        const { error } = await admin.from("meta_campaigns").upsert(
          lista.map((campana) => ({
            account_id: cuenta.account_id,
            meta_id: campana.id,
            name: campana.name,
            objective: campana.objective,
            status: campana.status,
            started_at: campana.startedAt,
            stopped_at: campana.stoppedAt,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "meta_id" },
        );
        if (error) throw new Error(error.message);
        for (const campana of lista) conocidas.add(campana.id);
      };

      const campanas = await fetchCampaigns(cuenta.account_id, token);
      await guardarCampanas(campanas);
      // Si Meta dice que una campaña está archivada, aquí se da por finalizada:
      // en el panel no puede seguir saliendo "Activa" algo que ya no corre.
      const { data: cerradas, error: errorEstado } = await admin.rpc("meta_sync_campaign_status");
      if (errorEstado) console.warn("No se pudo poner al día el estado de las campañas:", errorEstado.message);
      else if (Number(cerradas) > 0) finalizadas += Number(cerradas);

      for (const ventana of ventanas(desde, hasta)) {
        const datos = await fetchDailyInsights(cuenta.account_id, token, ventana.from, ventana.to);
        // Una campaña puede tener gasto y no venir en el listado. Antes esas
        // filas se tiraban y faltaban 9,86 € de BlizzCool; ahora se pide su
        // ficha para poder guardar su gasto.
        const desconocidas = [...new Set(datos.map((fila) => fila.campaignId))].filter((id) => !conocidas.has(id));
        if (desconocidas.length > 0) await guardarCampanas(await fetchCampaignsByIds(desconocidas, token));
        const utiles = datos.filter((fila) => conocidas.has(fila.campaignId));
        for (let i = 0; i < utiles.length; i += 500) {
          const { error } = await admin.from("meta_insights_daily").upsert(
            utiles.slice(i, i + 500).map((fila) => ({
              meta_campaign_id: fila.campaignId,
              day: fila.day,
              spend: fila.spend,
              impressions: fila.impressions,
              reach: fila.reach,
              clicks: fila.clicks,
              leads: fila.leads,
              purchases: fila.purchases,
              revenue: fila.revenue,
              synced_at: new Date().toISOString(),
            })),
            { onConflict: "meta_campaign_id,day" },
          );
          if (error) throw new Error(error.message);
        }
        filas += utiles.length;
      }

      await admin.from("ads_sync_runs").insert({
        platform: "meta",
        started_at: empezado,
        finished_at: new Date().toISOString(),
        account_id: cuenta.account_id,
        covered_from: desde,
        covered_to: hasta,
        rows_written: filas,
        ok: true,
      });
      resumen.push({ [cuenta.name]: `${campanas.length} campañas, ${filas} días` });
    } catch (cause) {
      const mensaje = cause instanceof Error ? cause.message : "Error desconocido";
      console.error(`Cron meta-ads: falló ${cuenta.name}`, mensaje);
      await admin.from("ads_sync_runs").insert({
        platform: "meta",
        started_at: empezado,
        finished_at: new Date().toISOString(),
        account_id: cuenta.account_id,
        covered_from: desde,
        covered_to: hasta,
        rows_written: filas,
        ok: false,
        message: mensaje.slice(0, 500),
      });
      resumen.push({ [cuenta.name]: `FALLÓ: ${mensaje.slice(0, 120)}` });
    }
  }

  // Con las campañas al día, cada una se une a la de la aplicación (o se crea):
  // así el gasto aparece en Campañas sin darla de alta a mano.
  const { data: unidas, error: errorUnion } = await admin.rpc("meta_reconcile_campaigns");
  const porAccion = new Map<string, number>();
  for (const fila of (unidas ?? []) as { accion: string }[]) porAccion.set(fila.accion, (porAccion.get(fila.accion) ?? 0) + 1);
  const campanas = errorUnion
    ? `No se pudieron unir: ${errorUnion.message}`
    : porAccion.size === 0 ? "Nada nuevo que unir" : [...porAccion].map(([accion, total]) => `${total} ${accion}`).join(", ");

  // Y los formularios de clientes potenciales que no hayan entrado por su aviso.
  let formularios: string[] = [];
  if (!soloCuenta) {
    try {
      formularios = await syncPagesAndLeads(admin, appOrigin(request));
    } catch (cause) {
      formularios = [`No se pudieron revisar: ${cause instanceof Error ? cause.message : "error desconocido"}`];
    }
  }

  return NextResponse.json({ desde, hasta, cuentas: resumen, campanas, formularios, finalizadas });
}
