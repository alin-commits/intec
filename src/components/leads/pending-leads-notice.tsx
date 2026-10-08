"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { atencionDeLead, horasEnPalabras, HORAS_PARA_ATENDER, type CambioDeEstado } from "@/lib/leads/atencion";
import { createClient } from "@/lib/supabase/client";

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
 * reglas que la insignia "Sin atender" de la tabla de leads: una sola fuente
 * para las dos cosas, para que nunca digan cosas distintas del mismo lead.
 */

const CUANTOS_SE_ENSEÑAN = 8;
/** Lo que calla tras cerrarlo, mientras no haya ninguno nuevo. */
const MINUTOS_DE_SILENCIO = 60;

type LeadPendiente = { id: string; nombre: string; empresa: string | null; horas: number };

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

export function PendingLeadsNotice({ userId }: { userId: string }) {
  const [pendientes, setPendientes] = useState<LeadPendiente[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let activo = true;
    void (async () => {
      // Un lead puede llevarlo más de una persona: los suyos salen de la tabla
      // de responsables, no del lead.
      const { data } = await createClient()
        .from("lead_assignees")
        .select("leads!inner(id, contact_name, client_company_name, created_at, status, lead_status_history(new_status, changed_at))")
        .eq("profile_id", userId)
        .eq("leads.status", "new");
      if (!activo) return;

      const ahora = new Date().toISOString();
      const tarde: LeadPendiente[] = [];
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
      if (!activo || tarde.length === 0) return;
      tarde.sort((a, b) => b.horas - a.horas);
      setPendientes(tarde);
      // Lo enseñado hace menos de una hora se carga igual —hace falta para el
      // botón de la lista— pero sin volver a abrir el diálogo.
      if (!yaSeVieron(userId, tarde.map((lead) => lead.id))) setOpen(true);
    })();
    return () => { activo = false; };
  }, [userId]);

  function cerrar() {
    apuntarVisto(userId, pendientes.map((lead) => lead.id));
    setOpen(false);
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
            <span className="pending-lead-name">
              <strong>{lead.nombre}</strong>
              {lead.empresa && lead.empresa !== lead.nombre ? <small>{lead.empresa}</small> : null}
            </span>
            <span className="pending-lead-delay">{horasEnPalabras(lead.horas)}</span>
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
