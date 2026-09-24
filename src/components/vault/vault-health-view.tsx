"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { CheckCircleIcon, ClockIcon, KeyIcon, RefreshIcon, XCircleIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";

type HealthItem = { id: string; name: string; folder: string };
type HealthPayload = {
  total: number;
  personalCount: number;
  reused: { count: number; entries: HealthItem[] }[];
  reusedCount: number;
  weak: HealthItem[];
  fair: number;
  strong: number;
  stale: (HealthItem & { changedAt: string })[];
  staleYears: number;
  unknown: number;
};

/** Hygiene report of the vault: which passwords are repeated, weak or old. */
export function VaultHealthView() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/vault/health", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as HealthPayload & { error?: string };
      if (!active) return;
      if (!response.ok) setError(payload.error ?? "No se pudo cargar el estado del gestor.");
      else setHealth(payload);
    })();
    return () => { active = false; };
  }, []);

  const strengthItems = useMemo<DonutItem[]>(() => {
    if (!health) return [];
    return [
      { label: "Fuertes", value: health.strong, color: "#10b981" },
      { label: "Aceptables", value: health.fair, color: "#f59e0b" },
      { label: "Débiles", value: health.weak.length, color: "#ef4444" },
    ];
  }, [health]);

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
  if (!health) return <div className="page-stack" />;

  const reusedShare = health.total ? Math.round((health.reusedCount / health.total) * 100) : 0;
  const weakShare = health.total ? Math.round((health.weak.length / health.total) * 100) : 0;

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Revisión de las credenciales compartidas: cuáles repiten contraseña, cuáles son débiles y cuáles llevan tiempo sin cambiarse. Las personales de cada uno no se revisan.</p></div>
        <div className="panel-heading-trailing">
          <Link className="button button-secondary" href="/contrasenas">Volver al gestor</Link>
        </div>
      </section>

      <section className="kpi-grid">
        <KpiCard label="Credenciales revisadas" value={String(health.total)} delta="Sin comparación" helper={health.personalCount ? `${health.personalCount} personales no se revisan` : "todas las compartidas"} icon={<KeyIcon />} tone="indigo" />
        <KpiCard label="Con contraseña repetida" value={String(health.reusedCount)} delta="Sin comparación" helper={`${reusedShare}% del total · ${health.reused.length} grupos`} icon={<RefreshIcon />} tone={health.reusedCount ? "rose" : "emerald"} />
        <KpiCard label="Contraseñas débiles" value={String(health.weak.length)} delta="Sin comparación" helper={`${weakShare}% del total`} icon={<XCircleIcon />} tone={health.weak.length ? "amber" : "emerald"} />
        <KpiCard label={`Sin cambiar en ${health.staleYears} años`} value={String(health.stale.length)} delta="Sin comparación" helper="desde la última modificación" icon={<ClockIcon />} tone={health.stale.length ? "sky" : "emerald"} />
      </section>

      <section className="vault-health-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Fuerza de las contraseñas</h2><p className="panel-subtitle">Según su longitud y variedad</p></div></div>
          <DonutChart items={strengthItems} centerLabel="credenciales" ariaLabel="Reparto de credenciales por fuerza de la contraseña" emptyMessage="Sin datos todavía." />
        </article>
        <article className="panel">
          <div className="panel-heading"><div><h2>Qué conviene hacer</h2><p className="panel-subtitle">Por dónde empezar</p></div></div>
          <ol className="vault-health-steps">
            <li><strong>Las repetidas primero.</strong> Si una se filtra, caen todas las de su grupo. Empieza por bancos, Microsoft 365, hosting, NAS y VPN.</li>
            <li><strong>Luego las débiles.</strong> Cámbialas con el generador del gestor, que crea contraseñas de 20 caracteres.</li>
            <li><strong>Al cambiar una, edítala aquí también.</strong> Así el gestor queda al día y la fecha de cambio empieza a contar.</li>
          </ol>
          {health.unknown > 0 ? <p className="muted invoice-hint">{health.unknown} credenciales no tienen huella calculada todavía.</p> : null}
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Contraseñas repetidas</h2><p className="panel-subtitle">{health.reused.length} grupos comparten contraseña</p></div>
        </div>
        {health.reused.length === 0 ? (
          <p className="muted"><CheckCircleIcon /> Ninguna contraseña se repite. Bien.</p>
        ) : (
          <div className="table-scroll vault-health-scroll">
            <table>
              <thead><tr><th>Credenciales que comparten contraseña</th><th>Cuántas</th></tr></thead>
              <tbody>
                {health.reused.map((group) => (
                  <tr key={group.entries.map((entry) => entry.id).join("-")}>
                    <td>
                      <div className="vault-health-group">
                        {group.entries.map((entry) => (
                          <span key={entry.id} className="vault-health-chip"><strong>{entry.name}</strong><small>{entry.folder}</small></span>
                        ))}
                      </div>
                    </td>
                    <td className="vault-health-count">{group.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Contraseñas débiles</h2><p className="panel-subtitle">Cortas o poco variadas</p></div>
        </div>
        {health.weak.length === 0 ? (
          <p className="muted"><CheckCircleIcon /> Ninguna contraseña débil.</p>
        ) : (
          <div className="table-scroll vault-health-scroll">
            <table>
              <thead><tr><th>Credencial</th><th>Carpeta</th></tr></thead>
              <tbody>
                {health.weak.map((entry) => (
                  <tr key={entry.id}><td><strong>{entry.name}</strong></td><td className="muted">{entry.folder}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {health.stale.length > 0 ? (
        <section className="panel table-panel">
          <div className="panel-heading">
            <div><h2>Sin cambiar desde hace más de {health.staleYears} años</h2><p className="panel-subtitle">Conviene renovarlas</p></div>
          </div>
          <div className="table-scroll vault-health-scroll">
            <table>
              <thead><tr><th>Credencial</th><th>Carpeta</th><th>Último cambio</th></tr></thead>
              <tbody>
                {health.stale.map((entry) => (
                  <tr key={entry.id}><td><strong>{entry.name}</strong></td><td className="muted">{entry.folder}</td><td>{formatDate(entry.changedAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
