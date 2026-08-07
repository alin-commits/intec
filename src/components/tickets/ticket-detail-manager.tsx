"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { hasAnyRole } from "@/lib/constants";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { mapTicketRow } from "@/lib/tickets/map";
import { TICKET_MANAGER_ROLES, TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import type { Ticket, TicketNote, TicketNoteType, TicketPriority, TicketStatus } from "@/lib/tickets/types";
import { AddTicketNoteForm } from "./add-ticket-note-form";
import { TicketDetails } from "./ticket-details";
import { TicketNotes, type TicketEventItem } from "./ticket-notes";
import { TicketPriorityBadge } from "./ticket-priority-badge";
import { TicketStatusBadge } from "./ticket-status-badge";

type Access = "checking" | "allowed" | "denied" | "not_found";

function mapNoteRow(row: Record<string, unknown>): TicketNote {
  return {
    id: String(row.id),
    ticketId: String(row.ticket_id),
    authorId: String(row.author_id),
    noteType: row.note_type as TicketNoteType,
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

function mapEventRow(row: Record<string, unknown>): TicketEventItem {
  return {
    id: String(row.id),
    actorId: row.actor_id ? String(row.actor_id) : null,
    eventType: String(row.event_type),
    previousValue: row.previous_value ? String(row.previous_value) : null,
    newValue: row.new_value ? String(row.new_value) : null,
    createdAt: String(row.created_at),
  };
}

export function TicketDetailManager({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [access, setAccess] = useState<Access>(configured ? "checking" : "denied");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [events, setEvents] = useState<TicketEventItem[]>([]);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [canManage, setCanManage] = useState(false);

  const loadTicket = useCallback(async () => {
    const supabase = createClient();
    const [{ data: ticketRow, error: ticketError }, { data: noteRows }, { data: eventRows }, { data: profileRows }] = await Promise.all([
      supabase.from("tickets").select("*").eq("id", ticketId).maybeSingle(),
      supabase.from("ticket_notes").select("*").eq("ticket_id", ticketId),
      supabase.from("ticket_events").select("*").eq("ticket_id", ticketId),
      supabase.from("profiles").select("id, full_name"),
    ]);
    if (ticketError || !ticketRow) {
      setAccess("not_found");
      return;
    }
    setTicket(mapTicketRow(ticketRow as Record<string, unknown>));
    setNotes((noteRows ?? []).map((row) => mapNoteRow(row as Record<string, unknown>)));
    setEvents((eventRows ?? []).map((row) => mapEventRow(row as Record<string, unknown>)));
    setAuthorNames(Object.fromEntries((profileRows ?? []).map((row) => [String(row.id), String(row.full_name ?? "Administrador")])));
    setAccess("allowed");
  }, [ticketId]);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setAccess("denied");
        return;
      }
      setCurrentUserId(authData.user.id);
      const { data: ownProfile } = await supabase.from("profiles").select("roles").eq("id", authData.user.id).maybeSingle();
      if (!ownProfile || !hasAnyRole(ownProfile.roles, TICKET_VIEW_ROLES)) {
        setAccess("denied");
        return;
      }
      setCanManage(hasAnyRole(ownProfile.roles, TICKET_MANAGER_ROLES));
      await loadTicket();
    });
  }, [configured, loadTicket]);

  async function logEvent(eventType: string, previousValue: string | null, newValue: string | null) {
    if (!currentUserId) return;
    await createClient().from("ticket_events").insert({ ticket_id: ticketId, actor_id: currentUserId, event_type: eventType, previous_value: previousValue, new_value: newValue });
  }

  async function updateStatus(status: TicketStatus) {
    if (!ticket || status === ticket.status) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = { status };
      if (status === "resolved") patch.resolved_at = new Date().toISOString();
      if (status === "closed") patch.closed_at = new Date().toISOString();
      const { error } = await createClient().from("tickets").update(patch).eq("id", ticketId);
      if (error) throw error;
      await logEvent("status_change", ticket.status, status);
      await loadTicket();
      setMessage("Estado actualizado.");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar el estado."));
    } finally {
      setBusy(false);
    }
  }

  async function updatePriority(priority: TicketPriority) {
    if (!ticket || priority === ticket.priority) return;
    setBusy(true);
    try {
      const { error } = await createClient().from("tickets").update({ priority }).eq("id", ticketId);
      if (error) throw error;
      await logEvent("priority_change", ticket.priority, priority);
      await loadTicket();
      setMessage("Prioridad actualizada.");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar la prioridad."));
    } finally {
      setBusy(false);
    }
  }

  async function addNote({ noteType, content }: { noteType: TicketNoteType; content: string }) {
    if (!currentUserId) return;
    setBusy(true);
    try {
      const { error } = await createClient().from("ticket_notes").insert({ ticket_id: ticketId, author_id: currentUserId, note_type: noteType, content });
      if (error) throw error;
      await loadTicket();
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo añadir la nota."));
    } finally {
      setBusy(false);
    }
  }

  async function archiveTicket() {
    setBusy(true);
    try {
      const { error } = await createClient().from("tickets").update({ archived_at: new Date().toISOString() }).eq("id", ticketId);
      if (error) throw error;
      router.push("/tickets");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo archivar el ticket."));
      setBusy(false);
    }
  }

  async function deleteTicket() {
    setBusy(true);
    try {
      const { error } = await createClient().from("tickets").delete().eq("id", ticketId);
      if (error) throw error;
      router.push("/tickets");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar el ticket."));
      setBusy(false);
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Tickets no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  if (access === "not_found" || !ticket) {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>Ticket no encontrado</h2>
          <p>Puede que haya sido eliminado.</p>
          <Link href="/tickets" className="button button-secondary">Volver a Tickets</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">{ticket.department} · {ticket.reporterName}</span>
          <h2>{ticket.ticketNumber} — {ticket.title}</h2>
          <div className="ticket-detail-badges">
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
          </div>
        </div>
        <div className="ticket-detail-actions">
          <Link href="/tickets" className="button button-secondary">← Volver</Link>
          {canManage ? <button type="button" className="button button-secondary" onClick={() => setPendingArchive(true)}>Archivar</button> : null}
          {canManage ? <button type="button" className="button button-danger" onClick={() => setPendingDelete(true)}>Eliminar</button> : null}
        </div>
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <div className="ticket-detail-layout">
        <section className="ticket-detail-pane">
          <TicketDetails
            ticket={ticket}
            busy={busy}
            canManage={canManage}
            onStatusChange={(status) => void updateStatus(status)}
            onPriorityChange={(priority) => void updatePriority(priority)}
          />
        </section>

        <section className="ticket-detail-pane">
          <h3>Notas y actuaciones</h3>
          {canManage ? <AddTicketNoteForm busy={busy} onSubmit={addNote} /> : null}
          <TicketNotes notes={notes} events={events} authorNames={authorNames} />
        </section>
      </div>

      <ConfirmationDialog
        open={pendingArchive}
        title="¿Archivar este ticket?"
        confirmLabel="Archivar"
        busy={busy}
        onCancel={() => setPendingArchive(false)}
        onConfirm={() => void archiveTicket()}
      >
        <p>Dejará de aparecer en el listado de tickets, pero se conserva todo su historial.</p>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={pendingDelete}
        title="¿Eliminar este ticket definitivamente?"
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => void deleteTicket()}
      >
        <p>Esta acción no se puede deshacer. Se eliminarán también sus notas e historial.</p>
      </ConfirmationDialog>
    </div>
  );
}
