import { NextResponse } from "next/server";
import { hasAnyRole, COMPRAS_ROLES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enviarReclamacion, prepararReclamacion } from "@/lib/compras/enviar-reclamacion";
import { clavePedido, escalonAMano, type PedidoAReclamar, type Seguimiento } from "@/lib/compras/reclamaciones";
import type { AppRole } from "@/lib/types";

/*
  Reclamarle la fecha a un proveedor desde la pantalla.

  Esto manda un correo a una empresa de fuera, así que:

  · Los pedidos que van en el correo no se cogen de lo que mande el navegador:
    llega una lista de números y se vuelven a leer de la base. Si alguien
    toquetea la petición, como mucho reclama pedidos que existen y son de ese
    proveedor.
  · Con `previsualizar` se devuelve el correo sin mandarlo. La pantalla lo
    enseña antes de enviar: nada sale a un proveedor sin que alguien lo haya
    visto.
*/

type Peticion = {
  companyCode?: number;
  supplierCode?: string;
  numeros?: number[];
  previsualizar?: boolean;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("full_name, roles, is_active").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.is_active || !hasAnyRole(perfil.roles as AppRole[], COMPRAS_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }

  let cuerpo: Peticion;
  try {
    cuerpo = (await request.json()) as Peticion;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  const companyCode = Number(cuerpo.companyCode);
  const supplierCode = String(cuerpo.supplierCode ?? "").trim();
  const numeros = (Array.isArray(cuerpo.numeros) ? cuerpo.numeros : []).map(Number).filter(Number.isInteger);
  if (!Number.isInteger(companyCode) || !supplierCode || numeros.length === 0) {
    return NextResponse.json({ error: "Falta el proveedor o los pedidos." }, { status: 400 });
  }
  if (numeros.length > 60) return NextResponse.json({ error: "Demasiados pedidos en un correo." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta la clave de servicio." }, { status: 503 });

  // Los pedidos, leídos de la base y acotados a ese proveedor: lo que llega del
  // navegador solo dice cuáles mirar.
  const { data: pedidos, error } = await admin.from("sage_purchase_orders")
    .select("company_code, year, series, number, supplier_code, order_date, pending_amount")
    .eq("company_code", companyCode).eq("supplier_code", supplierCode).gt("pending_units", 0).in("number", numeros);
  if (error) {
    console.error("Compras: no se pudieron leer los pedidos a reclamar", error);
    return NextResponse.json({ error: "No se pudieron leer los pedidos." }, { status: 500 });
  }
  if (!pedidos?.length) return NextResponse.json({ error: "Esos pedidos ya no están pendientes." }, { status: 409 });

  // Cuántas líneas siguen sin fecha en cada uno: si no queda ninguna, no hay
  // nada que preguntar y el pedido se cae del correo.
  const { data: lineas } = await admin.from("sage_purchase_order_lines")
    .select("company_code, year, series, number, expected_on")
    .eq("company_code", companyCode).gt("pending_units", 0).in("number", numeros);
  const sinFecha = new Map<string, number>();
  for (const linea of lineas ?? []) {
    if (linea.expected_on) continue;
    const llave = clavePedido({ companyCode: linea.company_code, year: linea.year, series: linea.series, number: linea.number });
    sinFecha.set(llave, (sinFecha.get(llave) ?? 0) + 1);
  }

  const { data: seguimientos } = await admin.from("purchase_order_tracking")
    .select("company_code, year, series, number, state, level, quiet_until")
    .eq("company_code", companyCode).in("number", numeros);
  const seguimientoDe = new Map<string, Seguimiento>((seguimientos ?? []).map((s) => [
    clavePedido({ companyCode: s.company_code, year: s.year, series: s.series, number: s.number }),
    { state: s.state as string, level: Number(s.level), quietUntil: s.quiet_until as string | null },
  ]));

  const aReclamar: PedidoAReclamar[] = pedidos
    .map((p) => {
      const llave = clavePedido({ companyCode: p.company_code, year: p.year, series: p.series, number: p.number });
      return {
        companyCode: p.company_code, year: p.year, series: p.series ?? "", number: p.number,
        supplierCode: p.supplier_code, orderDate: p.order_date as string,
        lineasSinFecha: sinFecha.get(llave) ?? 0,
        pendingAmount: Number(p.pending_amount),
        nivel: escalonAMano(seguimientoDe.get(llave)),
      };
    })
    .filter((p) => p.lineasSinFecha > 0)
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate));

  if (aReclamar.length === 0) {
    return NextResponse.json({ error: "Todas las líneas de esos pedidos ya tienen fecha." }, { status: 409 });
  }

  const grupo = {
    companyCode,
    supplierCode,
    nivel: aReclamar.reduce((alto, p) => (p.nivel > alto ? p.nivel : alto), 1 as 1 | 2),
    pedidos: aReclamar,
  };
  const firma = (perfil.full_name as string) || null;

  if (cuerpo.previsualizar) {
    const previo = await prepararReclamacion(admin, grupo, { firma });
    return NextResponse.json({ previsualizacion: true, ...previo, pedidos: aReclamar.length });
  }

  const resultado = await enviarReclamacion(admin, grupo, { kind: "manual", sentBy: user.id, firma });
  if (!resultado.ok) {
    const porQue = {
      sin_correo: "Este proveedor no tiene correo en Sage.",
      sin_configurar: "El envío de correos no está configurado.",
      repetido: "Ya se le ha escrito hoy por lo mismo.",
      fallo_envio: "No se pudo enviar el correo.",
    }[resultado.motivo ?? "fallo_envio"];
    return NextResponse.json({ error: porQue, motivo: resultado.motivo }, { status: resultado.motivo === "sin_correo" ? 409 : 502 });
  }
  return NextResponse.json({ ok: true, destinatario: resultado.destinatario, pedidos: resultado.pedidos, nivel: grupo.nivel });
}
