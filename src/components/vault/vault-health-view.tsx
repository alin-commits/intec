"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { CheckCircleIcon, ClockIcon, KeyIcon, RefreshIcon, XCircleIcon } from "@/components/icons";
import { VaultTabs } from "@/components/vault/vault-tabs";
import { formatDate } from "@/lib/format";
import { DEFAULT_GENERATOR, generatePassword, passwordStrength } from "@/lib/vault/password-generator";

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
  const [reloadTick, setReloadTick] = useState(0);
  /** Credential being fixed: the new password is only in memory until it is saved. */
  const [fixing, setFixing] = useState<{ entry: HealthItem; password: string; changedOutside: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

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
  }, [reloadTick]);

  function startFix(entry: HealthItem) {
    setFixing({ entry, password: generatePassword(DEFAULT_GENERATOR), changedOutside: false });
  }

  async function saveNewPassword() {
    if (!fixing) return;
    setBusy(true);
    const response = await fetch(`/api/vault/entries/${fixing.entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: fixing.password }),
    });
    setBusy(false);
    setConfirming(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(payload.error ?? "No se pudo guardar la nueva contraseña.");
      return;
    }
    setMessage(`Contraseña de «${fixing.entry.name}» actualizada en el gestor.`);
    setFixing(null);
    reload();
  }

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
      </section>

      <VaultTabs />

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
            <li>
              <span className="vault-step-number">1</span>
              <div><strong>Las repetidas primero</strong><p>Si una se filtra, caen todas las de su grupo. Empieza por bancos, Microsoft 365, hosting, NAS y VPN.</p></div>
            </li>
            <li>
              <span className="vault-step-number">2</span>
              <div><strong>Luego las débiles</strong><p>Usa el botón «Cambiar» de cada una: genera una contraseña de 20 caracteres.</p></div>
            </li>
            <li>
              <span className="vault-step-number">3</span>
              <div><strong>Cámbiala antes en el servicio</strong><p>El gestor solo guarda la contraseña. Primero cámbiala en la web o la aplicación, y luego guárdala aquí.</p></div>
            </li>
          </ol>
          {health.unknown > 0 ? <p className="muted invoice-hint">{health.unknown} credenciales no tienen huella calculada todavía.</p> : null}
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Contraseñas repetidas</h2>
            <p className="panel-subtitle">{health.reusedCount} credenciales repiten contraseña, en {health.reused.length} grupos · abre un grupo para ver cuáles son</p>
          </div>
        </div>
        {health.reused.length === 0 ? (
          <p className="muted"><CheckCircleIcon /> Ninguna contraseña se repite. Bien.</p>
        ) : (
          <div className="vault-reused">
            {health.reused.map((group, index) => (
              <details key={group.entries.map((entry) => entry.id).join("-")} className="vault-reused-group" open={index === 0}>
                <summary>
                  <span className="vault-reused-count">{group.count}</span>
                  <span className="vault-reused-title">
                    <strong>{group.count} credenciales usan la misma contraseña</strong>
                    <small>{group.entries.map((entry) => entry.name).join(" · ")}</small>
                  </span>
                </summary>
                <ul className="vault-reused-items">
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <Link href={`/contrasenas?entry=${entry.id}`} className="vault-reused-name" title={`Abrir ${entry.name}`}>{entry.name}</Link>
                      <span className="vault-reused-folder">{entry.folder}</span>
                      <button type="button" className="button button-compact button-secondary" onClick={() => startFix(entry)}>Cambiar</button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Contraseñas débiles</h2><p className="panel-subtitle">Cortas o poco variadas · pulsa una para abrirla</p></div>
        </div>
        {health.weak.length === 0 ? (
          <p className="muted"><CheckCircleIcon /> Ninguna contraseña débil.</p>
        ) : (
          <div className="table-scroll vault-health-scroll">
            <table>
              <thead><tr><th>Credencial</th><th>Carpeta</th><th>Acciones</th></tr></thead>
              <tbody>
                {health.weak.map((entry) => (
                  <tr key={entry.id} className="vault-health-row">
                    <td><Link href={`/contrasenas?entry=${entry.id}`} className="vault-health-link">{entry.name}</Link></td>
                    <td className="muted vault-health-folder">{entry.folder}</td>
                    <td><button type="button" className="button button-compact button-secondary" onClick={() => startFix(entry)}>Cambiar contraseña</button></td>
                  </tr>
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
              <thead><tr><th>Credencial</th><th>Carpeta</th><th>Último cambio</th><th>Acciones</th></tr></thead>
              <tbody>
                {health.stale.map((entry) => (
                  <tr key={entry.id} className="vault-health-row">
                    <td><Link href={`/contrasenas?entry=${entry.id}`} className="vault-health-link">{entry.name}</Link></td>
                    <td className="muted vault-health-folder">{entry.folder}</td>
                    <td>{formatDate(entry.changedAt)}</td>
                    <td><button type="button" className="button button-compact button-secondary" onClick={() => startFix(entry)}>Cambiar contraseña</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <Toast message={message} onDismiss={() => setMessage(null)} />

      <Modal open={Boolean(fixing)} title="Poner una contraseña nueva" eyebrow={fixing?.entry.name ?? ""} onClose={() => setFixing(null)}>
        {fixing ? (
          <div className="vault-fix">
            <div className="notice">
              <strong>Ojo: esto solo cambia lo que hay guardado aquí.</strong>
              <span>Primero cámbiala en el sitio o servicio ({fixing.entry.folder}). Cuando allí funcione la nueva, guárdala en el gestor.</span>
            </div>

            <label className="vault-fix-field">
              <span>Contraseña nueva</span>
              <input value={fixing.password} onChange={(event) => setFixing({ ...fixing, password: event.target.value })} spellCheck={false} autoComplete="new-password" />
            </label>
            <div className="vault-fix-actions">
              <span className={`vault-strength vault-strength-${passwordStrength(fixing.password).level}`}>{passwordStrength(fixing.password).label}</span>
              <button type="button" className="button button-compact button-secondary" onClick={() => setFixing({ ...fixing, password: generatePassword(DEFAULT_GENERATOR) })}>Generar otra</button>
              <button type="button" className="button button-compact button-secondary" onClick={() => void navigator.clipboard.writeText(fixing.password).then(() => setMessage("Contraseña nueva copiada."), () => setMessage("Tu navegador no ha permitido copiar."))}>Copiar</button>
            </div>

            <label className="announcement-email">
              <input type="checkbox" checked={fixing.changedOutside} onChange={(event) => setFixing({ ...fixing, changedOutside: event.target.checked })} />
              Ya he cambiado esta contraseña en el servicio y la nueva funciona
            </label>

            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setFixing(null)}>Cancelar</button>
              <button type="button" className="button button-primary" disabled={!fixing.changedOutside || fixing.password.length < 8} onClick={() => setConfirming(true)}>Guardar en el gestor</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmationDialog
        open={confirming}
        title="¿Guardar la contraseña nueva?"
        confirmLabel="Sí, guardar"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void saveNewPassword()}
      >
        {fixing ? (
          <div className="confirmation-summary">
            <span>Credencial</span><strong>{fixing.entry.name}</strong>
            <span>Carpeta</span><strong>{fixing.entry.folder}</strong>
            <span>Efecto</span><strong>La contraseña guardada se sustituye por la nueva. La anterior no se podrá recuperar.</strong>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
