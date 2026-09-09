"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { ticketCategoryLabels, ticketCategoryOrder, ticketPriorityLabels, ticketPriorityOrder } from "@/lib/tickets/constants";
import type { TicketCategory, TicketPriority } from "@/lib/tickets/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function QuickCreateTicketButton({ visible, onCreated }: { visible: boolean; onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("erp_apps");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [occurredOn, setOccurredOn] = useState(today);

  function openModal() {
    setTitle("");
    setReporterName("");
    setDescription("");
    setCategory("erp_apps");
    setPriority("medium");
    setOccurredOn(today());
    setMessage(null);
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tickets/create-internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, reporterName, description, category, priority, occurredOn }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo crear el ticket.");
      setOpen(false);
      setMessage(`Ticket ${payload.ticketNumber} creado correctamente.`);
      onCreated?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo crear el ticket.");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      <button type="button" className="button button-secondary" onClick={openModal}>+ Nuevo ticket</button>
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <Modal open={open} title="Nuevo ticket" eyebrow="Soporte interno" onClose={() => setOpen(false)}>
        <form className="lead-editor-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field-wide"><span>Título *</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={150} placeholder="Resumen breve del problema" /></label>
            <label><span>¿Quién lo pide? *</span><input value={reporterName} onChange={(event) => setReporterName(event.target.value)} required maxLength={120} /></label>
            <label><span>Categoría *</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)}>
                {ticketCategoryOrder.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
              </select>
            </label>
            <label><span>Prioridad *</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
                {ticketPriorityOrder.map((value) => <option key={value} value={value}>{ticketPriorityLabels[value]}</option>)}
              </select>
            </label>
            <label><span>Fecha</span><input type="date" value={occurredOn} max={today()} onChange={(event) => setOccurredOn(event.target.value)} /></label>
            <label className="form-field-wide"><span>Descripción</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} /></label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Creando…" : "Crear ticket"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
