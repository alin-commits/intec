"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";

/*
  El aviso de entrada para quien lleva compras.

  Tres cosas, y en este orden porque es el orden en que importan:

   1. Han contestado y la fecha todavía no está en Sage. Es lo único que pide
      que alguien haga algo ahora mismo.
   2. A quién hemos escrito nosotros estos días. Sale de su buzón y con su
      nombre: tiene derecho a saberlo antes de que un proveedor le conteste
      sobre un correo que no recuerda.
   3. A quién le hemos escrito dos veces sin respuesta. Ahí se acaban los
      recordatorios automáticos y empieza el teléfono.

  Al cerrarlo se calla una hora, como el de leads: ni en cada pantalla —eso se
  deja de leer en dos días— ni una sola vez al día. Si aparece algo nuevo
  mientras tanto, vuelve a salir en el acto con eso.
*/

const CUANTOS_SE_ENSEÑAN = 6;
const MINUTOS_DE_SILENCIO = 60;
/** Tras el segundo aviso, cuántos días se espera antes de decir "llama tú". */
const DIAS_SIN_RESPUESTA = 2;

type Fila = {
  id: string;
  /** Para abrir su ficha. */
  llave: string;
  pedido: string;
  proveedor: string;
  detalle: string;
  cuando: string;
};

type Grupo = "contestados" | "reclamados" | "sin_respuesta";

const TITULOS: Record<Grupo, string> = {
  contestados: "Han contestado",
  reclamados: "Se ha reclamado",
  sin_respuesta: "Sin respuesta",
};

function clave(userId: string) {
  return `intec.compras-aviso.${userId}`;
}

function loVisto(userId: string): { hasta: number; ids: string[] } {
  try {
    const crudo = window.localStorage.getItem(clave(userId));
    if (!crudo) return { hasta: 0, ids: [] };
    const valor = JSON.parse(crudo) as { hasta?: number; ids?: string[] };
    return { hasta: Number(valor.hasta) || 0, ids: Array.isArray(valor.ids) ? valor.ids : [] };
  } catch {
    // Sin almacén se avisa en cada carga: molesta menos que callarse.
    return { hasta: 0, ids: [] };
  }
}

function sigueCallado(userId: string, ids: string[]): boolean {
  const visto = loVisto(userId);
  if (Date.now() > visto.hasta) return false;
  const vistos = new Set(visto.ids);
  return ids.every((id) => vistos.has(id));
}

function apuntarVisto(userId: string, ids: string[]) {
  try {
    window.localStorage.setItem(clave(userId), JSON.stringify({ hasta: Date.now() + MINUTOS_DE_SILENCIO * 60_000, ids }));
  } catch {
    // Nada que hacer: el aviso volverá a salir, que es el lado seguro.
  }
}

export function AvisoCompras({ userId }: { userId: string }) {
  const [grupos, setGrupos] = useState<Record<Grupo, Fila[]>>({ contestados: [], reclamados: [], sin_respuesta: [] });
  const [filtro, setFiltro] = useState<Grupo>("contestados");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const desde = new Date(Date.now() - 3 * 86400000).toISOString();
      const haceDias = new Date(Date.now() - DIAS_SIN_RESPUESTA * 86400000).toISOString();

      const [seguimientoRes, enviosRes] = await Promise.all([
        supabase.from("purchase_order_tracking")
          .select("company_code, year, series, number, state, level, last_chased_at, replied_at, proposed_on, confirmed_on, reply_summary"),
        supabase.from("purchase_order_chases")
          .select("id, company_code, supplier_code, level, sent_at, to_email, orders").eq("ok", true).gte("sent_at", desde).order("sent_at", { ascending: false }),
      ]);
      if (!vivo || seguimientoRes.error) return;

      const seguimientos = seguimientoRes.data ?? [];
      const envios = enviosRes.data ?? [];
      const numeros = [...new Set([
        ...seguimientos.map((s) => s.number as number),
        ...envios.flatMap((e) => (Array.isArray(e.orders) ? (e.orders as { number: number }[]) : []).map((o) => o.number)),
      ])];
      if (numeros.length === 0) return;

      const [pedidosRes, proveedoresRes, lineasRes] = await Promise.all([
        supabase.from("sage_purchase_orders").select("company_code, year, series, number, supplier_code, order_date, pending_amount").in("number", numeros.slice(0, 300)).gt("pending_units", 0),
        supabase.from("sage_suppliers").select("company_code, code, name"),
        // A qué pedidos les falta todavía alguna fecha. Sin esto, el aviso
        // daba trabajo por hecho: desde que «contestado» es el hecho de haber
        // contestado y no «contestado y aún sin fecha», aquí entraban también
        // los que ya tienen su fecha en Sage y no piden nada de nadie.
        supabase.from("sage_purchase_order_lines").select("company_code, year, series, number")
          .in("number", numeros.slice(0, 300)).gt("pending_units", 0).is("expected_on", null),
      ]);
      if (!vivo) return;

      const llaveDe = (p: { company_code: number; year: number; series: string; number: number }) => `${p.company_code}-${p.year}-${p.series}-${p.number}`;
      const pedidos = new Map((pedidosRes.data ?? []).map((p) => [llaveDe(p), p]));
      const nombres = new Map((proveedoresRes.data ?? []).map((p) => [`${p.company_code}-${p.code}`, p.name as string]));
      const nombreDe = (companyCode: number, code: string | null) => (code ? nombres.get(`${companyCode}-${code}`) ?? code : "Sin proveedor");

      const faltaFecha = new Set((lineasRes.data ?? []).map((l) => llaveDe(l as never)));

      // 1. Han contestado y la fecha no está en Sage: lo único que pide trabajo.
      const contestados: Fila[] = seguimientos
        .filter((s) => s.state === "contestado" && faltaFecha.has(llaveDe(s as never)))
        .map((s) => {
          const llave = llaveDe(s as never);
          const pedido = pedidos.get(llave);
          if (!pedido) return null;
          return {
            id: `contestado-${llave}`,
            llave,
            pedido: `${pedido.series}${pedido.number}`,
            proveedor: nombreDe(pedido.company_code, pedido.supplier_code),
            detalle: s.confirmed_on
              ? `da el ${s.confirmed_on} · falta pasarlo a Sage`
              : s.proposed_on
                ? `propone el ${s.proposed_on}`
                : (s.reply_summary as string) ?? "ha contestado, sin fecha",
            cuando: String(s.replied_at ?? "").slice(0, 10),
          };
        })
        .filter(Boolean) as Fila[];

      // 2. Lo que ha salido estos días con el nombre del departamento.
      const reclamados: Fila[] = envios.flatMap((envio) => {
        const suyos = Array.isArray(envio.orders) ? (envio.orders as { year: number; series: string; number: number }[]) : [];
        return suyos.map((orden) => {
          const llave = `${envio.company_code}-${orden.year}-${orden.series}-${orden.number}`;
          return {
            id: `envio-${envio.id}-${orden.number}`,
            llave,
            pedido: `${orden.series}${orden.number}`,
            proveedor: nombreDe(envio.company_code as number, envio.supplier_code as string),
            detalle: `${envio.level === 1 ? "primer aviso" : `aviso ${envio.level}`} · ${envio.to_email ?? "sin correo"}`,
            cuando: String(envio.sent_at).slice(0, 10),
          };
        });
      });

      // 3. Dos avisos y ni una palabra: aquí se acaban los correos.
      const sinRespuesta: Fila[] = seguimientos
        .filter((s) => s.state === "reclamado" && Number(s.level) >= 2 && String(s.last_chased_at ?? "") < haceDias)
        .map((s) => {
          const llave = llaveDe(s as never);
          const pedido = pedidos.get(llave);
          if (!pedido) return null;
          return {
            id: `mudo-${llave}`,
            llave,
            pedido: `${pedido.series}${pedido.number}`,
            proveedor: nombreDe(pedido.company_code, pedido.supplier_code),
            detalle: `dos avisos sin respuesta desde el ${String(s.last_chased_at).slice(0, 10)}`,
            cuando: String(s.last_chased_at ?? "").slice(0, 10),
          };
        })
        .filter(Boolean) as Fila[];

      const todos = [...contestados, ...reclamados, ...sinRespuesta];
      if (todos.length === 0 || sigueCallado(userId, todos.map((fila) => fila.id))) return;
      setGrupos({ contestados, reclamados, sin_respuesta: sinRespuesta });
      // El primer grupo con algo: lo que pide trabajo manda sobre lo informativo.
      setFiltro(contestados.length > 0 ? "contestados" : sinRespuesta.length > 0 ? "sin_respuesta" : "reclamados");
      setOpen(true);
    })();
    return () => { vivo = false; };
  }, [userId]);

  const todos = [...grupos.contestados, ...grupos.reclamados, ...grupos.sin_respuesta];

  function cerrar() {
    apuntarVisto(userId, todos.map((fila) => fila.id));
    setOpen(false);
  }

  if (todos.length === 0) return null;
  const visibles = grupos[filtro];

  return (
    <Modal
      open={open}
      title={grupos.contestados.length > 0
        ? `${grupos.contestados.length} ${grupos.contestados.length === 1 ? "pedido contestado" : "pedidos contestados"}`
        : "Pedidos a proveedor"}
      eyebrow="Compras"
      onClose={cerrar}
      scrollInside
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {grupos.contestados.length > 0
          ? "Han contestado a estos pedidos y la fecha todavía no está en Sage. Pincha uno para ver su ficha."
          : "Esto es lo que ha pasado estos días con los pedidos a proveedor."}
      </p>

      <div className="view-tabs" role="tablist" aria-label="Qué ver">
        {(Object.keys(TITULOS) as Grupo[]).map((grupo) => (
          <button key={grupo} type="button" role="tab" aria-selected={filtro === grupo}
            className={filtro === grupo ? "view-tab active" : "view-tab"}
            onClick={() => setFiltro(grupo)}>
            {TITULOS[grupo]}{grupos[grupo].length > 0 ? ` (${grupos[grupo].length})` : ""}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="muted">Nada por aquí.</p>
      ) : (
        <ul className="pending-leads-list">
          {visibles.slice(0, CUANTOS_SE_ENSEÑAN).map((fila) => (
            <li key={fila.id}>
              {/* Lleva a su ficha abierta: el aviso dice qué mirar y el
                  siguiente clic ya es el historial del pedido. */}
              <Link href={`/compras?pedido=${encodeURIComponent(fila.llave)}`} className="pending-lead-link" onClick={cerrar}>
                <span className="pending-lead-name">
                  <strong>{fila.pedido} · {fila.proveedor}</strong>
                  <small>{fila.detalle}</small>
                </span>
                <span className="pending-lead-delay" style={{ background: "var(--surface-muted)", color: "var(--muted)" }}>{fila.cuando}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {visibles.length > CUANTOS_SE_ENSEÑAN ? (
        <p className="muted">Y {visibles.length - CUANTOS_SE_ENSEÑAN} más.</p>
      ) : null}

      <div className="modal-actions">
        <Link href="/compras" className="button button-secondary" onClick={cerrar}>Ver todos los pedidos</Link>
        <button type="button" className="button" onClick={cerrar}>Entendido</button>
      </div>
    </Modal>
  );
}
