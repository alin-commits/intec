"use client";

import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { USER_MANAGER_ROLES, hasAnyRole, roleLabels } from "@/lib/constants";
import { demoProfiles } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { writeRows } from "@/lib/supabase/write";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { SearchIcon } from "@/components/icons";
import { Toast } from "@/components/ui/toast";
import type { AppRole, Profile } from "@/lib/types";
import { PageLoader } from "@/components/ui/page-loader";

const STORAGE_KEY = "intec-demo-users";

/** Sin tildes ni mayúsculas, para que «jose» encuentre a «José». */
const plano = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Qué cuentas se enseñan: las de la casa, las de prueba o todas. */
type TipoDeCuenta = "all" | "reales" | "prueba";

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? "Usuario"),
    email: row.email ? String(row.email) : null,
    roles: row.roles as AppRole[],
    isActive: Boolean(row.is_active),
    isPreview: Boolean(row.is_preview),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

function initialDemoProfiles(configured: boolean): Profile[] {
  if (configured || typeof window === "undefined") return demoProfiles;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved ? (JSON.parse(saved) as Profile[]) : demoProfiles;
}

function toggleRole(current: AppRole[], role: AppRole): AppRole[] {
  return current.includes(role) ? current.filter((item) => item !== role) : [...current, role];
}

function RoleChips({ value, onChange, disabled }: { value: AppRole[]; onChange: (next: AppRole[]) => void; disabled?: boolean }) {
  return (
    <div className="role-chip-group">
      {USER_MANAGER_ROLES.map((role) => (
        <button
          key={role}
          type="button"
          disabled={disabled}
          className={value.includes(role) ? "role-chip active" : "role-chip"}
          onClick={() => onChange(toggleRole(value, role))}
        >
          {roleLabels[role]}
        </button>
      ))}
    </div>
  );
}

/*
  Para leer la fila hacen falta las que tiene puestas, no las catorce. Las
  pastillas apagadas eran la mitad de la altura de la tabla y obligaban a
  distinguir encendido de apagado quince veces seguidas.
*/
function ChipsPuestos({ etiquetas, vacio }: { etiquetas: string[]; vacio: string }) {
  if (etiquetas.length === 0) return <span className="muted">{vacio}</span>;
  return <div className="role-chip-group">{etiquetas.map((etiqueta) => <span key={etiqueta} className="role-chip active es-lectura">{etiqueta}</span>)}</div>;
}

type UnitOption = { id: string; name: string };

function toggleUnit(current: string[], unitId: string): string[] {
  return current.includes(unitId) ? current.filter((item) => item !== unitId) : [...current, unitId];
}

function UnitChips({ options, value, onChange, disabled }: { options: UnitOption[]; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  if (options.length === 0) return <span className="muted">Sin marcas</span>;
  return (
    <div className="role-chip-group">
      {options.map((unit) => (
        <button
          key={unit.id}
          type="button"
          disabled={disabled}
          className={value.includes(unit.id) ? "role-chip active" : "role-chip"}
          onClick={() => onChange(toggleUnit(value, unit.id))}
        >
          {unit.name}
        </button>
      ))}
    </div>
  );
}

export function UsersManager() {
  const configured = isSupabaseConfigured();
  const [profiles, setProfiles] = useState<Profile[]>(() => initialDemoProfiles(configured));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["commercial"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [editando, setEditando] = useState<string | null>(null);
  /*
    Buscar y filtrar la lista.

    Las cuentas de prueba viven mezcladas con las de verdad y son ocho: con
    ellas delante, encontrar a una persona concreta es ir leyendo. Esto no
    cambia ningún permiso, solo qué filas se pintan.
  */
  const [busqueda, setBusqueda] = useState("");
  const [tipoDeCuenta, setTipoDeCuenta] = useState<TipoDeCuenta>("all");
  const [filtroRol, setFiltroRol] = useState<"all" | AppRole>("all");
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [businessUnits, setBusinessUnits] = useState<UnitOption[]>([]);
  const [unitAssignments, setUnitAssignments] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setAccess("denied");
        return;
      }
      setCurrentUserId(authData.user.id);
      const { data: ownProfile } = await supabase.from("profiles").select("roles").eq("id", authData.user.id).maybeSingle();
      if (!ownProfile || !hasAnyRole(ownProfile.roles, ["admin"])) {
        setAccess("denied");
        return;
      }
      setAccess("allowed");
      await Promise.all([loadProfiles(), loadUnitData()]);
    });
  }, [configured]);

  const activeCount = useMemo(() => profiles.filter((profile) => profile.isActive).length, [profiles]);

  async function loadProfiles() {
    const supabase = createClient();
    const { data, error } = await supabase.from("profiles").select("id, full_name, email, roles, is_active, is_preview, created_at").order("full_name");
    if (error) {
      setMessage(reportSafeError(error, "No se pudieron cargar los usuarios."));
      return;
    }
    setProfiles((data ?? []).map((row) => mapProfile(row as Record<string, unknown>)));
  }

  async function loadUnitData() {
    if (!configured) return;
    const supabase = createClient();
    const [{ data: units, error: unitsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      supabase.from("business_units").select("id, name").order("sort_order"),
      supabase.from("profile_business_units").select("profile_id, business_unit_id"),
    ]);
    if (unitsError || assignmentsError) {
      setMessage(reportSafeError(unitsError ?? assignmentsError, "No se pudieron cargar las marcas."));
      return;
    }
    setBusinessUnits((units ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })));
    const grouped: Record<string, string[]> = {};
    for (const row of assignments ?? []) {
      const profileId = String(row.profile_id);
      (grouped[profileId] ??= []).push(String(row.business_unit_id));
    }
    setUnitAssignments(grouped);
  }

  async function updateUnitAssignment(profileId: string, nextUnitIds: string[]) {
    setMessage(null);
    if (!configured) {
      setUnitAssignments((current) => ({ ...current, [profileId]: nextUnitIds }));
      return;
    }
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("profile_business_units").delete().eq("profile_id", profileId);
    if (deleteError) {
      setMessage(reportSafeError(deleteError, "No se pudieron actualizar las marcas asignadas."));
      return;
    }
    if (nextUnitIds.length > 0) {
      const { error: insertError } = await supabase
        .from("profile_business_units")
        .insert(nextUnitIds.map((businessUnitId) => ({ profile_id: profileId, business_unit_id: businessUnitId })));
      if (insertError) {
        setMessage(reportSafeError(insertError, "No se pudieron actualizar las marcas asignadas."));
        return;
      }
    }
    setUnitAssignments((current) => ({ ...current, [profileId]: nextUnitIds }));
    setMessage("Marcas asignadas actualizadas.");
  }

  function persistDemo(next: Profile[]) {
    setProfiles(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const usuariosFiltrados = useMemo(() => {
    const texto = plano(busqueda.trim());
    return profiles.filter((profile) => {
      if (tipoDeCuenta === "reales" && profile.isPreview) return false;
      if (tipoDeCuenta === "prueba" && !profile.isPreview) return false;
      if (filtroRol !== "all" && !profile.roles.includes(filtroRol)) return false;
      if (!texto) return true;
      // Por nombre, por correo y por el rol tal como se lee: quien busca
      // «compras» espera encontrar al de compras, no acordarse de su nombre.
      const donde = [profile.fullName, profile.email ?? "", ...profile.roles.map((role) => roleLabels[role] ?? role)];
      return donde.some((campo) => plano(campo).includes(texto));
    });
  }, [profiles, busqueda, tipoDeCuenta, filtroRol]);

  const hayFiltros = tipoDeCuenta !== "all" || filtroRol !== "all" || busqueda.trim() !== "";

  async function updateProfile(id: string, patch: Partial<Pick<Profile, "roles" | "isActive">>) {
    setMessage(null);
    if (profiles.find((profile) => profile.id === id)?.roles.includes("owner")) {
      setMessage("La cuenta del propietario no la puede modificar nadie más.");
      return;
    }
    if (id === currentUserId) {
      setMessage("No puedes cambiar tu propio rol o estado de activación.");
      return;
    }
    if (patch.roles && patch.roles.length === 0) {
      setMessage("Selecciona al menos un rol.");
      return;
    }
    if (!configured) {
      persistDemo(profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
      setMessage("Usuario actualizado en el modo demostración.");
      return;
    }
    const dbPatch: Record<string, unknown> = {};
    if (patch.roles) dbPatch.roles = patch.roles;
    if (typeof patch.isActive === "boolean") dbPatch.is_active = patch.isActive;
    try {
      await writeRows(
        createClient().from("profiles").update(dbPatch).eq("id", id),
        "No se pudo actualizar el usuario: puede que su ficha ya no exista o que tu rol no permita cambiarla.",
      );
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar el usuario."));
      return;
    }
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
    setMessage("Usuario actualizado correctamente.");
  }

  async function confirmDeleteUser() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        persistDemo(profiles.filter((profile) => profile.id !== pendingDelete.id));
        setMessage("Usuario eliminado en el modo demostración.");
        setPendingDelete(null);
        return;
      }
      const response = await fetch(`/api/users/${pendingDelete.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo eliminar el usuario.");
      setProfiles((current) => current.filter((profile) => profile.id !== pendingDelete.id));
      setMessage("Usuario eliminado correctamente.");
      setPendingDelete(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo eliminar el usuario.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roles.length === 0) {
      setMessage("Selecciona al menos un rol.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const next: Profile[] = [...profiles, {
          id: `demo-${Date.now()}`,
          fullName,
          email,
          roles,
          isActive: true,
          createdAt: new Date().toISOString(),
        }];
        persistDemo(next);
        setMessage("Usuario añadido en el modo demostración.");
      } else {
        const response = await fetch("/api/users/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email, roles }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo invitar al usuario.");
        setMessage("Invitación enviada correctamente.");
        await loadProfiles();
      }
      setFullName("");
      setEmail("");
      setRoles(["commercial"]);
    } catch (cause) {
      // La ruta /api/users/invite ya devuelve mensajes seguros y en español;
      // aquí solo cubrimos errores de red inesperados.
      setMessage(cause instanceof Error ? cause.message : "No se pudo crear el usuario.");
    } finally {
      setBusy(false);
    }
  }

  if (access === "checking") {
    return <PageLoader label="Cargando los usuarios…" />;
  }

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes permiso para ver esta página</h2>
          <p>La gestión de usuarios está reservada a administradores.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Gestiona quién puede entrar en la plataforma y qué acciones puede realizar. Un usuario puede tener varios roles a la vez.</p></div>
        <div className="summary-pill"><strong>{activeCount}</strong><span>usuarios activos</span></div>
      </section>

      <section className="panel user-invite-panel">
        <div className="panel-heading"><div><span className="eyebrow">Nuevo acceso</span><h2>Invitar usuario</h2></div></div>
        <form className="form-grid" onSubmit={inviteUser}>
          <label><span>Nombre</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
          <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="form-field-wide"><span>Roles</span><RoleChips value={roles} onChange={setRoles} /></label>
          <div className="form-field-wide modal-actions" style={{ justifyContent: "flex-start" }}>
            <button className="button button-primary" disabled={busy}>{busy ? "Enviando…" : "Invitar usuario"}</button>
          </div>
        </form>
        <Toast message={message} onDismiss={() => setMessage(null)} />
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Equipo</span><h2>Usuarios registrados</h2></div></div>
        <label className="list-search">
          <span className="sr-only">Buscar usuarios</span>
          <SearchIcon />
          <input
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar por nombre, correo o rol"
          />
        </label>
        <div className="filter-bar">
          <label><span>Tipo de cuenta</span>
            <select value={tipoDeCuenta} onChange={(event) => setTipoDeCuenta(event.target.value as TipoDeCuenta)}>
              <option value="all">Todas</option>
              <option value="reales">Personas</option>
              <option value="prueba">Cuentas de prueba</option>
            </select>
          </label>
          <label><span>Rol</span>
            <select value={filtroRol} onChange={(event) => setFiltroRol(event.target.value as "all" | AppRole)}>
              <option value="all">Todos</option>
              {USER_MANAGER_ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </select>
          </label>
          <div className="filter-summary"><span>Se ven</span><strong>{usuariosFiltrados.length} de {profiles.length}</strong></div>
        </div>
        <div className="table-scroll">
          <table className="users-table">
            <thead><tr><th>Usuario</th><th>Email</th><th>Roles</th><th>Marcas asignadas</th><th>Estado</th><th></th></tr></thead>
            <tbody>{usuariosFiltrados.length === 0 ? (
              <tr><td colSpan={6} className="muted">
                {hayFiltros ? "Ningún usuario encaja con lo que has puesto." : "Todavía no hay usuarios."}
              </td></tr>
            ) : null}{usuariosFiltrados.map((profile) => {
              const esPropietario = profile.roles.includes("owner");
              const abierto = editando === profile.id;
              return (
              <Fragment key={profile.id}>
              <tr>
                <td><strong>{profile.fullName}</strong>{esPropietario ? <small className="muted">Propietario · no se puede modificar</small> : null}{profile.isPreview ? <small className="muted">Cuenta de prueba</small> : null}</td>
                <td>{profile.email || "—"}</td>
                <td><ChipsPuestos etiquetas={profile.roles.map((role) => roleLabels[role] ?? role)} vacio="Sin rol" /></td>
                <td><ChipsPuestos etiquetas={(unitAssignments[profile.id] ?? []).map((id) => businessUnits.find((unit) => unit.id === id)?.name ?? id)} vacio={businessUnits.length === 0 ? "Sin marcas" : "Ninguna"} /></td>
                <td><button type="button" className={profile.isActive ? "status-toggle active" : "status-toggle"} disabled={esPropietario} onClick={() => void updateProfile(profile.id, { isActive: !profile.isActive })}>{profile.isActive ? "Activo" : "Desactivado"}</button></td>
                <td className="user-row-actions">
                  {esPropietario ? null : (
                    <button type="button" className="button button-compact button-secondary" onClick={() => setEditando(abierto ? null : profile.id)}>
                      {abierto ? "Cerrar" : "Cambiar"}
                    </button>
                  )}
                  {profile.id !== currentUserId && !esPropietario ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDelete(profile)}>Eliminar</button> : null}
                </td>
              </tr>
              {abierto ? (
                <tr className="user-edit-row">
                  <td colSpan={6}>
                    <div className="user-edit-fields">
                      <div>
                        <span className="sales-subheading">Roles</span>
                        <RoleChips value={profile.roles} onChange={(next) => void updateProfile(profile.id, { roles: next })} />
                      </div>
                      <div>
                        <span className="sales-subheading">Marcas asignadas</span>
                        <UnitChips
                          options={businessUnits}
                          value={unitAssignments[profile.id] ?? []}
                          onChange={(next) => void updateUnitAssignment(profile.id, next)}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}
              </Fragment>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar este usuario?"
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteUser()}
      >
        {pendingDelete ? (
          <div className="confirmation-summary">
            <span>Usuario</span><strong>{pendingDelete.fullName}</strong>
            <span>Email</span><strong>{pendingDelete.email || "—"}</strong>
            <p>Se eliminará su acceso por completo. Sus consultas, leads, campañas o ventas registradas se conservan, solo se les quita el vínculo con este usuario.</p>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
