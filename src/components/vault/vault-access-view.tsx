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

/** The two roles that decide what someone is inside the vault. */
type ManagedRole = "vault_admin" | "employee";
const userTypes: { role: ManagedRole; label: string; helper: string }[] = [
  { role: "vault_admin", label: "Administrador del gestor", helper: "Ve todas las carpetas y las páginas de salud, accesos y auditoría." },
  { role: "employee", label: "Solo contraseñas", helper: "En el menú solo le aparece el gestor y el botón para avisar a informática." },
];

/** Who can see what: folders with their access list, and what that means per person. */
export function VaultAccessView() {
  const [data, setData] = useState<AccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"folders" | "people">("folders");
  const [editing, setEditing] = useState<{ folder: Folder; userIds: string[] } | null>(null);
  /** The person being adjusted: their type of user and the folders they reach. */
  const [editingPerson, setEditingPerson] = useState<{ person: Person; roles: ManagedRole[]; folderIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/vault/access", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as AccessPayload & { error?: string };
        if (!active) return;
        if (!response.ok) setError(payload.error ?? "No se pudo cargar el panel de accesos.");
        else {
          setError(null);
          setData(payload);
        }
      } catch {
        if (active) setError("No hay conexión con el servidor. Comprueba tu red y recarga la página.");
      }
    })();
    return () => { active = false; };
  }, [reloadTick]);

  /** The folder list starts from what the person reaches on their own, without counting the admin role. */
  function openPerson(person: Person) {
    setEditingPerson({
      person,
      roles: person.roles.filter((role): role is ManagedRole => role === "vault_admin" || role === "employee"),
      folderIds: (data?.folders ?? [])
        .filter((folder) => folder.userIds.length === 0 || folder.userIds.includes(person.id))
        .map((folder) => folder.id),
    });
  }

  async function savePerson() {
    if (!editingPerson) return;
    setBusy(true);
    const response = await fetch(`/api/vault/access/${editingPerson.person.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: editingPerson.roles, folderIds: editingPerson.folderIds }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(payload.error ?? "No se pudo guardar.");
      return;
    }
    setMessage(`Acceso de ${editingPerson.person.name} actualizado.`);
    setEditingPerson(null);
    reload();
  }

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
          <h2>No se pudo cargar esta página</h2>
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
          <div className="panel-heading"><div><h2>Personas</h2><p className="panel-subtitle">Qué alcanza a ver cada una · pulsa «Ajustar» para cambiarlo</p></div></div>
          <div className="table-scroll vault-access-scroll">
            <table>
              <thead><tr><th>Persona</th><th>Roles</th><th>Carpetas</th><th>Credenciales</th><th>Sin acceso a</th><th>Acciones</th></tr></thead>
              <tbody>
                {data.people.map((person) => (
                  <tr key={person.id}>
                    <td><strong>{person.name}</strong>{person.isVaultAdmin ? <span className="badge badge-active">Admin. del gestor</span> : null}</td>
                    <td className="muted">{person.roles.map((role) => roleLabels[role]).join(" · ") || "—"}</td>
                    <td className="vault-access-count">{person.folderCount}</td>
                    <td className="vault-access-count">{person.credentialCount}</td>
                    <td className="muted">{person.restrictedFolders.length === 0 ? "—" : person.restrictedFolders.join(" · ")}</td>
                    <td><button type="button" className="button button-compact button-secondary" onClick={() => openPerson(person)}>Ajustar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted invoice-hint">Las credenciales personales de cada uno no se cuentan aquí: solo las ve su dueño.</p>
        </section>
      )}

      <Modal open={Boolean(editingPerson)} title={editingPerson?.person.name ?? ""} eyebrow="Acceso de la persona" onClose={() => setEditingPerson(null)}>
        {editingPerson ? (
          <div className="vault-person-form">
            <div>
              <span className="vault-access-title">Tipo de usuario</span>
              <div className="vault-person-types">
                {userTypes.map((type) => {
                  const active = editingPerson.roles.includes(type.role);
                  return (
                    <button
                      key={type.role}
                      type="button"
                      className={active ? "vault-person-type active" : "vault-person-type"}
                      aria-pressed={active}
                      onClick={() => setEditingPerson({
                        ...editingPerson,
                        roles: active ? editingPerson.roles.filter((role) => role !== type.role) : [...editingPerson.roles, type.role],
                      })}
                    >
                      <strong>{type.label}</strong>
                      <small>{type.helper}</small>
                    </button>
                  );
                })}
              </div>
              <p className="muted invoice-hint">Sin ninguno de los dos marcados, es un usuario normal: ve las carpetas que le marques abajo y el resto de la plataforma según sus otros roles.</p>
            </div>

            <div>
              <span className="vault-access-title">Carpetas a las que llega ({editingPerson.folderIds.length} de {data.folders.length})</span>
              {editingPerson.roles.includes("vault_admin") ? (
                <p className="muted invoice-hint">Como administrador del gestor llega a todas las carpetas. Quita ese tipo de usuario para elegirlas una a una.</p>
              ) : (
                <>
                  <div className="announcement-people vault-person-folders">
                    {data.folders.map((folder) => (
                      <label key={folder.id} className="announcement-person">
                        <input
                          type="checkbox"
                          checked={editingPerson.folderIds.includes(folder.id)}
                          onChange={() => setEditingPerson({
                            ...editingPerson,
                            folderIds: editingPerson.folderIds.includes(folder.id)
                              ? editingPerson.folderIds.filter((id) => id !== folder.id)
                              : [...editingPerson.folderIds, folder.id],
                          })}
                        />
                        <span>{folder.name}</span>
                        <small>{folder.count} credenciales{folder.userIds.length === 0 ? " · abierta a todo el equipo" : ` · restringida a ${folder.userIds.length}`}</small>
                      </label>
                    ))}
                  </div>
                  <div className="vault-person-bulk">
                    <button type="button" className="notice-clear-all" onClick={() => setEditingPerson({ ...editingPerson, folderIds: data.folders.map((folder) => folder.id) })}>Marcar todas</button>
                    <button type="button" className="notice-clear-all" onClick={() => setEditingPerson({ ...editingPerson, folderIds: [] })}>Desmarcar todas</button>
                  </div>
                  <p className="muted invoice-hint">Si le quitas una carpeta que hoy ve todo el equipo, esa carpeta pasa a restringida: el resto la sigue viendo, esta persona no.</p>
                </>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setEditingPerson(null)}>Cancelar</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void savePerson()}>{busy ? "Guardando…" : "Guardar"}</button>
            </div>
          </div>
        ) : null}
      </Modal>

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
