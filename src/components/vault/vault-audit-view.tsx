"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { VaultTabs } from "@/components/vault/vault-tabs";
import { ClockIcon, EyeIcon, KeyIcon, UsuariosIcon } from "@/components/icons";

type AuditEvent = {
  id: string;
  userId: string | null;
  userName: string;
  entryId: string | null;
  entryName: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
type AuditPayload = { events: AuditEvent[]; people: { id: string; name: string }[]; total: number; pageSize: number };

const actionLabels: Record<string, string> = {
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
const SENSITIVE = new Set(["PASSWORD_REVEAL", "PASSWORD_COPY"]);
const dateFormatter = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

/** Full activity log of the vault: who did what, when and on which credential. */
export function VaultAuditView() {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("all");
  const [person, setPerson] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const params = new URLSearchParams();
      if (action !== "all") params.set("action", action);
      if (person !== "all") params.set("user", person);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(page));
      try {
        const response = await fetch(`/api/vault/audit?${params}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as AuditPayload & { error?: string };
        if (!active) return;
        if (!response.ok) setError(payload.error ?? "No se pudo cargar la auditoría.");
        else {
          setError(null);
          setData(payload);
        }
      } catch {
        // Sin esto la tabla se quedaba con «Cargando…» para siempre.
        if (active) setError("No hay conexión con el servidor. Comprueba tu red y recarga la página.");
      }
    })();
    return () => { active = false; };
  }, [action, person, from, to, page]);

  const summary = useMemo(() => {
    const events = data?.events ?? [];
    return {
      reveals: events.filter((event) => SENSITIVE.has(event.action)).length,
      changes: events.filter((event) => event.action.startsWith("ENTRY_") && event.action !== "ENTRY_LIST" && event.action !== "ENTRY_VIEW").length,
      people: new Set(events.map((event) => event.userId).filter(Boolean)).size,
    };
  }, [data?.events]);

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

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 100)));

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Todo lo que pasa en el gestor queda aquí: quién abrió, mostró, copió, creó o borró cada credencial. Nunca se guarda ninguna contraseña.</p></div>
      </section>

      <VaultTabs />

      <section className="kpi-grid">
        <KpiCard label="Movimientos en esta página" value={String(data?.events.length ?? 0)} delta="Sin comparación" helper={`de ${data?.total ?? 0} registrados con estos filtros`} icon={<ClockIcon />} tone="indigo" />
        <KpiCard label="Contraseñas vistas o copiadas" value={String(summary.reveals)} delta="Sin comparación" helper="en los movimientos mostrados" icon={<EyeIcon />} tone={summary.reveals ? "amber" : "emerald"} />
        <KpiCard label="Altas, cambios y bajas" value={String(summary.changes)} delta="Sin comparación" helper="credenciales modificadas" icon={<KeyIcon />} tone="sky" />
        <KpiCard label="Personas distintas" value={String(summary.people)} delta="Sin comparación" helper="con actividad aquí" icon={<UsuariosIcon />} tone="emerald" />
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Registro de actividad</h2><p className="panel-subtitle">Lo más reciente primero</p></div>
        </div>
        <div className="filter-bar lead-filters">
          <label><span>Acción</span><select value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }}>
            <option value="all">Todas</option>
            {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label><span>Persona</span><select value={person} onChange={(event) => { setPerson(event.target.value); setPage(0); }}>
            <option value="all">Todas</option>
            {(data?.people ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label><span>Desde</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0); }} /></label>
          <label><span>Hasta</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0); }} /></label>
        </div>
        <div className="table-scroll vault-audit-scroll">
          <table>
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Credencial</th></tr></thead>
            <tbody>
              {data === null ? (
                <tr><td colSpan={4} className="muted">Cargando…</td></tr>
              ) : data.events.length === 0 ? (
                <tr><td colSpan={4} className="muted">Sin actividad con estos filtros.</td></tr>
              ) : data.events.map((event) => (
                <tr key={event.id}>
                  <td className="vault-audit-when">{dateFormatter.format(new Date(event.createdAt))}</td>
                  <td>{event.userName}</td>
                  <td>
                    <span className={SENSITIVE.has(event.action) ? "badge badge-offer_sent" : event.action.startsWith("PERMISSION") ? "badge badge-lost" : "badge"}>
                      {actionLabels[event.action] ?? event.action}
                    </span>
                  </td>
                  <td className="muted">{event.entryName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
          <div className="table-panel-footer table-panel-pagination">
            <button type="button" className="button button-compact button-secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Anterior</button>
            <span className="muted">Página {page + 1} de {pageCount} · {data?.total} movimientos</span>
            <button type="button" className="button button-compact button-secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Siguiente</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
