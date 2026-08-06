"use client";

import { useState, type FormEvent } from "react";
import { ticketNoteTypeLabels, ticketNoteTypeOrder } from "@/lib/tickets/constants";
import type { TicketNoteType } from "@/lib/tickets/types";

type AddTicketNoteFormProps = {
  busy: boolean;
  onSubmit: (input: { noteType: TicketNoteType; content: string }) => Promise<void>;
};

export function AddTicketNoteForm({ busy, onSubmit }: AddTicketNoteFormProps) {
  const [noteType, setNoteType] = useState<TicketNoteType>("internal_note");
  const [content, setContent] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;
    await onSubmit({ noteType, content: content.trim() });
    setContent("");
  }

  return (
    <form className="add-note-form" onSubmit={handleSubmit}>
      <label><span>Tipo de actuación</span>
        <select value={noteType} onChange={(event) => setNoteType(event.target.value as TicketNoteType)}>
          {ticketNoteTypeOrder.map((value) => <option key={value} value={value}>{ticketNoteTypeLabels[value]}</option>)}
        </select>
      </label>
      <label className="form-field-wide"><span>Nota</span>
        <textarea rows={3} value={content} onChange={(event) => setContent(event.target.value)} required />
      </label>
      <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
        <button type="submit" className="button button-primary" disabled={busy || !content.trim()}>{busy ? "Guardando…" : "Añadir nota"}</button>
      </div>
    </form>
  );
}
