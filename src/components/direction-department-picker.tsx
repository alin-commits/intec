"use client";

import type { DirectionDepartment } from "@/lib/direction-view";

const options: { value: DirectionDepartment; label: string; description: string }[] = [
  { value: "commercial", label: "Comercial", description: "Dashboard, consultas y leads, como los ve el equipo comercial." },
  { value: "it", label: "Informática", description: "Resumen y listado de tickets, como los ve informática." },
  { value: "marketing", label: "Marketing", description: "Leads y campañas, como los ve marketing." },
];

export function DirectionDepartmentPicker({ onChoose }: { onChoose: (department: DirectionDepartment) => void }) {
  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Dirección</span><h2>Elige un departamento</h2><p>Verás el mismo panel que ese equipo, en modo solo lectura. Puedes cambiarlo cuando quieras desde el menú.</p></div>
      </section>
      <section className="brand-picker">
        {options.map((option) => (
          <button key={option.value} type="button" className="brand-tile department-tile" onClick={() => onChoose(option.value)}>
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
