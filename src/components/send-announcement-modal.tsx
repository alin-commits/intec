"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { ALL_APP_ROLES, roleLabels } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

type Member = { id: string; fullName: string; roles: AppRole[] };

const GROUP_LABELS: Record<AppRole, string> = {
  admin: "Administración",
  commercial: "Comerciales",
  viewer: "Solo lectura",
  it: "Informática",
  marketing: "Marketing",
  direction: "Dirección",
  employee: "Empleados",
  vault_admin: "Admin. de contraseñas",
};

export function SendAnnouncementModal({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (message: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [{ data }, { data: auth }] = await Promise.all([supabase.rpc("list_team_members"), supabase.auth.getUser()]);
      if (!active) return;
      setCurrentUserId(auth.user?.id ?? null);
      setMembers(((data ?? []) as { id: string; full_name: string | null; roles: AppRole[] }[]).map((row) => ({ id: row.id, fullName: row.full_name || "Usuario", roles: row.roles })));
    })();
    return () => { active = false; };
  }, [open]);

  // Other people only; sending a notice to yourself is rarely intended.
  const others = useMemo(() => members.filter((member) => member.id !== currentUserId), [members, currentUserId]);
  const groups = ALL_APP_ROLES.map((role) => ({ role, ids: others.filter((member) => member.roles.includes(role)).map((member) => member.id) })).filter((group) => group.ids.length > 0);
  const allSelected = others.length > 0 && others.every((member) => selected.has(member.id));

  function toggleMany(ids: string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const everyOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (everyOn) next.delete(id); else next.add(id);
      }
      return next;
    });
  }

  function reset() {
    setSelected(new Set());
    setTitle("");
    setBody("");
    setAlsoEmail(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.size === 0) {
      setError("Elige al menos un destinatario.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, recipientIds: Array.from(selected), sendEmail: alsoEmail }),
      });
      const payload = (await response.json()) as { error?: string; recipients?: number; emailed?: number };
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar el aviso.");
      const people = `${payload.recipients} persona${payload.recipients === 1 ? "" : "s"}`;
      onSent(alsoEmail ? `Aviso enviado a ${people} (${payload.emailed} por email).` : `Aviso enviado a ${people}.`);
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar el aviso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Enviar aviso" eyebrow="Comunicación interna" onClose={onClose}>
      <form className="announcement-form" onSubmit={submit}>
        <label><span>Título</span><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Ej.: Reunión comercial el lunes a las 9:00" required /></label>
        <label><span>Mensaje</span><textarea value={body} maxLength={2000} rows={5} onChange={(event) => setBody(event.target.value)} placeholder="Escribe el aviso…" required /></label>

        <div className="announcement-recipients">
          <span className="announcement-label">Destinatarios {selected.size ? <strong>({selected.size})</strong> : null}</span>
          <div className="role-chip-group">
            <button type="button" className={allSelected ? "role-chip active" : "role-chip"} onClick={() => toggleMany(others.map((member) => member.id))}>Todos</button>
            {groups.map((group) => (
              <button key={group.role} type="button" className={group.ids.every((id) => selected.has(id)) ? "role-chip active" : "role-chip"} onClick={() => toggleMany(group.ids)}>
                {GROUP_LABELS[group.role]}
              </button>
            ))}
          </div>
          <div className="announcement-people">
            {others.length === 0 ? <p className="muted">Cargando equipo…</p> : others.map((member) => (
              <label key={member.id} className="announcement-person">
                <input type="checkbox" checked={selected.has(member.id)} onChange={() => toggleMany([member.id])} />
                <span>{member.fullName}</span>
                <small>{member.roles.map((role) => roleLabels[role]).join(" · ")}</small>
              </label>
            ))}
          </div>
        </div>

        <label className="announcement-email"><input type="checkbox" checked={alsoEmail} onChange={(event) => setAlsoEmail(event.target.checked)} /> Enviar también por email</label>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Enviando…" : "Enviar aviso"}</button>
        </div>
      </form>
    </Modal>
  );
}
