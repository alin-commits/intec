"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { EyeIcon, RefreshIcon, SearchIcon } from "@/components/icons";
import { MyTicketButton } from "@/components/tickets/my-ticket-button";
import { VaultUnlock } from "@/components/vault/vault-unlock";
import { DEFAULT_GENERATOR, generatePassword, MAX_LENGTH, MIN_LENGTH, passwordStrength, type GeneratorOptions } from "@/lib/vault/password-generator";
import type { VaultCategory, VaultEntrySummary, VaultPermission, VaultVisibility } from "@/lib/vault/types";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

const REVEAL_SECONDS = 30;
const LOCK_REASONS = ["mfa_enrollment_required", "mfa_required", "locked"] as const;
type LockReason = (typeof LOCK_REASONS)[number];

const visibilityLabels: Record<VaultVisibility, string> = {
  shared: "Compartida",
  personal: "Personal",
  restricted: "Restringida",
};

type EntryDraft = {
  name: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  categoryId: string;
  visibility: VaultVisibility;
};

type DetailPayload = {
  entry: VaultEntrySummary;
  can: { edit: boolean; delete: boolean; managePermissions: boolean };
  sharedWith: VaultPermission[];
};

type TeamMember = { id: string; fullName: string };

type AuditEvent = {
  id: string;
  userName: string;
  entryName: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const auditActionLabels: Record<string, string> = {
  VAULT_OPEN: "Abrió el gestor",
  VAULT_UNLOCK_FAILED: "Intento bloqueado",
  ENTRY_LIST: "Vio el listado",
  ENTRY_VIEW: "Abrió una ficha",
  PASSWORD_REVEAL: "Mostró una contraseña",
  PASSWORD_COPY: "Copió una contraseña",
  ENTRY_CREATE: "Creó una credencial",
  ENTRY_UPDATE: "Editó una credencial",
  ENTRY_DELETE: "Eliminó una credencial",
  PERMISSION_ADD: "Dio acceso",
  PERMISSION_REMOVE: "Quitó acceso",
  IMPORT: "Importó credenciales",
};

const auditDateFormatter = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

function blankDraft(): EntryDraft {
  return { name: "", url: "", username: "", password: "", notes: "", categoryId: "", visibility: "shared" };
}

function isLockReason(value: unknown): value is LockReason {
  return typeof value === "string" && (LOCK_REASONS as readonly string[]).includes(value);
}

/** Every call to the vault API goes through here so a locked vault is handled in one place. */
async function vaultRequest<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; lock?: LockReason }> {
  try {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; reason?: string } & T;
    if (response.ok) return { ok: true, data: payload as T };
    return { ok: false, error: payload.error ?? "No se pudo completar la operación.", lock: isLockReason(payload.reason) ? payload.reason : undefined };
  } catch {
    return { ok: false, error: "No hay conexión con el servidor." };
  }
}

export function VaultManager() {
  const [stage, setStage] = useState<"loading" | "locked" | "ready">("loading");
  const [lockReason, setLockReason] = useState<LockReason>("mfa_required");
  const [entries, setEntries] = useState<VaultEntrySummary[]>([]);
  const [categories, setCategories] = useState<VaultCategory[]>([]);
  const [isVaultAdmin, setIsVaultAdmin] = useState(false);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");

  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [scope, setScope] = useState<"all" | "mine">("all");

  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(blankDraft);
  const [generator, setGenerator] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [revealed, setRevealed] = useState<{ entryId: string; field: "password" | "notes"; value: string; seconds: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VaultEntrySummary | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null);
  const [auditAction, setAuditAction] = useState("all");
  const [auditUser, setAuditUser] = useState("all");
  const [auditPeople, setAuditPeople] = useState<TeamMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEmployee = roles.includes("employee");

  // Identity for the greeting and the "only mine" filter; the server never trusts it.
  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!active || !auth.user) return;
      setUserId(auth.user.id);
      const { data: profile } = await supabase.from("profiles").select("full_name, roles").eq("id", auth.user.id).maybeSingle();
      setUserName((profile?.full_name as string | null) ?? auth.user.email ?? "");
      if (!active) return;
      setRoles(((profile?.roles ?? []) as AppRole[]));
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);


  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const params = new URLSearchParams();
      if (searchTerm.length >= 2) params.set("q", searchTerm);
      if (categoryId !== "all") params.set("category", categoryId);
      if (scope === "mine") params.set("visibility", "personal");
      const result = await vaultRequest<{ entries: VaultEntrySummary[]; categories: VaultCategory[]; isVaultAdmin: boolean }>(`/api/vault/entries?${params}`);
      if (!active) return;
      if (!result.ok) {
        if (result.lock) {
          setLockReason(result.lock);
          setStage("locked");
          return;
        }
        setMessage(result.error);
        setStage("ready");
        return;
      }
      setEntries(result.data.entries);
      setCategories(result.data.categories);
      setIsVaultAdmin(result.data.isVaultAdmin);
      setStage("ready");
    })();
    return () => { active = false; };
  }, [searchTerm, categoryId, scope, reloadTick]);

  // Audit trail, loaded only while its window is open (vault admins only).
  useEffect(() => {
    if (!auditOpen) return;
    let active = true;
    void (async () => {
      const params = new URLSearchParams();
      if (auditAction !== "all") params.set("action", auditAction);
      if (auditUser !== "all") params.set("user", auditUser);
      const result = await vaultRequest<{ events: AuditEvent[]; people: { id: string; name: string }[] }>(`/api/vault/audit?${params}`);
      if (!active) return;
      if (!result.ok) {
        setMessage(result.error);
        setAuditEvents([]);
        return;
      }
      setAuditEvents(result.data.events);
      setAuditPeople(result.data.people.map((person) => ({ id: person.id, fullName: person.name })));
    })();
    return () => { active = false; };
  }, [auditOpen, auditAction, auditUser]);

  // A revealed secret lives in this state and nowhere else, and only for 30 seconds.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed((current) => (current && current.seconds > 1 ? { ...current, seconds: current.seconds - 1 } : null)), 1000);
    return () => clearTimeout(timer);
  }, [revealed]);

  function handleLock(lock: LockReason) {
    setRevealed(null);
    setDetail(null);
    setEditorOpen(false);
    setLockReason(lock);
    setStage("locked");
  }

  async function openDetail(entryId: string) {
    setRevealed(null);
    const result = await vaultRequest<DetailPayload>(`/api/vault/entries/${entryId}`);
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setMessage(result.error);
      return;
    }
    setDetail(result.data);
  }

  async function reveal(entryId: string, field: "password" | "notes") {
    const result = await vaultRequest<{ value: string }>(`/api/vault/entries/${entryId}/reveal`, { method: "POST", body: JSON.stringify({ field, intent: "view" }) });
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setMessage(result.error);
      return;
    }
    setRevealed({ entryId, field, value: result.data.value, seconds: REVEAL_SECONDS });
  }

  async function copySecret(entryId: string, field: "password" | "notes" = "password") {
    const result = await vaultRequest<{ value: string }>(`/api/vault/entries/${entryId}/reveal`, { method: "POST", body: JSON.stringify({ field, intent: "copy" }) });
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setMessage(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.data.value);
      setMessage(`${field === "notes" ? "Notas copiadas" : "Contraseña copiada"}. Se intentará borrar del portapapeles en ${REVEAL_SECONDS} segundos.`);
      // Best effort only: the browser may refuse if the tab is not focused.
      setTimeout(() => { void navigator.clipboard.writeText("").catch(() => {}); }, REVEAL_SECONDS * 1000);
    } catch {
      setMessage("Tu navegador no ha permitido copiar. Usa «Mostrar» y cópialo a mano.");
    }
  }

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft());
    setError(null);
    setGeneratorOpen(false);
    setEditorOpen(true);
  }

  async function openEdit(entry: VaultEntrySummary) {
    setEditingId(entry.id);
    setDraft({
      name: entry.name,
      url: entry.url ?? "",
      username: entry.username ?? "",
      password: "",
      notes: "",
      categoryId: entry.categoryId ?? "",
      visibility: entry.visibility,
    });
    setError(null);
    setGeneratorOpen(false);
    setEditorOpen(true);
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: draft.name,
      url: draft.url,
      username: draft.username,
      categoryId: draft.categoryId || null,
      visibility: draft.visibility,
    };
    // An untouched password field means "leave it as it is": it is never sent back and forth.
    if (draft.password) body.password = draft.password;
    if (draft.notes) body.notes = draft.notes;
    const result = editingId
      ? await vaultRequest(`/api/vault/entries/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
      : await vaultRequest("/api/vault/entries", { method: "POST", body: JSON.stringify({ ...body, password: draft.password }) });
    setBusy(false);
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setError(result.error);
      return;
    }
    setEditorOpen(false);
    setMessage(editingId ? "Credencial actualizada." : "Credencial guardada.");
    if (editingId && detail?.entry.id === editingId) await openDetail(editingId);
    reload();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    const result = await vaultRequest(`/api/vault/entries/${pendingDelete.id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setMessage(result.error);
      return;
    }
    setPendingDelete(null);
    setDetail(null);
    setMessage("Credencial eliminada.");
    reload();
  }

  async function openPermissions() {
    if (!detail) return;
    if (team.length === 0) {
      const { data } = await createClient().rpc("list_team_members");
      setTeam(((data ?? []) as { id: string; full_name: string | null }[]).map((row) => ({ id: row.id, fullName: row.full_name || "Usuario" })));
    }
    setPermissionsOpen(true);
  }

  async function grantAccess(targetId: string, permission: Partial<VaultPermission>) {
    if (!detail) return;
    const result = await vaultRequest(`/api/vault/entries/${detail.entry.id}/permissions`, {
      method: "POST",
      body: JSON.stringify({ userId: targetId, canView: true, canEdit: false, canDelete: false, canManagePermissions: false, ...permission }),
    });
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setMessage(result.error);
      return;
    }
    await openDetail(detail.entry.id);
  }

  async function revokeAccess(targetId: string) {
    if (!detail) return;
    const result = await vaultRequest(`/api/vault/entries/${detail.entry.id}/permissions?userId=${targetId}`, { method: "DELETE" });
    if (!result.ok) {
      if (result.lock) return handleLock(result.lock);
      setMessage(result.error);
      return;
    }
    await openDetail(detail.entry.id);
  }

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((category) => [category.id, category.name]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "Sin categoría");
  }, [categories]);

  if (stage === "loading") return <div className="page-stack" />;
  if (stage === "locked") return <VaultUnlock reason={lockReason} onUnlocked={() => { setStage("loading"); reload(); }} />;

  const strength = draft.password ? passwordStrength(draft.password) : null;

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Credenciales de la empresa, cifradas. Para mostrar o copiar una contraseña se pide el código de tu app de autenticación, una vez al día.</p></div>
        <div className="panel-heading-trailing">
          {isEmployee ? <MyTicketButton userName={userName} /> : null}
          {isVaultAdmin ? <button type="button" className="button button-secondary" onClick={() => { setAuditEvents(null); setAuditOpen(true); }}>Auditoría</button> : null}
          <button type="button" className="button button-primary" onClick={openNew}>+ Nueva credencial</button>
        </div>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <CollapsibleFilters
        hasActiveFilters={query !== "" || categoryId !== "all" || scope !== "all"}
        onClear={() => { setQuery(""); setCategoryId("all"); setScope("all"); }}
        resultCount={entries.length}
        resultLabel="Credenciales"
      >
        <div className="filter-bar lead-filters">
          <label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, usuario o web" /></label>
          <label><span>Categoría</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="all">Todas</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          <label><span>Ámbito</span><select value={scope} onChange={(event) => setScope(event.target.value as "all" | "mine")}>
            <option value="all">Todas las que puedo ver</option>
            <option value="mine">Solo las mías</option>
          </select></label>
        </div>
      </CollapsibleFilters>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Credencial</th><th>Usuario</th><th>Categoría</th><th>Ámbito</th><th>Actualizada</th><th>Acciones</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.name}</strong>
                    {entry.url ? <small><a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-link">{entry.url.replace(/^https?:\/\//, "").slice(0, 40)}</a></small> : null}
                  </td>
                  <td>{entry.username || "—"}</td>
                  <td>{categoryName(entry.categoryId)}</td>
                  <td><span className={entry.visibility === "personal" ? "badge badge-offer_sent" : entry.visibility === "restricted" ? "badge badge-lost" : "badge"}>{visibilityLabels[entry.visibility]}</span></td>
                  <td>{formatDate(entry.updatedAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="button button-compact button-secondary" onClick={() => void copySecret(entry.id)}>Copiar</button>
                      <button type="button" className="button button-compact button-secondary" onClick={() => void openDetail(entry.id)}>Ver</button>
                    </div>
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr><td colSpan={6} className="muted">{searchTerm ? "Ninguna credencial coincide con la búsqueda." : "Todavía no hay credenciales guardadas."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Detail ---------- */}
      <Modal open={Boolean(detail)} title={detail?.entry.name ?? ""} eyebrow="Credencial" onClose={() => { setDetail(null); setRevealed(null); }}>
        {detail ? (
          <div className="vault-detail">
            <div className="confirmation-summary">
              <span>Usuario</span>
              <strong className="vault-inline">
                {detail.entry.username || "—"}
                {detail.entry.username ? <button type="button" className="button button-compact button-secondary" onClick={() => void navigator.clipboard.writeText(detail.entry.username ?? "")}>Copiar</button> : null}
              </strong>
              <span>Contraseña</span>
              <strong className="vault-inline">
                {revealed?.entryId === detail.entry.id && revealed.field === "password" ? (
                  <>
                    <code className="vault-secret">{revealed.value}</code>
                    <small className="muted">se oculta en {revealed.seconds}s</small>
                  </>
                ) : (
                  <code className="vault-secret">••••••••••••</code>
                )}
                <button type="button" className="button button-compact button-secondary" onClick={() => void reveal(detail.entry.id, "password")}><EyeIcon /> Mostrar</button>
                <button type="button" className="button button-compact button-secondary" onClick={() => void copySecret(detail.entry.id)}>Copiar</button>
              </strong>
              <span>Web</span>
              <strong>{detail.entry.url ? <a href={detail.entry.url} target="_blank" rel="noopener noreferrer" className="text-link">{detail.entry.url}</a> : "—"}</strong>
              <span>Categoría</span><strong>{categoryName(detail.entry.categoryId)}</strong>
              <span>Ámbito</span><strong>{visibilityLabels[detail.entry.visibility]}</strong>
              <span>Última modificación</span><strong>{formatDate(detail.entry.updatedAt)}</strong>
              <span>Contraseña cambiada</span><strong>{formatDate(detail.entry.lastPasswordChangeAt)}</strong>
            </div>

            {detail.entry.hasNotes ? (
              <div className="vault-notes">
                <div className="notice-section-head">
                  <span className="search-group-title">Notas</span>
                  <button type="button" className="button button-compact button-secondary" onClick={() => void reveal(detail.entry.id, "notes")}>Mostrar notas</button>
                </div>
                {revealed?.entryId === detail.entry.id && revealed.field === "notes" ? <p className="vault-notes-body">{revealed.value}</p> : <p className="muted">Guardadas y cifradas.</p>}
              </div>
            ) : null}

            {detail.entry.visibility === "restricted" && detail.can.managePermissions ? (
              <div className="vault-shared">
                <div className="notice-section-head">
                  <span className="search-group-title">Con acceso ({detail.sharedWith.length})</span>
                  <button type="button" className="button button-compact button-secondary" onClick={() => void openPermissions()}>Gestionar acceso</button>
                </div>
              </div>
            ) : null}

            <div className="modal-actions">
              {detail.can.delete ? <button type="button" className="button button-secondary expenses-delete" onClick={() => setPendingDelete(detail.entry)}>Eliminar</button> : null}
              <button type="button" className="button button-secondary" onClick={() => { setDetail(null); setRevealed(null); }}>Cerrar</button>
              {detail.can.edit ? <button type="button" className="button button-primary" onClick={() => void openEdit(detail.entry)}>Editar</button> : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---------- Editor ---------- */}
      <Modal open={editorOpen} title={editingId ? "Editar credencial" : "Nueva credencial"} eyebrow="Gestor de contraseñas" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveEntry} autoComplete="off">
          <div className="form-grid">
            <label><span>Nombre *</span><input value={draft.name} maxLength={160} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Microsoft 365 – Administración" required /></label>
            <label><span>Web</span><input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://…" /></label>
            <label><span>Usuario</span><input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} autoComplete="off" /></label>
            <label>
              <span>{editingId ? "Nueva contraseña (vacío = no cambiar)" : "Contraseña *"}</span>
              <input
                type="text"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                autoComplete="new-password"
                spellCheck={false}
                required={!editingId}
              />
            </label>
            <label><span>Categoría</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
              <option value="">Sin categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <label><span>¿Quién puede verla?</span><select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as VaultVisibility })}>
              <option value="shared">Compartida con el equipo</option>
              <option value="personal">Personal (solo yo)</option>
              <option value="restricted">Restringida (solo a quien le dé acceso)</option>
            </select></label>
            <label className="form-field-wide">
              <span>{editingId ? "Notas (vacío = no cambiar)" : "Notas"}</span>
              <textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Datos de acceso adicionales, contacto del proveedor…" />
            </label>
          </div>

          <div className="vault-generator">
            <div className="notice-section-head">
              <span className="search-group-title">Generador {strength ? <em className={`vault-strength vault-strength-${strength.level}`}>{strength.label}</em> : null}</span>
              <button type="button" className="notice-clear-all" onClick={() => setGeneratorOpen((current) => !current)}>{generatorOpen ? "Ocultar opciones" : "Opciones"}</button>
            </div>
            {generatorOpen ? (
              <div className="vault-generator-options">
                <label><span>Longitud: {generator.length}</span><input type="range" min={MIN_LENGTH} max={MAX_LENGTH} value={generator.length} onChange={(event) => setGenerator({ ...generator, length: Number(event.target.value) })} /></label>
                <div className="role-chip-group">
                  {([["lowercase", "abc"], ["uppercase", "ABC"], ["digits", "123"], ["symbols", "!@#"]] as const).map(([key, label]) => (
                    <button key={key} type="button" className={generator[key] ? "role-chip active" : "role-chip"} onClick={() => setGenerator({ ...generator, [key]: !generator[key] })}>{label}</button>
                  ))}
                </div>
              </div>
            ) : null}
            <button type="button" className="button button-secondary" onClick={() => setDraft({ ...draft, password: generatePassword(generator) })}>
              <RefreshIcon /> Generar contraseña segura
            </button>
          </div>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cancelar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar credencial"}</button>
          </div>
        </form>
      </Modal>

      {/* ---------- Permissions ---------- */}
      <Modal open={permissionsOpen} title="Quién puede ver esta credencial" eyebrow="Acceso" onClose={() => setPermissionsOpen(false)}>
        <div className="announcement-people">
          {team.filter((member) => member.id !== userId).map((member) => {
            const granted = detail?.sharedWith.find((permission) => permission.userId === member.id);
            return (
              <label key={member.id} className="announcement-person">
                <input type="checkbox" checked={Boolean(granted)} onChange={() => (granted ? void revokeAccess(member.id) : void grantAccess(member.id, {}))} />
                <span>{member.fullName}</span>
                {granted ? (
                  <small>
                    <button type="button" className="text-link vault-link-button" onClick={() => void grantAccess(member.id, { canEdit: !granted.canEdit, canView: true })}>
                      {granted.canEdit ? "Puede editar · quitar edición" : "Solo ver · permitir editar"}
                    </button>
                  </small>
                ) : null}
              </label>
            );
          })}
        </div>
        <p className="muted invoice-hint">Cada cambio queda registrado en la auditoría. Nadie puede darse acceso a sí mismo.</p>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setPermissionsOpen(false)}>Cerrar</button></div>
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar la credencial?"
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        {pendingDelete ? (
          <div className="confirmation-summary">
            <span>Credencial</span><strong>{pendingDelete.name}</strong>
            <span>Efecto</span><strong>Desaparece del gestor. Queda el registro en la auditoría, pero la contraseña ya no se podrá consultar.</strong>
          </div>
        ) : null}
      </ConfirmationDialog>

      <Modal open={auditOpen} title="Auditoría del gestor" eyebrow="Registro de actividad" onClose={() => setAuditOpen(false)}>
        <div className="filter-bar lead-filters">
          <label><span>Acción</span><select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}>
            <option value="all">Todas</option>
            {Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label><span>Persona</span><select value={auditUser} onChange={(event) => setAuditUser(event.target.value)}>
            <option value="all">Todas</option>
            {auditPeople.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
          </select></label>
        </div>
        <div className="table-scroll vault-audit-table">
          <table>
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Credencial</th></tr></thead>
            <tbody>
              {auditEvents === null ? (
                <tr><td colSpan={4} className="muted">Cargando…</td></tr>
              ) : auditEvents.length === 0 ? (
                <tr><td colSpan={4} className="muted">Sin actividad registrada con estos filtros.</td></tr>
              ) : auditEvents.map((event) => (
                <tr key={event.id} className={event.action === "PASSWORD_REVEAL" || event.action === "PASSWORD_COPY" ? "vault-audit-secret" : undefined}>
                  <td>{auditDateFormatter.format(new Date(event.createdAt))}</td>
                  <td>{event.userName}</td>
                  <td>{auditActionLabels[event.action] ?? event.action}</td>
                  <td>{event.entryName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted invoice-hint">El registro nunca guarda contraseñas: solo quién hizo qué y cuándo.</p>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setAuditOpen(false)}>Cerrar</button></div>
      </Modal>

      {isVaultAdmin ? <p className="muted vault-admin-note"><SearchIcon /> Eres administrador del gestor: puedes gestionar accesos y consultar la auditoría. Las credenciales personales de otras personas siguen siendo privadas.</p> : null}
    </div>
  );
}
