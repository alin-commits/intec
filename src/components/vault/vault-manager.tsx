"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { ChevronIcon, CopyIcon, EyeIcon, RefreshIcon, SearchIcon, StarIcon } from "@/components/icons";
import { MyTicketButton } from "@/components/tickets/my-ticket-button";
import { VaultTabs } from "@/components/vault/vault-tabs";
import { VaultUnlock } from "@/components/vault/vault-unlock";
import { DEFAULT_GENERATOR, generatePassword, MAX_LENGTH, MIN_LENGTH, passwordStrength, type GeneratorOptions } from "@/lib/vault/password-generator";
import type { VaultBankDetails, VaultEntrySummary, VaultEntryType, VaultPermission, VaultVisibility } from "@/lib/vault/types";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import type { AppRole } from "@/lib/types";

const REVEAL_SECONDS = 30;
const LOCK_REASONS = ["mfa_enrollment_required", "mfa_required", "locked"] as const;
type LockReason = (typeof LOCK_REASONS)[number];

const visibilityLabels: Record<VaultVisibility, string> = { shared: "Compartida", personal: "Personal", restricted: "Restringida" };
const strengthLabels = { weak: "Débil", fair: "Aceptable", strong: "Fuerte" } as const;
const typeLabels: Record<VaultEntryType, string> = { plain: "Normal", email: "Correo", server: "Servidor", bank: "Banco", other: "Otra" };
/** Los campos que solo tienen sentido en una ficha de banco, en el orden en que se leen. */
const bankFields: { key: keyof VaultBankDetails; label: string; placeholder: string }[] = [
  { key: "bankName", label: "Banco", placeholder: "BANCO SANTANDER" },
  { key: "bankCode", label: "Código bancario", placeholder: "0049" },
  { key: "accountHolder", label: "Titular de la cuenta", placeholder: "SUMINISTROS INTEC SL" },
  { key: "accountNumber", label: "Número de cuenta", placeholder: "" },
  { key: "iban", label: "IBAN", placeholder: "ES00 0000 0000 0000 0000 0000" },
];
const emptyBank: VaultBankDetails = { bankName: null, bankCode: null, accountHolder: null, accountNumber: null, iban: null };


type Category = { id: string; name: string; description: string | null; parentId: string | null; count: number };
/** En una carpeta madre, `ids` lleva la suya y las de sus subcarpetas. */
type Scope = { kind: "all" | "favorites" | "recent" | "personal" | "uncategorised" | "category"; id?: string; ids?: string[] };
type EntryDraft = { name: string; url: string; username: string; password: string; notes: string; categoryId: string; visibility: VaultVisibility; entryType: VaultEntryType; bank: VaultBankDetails };
type DetailPayload = { entry: VaultEntrySummary; can: { edit: boolean; delete: boolean; managePermissions: boolean }; sharedWith: VaultPermission[] };
type TeamMember = { id: string; fullName: string };
type ListPayload = {
  entries: VaultEntrySummary[];
  categories: Category[];
  uncategorised: number;
  visibleTotal: number;
  favorites: string[];
  recent: string[];
  total: number;
  page: number;
  pageSize: number;
  isVaultAdmin: boolean;
};

function blankDraft(): EntryDraft {
  return { name: "", url: "", username: "", password: "", notes: "", categoryId: "", visibility: "shared", entryType: "plain", bank: { ...emptyBank } };
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
  const [data, setData] = useState<ListPayload | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");

  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [page, setPage] = useState(0);
  const [openFolders, setOpenFolders] = useState<string[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  /** Copia de todo lo que esta persona puede ver, para buscar sin ir al servidor. */
  const [index, setIndex] = useState<VaultEntrySummary[] | null>(null);

  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(blankDraft);
  const [generator, setGenerator] = useState<GeneratorOptions>(DEFAULT_GENERATOR);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  /** Who will have access when the credential is restricted, and who had it before. */
  const [accessUserIds, setAccessUserIds] = useState<string[]>([]);
  const [baselineAccess, setBaselineAccess] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<{ entryId: string; field: "password" | "notes"; value: string; seconds: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VaultEntrySummary | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [folderAccess, setFolderAccess] = useState<{ id: string; name: string; userIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** El borrado del portapapeles, para poder cancelarlo al salir de la página. */
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clipboardTimer.current) clearTimeout(clipboardTimer.current); }, []);

  const isEmployee = roles.includes("employee");
  const isVaultAdmin = data?.isVaultAdmin ?? false;
  const reload = useCallback((refreshIndex = true) => {
    // El índice del buscador deja de valer cuando cambia una credencial, pero
    // no cuando solo se marca una favorita: eso son 613 filas y un apunte de
    // auditoría de más por cada clic en la estrella.
    if (refreshIndex) setIndex(null);
    setReloadTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profile = await loadCurrentProfile();
      if (!active || !profile) return;
      setUserId(profile.id);
      setUserName(profile.fullName);
      setRoles(profile.roles);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { setSearchTerm(query.trim()); setPage(0); }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const searchingLocally = Boolean(index && index.length > 0 && query.trim());
  useEffect(() => {
    if (searchingLocally) return;
    let active = true;
    void (async () => {
      const params = new URLSearchParams();
      if (searchTerm.length >= 2) params.set("q", searchTerm);
      if (scope.kind === "category" && scope.id) params.set("category", (scope.ids ?? [scope.id]).join(","));
      if (scope.kind === "personal") params.set("visibility", "personal");
      if (scope.kind === "uncategorised") params.set("uncategorised", "1");
      if (scope.kind === "favorites") params.set("favorites", "1");
      if (scope.kind === "recent") params.set("recent", "1");
      params.set("page", String(page));
      const result = await vaultRequest<ListPayload>(`/api/vault/entries?${params}`);
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
      setData(result.data);
      setStage("ready");
    })();
    return () => { active = false; };
  }, [searchTerm, scope, page, reloadTick, searchingLocally]);

  // Se pide una vez, ya con la lista pintada: no retrasa nada de lo que se ve.
  useEffect(() => {
    if (stage !== "ready" || index !== null) return;
    let active = true;
    void (async () => {
      const result = await vaultRequest<{ entries: VaultEntrySummary[]; complete: boolean }>("/api/vault/entries?index=1");
      if (!active || !result.ok) return;
      setIndex(result.data.complete ? result.data.entries : []);
    })();
    return () => { active = false; };
  }, [stage, index]);

  // Arriving from another page with ?entry=<id> opens that credential straight away.
  useEffect(() => {
    if (stage !== "ready") return;
    const requested = new URLSearchParams(window.location.search).get("entry");
    if (!requested) return;
    window.history.replaceState(null, "", "/contrasenas");
    void openDetail(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the vault becomes usable
  }, [stage]);

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

  // ---------- folder tree ----------

  const tree = useMemo(() => {
    const all = data?.categories ?? [];
    const present = new Set(all.map((category) => category.id));
    const childrenOf = new Map<string, Category[]>();
    for (const category of all) {
      if (!category.parentId || !present.has(category.parentId)) continue;
      childrenOf.set(category.parentId, [...(childrenOf.get(category.parentId) ?? []), category]);
    }
    // Una carpeta cuya madre no esté en la lista se enseña como si fuera de
    // primer nivel: mejor eso que dejarla fuera del árbol y que parezca perdida.
    return all
      .filter((category) => !category.parentId || !present.has(category.parentId))
      .map((category) => {
        const children = childrenOf.get(category.id) ?? [];
        return { category, name: category.name, children, total: category.count + children.reduce((sum, child) => sum + child.count, 0) };
      })
      .sort((a, b) => b.total - a.total);
  }, [data?.categories]);

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const favorites = useMemo(() => new Set(data?.favorites ?? []), [data?.favorites]);
  const categoryName = useMemo(() => {
    const map = new Map((data?.categories ?? []).map((category) => [category.id, category.name]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "Sin carpeta");
  }, [data?.categories]);
  /** La carpeta con su madre delante ("Dpto. Marketing e IT / Blizzcool"), para
   *  la ficha, el buscador y los títulos: hay nombres que se repiten en varios
   *  departamentos y por sí solos no dicen de cuál son. */
  const categoryPath = useMemo(() => {
    const byId = new Map((data?.categories ?? []).map((category) => [category.id, category]));
    return (id: string | null) => {
      if (!id) return "Sin carpeta";
      const parts: string[] = [];
      let current = byId.get(id);
      // El tope corta cualquier lazo raro entre carpetas en vez de colgarse.
      while (current && parts.length < 10) {
        parts.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return parts.length > 0 ? parts.join(" / ") : "—";
    };
  }, [data?.categories]);
  const typed = query.trim().toLowerCase();
  /** Null mientras no haya índice o no se esté buscando: entonces manda el servidor. */
  const localResults = useMemo(() => {
    if (!index || index.length === 0 || typed.length === 0) return null;
    const words = typed.split(/\s+/).filter(Boolean);
    const recent = data?.recent ?? [];
    return index.filter((entry) => {
      if (scope.kind === "category" && !(entry.categoryId && (scope.ids ?? [scope.id]).includes(entry.categoryId))) return false;
      if (scope.kind === "personal" && !(entry.visibility === "personal" && entry.createdBy === userId)) return false;
      if (scope.kind === "favorites" && !favorites.has(entry.id)) return false;
      if (scope.kind === "uncategorised" && entry.categoryId) return false;
      if (scope.kind === "recent" && !recent.includes(entry.id)) return false;
      // Con la ruta entera se sigue encontrando por departamento, no solo por
      // el nombre corto de la carpeta.
      const haystack = `${entry.name} ${entry.username ?? ""} ${entry.url ?? ""} ${categoryPath(entry.categoryId)}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [index, typed, scope.kind, scope.id, scope.ids, userId, favorites, categoryPath, data?.recent]);

  const visibleEntries = useMemo(() => {
    if (localResults) return localResults;
    if (scope.kind !== "recent") return entries;
    const order = data?.recent ?? [];
    return entries.filter((entry) => order.includes(entry.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [localResults, scope.kind, data?.recent, entries]);
  const pageCount = localResults ? 1 : Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 100)));

  function selectScope(next: Scope) {
    setScope(next);
    setPage(0);
  }

  // Por id y no por nombre: al quitarles el prefijo hay carpetas que se llaman
  // igual en departamentos distintos, y abrir una abriría también la otra.
  function toggleFolder(id: string) {
    setOpenFolders((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  // ---------- actions ----------

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

  async function secretOf(entryId: string, field: "password" | "notes", intent: "view" | "copy") {
    const result = await vaultRequest<{ value: string }>(`/api/vault/entries/${entryId}/reveal`, { method: "POST", body: JSON.stringify({ field, intent }) });
    if (!result.ok) {
      if (result.lock) handleLock(result.lock);
      else setMessage(result.error);
      return null;
    }
    return result.data.value;
  }

  async function reveal(entryId: string, field: "password" | "notes") {
    const value = await secretOf(entryId, field, "view");
    if (value !== null) setRevealed({ entryId, field, value, seconds: REVEAL_SECONDS });
  }

  async function copySecret(entryId: string, field: "password" | "notes" = "password") {
    const value = await secretOf(entryId, field, "copy");
    if (value === null) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${field === "notes" ? "Notas copiadas" : "Contraseña copiada"}. Se intentará borrar del portapapeles en ${REVEAL_SECONDS} segundos.`);
      // Best effort only: the browser may refuse if the tab is not focused.
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
      clipboardTimer.current = setTimeout(() => {
        clipboardTimer.current = null;
        // Solo se borra si lo que hay sigue siendo el secreto: si entretanto se
        // ha copiado otra cosa, vaciar el portapapeles sería perderla.
        void navigator.clipboard.readText()
          .then((current) => { if (current === value) return navigator.clipboard.writeText(""); })
          .catch(() => {});
      }, REVEAL_SECONDS * 1000);
    } catch {
      setMessage("Tu navegador no ha permitido copiar. Usa «Mostrar» y cópialo a mano.");
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado.`);
    } catch {
      setMessage("Tu navegador no ha permitido copiar.");
    }
  }

  async function toggleFavorite(entryId: string) {
    if (!userId) return;
    const supabase = createClient();
    const { error: favoriteError } = favorites.has(entryId)
      ? await supabase.from("vault_favorites").delete().eq("user_id", userId).eq("vault_entry_id", entryId)
      : await supabase.from("vault_favorites").insert({ user_id: userId, vault_entry_id: entryId });
    if (favoriteError) {
      setMessage("No se pudo cambiar el favorito.");
      return;
    }
    reload();
  }

  function openNew() {
    setEditingId(null);
    setDraft({ ...blankDraft(), categoryId: scope.kind === "category" ? scope.id ?? "" : "" });
    setAccessUserIds([]);
    setBaselineAccess([]);
    setError(null);
    setGeneratorOpen(false);
    setEditorOpen(true);
    void loadTeam();
  }

  /** `withNewPassword` is the shortcut from a weak credential: the form opens with a strong one ready. */
  function openEdit(entry: VaultEntrySummary, withNewPassword = false) {
    setEditingId(entry.id);
    setDraft({
      name: entry.name,
      url: entry.url ?? "",
      username: entry.username ?? "",
      password: withNewPassword ? generatePassword(generator) : "",
      notes: "",
      categoryId: entry.categoryId ?? "",
      visibility: entry.visibility,
      entryType: entry.entryType,
      bank: entry.bankDetails ?? { ...emptyBank },
    });
    const current = (detail?.entry.id === entry.id ? detail.sharedWith : []).map((permission) => permission.userId);
    setAccessUserIds(current);
    setBaselineAccess(current);
    setError(null);
    void loadTeam();
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
      entryType: draft.entryType,
      bankDetails: draft.entryType === "bank" ? draft.bank : null,
    };
    // An untouched password field means "leave it as it is": it is never sent back and forth.
    if (draft.password) body.password = draft.password;
    if (draft.notes) body.notes = draft.notes;
    const result = editingId
      ? await vaultRequest<{ ok: boolean }>(`/api/vault/entries/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
      : await vaultRequest<{ entry: VaultEntrySummary }>("/api/vault/entries", { method: "POST", body: JSON.stringify({ ...body, password: draft.password }) });
    if (!result.ok) {
      setBusy(false);
      if (result.lock) return handleLock(result.lock);
      setError(result.error);
      return;
    }

    // Apply the access list of a restricted credential: what was added and what was taken away.
    const entryId = editingId ?? (result.data as { entry?: VaultEntrySummary }).entry?.id;
    if (entryId) {
      const wanted = draft.visibility === "restricted" ? accessUserIds : [];
      for (const userId of wanted.filter((id) => !baselineAccess.includes(id))) {
        await vaultRequest(`/api/vault/entries/${entryId}/permissions`, {
          method: "POST",
          body: JSON.stringify({ userId, canView: true, canEdit: false, canDelete: false, canManagePermissions: false }),
        });
      }
      for (const userId of baselineAccess.filter((id) => !wanted.includes(id))) {
        await vaultRequest(`/api/vault/entries/${entryId}/permissions?userId=${userId}`, { method: "DELETE" });
      }
    }
    setBusy(false);
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

  async function loadTeam() {
    if (team.length > 0) return;
    const { data: members } = await createClient().rpc("list_team_members");
    setTeam(((members ?? []) as { id: string; full_name: string | null }[]).map((row) => ({ id: row.id, fullName: row.full_name || "Usuario" })));
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

  async function openFolderAccess(categoryId: string, name: string) {
    await loadTeam();
    const result = await vaultRequest<{ userIds: string[] }>(`/api/vault/categories/${categoryId}/access`);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setFolderAccess({ id: categoryId, name, userIds: result.data.userIds });
  }

  async function saveFolderAccess(userIds: string[]) {
    if (!folderAccess) return;
    const result = await vaultRequest<{ userIds: string[] }>(`/api/vault/categories/${folderAccess.id}/access`, { method: "PUT", body: JSON.stringify({ userIds }) });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setFolderAccess(null);
    setMessage(userIds.length ? `Carpeta restringida a ${result.data.userIds.length} personas.` : "Carpeta abierta a todo el equipo.");
    reload();
  }

  if (stage === "loading") return <div className="page-stack" />;
  if (stage === "locked") return <VaultUnlock reason={lockReason} onUnlocked={() => { setStage("loading"); reload(); }} />;

  const strength = draft.password ? passwordStrength(draft.password) : null;
  const scopeTitle =
    scope.kind === "all" ? "Todas las credenciales"
      : scope.kind === "favorites" ? "Favoritas"
        : scope.kind === "recent" ? "Usadas recientemente"
          : scope.kind === "personal" ? "Mis credenciales personales"
            : scope.kind === "uncategorised" ? "Sin carpeta"
              : categoryPath(scope.id ?? null);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Credenciales de la empresa, cifradas. Para mostrar o copiar una contraseña se pide el código de tu app de autenticación, una vez al día.</p></div>
        <div className="panel-heading-trailing">
          {isEmployee ? <MyTicketButton userName={userName} /> : null}
          <button type="button" className="button button-primary" onClick={openNew}>+ Nueva credencial</button>
        </div>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <VaultTabs />

      <div className="vault-layout">
        <aside className="panel vault-tree">
          <ul className="vault-tree-list">
            <li><button type="button" className={scope.kind === "all" ? "vault-tree-item active" : "vault-tree-item"} onClick={() => selectScope({ kind: "all" })}>Todas<span>{data?.visibleTotal ?? 0}</span></button></li>
            <li><button type="button" className={scope.kind === "favorites" ? "vault-tree-item active" : "vault-tree-item"} onClick={() => selectScope({ kind: "favorites" })}><span className="vault-tree-label"><StarIcon filled /> Favoritas</span><span>{favorites.size}</span></button></li>
            <li><button type="button" className={scope.kind === "recent" ? "vault-tree-item active" : "vault-tree-item"} onClick={() => selectScope({ kind: "recent" })}>Recientes<span>{data?.recent.length ?? 0}</span></button></li>
            <li><button type="button" className={scope.kind === "personal" ? "vault-tree-item active" : "vault-tree-item"} onClick={() => selectScope({ kind: "personal" })}>Mías (personales)</button></li>
          </ul>
          <span className="search-group-title vault-tree-title">Carpetas</span>
          <ul className="vault-tree-list">
            {tree.map((node) => (
              <li key={node.category.id}>
                <div className="vault-tree-row">
                  {node.children.length > 0 ? (
                    <button type="button" className="vault-tree-toggle" onClick={() => toggleFolder(node.category.id)} aria-expanded={openFolders.includes(node.category.id)} aria-label={openFolders.includes(node.category.id) ? `Cerrar ${node.name}` : `Abrir ${node.name}`}>
                      <ChevronIcon open={openFolders.includes(node.category.id)} />
                    </button>
                  ) : <span className="vault-tree-toggle vault-tree-toggle-empty" />}
                  <button
                    type="button"
                    className={scope.kind === "category" && scope.id === node.category.id ? "vault-tree-item active" : "vault-tree-item"}
                    onClick={() => selectScope({ kind: "category", id: node.category.id, ids: [node.category.id, ...node.children.map((child) => child.id)] })}
                  >
                    {node.name}<span>{node.total}</span>
                  </button>
                </div>
                {node.children.length > 0 && openFolders.includes(node.category.id) ? (
                  <ul className="vault-tree-children">
                    {node.children.map((child) => (
                      <li key={child.id}>
                        <button type="button" className={scope.kind === "category" && scope.id === child.id ? "vault-tree-item active" : "vault-tree-item"} onClick={() => selectScope({ kind: "category", id: child.id })}>
                          {child.name}<span>{child.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {data?.uncategorised ? (
              <li><button type="button" className={scope.kind === "uncategorised" ? "vault-tree-item active" : "vault-tree-item"} onClick={() => selectScope({ kind: "uncategorised" })}>Sin carpeta<span>{data.uncategorised}</span></button></li>
            ) : null}
          </ul>
        </aside>

        <section className="panel table-panel vault-list">
          <div className="panel-heading vault-list-heading">
            <div>
              <h2>{scopeTitle}</h2>
              <p className="panel-subtitle">
                {localResults
                  ? `${localResults.length} ${localResults.length === 1 ? "resultado" : "resultados"} de «${query.trim()}»`
                  : searchTerm ? `Resultados de «${searchTerm}»` : `${data?.total ?? 0} credenciales`}
                {/* Buscando dentro de una carpeta es fácil pensar que no encuentra nada. */}
                {query.trim() && scope.kind !== "all" ? (
                  <> · solo en esta carpeta · <button type="button" className="text-link" onClick={() => selectScope({ kind: "all" })}>buscar en todas</button></>
                ) : null}
              </p>
            </div>
            <div className="vault-list-tools">
              <label className="search-field vault-search">
                <SearchIcon />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar credencial…" aria-label="Buscar credencial" />
              </label>
              {isVaultAdmin && scope.kind === "category" && scope.id ? (
                <button type="button" className="button button-compact button-secondary" onClick={() => void openFolderAccess(scope.id as string, scopeTitle)}>Quién ve esta carpeta</button>
              ) : null}
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th aria-label="Favorita"></th><th>Credencial</th><th>Usuario</th><th>Carpeta</th><th>Acciones</th></tr></thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <button type="button" className={favorites.has(entry.id) ? "vault-star active" : "vault-star"} onClick={() => void toggleFavorite(entry.id)} aria-label={favorites.has(entry.id) ? "Quitar de favoritas" : "Marcar como favorita"} title="Favorita"><StarIcon filled={favorites.has(entry.id)} /></button>
                    </td>
                    <td className="vault-name-cell">
                      <div className="vault-cell">
                      <strong title={entry.name}>{entry.name}</strong>
                      {entry.visibility !== "shared" ? <span className={entry.visibility === "personal" ? "badge badge-offer_sent" : "badge badge-lost"}>{visibilityLabels[entry.visibility]}</span> : null}
                      {entry.strength === "weak" ? <span className="vault-strength vault-strength-weak">Débil</span> : null}
                      </div>
                    </td>
                    <td className="vault-user-cell" title={entry.username ?? ""}>
                      <div className="vault-cell">
                        <span>{entry.username || "—"}</span>
                        {entry.username ? <button type="button" className="vault-icon-button" onClick={() => void copyText(entry.username as string, "Usuario")} title="Copiar usuario" aria-label={`Copiar el usuario de ${entry.name}`}><CopyIcon /></button> : null}
                      </div>
                    </td>
                    <td className="vault-folder-cell" title={categoryPath(entry.categoryId)}>{categoryName(entry.categoryId)}</td>
                    <td>
                      <div className="table-actions vault-row-actions">
                        <button type="button" className="button button-compact button-primary" aria-label={`Copiar la contraseña de ${entry.name}`} onClick={() => void copySecret(entry.id)} title="Copiar la contraseña"><CopyIcon /> Copiar</button>
                        {entry.url ? <a className="button button-compact button-secondary" href={entry.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir la web de ${entry.name}`} title="Abrir la web">Abrir</a> : null}
                        <button type="button" className="button button-compact button-secondary" aria-label={`Ver ${entry.name}`} onClick={() => void openDetail(entry.id)}>Ver</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleEntries.length === 0 ? (
                  <tr><td colSpan={5} className="muted">{searchTerm ? "Ninguna credencial coincide con la búsqueda." : "No hay credenciales en esta carpeta."}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && scope.kind !== "recent" ? (
            <div className="table-panel-footer table-panel-pagination">
              <button type="button" className="button button-compact button-secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Anterior</button>
              <span className="muted">Página {page + 1} de {pageCount} · {data?.total} credenciales</span>
              <button type="button" className="button button-compact button-secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Siguiente</button>
            </div>
          ) : null}
        </section>
      </div>

      {/* ---------- Detail ---------- */}
      <Modal open={Boolean(detail)} title={detail?.entry.name ?? ""} eyebrow="Credencial" onClose={() => { setDetail(null); setRevealed(null); }}>
        {detail ? (
          <div className="vault-detail">
            <div className="confirmation-summary">
              <span>Usuario</span>
              <strong className="vault-inline">
                {detail.entry.username || "—"}
                {detail.entry.username ? <button type="button" className="button button-compact button-secondary" onClick={() => void copyText(detail.entry.username as string, "Usuario")}><CopyIcon /> Copiar</button> : null}
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
                <button type="button" className="button button-compact button-secondary" onClick={() => void copySecret(detail.entry.id)}><CopyIcon /> Copiar</button>
              </strong>
              <span>Web</span>
              <strong>{detail.entry.url ? <a href={detail.entry.url} target="_blank" rel="noopener noreferrer" className="text-link">{detail.entry.url}</a> : "—"}</strong>
              <span>Carpeta</span><strong>{categoryPath(detail.entry.categoryId)}</strong>
              <span>Ámbito</span><strong>{visibilityLabels[detail.entry.visibility]}</strong>
              <span>Fuerza</span>
              <strong>{detail.entry.strength ? <em className={`vault-strength vault-strength-${detail.entry.strength}`}>{strengthLabels[detail.entry.strength]}</em> : "—"}</strong>
              <span>Contraseña cambiada</span><strong>{formatDate(detail.entry.lastPasswordChangeAt)}</strong>
            </div>

            {detail.entry.entryType === "bank" && detail.entry.bankDetails ? (
              <div className="vault-bank-block">
                <span className="search-group-title">Datos del banco</span>
                <div className="confirmation-summary">
                  {bankFields.filter((field) => detail.entry.bankDetails?.[field.key]).map((field) => (
                    <Fragment key={field.key}>
                      <span>{field.label}</span>
                      <strong className="vault-inline">
                        {detail.entry.bankDetails?.[field.key]}
                        <button type="button" className="button button-compact button-secondary" onClick={() => void copyText(detail.entry.bankDetails?.[field.key] as string, field.label)}><CopyIcon /> Copiar</button>
                      </strong>
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.entry.strength === "weak" && detail.can.edit ? (
              <div className="notice vault-weak-notice">
                <div>
                  <strong>Esta contraseña es débil.</strong>
                  <span>Es corta o poco variada. Cámbiala primero en el servicio y guarda aquí la nueva.</span>
                </div>
                <button type="button" className="button button-compact button-primary" onClick={() => openEdit(detail.entry, true)}>
                  <RefreshIcon /> Cambiarla ahora
                </button>
              </div>
            ) : null}

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
              <div className="notice-section-head">
                <span className="search-group-title">Con acceso ({detail.sharedWith.length})</span>
                <button type="button" className="button button-compact button-secondary" onClick={() => { void loadTeam(); setPermissionsOpen(true); }}>Gestionar acceso</button>
              </div>
            ) : null}

            <div className="modal-actions">
              {detail.can.delete ? <button type="button" className="button button-secondary expenses-delete" onClick={() => setPendingDelete(detail.entry)}>Eliminar</button> : null}
              <button type="button" className="button button-secondary" onClick={() => { setDetail(null); setRevealed(null); }}>Cerrar</button>
              {detail.can.edit ? <button type="button" className="button button-primary" onClick={() => openEdit(detail.entry)}>Editar</button> : null}
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
              <input type="text" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" spellCheck={false} required={!editingId} />
            </label>
            <label><span>Carpeta</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
              <option value="">Sin carpeta</option>
              {/* Agrupadas por departamento: hay subcarpetas que se llaman igual y sueltas no se distinguirían. */}
              {tree.map((node) => (node.children.length > 0 ? (
                <optgroup key={node.category.id} label={node.name}>
                  <option value={node.category.id}>{node.name}</option>
                  {node.children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
                </optgroup>
              ) : (
                <option key={node.category.id} value={node.category.id}>{node.name}</option>
              )))}
            </select></label>
            <label><span>Tipo</span><select value={draft.entryType} onChange={(event) => setDraft({ ...draft, entryType: event.target.value as VaultEntryType })}>
              {(Object.keys(typeLabels) as VaultEntryType[]).map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
            </select></label>
            <label><span>¿Quién puede verla?</span><select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as VaultVisibility })}>
              <option value="shared">Compartida con el equipo</option>
              <option value="personal">Personal (solo yo)</option>
              <option value="restricted">Restringida (solo a quien le dé acceso)</option>
            </select></label>
            {draft.entryType === "bank" ? (
              <div className="form-field-wide vault-bank-fields">
                <span className="vault-access-title">Datos del banco</span>
                <div className="vault-bank-grid">
                  {bankFields.map((field) => (
                    <label key={field.key}>
                      <span>{field.label}</span>
                      <input
                        value={draft.bank[field.key] ?? ""}
                        placeholder={field.placeholder}
                        onChange={(event) => setDraft({ ...draft, bank: { ...draft.bank, [field.key]: event.target.value } })}
                      />
                    </label>
                  ))}
                </div>
                <p className="muted invoice-hint">Estos datos se guardan sin cifrar, porque no son secretos. El PIN o la clave de firma van en la contraseña, y lo demás en las notas.</p>
              </div>
            ) : null}
            {draft.visibility === "restricted" ? (
              <div className="form-field-wide vault-access-picker">
                <span className="vault-access-title">¿Quién puede verla? {accessUserIds.length ? <strong>({accessUserIds.length})</strong> : null}</span>
                <div className="announcement-people">
                  {team.filter((member) => member.id !== userId).map((member) => (
                    <label key={member.id} className="announcement-person">
                      <input
                        type="checkbox"
                        checked={accessUserIds.includes(member.id)}
                        onChange={() => setAccessUserIds((current) => (current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id]))}
                      />
                      <span>{member.fullName}</span>
                    </label>
                  ))}
                  {team.length === 0 ? <p className="muted">Cargando el equipo…</p> : null}
                </div>
                <p className="muted invoice-hint">Tú siempre la ves, por ser quien la crea. Los administradores del gestor también.</p>
              </div>
            ) : null}
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

      {/* ---------- Access for one credential ---------- */}
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
                    <button type="button" className="vault-link-button" onClick={() => void grantAccess(member.id, { canEdit: !granted.canEdit, canView: true })}>
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

      {/* ---------- Access for a whole folder ---------- */}
      <Modal open={Boolean(folderAccess)} title={`Quién ve «${folderAccess?.name ?? ""}»`} eyebrow="Acceso por carpeta" onClose={() => setFolderAccess(null)}>
        {folderAccess ? (
          <>
            <p className="muted">
              {folderAccess.userIds.length === 0
                ? "Ahora mismo la ve todo el equipo. Si marcas a alguien, pasará a verla solo esa gente."
                : `Restringida a ${folderAccess.userIds.length} personas. Desmárcalas todas para volver a abrirla al equipo.`}
            </p>
            <div className="announcement-people">
              {team.map((member) => (
                <label key={member.id} className="announcement-person">
                  <input
                    type="checkbox"
                    checked={folderAccess.userIds.includes(member.id)}
                    onChange={() => {
                      const next = folderAccess.userIds.includes(member.id)
                        ? folderAccess.userIds.filter((id) => id !== member.id)
                        : [...folderAccess.userIds, member.id];
                      setFolderAccess({ ...folderAccess, userIds: next });
                    }}
                  />
                  <span>{member.fullName}</span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setFolderAccess(null)}>Cancelar</button>
              <button type="button" className="button button-primary" onClick={() => void saveFolderAccess(folderAccess.userIds)}>Guardar acceso</button>
            </div>
          </>
        ) : null}
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

    </div>
  );
}
