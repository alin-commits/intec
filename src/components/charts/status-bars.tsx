"use client";

const statusData = [
  { label: "Nuevo", value: 12 },
  { label: "Intento", value: 9 },
  { label: "Contactado", value: 18 },
  { label: "Oferta enviada", value: 11 },
  { label: "Interesado", value: 8 },
  { label: "Ganado", value: 6 },
  { label: "Perdido", value: 5 },
];

export function StatusBars() {
  const max = Math.max(...statusData.map((item) => item.value));
  return (
    <div className="status-bars">
      {statusData.map((item) => (
        <div className="status-row" key={item.label}>
          <span>{item.label}</span>
          <div className="status-track">
            <div className="status-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
