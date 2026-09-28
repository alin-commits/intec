"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DateField } from "@/components/ui/date-field";
import { EuroIcon, EyeIcon, LeadsIcon, ConversionIcon } from "@/components/icons";
import { currencyFormatter, numberFormatter, formatPercent } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { BusinessUnit } from "@/lib/types";

/**
 * Lo que Meta manda cada mañana, filtrable por marca, campaña y fechas.
 *
 * Es aparte de la tabla de abajo, que son las entradas que se metían a mano.
 * Aquí hay una fila por campaña y día, así que cualquier rango de fechas se
 * calcula sumando, sin volver a pedirle nada a Meta.
 */

type Cuenta = { account_id: string; name: string; business_unit_id: string | null; is_active: boolean };
type Campana = { meta_id: string; account_id: string; name: string; status: string | null };
type Dia = {
  meta_campaign_id: string;
  day: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
};
type Ejecucion = { started_at: string; ok: boolean };

const hoy = () => new Date().toISOString().slice(0, 10);
const haceDias = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiquetaMes = (mes: string) => `${meses[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`;

export function MetaAdsSyncedPanel({ units }: { units: BusinessUnit[] }) {
  const [desde, setDesde] = useState(() => haceDias(90));
  const [hasta, setHasta] = useState(hoy);
  const [marca, setMarca] = useState("all");
  const [campana, setCampana] = useState("all");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [dias, setDias] = useState<Dia[]>([]);
  const [ultima, setUltima] = useState<Ejecucion | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "vacio" | "error">("cargando");

  useEffect(() => {
    let activo = true;
    void (async () => {
      try {
        const supabase = createClient();
        const [cuentasRes, campanasRes, diasRes, ejecucionRes] = await Promise.all([
          supabase.from("meta_ad_accounts").select("account_id, name, business_unit_id, is_active"),
          supabase.from("meta_campaigns").select("meta_id, account_id, name, status"),
          // Solo el tramo pedido: el histórico entero crece sin parar y no hace
          // falta traérselo al navegador para enseñar tres meses.
          supabase.from("meta_insights_daily")
            .select("meta_campaign_id, day, spend, impressions, clicks, leads")
            .gte("day", desde).lte("day", hasta).order("day"),
          supabase.from("meta_sync_runs").select("started_at, ok").order("started_at", { ascending: false }).limit(1),
        ]);
        const fallo = cuentasRes.error ?? campanasRes.error ?? diasRes.error ?? ejecucionRes.error;
        if (fallo) throw fallo;
        if (!activo) return;
        setCuentas((cuentasRes.data ?? []) as Cuenta[]);
        setCampanas((campanasRes.data ?? []) as Campana[]);
        setDias((diasRes.data ?? []) as Dia[]);
        setUltima(((ejecucionRes.data ?? [])[0] as Ejecucion) ?? null);
        setEstado((cuentasRes.data ?? []).length === 0 ? "vacio" : "listo");
      } catch (causa) {
        console.error("No se pudieron cargar los datos de Meta:", causa);
        if (activo) setEstado("error");
      }
    })();
    return () => { activo = false; };
  }, [desde, hasta]);

  /** De qué marca es cada campaña, a través de su cuenta publicitaria. */
  const marcaDe = useMemo(() => {
    const porCuenta = new Map(cuentas.map((c) => [c.account_id, c.business_unit_id]));
    return new Map(campanas.map((c) => [c.meta_id, porCuenta.get(c.account_id) ?? null]));
  }, [cuentas, campanas]);

  const nombreDe = useMemo(() => new Map(campanas.map((c) => [c.meta_id, c.name])), [campanas]);

  const visibles = useMemo(() => dias.filter((d) => {
    if (marca !== "all" && marcaDe.get(d.meta_campaign_id) !== marca) return false;
    if (campana !== "all" && d.meta_campaign_id !== campana) return false;
    return true;
  }), [dias, marca, campana, marcaDe]);

  /** Las campañas que se pueden elegir: las de la marca puesta, y con datos. */
  const campanasElegibles = useMemo(() => {
    const conDatos = new Set(dias
      .filter((d) => marca === "all" || marcaDe.get(d.meta_campaign_id) === marca)
      .map((d) => d.meta_campaign_id));
    return campanas
      .filter((c) => conDatos.has(c.meta_id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [campanas, dias, marca, marcaDe]);

  const totales = useMemo(() => visibles.reduce((acc, d) => ({
    gasto: acc.gasto + Number(d.spend),
    impresiones: acc.impresiones + Number(d.impressions),
    clics: acc.clics + Number(d.clicks),
    leads: acc.leads + Number(d.leads),
  }), { gasto: 0, impresiones: 0, clics: 0, leads: 0 }), [visibles]);

  /** Por mes cuando el rango es largo, por día cuando es corto. */
  const evolucion = useMemo(() => {
    const porMes = hasta > desde && (new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000 > 70;
    const mapa = new Map<string, { gasto: number; leads: number }>();
    for (const d of visibles) {
      const clave = porMes ? d.day.slice(0, 7) : d.day;
      const v = mapa.get(clave) ?? { gasto: 0, leads: 0 };
      v.gasto += Number(d.spend);
      v.leads += Number(d.leads);
      mapa.set(clave, v);
    }
    return [...mapa].sort(([a], [b]) => a.localeCompare(b)).map(([clave, v]) => ({
      label: porMes ? etiquetaMes(clave) : clave.slice(8),
      gasto: Math.round(v.gasto * 100) / 100,
      leads: v.leads,
    }));
  }, [visibles, desde, hasta]);

  const porCampana = useMemo(() => {
    const mapa = new Map<string, { gasto: number; impresiones: number; clics: number; leads: number }>();
    for (const d of visibles) {
      const v = mapa.get(d.meta_campaign_id) ?? { gasto: 0, impresiones: 0, clics: 0, leads: 0 };
      v.gasto += Number(d.spend);
      v.impresiones += Number(d.impressions);
      v.clics += Number(d.clicks);
      v.leads += Number(d.leads);
      mapa.set(d.meta_campaign_id, v);
    }
    return [...mapa]
      .map(([id, v]) => ({
        id,
        nombre: nombreDe.get(id) ?? id,
        marca: units.find((u) => u.id === marcaDe.get(id))?.name ?? "—",
        ...v,
      }))
      .sort((a, b) => b.gasto - a.gasto);
  }, [visibles, nombreDe, marcaDe, units]);

  if (estado === "error") {
    return (
      <section className="panel">
        <h3>No se pudieron cargar los datos de Meta</h3>
        <p className="muted">Recarga la página. Si sigue igual, revisa que la sincronización esté corriendo.</p>
      </section>
    );
  }
  if (estado === "vacio") {
    return (
      <section className="panel">
        <h3>Todavía no hay nada sincronizado</h3>
        <p className="muted">
          En cuanto la sincronización con Meta se ejecute por primera vez, aquí aparecerá el gasto de cada campaña
          día a día, y se podrá filtrar por marca, campaña y fechas.
        </p>
      </section>
    );
  }

  const cpl = totales.leads > 0 ? totales.gasto / totales.leads : 0;
  const ctr = totales.impresiones > 0 ? (totales.clics / totales.impresiones) * 100 : 0;
  const marcasConCuenta = units.filter((u) => cuentas.some((c) => c.business_unit_id === u.id && c.is_active));

  return (
    <section className="meta-synced">
      <div className="panel-heading">
        <div>
          <h3>Meta Ads, directo de la API</h3>
          <p className="panel-subtitle">
            Una fila por campaña y día. Filtra por marca, campaña y fechas.
            {ultima ? ` Última sincronización: ${new Date(ultima.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}.` : ""}
          </p>
        </div>
      </div>

      <div className="filter-bar meta-synced-filters">
        <label>
          <span>Marca</span>
          <select value={marca} onChange={(event) => { setMarca(event.target.value); setCampana("all"); }}>
            <option value="all">Todas las marcas</option>
            {marcasConCuenta.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
        <label>
          <span>Campaña</span>
          <select value={campana} onChange={(event) => setCampana(event.target.value)}>
            <option value="all">Todas las campañas</option>
            {campanasElegibles.map((c) => <option key={c.meta_id} value={c.meta_id}>{c.name}</option>)}
          </select>
        </label>
        <label><span>Desde</span><DateField value={desde} max={hasta} onChange={(value) => setDesde(value || haceDias(90))} /></label>
        <label><span>Hasta</span><DateField value={hasta} min={desde} onChange={(value) => setHasta(value || hoy())} /></label>
      </div>

      <div className="kpi-grid kpi-grid-main">
        <KpiCard label="Gasto" value={currencyFormatter.format(totales.gasto)} helper="en el periodo elegido" icon={<EuroIcon />} tone="indigo" delta="" />
        <KpiCard label="Leads" value={numberFormatter.format(totales.leads)} helper={totales.leads > 0 ? `${currencyFormatter.format(cpl)} por lead` : "sin leads en el periodo"} icon={<LeadsIcon />} tone="emerald" delta="" />
        <KpiCard label="Impresiones" value={numberFormatter.format(totales.impresiones)} helper={`${formatPercent(ctr)} de clics`} icon={<EyeIcon />} tone="sky" delta="" />
        <KpiCard label="Clics" value={numberFormatter.format(totales.clics)} helper="en el enlace" icon={<ConversionIcon />} tone="amber" delta="" />
      </div>

      {evolucion.length > 1 ? (
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><h3>Evolución</h3><p className="panel-subtitle">Gasto y leads</p></div>
          </div>
          <TrendChart
            data={evolucion}
            series={[
              { key: "gasto", label: "Gasto (€)", color: "#4f46e5" },
              { key: "leads", label: "Leads", color: "#10b981" },
            ]}
            ariaLabel="Evolución del gasto y los leads de Meta Ads"
          />
        </article>
      ) : null}

      <article className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h3>Por campaña</h3>
            <p className="panel-subtitle">{porCampana.length} campañas con datos en el periodo</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Campaña</th><th>Marca</th><th>Gasto</th><th>Impresiones</th><th>Clics</th><th>Leads</th><th>Coste por lead</th></tr>
            </thead>
            <tbody>
              {porCampana.map((fila) => (
                <tr key={fila.id}>
                  <td><strong>{fila.nombre}</strong></td>
                  <td>{fila.marca}</td>
                  <td>{currencyFormatter.format(fila.gasto)}</td>
                  <td>{numberFormatter.format(fila.impresiones)}</td>
                  <td>{numberFormatter.format(fila.clics)}</td>
                  <td>{numberFormatter.format(fila.leads)}</td>
                  <td>{fila.leads > 0 ? currencyFormatter.format(fila.gasto / fila.leads) : <span className="muted">—</span>}</td>
                </tr>
              ))}
              {porCampana.length === 0 ? (
                <tr><td colSpan={7} className="muted">No hay gasto en este periodo con los filtros puestos.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
