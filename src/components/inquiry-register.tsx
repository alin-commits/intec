"use client";

import { useState } from "react";
import { businessUnits } from "@/lib/demo-data";

type Counter = { web: number; phone: number };

const initialCounters: Record<string, Counter> = Object.fromEntries(
  businessUnits.map((unit, index) => [unit.id, { web: 4 + index * 2, phone: 2 + index }]),
);

export function InquiryRegister() {
  const [counters, setCounters] = useState(initialCounters);
  const [message, setMessage] = useState("Selecciona un canal para registrar una consulta.");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function register(unitId: string, type: keyof Counter) {
    const key = `${unitId}-${type}`;
    if (busyKey) return;
    setBusyKey(key);
    setCounters((current) => ({
      ...current,
      [unitId]: { ...current[unitId], [type]: current[unitId][type] + 1 },
    }));
    const unit = businessUnits.find((item) => item.id === unitId);
    setMessage(`Consulta ${type === "web" ? "web" : "telefónica"} registrada para ${unit?.name}.`);
    window.setTimeout(() => setBusyKey(null), 650);
  }

  return (
    <div className="page-stack">
      <section className="intro-grid">
        <div>
          <span className="eyebrow">Registro rápido</span>
          <h2>Consultas de hoy</h2>
          <p>Cada pulsación crea una consulta individual. La fecha, la hora y el usuario se asignarán automáticamente desde Supabase.</p>
        </div>
        <div className="notice"><strong>Modo demostración</strong><span>{message}</span></div>
      </section>
      <section className="inquiry-grid">
        {businessUnits.map((unit) => {
          const count = counters[unit.id];
          return (
            <article className="panel inquiry-card" key={unit.id}>
              <div className="unit-card-heading">
                <span className="unit-monogram" style={{ background: unit.accent }}>{unit.name.charAt(0)}</span>
                <div><h3>{unit.name}</h3><span>{count.web + count.phone} consultas hoy</span></div>
              </div>
              <div className="channel-counters">
                <div><span>Web</span><strong>{count.web}</strong></div>
                <div><span>Teléfono</span><strong>{count.phone}</strong></div>
              </div>
              <div className="inquiry-actions">
                <button disabled={busyKey === `${unit.id}-web`} onClick={() => register(unit.id, "web")} className="button button-channel button-web">+ Web</button>
                <button disabled={busyKey === `${unit.id}-phone`} onClick={() => register(unit.id, "phone")} className="button button-channel button-phone">+ Teléfono</button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
