"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { cargarSinAtender, type LeadSinAtender } from "@/lib/avisos-comercial";
import { esperaDetallada, HORAS_PARA_ATENDER } from "@/lib/leads/atencion";

/**
 * El aviso de entrada para un comercial: estos leads tuyos siguen sin tocar y
 * llevan esperando más de la cuenta.
 *
 * Al cerrarlo se calla una hora. Ni en cada pantalla —eso se deja de leer en
 * dos días— ni una sola vez al día, que es demasiado poco para algo que se
 * arregla con una llamada: si a media mañana sigue ahí, vale la pena repetirlo.
 *
 * La hora de silencio vale para los leads que ya se enseñaron. Si mientras
 * tanto se pasa de plazo otro, vuelve a salir en el acto con ese.
 *
 * El retraso se cuenta en horas laborables, sin fines de semana, con las mismas
 * reglas que la insignia "Sin atender" de la tabla de leads. Y la lista sale de
 * avisos-comercial.ts, la misma que lee la campana de abajo a la derecha: una
 * sola fuente, para que nunca digan cosas distintas del mismo lead.
 */

const CUANTOS_SE_ENSEÑAN = 8;
/** Lo que calla tras cerrarlo, mientras no haya ninguno nuevo. */
const MINUTOS_DE_SILENCIO = 60;

function clave(userId: string) {
  return `intec.leads-sin-atender.${userId}`;
}

/** Lo que se guardó al cerrarlo: hasta cuándo callar y con qué leads. */
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

/** Estos mismos leads se enseñaron hace menos de una hora: nada nuevo que decir. */
function yaSeVieron(userId: string, ids: string[]): boolean {
  const visto = loVisto(userId);
  if (Date.now() >= visto.hasta) return false;
  const vistos = new Set(visto.ids);
  return ids.every((id) => vistos.has(id));
}

function apuntarVisto(userId: string, ids: string[]) {
  try {
    window.localStorage.setItem(clave(userId), JSON.stringify({
      hasta: Date.now() + MINUTOS_DE_SILENCIO * 60_000,
      ids,
    }));
  } catch {
    // Nada que hacer: el aviso volverá a salir, que es el lado seguro.
  }
}

export function PendingLeadsNotice({ userId, onTerminado }: {
  userId: string;
  /**
   * Cuando ya no va a enseñar nada más: no había leads tarde, ya se vieron hace
   * menos de una hora, o se cerró. Lo usa el aviso de lo que hay por cerrar
   * para salir después y no a la vez: dos ventanas apiladas no las lee nadie.
   */
  onTerminado?: () => void;
}) {
  const [pendientes, setPendientes] = useState<LeadSinAtender[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let activo = true;
    void (async () => {
      const tarde = await cargarSinAtender(userId);
      if (!activo) return;
      if (tarde.length === 0) { onTerminado?.(); return; }
      setPendientes(tarde);
      // Lo enseñado hace menos de una hora se carga igual —hace falta para el
      // botón de la lista— pero sin volver a abrir el diálogo.
      if (!yaSeVieron(userId, tarde.map((lead) => lead.id))) setOpen(true);
      else onTerminado?.();
    })();
    return () => { activo = false; };
  }, [userId, onTerminado]);

  function cerrar() {
    apuntarVisto(userId, pendientes.map((lead) => lead.id));
    setOpen(false);
    onTerminado?.();
  }

  if (pendientes.length === 0) return null;

  return (
    <Modal
      open={open}
      title={pendientes.length === 1 ? "Tienes 1 lead sin contactar" : `Tienes ${pendientes.length} leads sin contactar`}
      eyebrow="Antes de nada"
      onClose={cerrar}
      scrollInside
    >
      <p className="muted">
        Llevan más de {HORAS_PARA_ATENDER} horas laborables esperando desde que entraron, sin fines de semana.
        El más antiguo primero.
      </p>
      <ul className="pending-leads-list">
        {pendientes.slice(0, CUANTOS_SE_ENSEÑAN).map((lead) => (
          <li key={lead.id}>
            {/* El nombre lleva a su ficha, abierta: el aviso dice a quién llamar
                y el siguiente clic ya es el teléfono. */}
            <Link href={`/leads?lead=${lead.id}`} className="pending-lead-link" onClick={cerrar}>
              <span className="pending-lead-name">
                <strong>{lead.nombre}</strong>
                {lead.empresa && lead.empresa !== lead.nombre ? <small>{lead.empresa}</small> : null}
              </span>
              <span className="pending-lead-delay">{esperaDetallada(lead.horas)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {pendientes.length > CUANTOS_SE_ENSEÑAN ? (
        <p className="muted">Y {pendientes.length - CUANTOS_SE_ENSEÑAN} más.</p>
      ) : null}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={cerrar}>Ahora no</button>
        <Link href="/leads?owner=mine&atencion=sin-atender" className="button button-primary" onClick={cerrar}>Ver mis leads</Link>
      </div>
    </Modal>
  );
}
