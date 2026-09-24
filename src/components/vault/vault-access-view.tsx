"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { VaultTabs } from "@/components/vault/vault-tabs";
import { KeyIcon, UnidadesIcon, UsuariosIcon } from "@/components/icons";
import { roleLabels } from "@/lib/constants";
import type { AppRole } from "@/lib/types";

type Folder = { id: string; name: string; count: number; userIds: string[] };
type Person = { id: string; name: string; roles: AppRole[]; isVaultAdmin: boolean; folderCount: number; credentialCount: number; restrictedFolders: string[] };
type AccessPayload = { folders: Folder[]; people: Person[]; uncategorised: number; personalCount: number; totalShared: number };

/** Who can see what: folders with their access list, and what that means per person. */
export function VaultAccessView() {
  const [data, setData] = useState<AccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"folders" | "people">("folders");
  const [editing, setEditing] = useState<{ folder: Folder; userIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/vault/access", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as AccessPayload & { error?: string };
      if (!active) return;
      if (!response.ok) setError(payload.error ?? "No se pudo cargar el panel de accesos.");
      else {
        setError(null);
        setData(payload);
      }
    })();
    return () => { active = false; };
  }, [reloadTick]);

  async function saveAccess() {
    if (!editing) return;
    setBusy(true);
    const response = await fetch(`/api/vault/categories/${editing.folder.id}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: editing.userIds }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(payload.error ?? "No se pudo guardar el acceso.");
      return;
    }
    setMessage(editing.userIds.length ? `«${editing.folder.name}» queda restringida.` : `«${editing.folder.name}» vuelve a estar abierta a todo el equipo.`);
    setEditing(null);
    reload();
  }

  if (error) {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes acceso a esta página</h2>
          <p>{error}</p>
          <div className="modal-actions"><Link className="button button-secondary" href="/contrasenas">Volver al gestor</Link></div>
        </section>
      </div>
    );
  }
  if (!data) return <div className="page-stack" />;

  const nameOf = (id: string) => data.people.find((person) => person.id === id)?.name ?? "Usuario";
  const restricted = data.folders.filter((folder) => folder.userIds.length > 0);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Quién puede ver cada carpeta. Una carpeta sin restricción la ve todo el equipo; en cuanto añades a alguien, pasa a verla solo esa gente (y los administradores del gestor).</p></div>
      </section>

      <VaultTabs />

      <section className="kpi-grid">
        <KpiCard label="Personas con acceso al gestor" value={String(data.people.length)} delta="Sin comparación" helper="usuarios activos de la plataforma" icon={<UsuariosIcon />} tone="indigo" />
        <KpiCard label="Carpetas" value={String(data.folders.length)} delta="Sin comparación" helper={`${restricted.length} con acceso restringido`} icon={<UnidadesIcon />} tone="sky" />
        <KpiCard label="Credenciales compartidas" value={String(data.totalShared)} delta="Sin comparación" helper={data.personalCount ? `${data.personalCount} personales aparte` : "sin personales"} icon={<KeyIcon />} tone="emerald" />
        <KpiCard label="Sin carpeta" value={String(data.uncategorised)} delta="Sin comparación" helper="las ve todo el equipo" icon={<UnidadesIcon />} tone={data.uncategorised ? "amber" : "emerald"} />
      </section>

      <div className="view-tabs" role="tablist" aria-label="Cómo ver los accesos">
        <button type="button" role="tab" aria-selected={view === "folders"} className={view === "folders" ? "view-tab active" : "view-tab"} onClick={() => setView("folders")}>Por carpeta</button>
        <button type="button" role="tab" aria-selected={view === "people"} className={view === "people" ? "view-tab active" : "view-tab"} onClick={() => setView("people")}>Por persona</button>
      </div>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      {view === "folders" ? (
        <section className="panel table-panel">
          <div className="panel-heading"><div><h2>Carpetas</h2><p className="panel-subtitle">Pulsa «Cambiar» para elegir quién la ve</p></div></div>
          <div className="table-scroll vault-access-scroll">
            <table>
              <thead><tr><th>Carpeta</th><th>Credenciales</th><th>Quién la ve</th><th>Acciones</th></tr></thead>
              <tbody>
                {data.folders.map((folder) => (
                  <tr key={folder.id}>
                    <td><strong>{folder.name}</strong></td>
                    <td className="vault-access-count">{folder.count}</td>
                    <td>
                      {folder.userIds.length === 0 ? (
                        <span className="badge badge-active">Todo el equipo</span>
                      ) : (
                        <div className="vault-access-people">
                          <span className="badge badge-lost">Restringida</span>
                          {folder.userIds.map((userId) => <span key={userId} className="vault-access-chip">{nameOf(userId)}</span>)}
                        </div>
                      )}
                    </td>
                    <td>
                      <button type="button" className="button button-compact button-secondary" onClick={() => setEditing({ folder, userIds: [...folder.userIds] })}>Cambiar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel table-panel">
          <div className="panel-heading"><div><h2>Personas</h2><p className="panel-subtitle">Qué alcanza a ver cada una</p></div></div>
          <div className="table-scroll vault-access-scroll">
            <table>
              <thead><tr><th>Persona</th><th>Roles</th><th>Carpetas</th><th>Credenciales</th><th>Sin acceso a</th></tr></thead>
              <tbody>
                {data.people.map((person) => (
                  <tr key={person.id}>
                    <td><strong>{person.name}</strong>{person.isVaultAdmin ? <span className="badge badge-active">Admin. del gestor</span> : null}</td>
                    <td className="muted">{person.roles.map((role) => roleLabels[role]).join(" · ") || "—"}</td>
                    <td className="vault-access-count">{person.folderCount}</td>
                    <td className="vault-access-count">{person.credentialCount}</td>
                    <td className="muted">{person.restrictedFolders.length === 0 ? "—" : person.restrictedFolders.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted invoice-hint">Las credenciales personales de cada uno no se cuentan aquí: solo las ve su dueño.</p>
        </section>
      )}

      <Modal open={Boolean(editing)} title={`Quién ve «${editing?.folder.name ?? ""}»`} eyebrow="Acceso por carpeta" onClose={() => setEditing(null)}>
        {editing ? (
          <>
            <p className="muted">
              {editing.userIds.length === 0
                ? "Sin nadie marcado, la carpeta la ve todo el equipo."
                : `La verán ${editing.userIds.length} personas, además de los administradores del gestor.`}
            </p>
            <div className="announcement-people">
              {data.people.map((person) => (
                <label key={person.id} className="announcement-person">
                  <input
                    type="checkbox"
                    checked={editing.userIds.includes(person.id)}
                    onChange={() => setEditing({
                      ...editing,
                      userIds: editing.userIds.includes(person.id) ? editing.userIds.filter((id) => id !== person.id) : [...editing.userIds, person.id],
                    })}
                  />
                  <span>{person.name}</span>
                  <small>{person.roles.map((role) => roleLabels[role]).join(" · ")}</small>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setEditing({ ...editing, userIds: [] })}>Abrir a todo el equipo</button>
              <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveAccess()}>{busy ? "Guardando…" : "Guardar acceso"}</button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
