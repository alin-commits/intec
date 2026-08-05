import { UnitBrandMark } from "@/components/unit-brand-mark";
import { monthKey } from "@/lib/dates";
import { businessUnits, monthlyStats } from "@/lib/demo-data";
import { formatPercent } from "@/lib/format";

export default function UnitsPage() {
  const currentMonth = monthKey();
  return (
    <div className="page-stack">
      <section className="section-heading"><div><span className="eyebrow">Configuración</span><h2>Unidades de negocio</h2><p>Las marcas internas organizan consultas, campañas, leads y estadísticas.</p></div><button className="button button-primary">+ Nueva unidad</button></section>
      <section className="units-grid">
        {businessUnits.map((unit) => {
          const row = monthlyStats.find((item) => item.month === currentMonth && item.businessUnitId === unit.id);
          const conversion = row?.leads ? (row.won / row.leads) * 100 : 0;
          return (
            <article className="panel unit-summary" key={unit.id}>
              <div className="unit-summary-heading">
                <UnitBrandMark unit={unit} size={48} />
                {unit.active ? null : <span className="badge">Inactiva</span>}
              </div>
              <h3>{unit.name}</h3>
              <p>{(row?.web ?? 0) + (row?.phone ?? 0)} consultas · {row?.leads ?? 0} leads · {formatPercent(conversion)} conversión</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
