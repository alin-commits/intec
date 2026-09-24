"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { TicketsIcon } from "@/components/icons";
import { ticketCategoryLabels, ticketCategoryOrder, ticketPriorityLabels, ticketPriorityOrder } from "@/lib/tickets/constants";
import type { TicketCategory, TicketPriority } from "@/lib/tickets/types";

/** Lets any signed-in worker report an IT incident; their name and email come from their profile. */
export function MyTicketButton({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("erp_apps");
  const [priority, setPriority] = useState<TicketPriority>("medium");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tickets/create-mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, category, priority }),
      });
      const payload = (await response.json()) as { error?: string; ticketNumber?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar la incidencia.");
      setMessage(`Incidencia ${payload.ticketNumber} enviada a informática. Te avisarán cuando esté resuelta.`);
      setTitle("");
      setDescription("");
      setCategory("erp_apps");
      setPriority("medium");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la incidencia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="button button-secondary" onClick={() => { setError(null); setOpen(true); }}>
        <TicketsIcon /> Ticket informático
      </button>
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <Modal open={open} title="Avisar a informática" eyebrow="Soporte interno" onClose={() => setOpen(false)}>
        <form className="lead-editor-form" onSubmit={submit}>
          <p className="muted">Se enviará a tu nombre ({userName}). Informática recibe un aviso por email al momento.</p>
          <div className="form-grid">
            <label className="form-field-wide"><span>¿Qué ocurre? *</span><input value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} placeholder="Ej.: No puedo entrar en SAGE" required /></label>
            <label><span>Tipo</span><select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)}>
              {ticketCategoryOrder.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
            </select></label>
            <label><span>Urgencia</span><select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
              {ticketPriorityOrder.map((value) => <option key={value} value={value}>{ticketPriorityLabels[value]}</option>)}
            </select></label>
            <label className="form-field-wide"><span>Detalles</span><textarea rows={4} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} placeholder="Qué estabas haciendo, qué mensaje sale, desde cuándo pasa…" /></label>
          </div>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Enviando…" : "Enviar incidencia"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
