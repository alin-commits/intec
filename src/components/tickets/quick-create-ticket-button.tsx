"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { hasAnyRole } from "@/lib/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { TICKET_QUICK_CREATE_ROLES } from "@/lib/tickets/constants";
import type { AppRole } from "@/lib/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function QuickCreateTicketButton() {
  const configured = isSupabaseConfigured();
  const [canCreate, setCanCreate] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      if (!active) return;
      setCanCreate(Boolean(profile && hasAnyRole(profile.roles as AppRole[], TICKET_QUICK_CREATE_ROLES)));
    })();
    return () => { active = false; };
  }, [configured]);

  function openModal() {
    setTitle("");
    setReporterName("");
    setDescription("");
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
        body: JSON.stringify({ title, reporterName, description, occurredOn }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo crear el ticket.");
      setOpen(false);
      setMessage(`Ticket ${payload.ticketNumber} creado correctamente.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo crear el ticket.");
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) return null;

  return (
    <>
      <button type="button" className="button button-primary" onClick={openModal}>+ Nuevo ticket</button>
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <Modal open={open} title="Nuevo ticket" eyebrow="Soporte interno" onClose={() => setOpen(false)}>
        <form className="lead-editor-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field-wide"><span>Título *</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={150} placeholder="Resumen breve del problema" /></label>
            <label><span>¿Quién lo pide? *</span><input value={reporterName} onChange={(event) => setReporterName(event.target.value)} required maxLength={120} /></label>
            <label><span>Fecha</span><input type="date" value={occurredOn} max={today()} onChange={(event) => setOccurredOn(event.target.value)} /></label>
            <label className="form-field-wide"><span>Descripción *</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={4000} /></label>
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
