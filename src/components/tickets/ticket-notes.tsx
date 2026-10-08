import { ticketNoteTypeLabels, ticketPriorityLabels, ticketStatusLabels } from "@/lib/tickets/constants";
import { formatDate } from "@/lib/format";
import type { TicketNote, TicketNoteType, TicketPriority, TicketStatus } from "@/lib/tickets/types";

export type TicketEventItem = {
  id: string;
  actorId: string | null;
  eventType: string;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
};

type TimelineEntry =
  | { kind: "note"; id: string; createdAt: string; authorName: string; noteType: TicketNoteType; content: string }
  | { kind: "event"; id: string; createdAt: string; actorName: string | null; label: string };

function labelForValue(field: "status" | "priority", value: string | null): string {
  if (!value) return "—";
  if (field === "status") return ticketStatusLabels[value as TicketStatus] ?? value;
  return ticketPriorityLabels[value as TicketPriority] ?? value;
}

/**
 * Un ticket entra por dos sitios: el formulario público, que lo rellena quien
 * tiene la avería y no lleva a nadie detrás, o el propio Hub, cuando informática
 * lo apunta por lo que le han contado por teléfono. Decirlo todo "desde el
 * formulario público" era mentira en el segundo caso, y además salía con el
 * nombre de quien lo tecleó al lado, que parecía que era quien tenía el problema.
 */
function eventLabel(event: TicketEventItem): string {
  if (event.eventType === "created") return event.actorId ? "Ticket creado por informática" : "Ticket creado desde el formulario público";
  if (event.eventType === "status_change") return `Estado: ${labelForValue("status", event.previousValue)} → ${labelForValue("status", event.newValue)}`;
  if (event.eventType === "priority_change") return `Prioridad: ${labelForValue("priority", event.previousValue)} → ${labelForValue("priority", event.newValue)}`;
  if (event.eventType === "details_edit") return "Datos del ticket editados";
  return event.eventType;
}

type TicketNotesProps = {
  notes: TicketNote[];
  events: TicketEventItem[];
  authorNames: Record<string, string>;
};

export function TicketNotes({ notes, events, authorNames }: TicketNotesProps) {
  const timeline: TimelineEntry[] = [
    ...notes.map((note): TimelineEntry => ({
      kind: "note",
      id: note.id,
      createdAt: note.createdAt,
      authorName: authorNames[note.authorId] ?? "Administrador",
      noteType: note.noteType,
      content: note.content,
    })),
    ...events.map((event): TimelineEntry => ({
      kind: "event",
      id: event.id,
      createdAt: event.createdAt,
      // Quién creó el ticket no se firma con su nombre: lo pone la etiqueta,
      // y el que tiene la avería es el solicitante, que ya sale en la ficha.
      actorName: event.eventType === "created"
        ? null
        : event.actorId ? (authorNames[event.actorId] ?? "Administrador") : "Formulario público",
      label: eventLabel(event),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (timeline.length === 0) {
    return <p className="ticket-timeline-empty">Sin actividad todavía.</p>;
  }

  return (
    <div className="ticket-timeline">
      {timeline.map((entry) => (
        <div key={`${entry.kind}-${entry.id}`} className="ticket-timeline-item">
          <div className="ticket-timeline-meta">
            <span>{formatDate(entry.createdAt)}</span>
            {entry.kind === "note" ? <span className="badge">{ticketNoteTypeLabels[entry.noteType]}</span> : null}
          </div>
          {entry.kind === "note" ? (
            <>
              <p>{entry.content}</p>
              <small>{entry.authorName}</small>
            </>
          ) : (
            <p className="ticket-timeline-event"><strong>{entry.label}</strong>{entry.actorName ? ` · ${entry.actorName}` : ""}</p>
          )}
        </div>
      ))}
    </div>
  );
}
