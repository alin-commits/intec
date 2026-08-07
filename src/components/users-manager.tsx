"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { roleLabels } from "@/lib/constants";
import { demoProfiles } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { AppRole, Profile } from "@/lib/types";

const STORAGE_KEY = "intec-demo-users";

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? "Usuario"),
    email: row.email ? String(row.email) : null,
    role: row.role as AppRole,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

function initialDemoProfiles(configured: boolean): Profile[] {
  if (configured || typeof window === "undefined") return demoProfiles;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved ? (JSON.parse(saved) as Profile[]) : demoProfiles;
}

export function UsersManager() {
  const configured = isSupabaseConfigured();
  const [profiles, setProfiles] = useState<Profile[]>(() => initialDemoProfiles(configured));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("commercial");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setAccess("denied");
        return;
      }
      setCurrentUserId(authData.user.id);
      const { data: ownProfile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
      if (ownProfile?.role !== "admin") {
        setAccess("denied");
        return;
      }
      setAccess("allowed");
      await loadProfiles();
    });
  }, [configured]);

  const activeCount = useMemo(() => profiles.filter((profile) => profile.isActive).length, [profiles]);

  async function loadProfiles() {
    const supabase = createClient();
    const { data, error } = await supabase.from("profiles").select("id, full_name, email, role, is_active, created_at").order("full_name");
    if (error) {
      setMessage(reportSafeError(error, "No se pudieron cargar los usuarios."));
      return;
    }
    setProfiles((data ?? []).map((row) => mapProfile(row as Record<string, unknown>)));
  }

  function persistDemo(next: Profile[]) {
    setProfiles(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function updateProfile(id: string, patch: Partial<Pick<Profile, "role" | "isActive">>) {
    setMessage(null);
    if (id === currentUserId) {
      setMessage("No puedes cambiar tu propio rol o estado de activación.");
      return;
    }
    if (!configured) {
      persistDemo(profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
      setMessage("Usuario actualizado en el modo demostración.");
      return;
    }
    const dbPatch: Record<string, unknown> = {};
    if (patch.role) dbPatch.role = patch.role;
    if (typeof patch.isActive === "boolean") dbPatch.is_active = patch.isActive;
    const { error } = await createClient().from("profiles").update(dbPatch).eq("id", id);
    if (error) setMessage(reportSafeError(error, "No se pudo actualizar el usuario."));
    else {
      setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
      setMessage("Usuario actualizado correctamente.");
    }
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
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const next: Profile[] = [...profiles, {
          id: `demo-${Date.now()}`,
          fullName,
          email,
          role,
          isActive: true,
          createdAt: new Date().toISOString(),
        }];
        persistDemo(next);
        setMessage("Usuario añadido en el modo demostración.");
      } else {
        const response = await fetch("/api/users/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email, role }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo invitar al usuario.");
        setMessage("Invitación enviada correctamente.");
        await loadProfiles();
      }
      setFullName("");
      setEmail("");
      setRole("commercial");
    } catch (cause) {
      // La ruta /api/users/invite ya devuelve mensajes seguros y en español;
      // aquí solo cubrimos errores de red inesperados.
      setMessage(cause instanceof Error ? cause.message : "No se pudo crear el usuario.");
    } finally {
      setBusy(false);
    }
  }

  if (access === "checking") {
    return <div className="page-stack" />;
  }

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>La gestión de usuarios está reservada a administradores.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Acceso y permisos</span><h2>Usuarios</h2><p>Gestiona quién puede entrar en la plataforma y qué acciones puede realizar.</p></div>
        <div className="summary-pill"><strong>{activeCount}</strong><span>usuarios activos</span></div>
      </section>

      <section className="panel user-invite-panel">
        <div className="panel-heading"><div><span className="eyebrow">Nuevo acceso</span><h2>Invitar usuario</h2></div></div>
        <form className="inline-form" onSubmit={inviteUser}>
          <label><span>Nombre</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
          <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label><span>Rol</span><select value={role} onChange={(event) => setRole(event.target.value as AppRole)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button className="button button-primary" disabled={busy}>{busy ? "Enviando…" : "Invitar usuario"}</button>
        </form>
        {message ? <div className="form-message" role="status">{message}</div> : null}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Equipo</span><h2>Usuarios registrados</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
            <tbody>{profiles.map((profile) => (
              <tr key={profile.id}>
                <td><strong>{profile.fullName}</strong></td>
                <td>{profile.email || "—"}</td>
                <td><select className="table-select" value={profile.role} onChange={(event) => void updateProfile(profile.id, { role: event.target.value as AppRole })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td><button type="button" className={profile.isActive ? "status-toggle active" : "status-toggle"} onClick={() => void updateProfile(profile.id, { isActive: !profile.isActive })}>{profile.isActive ? "Activo" : "Desactivado"}</button></td>
                <td>{profile.id !== currentUserId ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDelete(profile)}>Eliminar</button> : null}</td>
              </tr>
            ))}</tbody>
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
            <p>Se eliminará su acceso por completo. Si tiene consultas, leads, campañas o ventas registradas, no se podrá eliminar: desactívalo en su lugar para conservar el historial.</p>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
