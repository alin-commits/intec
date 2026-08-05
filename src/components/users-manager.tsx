"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { roleLabels } from "@/lib/constants";
import { demoProfiles } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
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

  useEffect(() => {
    if (!configured) return;
    void loadProfiles();
  }, [configured]);

  const activeCount = useMemo(() => profiles.filter((profile) => profile.isActive).length, [profiles]);

  async function loadProfiles() {
    const supabase = createClient();
    const [{ data, error }, { data: authData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, is_active, created_at").order("full_name"),
      supabase.auth.getUser(),
    ]);
    if (error) {
      setMessage(reportSafeError(error, "No se pudieron cargar los usuarios."));
      return;
    }
    setProfiles((data ?? []).map((row) => mapProfile(row as Record<string, unknown>)));
    setCurrentUserId(authData.user?.id ?? null);
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
            <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th></tr></thead>
            <tbody>{profiles.map((profile) => (
              <tr key={profile.id}>
                <td><strong>{profile.fullName}</strong></td>
                <td>{profile.email || "—"}</td>
                <td><select className="table-select" value={profile.role} onChange={(event) => void updateProfile(profile.id, { role: event.target.value as AppRole })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td><button type="button" className={profile.isActive ? "status-toggle active" : "status-toggle"} onClick={() => void updateProfile(profile.id, { isActive: !profile.isActive })}>{profile.isActive ? "Activo" : "Desactivado"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
