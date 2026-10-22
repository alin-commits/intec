import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { isEmailConfigured } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { todayKey } from "@/lib/dates";
import { enviarReclamacion } from "@/lib/compras/enviar-reclamacion";
import { ESTADO_SERVIDO, clavePedido, reclamacionesDeHoy, type PedidoReclamable, type Seguimiento } from "@/lib/compras/reclamaciones";

/*
  Los dos recordatorios: a las 48 y a las 120 horas del pedido.

  Corre una vez al día de lunes a viernes. En fin de semana no, no porque el
  cálculo falle, sino porque un correo que llega un sábado se lee el lunes
  enterrado entre otros veinte, y además nadie de aquí podría contestar si el
  proveedor responde.

  Solo entran pedidos hechos a partir de RECLAMAR_DESDE: lo de antes se reclama
  a mano desde la pantalla, mirándolo. Quién recibe qué lo decide
  reclamacionesDeHoy(), que no toca ni la base ni la red y está probada aparte.
*/

/** Un tope por si algún día se desmadra: nadie manda 300 correos sin querer. */
const MAXIMO_POR_DIA = 40;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const hoy = todayKey();
  const [{ data: pedidos, error: errorPedidos }, { data: lineas, error: errorLineas }, { data: seguimientos, error: errorSeguimiento }] = await Promise.all([
    fetchAllPages<{ company_code: number; year: number; series: string; number: number; supplier_code: string | null; order_date: string; pending_amount: number; status: number | null }>(
      (from, to) => admin.from("sage_purchase_orders")
        .select("company_code, year, series, number, supplier_code, order_date, pending_amount, status")
        .gt("pending_units", 0).or(`status.is.null,status.neq.${ESTADO_SERVIDO}`).order("company_code").order("number").range(from, to)),
    fetchAllPages<{ company_code: number; year: number; series: string; number: number; expected_on: string | null }>(
      (from, to) => admin.from("sage_purchase_order_lines")
        .select("company_code, year, series, number, expected_on")
        .gt("pending_units", 0).order("company_code").order("number").order("line_number").range(from, to)),
    fetchAllPages<{ company_code: number; year: number; series: string; number: number; state: string; level: number; quiet_until: string | null }>(
      (from, to) => admin.from("purchase_order_tracking")
        .select("company_code, year, series, number, state, level, quiet_until").order("company_code").order("number").range(from, to)),
  ]);

  // Si una de las tres lecturas falla, no se manda nada: con los pedidos a
  // medias se reclamaría lo que ya tiene fecha, y eso llega al proveedor.
  const falloDeLectura = errorPedidos ?? errorLineas ?? errorSeguimiento;
  if (falloDeLectura) {
    console.error("Cron reclamar-compras: no se pudieron leer los pedidos", falloDeLectura);
    return NextResponse.json({ error: "No se pudieron leer los pedidos." }, { status: 500 });
  }

  const sinFecha = new Map<string, number>();
  for (const linea of lineas) {
    if (linea.expected_on) continue;
    const llave = clavePedido({ companyCode: linea.company_code, year: linea.year, series: linea.series, number: linea.number });
    sinFecha.set(llave, (sinFecha.get(llave) ?? 0) + 1);
  }

  const seguimiento = new Map<string, Seguimiento>(seguimientos.map((s) => [
    clavePedido({ companyCode: s.company_code, year: s.year, series: s.series, number: s.number }),
    { state: s.state, level: Number(s.level), quietUntil: s.quiet_until },
  ]));

  const reclamables: PedidoReclamable[] = pedidos.map((p) => ({
    companyCode: p.company_code, year: p.year, series: p.series ?? "", number: p.number,
    supplierCode: p.supplier_code, orderDate: p.order_date,
    lineasSinFecha: sinFecha.get(clavePedido({ companyCode: p.company_code, year: p.year, series: p.series, number: p.number })) ?? 0,
    pendingAmount: Number(p.pending_amount),
    status: p.status,
  }));

  const grupos = reclamacionesDeHoy({ pedidos: reclamables, seguimiento, hoy });
  const resumen = { enviados: 0, sinCorreo: 0, repetidos: 0, fallidos: 0, pendientes: Math.max(0, grupos.length - MAXIMO_POR_DIA) };

  // De uno en uno: son correos a empresas distintas y da igual tardar unos
  // segundos; en paralelo solo se gana la posibilidad de que Resend corte.
  for (const grupo of grupos.slice(0, MAXIMO_POR_DIA)) {
    const resultado = await enviarReclamacion(admin, grupo, { kind: "auto" });
    if (resultado.ok) resumen.enviados++;
    else if (resultado.motivo === "sin_correo") resumen.sinCorreo++;
    else if (resultado.motivo === "repetido") resumen.repetidos++;
    else resumen.fallidos++;
  }

  if (resumen.fallidos > 0) console.error(`Cron reclamar-compras: ${resumen.fallidos} envíos fallaron.`);
  return NextResponse.json(resumen);
}
