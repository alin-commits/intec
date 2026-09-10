import { useState } from "react";
import {
  ticketBlockingLevelLabels,
  ticketCategoryLabels,
  ticketCategoryOrder,
  ticketPriorityLabels,
  ticketPriorityOrder,
  ticketStatusLabels,
  ticketStatusOrder,
} from "@/lib/tickets/constants";
import { formatDate } from "@/lib/format";
import type { Ticket, TicketCategory, TicketPriority, TicketStatus } from "@/lib/tickets/types";
import { AttachmentGallery } from "./attachment-gallery";

function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

function ResolutionTimeInput({ ticket, busy, onCommit }: { ticket: Ticket; busy: boolean; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(ticket.resolutionTime ?? "");
  return (
    <input
      key={`${ticket.id}-${ticket.updatedAt}`}
      placeholder="ej. 00:20 o 20 min"
      defaultValue={ticket.resolutionTime ?? ""}
      disabled={busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => { if (value !== (ticket.resolutionTime ?? "")) onCommit(value); }}
    />
  );
}

export type TicketDetailsDraft = {
  title: string;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string;
  department: string;
  category: TicketCategory;
  description: string;
};

type TicketDetailsProps = {
  ticket: Ticket;
  busy: boolean;
  canManage: boolean;
  editing: boolean;
  draft: TicketDetailsDraft;
  onDraftChange: (draft: TicketDetailsDraft) => void;
  onStatusChange: (status: TicketStatus) => void;
  onPriorityChange: (priority: TicketPriority) => void;
  onResolutionTimeChange: (resolutionTime: string) => void;
};

export function TicketDetails({ ticket, busy, canManage, editing, draft, onDraftChange, onStatusChange, onPriorityChange, onResolutionTimeChange }: TicketDetailsProps) {
  const editable = canManage && editing;

  function update<K extends keyof TicketDetailsDraft>(key: K, value: TicketDetailsDraft[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  return (
    <div className="ticket-details">
      {editable ? (
        <div className="ticket-editable-grid">
          <label><span>Trabajador</span><input value={draft.reporterName} disabled={busy} onChange={(event) => update("reporterName", event.target.value)} /></label>
          <label><span>Teléfono</span><input value={draft.reporterPhone} disabled={busy} onChange={(event) => update("reporterPhone", event.target.value)} /></label>
          <label><span>Correo</span><input type="email" value={draft.reporterEmail} disabled={busy} onChange={(event) => update("reporterEmail", event.target.value)} /></label>
          <label><span>Departamento</span><input value={draft.department} disabled={busy} onChange={(event) => update("department", event.target.value)} /></label>
          <label><span>Categoría</span>
            <select value={draft.category} disabled={busy} onChange={(event) => update("category", event.target.value as TicketCategory)}>
              {ticketCategoryOrder.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="ticket-details-grid">
          <div><span>Trabajador</span><strong>{ticket.reporterName}</strong></div>
          <div><span>Teléfono</span><strong>{ticket.reporterPhone}</strong></div>
          <div><span>Correo</span><strong>{ticket.reporterEmail || "—"}</strong></div>
          <div><span>Departamento</span><strong>{ticket.department}</strong></div>
          <div><span>Categoría</span><strong>{ticketCategoryLabels[ticket.category]}</strong></div>
          <div><span>Creado</span><strong>{formatDate(ticket.createdAt)}</strong></div>
          <div><span>Última actualización</span><strong>{formatDate(ticket.updatedAt)}</strong></div>
          <div><span>¿Desde cuándo?</span><strong>{ticket.startedAt || "—"}</strong></div>
          <div><span>¿Reinició el equipo?</span><strong>{ticket.restarted ? "Sí" : "No"}</strong></div>
        </div>
      )}

      <a href={whatsappHref(ticket.reporterPhone)} target="_blank" rel="noreferrer" className="button button-secondary">Abrir WhatsApp</a>

      <div className="ticket-details-section">
        <h3>Descripción</h3>
        {editable ? (
          <textarea rows={4} value={draft.description} disabled={busy} onChange={(event) => update("description", event.target.value)} />
        ) : (
          <p>{ticket.description}</p>
        )}
      </div>

      <div className="ticket-details-section">
        <h3>Nivel de bloqueo</h3>
        <p>{ticketBlockingLevelLabels[ticket.blockingLevel]}</p>
      </div>

      {ticket.hasErrorMessage ? (
        <div className="ticket-details-section">
          <h3>Mensaje de error</h3>
          <p>{ticket.errorMessage || "—"}</p>
        </div>
      ) : null}

      <div className="ticket-details-section">
        <h3>Archivos adjuntos</h3>
        <AttachmentGallery ticketId={ticket.id} />
      </div>

      {canManage ? (
        <div className="ticket-editable-grid">
          <label><span>Estado</span>
            <select value={ticket.status} disabled={busy} onChange={(event) => onStatusChange(event.target.value as TicketStatus)}>
              {ticketStatusOrder.map((value) => <option key={value} value={value}>{ticketStatusLabels[value]}</option>)}
            </select>
          </label>
          <label><span>Prioridad</span>
            <select value={ticket.priority} disabled={busy} onChange={(event) => onPriorityChange(event.target.value as TicketPriority)}>
              {ticketPriorityOrder.map((value) => <option key={value} value={value}>{ticketPriorityLabels[value]}</option>)}
            </select>
          </label>
          <label><span>Tiempo empleado</span>
            <ResolutionTimeInput ticket={ticket} busy={busy} onCommit={onResolutionTimeChange} />
          </label>
        </div>
      ) : (
        <div className="ticket-details-grid">
          <div><span>Estado</span><strong>{ticketStatusLabels[ticket.status]}</strong></div>
          <div><span>Prioridad</span><strong>{ticketPriorityLabels[ticket.priority]}</strong></div>
          <div><span>Tiempo empleado</span><strong>{ticket.resolutionTime || "—"}</strong></div>
        </div>
      )}
    </div>
  );
}
