import { businessUnits, campaigns } from "@/lib/demo-data";
import { currencyFormatter, formatPercent } from "@/lib/format";

export default function CampaignsPage() {
  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Captación</span><h2>Campañas</h2><p>Analiza los leads, la conversión y el valor conseguido por cada campaña.</p></div>
        <button className="button button-primary">+ Nueva campaña</button>
      </section>
      <section className="panel table-panel">
        <div className="table-scroll"><table>
          <thead><tr><th>Campaña</th><th>Unidad</th><th>Estado</th><th>Leads</th><th>Ganados</th><th>Conversión</th><th>Valor</th></tr></thead>
          <tbody>{campaigns.map((campaign) => {
            const unit = businessUnits.find((item) => item.id === campaign.businessUnitId);
            return <tr key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.id}</small></td><td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name}</span></td><td><span className={campaign.status === "Activa" ? "badge badge-active" : "badge"}>{campaign.status}</span></td><td>{campaign.leads}</td><td>{campaign.won}</td><td>{formatPercent((campaign.won / campaign.leads) * 100)}</td><td>{currencyFormatter.format(campaign.value)}</td></tr>;
          })}</tbody>
        </table></div>
      </section>
    </div>
  );
}
