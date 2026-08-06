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
import { AttachmentViewer } from "./attachment-viewer";

function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

type TicketDetailsProps = {
  ticket: Ticket;
  busy: boolean;
  onStatusChange: (status: TicketStatus) => void;
  onPriorityChange: (priority: TicketPriority) => void;
  onCategoryChange: (category: TicketCategory) => void;
};

export function TicketDetails({ ticket, busy, onStatusChange, onPriorityChange, onCategoryChange }: TicketDetailsProps) {
  return (
    <div className="ticket-details">
      <div className="ticket-details-grid">
        <div><span>Trabajador</span><strong>{ticket.reporterName}</strong></div>
        <div><span>Teléfono</span><strong>{ticket.reporterPhone}</strong></div>
        <div><span>Correo</span><strong>{ticket.reporterEmail || "—"}</strong></div>
        <div><span>Departamento</span><strong>{ticket.department}</strong></div>
        <div><span>Creado</span><strong>{formatDate(ticket.createdAt)}</strong></div>
        <div><span>Última actualización</span><strong>{formatDate(ticket.updatedAt)}</strong></div>
        <div><span>¿Desde cuándo?</span><strong>{ticket.startedAt || "—"}</strong></div>
        <div><span>¿Reinició el equipo?</span><strong>{ticket.restarted ? "Sí" : "No"}</strong></div>
      </div>

      <a href={whatsappHref(ticket.reporterPhone)} target="_blank" rel="noreferrer" className="button button-secondary">Abrir WhatsApp</a>

      <div className="ticket-details-section">
        <h3>Descripción</h3>
        <p>{ticket.description}</p>
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

      {ticket.attachmentPath ? (
        <div className="ticket-details-section">
          <h3>Archivo adjunto</h3>
          <AttachmentViewer attachmentPath={ticket.attachmentPath} />
        </div>
      ) : null}

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
        <label><span>Categoría</span>
          <select value={ticket.category} disabled={busy} onChange={(event) => onCategoryChange(event.target.value as TicketCategory)}>
            {ticketCategoryOrder.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
