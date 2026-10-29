"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { cargarPorCerrar, type PorCerrar } from "@/lib/avisos-comercial";
import { DIAS_PARA_CERRAR } from "@/lib/por-cerrar";

/**
 * El segundo aviso de entrada para un comercial: lo que dejó a medio camino.
 *
 * Leads suyos contactados o interesados y consultas suyas en lo mismo, que
 * llevan una semana sin cambiar de estado. Casi nunca siguen vivos: o se
 * ganaron y nadie lo apuntó, o se perdieron y nadie lo dijo, y las dos cosas
 * estropean la conversión. El aviso pide cerrarlos: ganado o perdido.
 *
 * Sale después del de leads sin atender, nunca a la vez: dos ventanas apiladas
 * al entrar no las lee nadie. Y se calla una hora como aquel, salvo que
 * aparezca algo nuevo por cerrar. La lista sale de avisos-comercial.ts, la
 * misma que lee la campana: los dos dicen siempre lo mismo.
 */

const CUANTOS_SE_ENSEÑAN = 6;
const MINUTOS_DE_SILENCIO = 60;

function clave(userId: string) {
  return `intec.por-cerrar.${userId}`;
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

function yaSeVieron(userId: string, ids: string[]): boolean {
  const visto = loVisto(userId);
  if (Date.now() >= visto.hasta) return false;
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

const enDias = (dias: number) => (dias === 1 ? "1 día" : `${dias} días`);

export function AvisoPorCerrar({ userId }: { userId: string }) {
  const [leads, setLeads] = useState<PorCerrar[]>([]);
  const [consultas, setConsultas] = useState<PorCerrar[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let activo = true;
    void (async () => {
      const { leads: leadsParados, consultas: consultasParadas } = await cargarPorCerrar(userId);
      if (!activo) return;
      setLeads(leadsParados);
      setConsultas(consultasParadas);
      const todos = [...leadsParados, ...consultasParadas].map((item) => item.clave);
      if (todos.length > 0 && !yaSeVieron(userId, todos)) setOpen(true);
    })();
    return () => { activo = false; };
  }, [userId]);

  function cerrar() {
    apuntarVisto(userId, [...leads, ...consultas].map((item) => item.clave));
    setOpen(false);
  }

  const total = leads.length + consultas.length;
  if (total === 0) return null;

  const lista = (items: PorCerrar[]) => (
    <ul className="pending-leads-list">
      {items.slice(0, CUANTOS_SE_ENSEÑAN).map((item) => (
        <li key={item.clave}>
          {/* Lleva a su ficha abierta: el siguiente clic ya es ganado o perdido. */}
          <Link href={item.enlace} className="pending-lead-link" onClick={cerrar}>
            <span className="pending-lead-name">
              <strong>{item.nombre}</strong>
              <small>{[item.estado, item.empresa && item.empresa !== item.nombre ? item.empresa : null].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="pending-lead-delay por-cerrar-delay">{enDias(item.dias)} sin moverse</span>
          </Link>
        </li>
      ))}
      {items.length > CUANTOS_SE_ENSEÑAN ? <li className="por-cerrar-mas muted">Y {items.length - CUANTOS_SE_ENSEÑAN} más.</li> : null}
    </ul>
  );

  return (
    <Modal
      open={open}
      title={total === 1 ? "Tienes 1 por cerrar" : `Tienes ${total} por cerrar`}
      eyebrow="Ganado o perdido"
      onClose={cerrar}
      scrollInside
    >
      <p className="muted">
        Llevan {DIAS_PARA_CERRAR} días o más contactados o interesados, sin cambiar de estado. Si se ganaron, apúntalo;
        si se perdieron, márcalo como perdido y di por qué.
      </p>
      {leads.length > 0 ? (
        <section className="por-cerrar-grupo">
          <h3>Leads · {leads.length}</h3>
          {lista(leads)}
        </section>
      ) : null}
      {consultas.length > 0 ? (
        <section className="por-cerrar-grupo">
          <h3>Consultas · {consultas.length}</h3>
          {lista(consultas)}
        </section>
      ) : null}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={cerrar}>Ahora no</button>
      </div>
    </Modal>
  );
}
