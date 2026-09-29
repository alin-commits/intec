"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { DateField } from "@/components/ui/date-field";
import { Modal } from "@/components/ui/modal";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";
import { EuroIcon, LeadsIcon, ConversionIcon, HeartIcon, UsuariosIcon } from "@/components/icons";
import { downloadCsvReport, type CsvSummaryItem } from "@/lib/csv-export";
import { currencyFormatter, numberFormatter, formatPercent } from "@/lib/format";
import { generatePdfReport } from "@/lib/pdf-report";
import { createClient } from "@/lib/supabase/client";
import type { BusinessUnit } from "@/lib/types";

/**
 * Meta Ads: lo que trae la API y lo que Meta no puede saber.
 *
 * El gasto, las impresiones, los clics y los leads vienen de la propia API, una
 * fila por campaña y día. Los ingresos no: aquí se vende por WhatsApp y por
 * teléfono, Meta no ve esas ventas y devuelve 0 € donde de verdad hubo 2.604.
 * Eso, los leads cualificados y los seguidores ganados se escriben a mano, pero
 * colgados de la campaña de Meta, no en una tabla paralela con el gasto
 * repetido. Así el gasto sale de un sitio y nadie lo suma dos veces.
 */

type Cuenta = { account_id: string; name: string; business_unit_id: string | null; is_active: boolean };
type Campana = { meta_id: string; account_id: string; name: string; status: string | null; objective: string | null };
type Dia = { meta_campaign_id: string; day: string; spend: number; impressions: number; clicks: number; leads: number };
type Extra = { meta_campaign_id: string; revenue: number; qualified_leads: number; followers_gained: number; notes: string | null };
type Suelta = { id: string; campaign_name: string; revenue: number; qualified_leads: number; followers_gained: number; notes: string | null };

type Fila = {
  id: string;
  nombre: string;
  marca: string;
  estado: string;
  gasto: number;
  impresiones: number;
  clics: number;
  leads: number;
  cualificados: number;
  seguidores: number;
  ingresos: number;
};

const hoy = () => new Date().toISOString().slice(0, 10);
const haceDias = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiquetaMes = (mes: string) => `${meses[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`;
const estadoLegible: Record<string, string> = { ACTIVE: "Activa", PAUSED: "Pausada", ARCHIVED: "Archivada", DELETED: "Borrada", IN_PROCESS: "En proceso", WITH_ISSUES: "Con avisos" };

const vacio = { revenue: 0, qualified_leads: 0, followers_gained: 0, notes: null as string | null };

export function MetaAdsSyncedPanel({ units, canEdit }: { units: BusinessUnit[]; canEdit: boolean }) {
  const [desde, setDesde] = useState(() => haceDias(90));
  const [hasta, setHasta] = useState(hoy);
  const [marca, setMarca] = useState("all");
  const [campana, setCampana] = useState("all");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [dias, setDias] = useState<Dia[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [sueltas, setSueltas] = useState<Suelta[]>([]);
  const [ultima, setUltima] = useState<{ started_at: string } | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "vacio" | "error">("cargando");
  const [editando, setEditando] = useState<Fila | null>(null);
  const [borrador, setBorrador] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [asignando, setAsignando] = useState<Record<string, string>>({});
  const [pdfBusy, setPdfBusy] = useState(false);
  /** False mientras la migración de lo escrito a mano no se haya ejecutado. */
  const [manualDisponible, setManualDisponible] = useState(true);

  async function cargar() {
    const supabase = createClient();
    const [cuentasRes, campanasRes, diasRes, extrasRes, sueltasRes, runRes] = await Promise.all([
      supabase.from("meta_ad_accounts").select("account_id, name, business_unit_id, is_active"),
      supabase.from("meta_campaigns").select("meta_id, account_id, name, status, objective"),
      supabase.from("meta_insights_daily").select("meta_campaign_id, day, spend, impressions, clicks, leads")
        .gte("day", desde).lte("day", hasta).order("day"),
      supabase.from("meta_campaign_extras").select("meta_campaign_id, revenue, qualified_leads, followers_gained, notes"),
      // Lo que quedó escrito a mano y todavía no está colgado de ninguna campaña.
      supabase.from("meta_ads_entries").select("id, campaign_name, revenue, qualified_leads, followers_gained, notes"),
      supabase.from("meta_sync_runs").select("started_at").order("started_at", { ascending: false }).limit(1),
    ]);
    // Lo que Meta da es lo que sostiene la pestaña; si falla, no hay nada que
    // enseñar. Lo escrito a mano, en cambio, puede no estar todavía —entre que
    // se despliega el código y se ejecuta la migración pasan minutos— y no debe
    // tumbar la pestaña entera por eso.
    const fallo = cuentasRes.error ?? campanasRes.error ?? diasRes.error ?? runRes.error;
    if (fallo) throw fallo;
    if (extrasRes.error) console.warn("Todavía no se puede leer lo escrito a mano:", extrasRes.error.message);
    if (sueltasRes.error) console.warn("No se pudieron leer las entradas antiguas:", sueltasRes.error.message);
    setCuentas((cuentasRes.data ?? []) as Cuenta[]);
    setCampanas((campanasRes.data ?? []) as Campana[]);
    setDias((diasRes.data ?? []) as Dia[]);
    setExtras((extrasRes.data ?? []) as Extra[]);
    setSueltas((sueltasRes.data ?? []) as Suelta[]);
    setManualDisponible(!extrasRes.error);
    setUltima(((runRes.data ?? [])[0] as { started_at: string }) ?? null);
    setEstado((cuentasRes.data ?? []).length === 0 ? "vacio" : "listo");
  }

  useEffect(() => {
    let activo = true;
    void (async () => {
      try {
        await cargar();
      } catch (causa) {
        console.error("No se pudieron cargar los datos de Meta:", causa);
        if (activo) setEstado("error");
      }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargar depende solo del rango
  }, [desde, hasta]);

  const marcaDe = useMemo(() => {
    const porCuenta = new Map(cuentas.map((c) => [c.account_id, c.business_unit_id]));
    return new Map(campanas.map((c) => [c.meta_id, porCuenta.get(c.account_id) ?? null]));
  }, [cuentas, campanas]);
  const extraDe = useMemo(() => new Map(extras.map((e) => [e.meta_campaign_id, e])), [extras]);

  const visibles = useMemo(() => dias.filter((d) => {
    if (marca !== "all" && marcaDe.get(d.meta_campaign_id) !== marca) return false;
    if (campana !== "all" && d.meta_campaign_id !== campana) return false;
    return true;
  }), [dias, marca, campana, marcaDe]);

  const campanasElegibles = useMemo(() => {
    const conDatos = new Set(dias
      .filter((d) => marca === "all" || marcaDe.get(d.meta_campaign_id) === marca)
      .map((d) => d.meta_campaign_id));
    return campanas.filter((c) => conDatos.has(c.meta_id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [campanas, dias, marca, marcaDe]);

  /** Una fila por campaña, con lo de la API y lo escrito a mano ya junto. */
  const filas = useMemo<Fila[]>(() => {
    const mapa = new Map<string, { gasto: number; impresiones: number; clics: number; leads: number }>();
    for (const d of visibles) {
      const v = mapa.get(d.meta_campaign_id) ?? { gasto: 0, impresiones: 0, clics: 0, leads: 0 };
      v.gasto += Number(d.spend); v.impresiones += Number(d.impressions);
      v.clics += Number(d.clicks); v.leads += Number(d.leads);
      mapa.set(d.meta_campaign_id, v);
    }
    return [...mapa].map(([id, v]) => {
      const ficha = campanas.find((c) => c.meta_id === id);
      const extra = extraDe.get(id);
      return {
        id,
        nombre: ficha?.name ?? id,
        marca: units.find((u) => u.id === marcaDe.get(id))?.name ?? "—",
        estado: estadoLegible[ficha?.status ?? ""] ?? ficha?.status ?? "—",
        ...v,
        cualificados: Number(extra?.qualified_leads ?? 0),
        seguidores: Number(extra?.followers_gained ?? 0),
        ingresos: Number(extra?.revenue ?? 0),
      };
    }).sort((a, b) => b.gasto - a.gasto);
  }, [visibles, campanas, extraDe, marcaDe, units]);

  const totales = useMemo(() => filas.reduce((a, f) => ({
    gasto: a.gasto + f.gasto, impresiones: a.impresiones + f.impresiones, clics: a.clics + f.clics,
    leads: a.leads + f.leads, cualificados: a.cualificados + f.cualificados,
    seguidores: a.seguidores + f.seguidores, ingresos: a.ingresos + f.ingresos,
  }), { gasto: 0, impresiones: 0, clics: 0, leads: 0, cualificados: 0, seguidores: 0, ingresos: 0 }), [filas]);

  const evolucion = useMemo(() => {
    const porMes = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000 > 70;
    const mapa = new Map<string, { gasto: number; leads: number }>();
    for (const d of visibles) {
      const clave = porMes ? d.day.slice(0, 7) : d.day;
      const v = mapa.get(clave) ?? { gasto: 0, leads: 0 };
      v.gasto += Number(d.spend); v.leads += Number(d.leads);
      mapa.set(clave, v);
    }
    return [...mapa].sort(([a], [b]) => a.localeCompare(b)).map(([clave, v]) => ({
      label: porMes ? etiquetaMes(clave) : clave.slice(8),
      gasto: Math.round(v.gasto * 100) / 100,
      leads: v.leads,
    }));
  }, [visibles, desde, hasta]);

  const porMarca = (campo: "gasto" | "ingresos") => units
    .map((unit) => ({ label: unit.name, value: filas.filter((f) => f.marca === unit.name).reduce((s, f) => s + f[campo], 0), color: unit.accent }))
    .filter((r) => r.value > 0);

  /** Lo de la tabla vieja que aún no está colgado de ninguna campaña. */
  const pendientes = useMemo(() => {
    const yaPuestas = new Set(extras.map((e) => e.meta_campaign_id));
    const nombresPuestos = new Set(campanas.filter((c) => yaPuestas.has(c.meta_id)).map((c) => c.name.trim().toLowerCase()));
    return sueltas.filter((s) =>
      (Number(s.revenue) > 0 || Number(s.qualified_leads) > 0 || Number(s.followers_gained) > 0)
      && !nombresPuestos.has((s.campaign_name ?? "").trim().toLowerCase()));
  }, [sueltas, extras, campanas]);

  function abrirEdicion(fila: Fila) {
    const extra = extraDe.get(fila.id);
    setBorrador({
      revenue: Number(extra?.revenue ?? 0),
      qualified_leads: Number(extra?.qualified_leads ?? 0),
      followers_gained: Number(extra?.followers_gained ?? 0),
      notes: extra?.notes ?? null,
    });
    setEditando(fila);
    setAviso(null);
  }

  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("meta_campaign_extras").upsert({
        meta_campaign_id: editando.id,
        revenue: borrador.revenue,
        qualified_leads: borrador.qualified_leads,
        followers_gained: borrador.followers_gained,
        notes: borrador.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "meta_campaign_id" });
      if (error) throw error;
      await cargar();
      setEditando(null);
    } catch (causa) {
      console.error("No se pudo guardar:", causa);
      setAviso("No se pudo guardar. Revisa tu conexión y prueba otra vez.");
    } finally {
      setGuardando(false);
    }
  }

  /** Cuelga una entrada vieja de la campaña de Meta que le corresponda. */
  async function asignar(suelta: Suelta) {
    const destino = asignando[suelta.id];
    if (!destino) return;
    setGuardando(true);
    try {
      const supabase = createClient();
      const previo = extraDe.get(destino);
      const { error } = await supabase.from("meta_campaign_extras").upsert({
        meta_campaign_id: destino,
        // Se suma a lo que ya hubiera: dos entradas viejas pueden ir a la misma.
        revenue: Number(previo?.revenue ?? 0) + Number(suelta.revenue ?? 0),
        qualified_leads: Number(previo?.qualified_leads ?? 0) + Number(suelta.qualified_leads ?? 0),
        followers_gained: Number(previo?.followers_gained ?? 0) + Number(suelta.followers_gained ?? 0),
        notes: [previo?.notes, suelta.notes].filter(Boolean).join("\n") || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "meta_campaign_id" });
      if (error) throw error;
      await cargar();
      setAsignando((actual) => ({ ...actual, [suelta.id]: "" }));
    } catch (causa) {
      console.error("No se pudo asignar:", causa);
      setAviso("No se pudo asignar esa entrada.");
    } finally {
      setGuardando(false);
    }
  }

  const cpl = totales.leads > 0 ? totales.gasto / totales.leads : 0;
  const roas = totales.gasto > 0 ? totales.ingresos / totales.gasto : 0;
  const ctr = totales.impresiones > 0 ? (totales.clics / totales.impresiones) * 100 : 0;
  const periodo = `${desde} a ${hasta}`;

  function exportarCsv() {
    const resumen: CsvSummaryItem[] = [
      { label: `Gasto total (${periodo})`, value: totales.gasto.toFixed(2) },
      { label: "Ingresos", value: totales.ingresos.toFixed(2) },
      { label: "Leads", value: totales.leads },
      { label: "Leads cualificados", value: totales.cualificados },
      { label: "Seguidores ganados", value: totales.seguidores },
      { label: "Impresiones", value: totales.impresiones },
      { label: "Clics", value: totales.clics },
      { label: "CPL medio (€)", value: cpl.toFixed(2) },
      { label: "ROAS medio", value: roas.toFixed(2) },
    ];
    downloadCsvReport(`meta_ads_${desde}_${hasta}.csv`, resumen, filas, [
      { header: "Marca", value: (f) => f.marca },
      { header: "Campaña", value: (f) => f.nombre },
      { header: "Estado", value: (f) => f.estado },
      { header: "Gasto (€)", value: (f) => f.gasto.toFixed(2) },
      { header: "Impresiones", value: (f) => f.impresiones },
      { header: "Clics", value: (f) => f.clics },
      { header: "Leads", value: (f) => f.leads },
      { header: "Cualificados", value: (f) => f.cualificados },
      { header: "Seguidores ganados", value: (f) => f.seguidores },
      { header: "Ingresos (€)", value: (f) => f.ingresos.toFixed(2) },
      { header: "Coste por lead (€)", value: (f) => (f.leads > 0 ? (f.gasto / f.leads).toFixed(2) : "") },
    ]);
  }

  async function exportarPdf() {
    setPdfBusy(true);
    try {
      await generatePdfReport<Fila>({
        title: "Meta Ads",
        subtitle: `Periodo: ${periodo}  ·  ${filas.length} campaña${filas.length === 1 ? "" : "s"}  ·  datos de la API de Meta`,
        stats: [
          { label: "Gasto", value: currencyFormatter.format(totales.gasto) },
          { label: "Ingresos", value: currencyFormatter.format(totales.ingresos) },
          { label: "Leads", value: numberFormatter.format(totales.leads) },
          { label: "CPL medio", value: currencyFormatter.format(cpl) },
          { label: "ROAS medio", value: `${roas.toFixed(2)}x` },
        ],
        sectionTitle: "Campañas",
        columns: [
          { header: "Marca", value: (f) => f.marca, width: 22 },
          { header: "Campaña", value: (f) => f.nombre, width: 46 },
          { header: "Gasto", value: (f) => currencyFormatter.format(f.gasto), align: "right" },
          { header: "Leads", value: (f) => String(f.leads), align: "right" },
          { header: "Ingresos", value: (f) => currencyFormatter.format(f.ingresos), align: "right" },
        ],
        rows: filas,
        filename: `meta_ads_${desde}_${hasta}.pdf`,
      });
    } catch (causa) {
      console.error("No se pudo generar el PDF:", causa);
      setAviso("No se pudo generar el PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

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
        <p className="muted">En cuanto la sincronización con Meta se ejecute por primera vez, aquí aparecerá todo.</p>
      </section>
    );
  }

  const marcasConCuenta = units.filter((u) => cuentas.some((c) => c.business_unit_id === u.id && c.is_active));

  return (
    <section className="meta-synced">
      <div className="panel-heading">
        <div>
          <h3>Meta Ads</h3>
          <p className="panel-subtitle">
            Gasto, impresiones, clics y leads vienen de la API, un día por fila. Los ingresos, los cualificados y los
            seguidores se escriben a mano, porque Meta no los sabe.
            {ultima ? ` Última sincronización: ${new Date(ultima.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}.` : ""}
          </p>
        </div>
        <ReportExportButtons onExportCsv={exportarCsv} onExportPdf={() => void exportarPdf()} pdfBusy={pdfBusy} />
      </div>

      {aviso ? <p className="export-range-summary is-warning">{aviso}</p> : null}
      {!manualDisponible ? (
        <p className="export-range-summary is-warning">
          Falta ejecutar la migración de los datos escritos a mano. Mientras tanto se ve todo lo que viene de Meta,
          pero los ingresos, los cualificados y los seguidores salen a cero y no se pueden editar.
        </p>
      ) : null}

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
        <KpiCard label="Gasto total" value={currencyFormatter.format(totales.gasto)} helper="según Meta" icon={<EuroIcon />} tone="indigo" delta="" />
        <KpiCard label="Ingresos" value={currencyFormatter.format(totales.ingresos)} helper="escritos a mano" icon={<EuroIcon />} tone="emerald" delta="" />
        <KpiCard label="Leads" value={numberFormatter.format(totales.leads)} helper={totales.cualificados > 0 ? `${numberFormatter.format(totales.cualificados)} cualificados` : "sin cualificar todavía"} icon={<LeadsIcon />} tone="sky" delta="" />
        <KpiCard label="Seguidores ganados" value={numberFormatter.format(totales.seguidores)} helper="escritos a mano" icon={<HeartIcon />} tone="rose" delta="" />
        <KpiCard label="CPL medio" value={totales.leads > 0 ? currencyFormatter.format(cpl) : "—"} helper="coste por lead" icon={<ConversionIcon />} tone="amber" delta="" />
        <KpiCard label="ROAS medio" value={totales.gasto > 0 ? `${roas.toFixed(2)}x` : "—"} helper="ingreso por euro gastado" icon={<UsuariosIcon />} tone="emerald" delta="" />
      </div>

      <div className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h3>Gasto por marca</h3><p className="panel-subtitle">En el periodo elegido</p></div></div>
          <BarChart items={porMarca("gasto")} ariaLabel="Gasto de Meta Ads por marca" valueFormatter={(v) => currencyFormatter.format(v)} />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h3>Ingresos por marca</h3><p className="panel-subtitle">De lo escrito a mano</p></div></div>
          <BarChart items={porMarca("ingresos")} ariaLabel="Ingresos de Meta Ads por marca" valueFormatter={(v) => currencyFormatter.format(v)} />
        </article>
      </div>

      {evolucion.length > 1 ? (
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h3>Evolución</h3><p className="panel-subtitle">Gasto y leads</p></div></div>
          <TrendChart
            data={evolucion}
            series={[{ key: "gasto", label: "Gasto (€)", color: "#4f46e5" }, { key: "leads", label: "Leads", color: "#10b981" }]}
            ariaLabel="Evolución del gasto y los leads de Meta Ads"
          />
        </article>
      ) : null}

      <article className="panel table-panel">
        <div className="panel-heading">
          <div><h3>Campañas</h3><p className="panel-subtitle">{filas.length} con datos en el periodo · {formatPercent(ctr)} de clics</p></div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaña</th><th>Marca</th><th>Estado</th><th>Gasto</th><th>Impresiones</th><th>Clics</th>
                <th>Leads</th><th>Cualif.</th><th>Seguidores</th><th>Ingresos</th><th>CPL</th>
                {canEdit ? <th aria-label="Acciones" /> : null}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.nombre}</strong></td>
                  <td>{f.marca}</td>
                  <td>{f.estado}</td>
                  <td>{currencyFormatter.format(f.gasto)}</td>
                  <td>{numberFormatter.format(f.impresiones)}</td>
                  <td>{numberFormatter.format(f.clics)}</td>
                  <td>{numberFormatter.format(f.leads)}</td>
                  <td>{f.cualificados > 0 ? numberFormatter.format(f.cualificados) : <span className="muted">—</span>}</td>
                  <td>{f.seguidores > 0 ? numberFormatter.format(f.seguidores) : <span className="muted">—</span>}</td>
                  <td>{f.ingresos > 0 ? currencyFormatter.format(f.ingresos) : <span className="muted">—</span>}</td>
                  <td>{f.leads > 0 ? currencyFormatter.format(f.gasto / f.leads) : <span className="muted">—</span>}</td>
                  {canEdit ? (
                    <td>
                      {manualDisponible ? (
                        <button type="button" className="button button-compact button-secondary" onClick={() => abrirEdicion(f)}>Completar</button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
              {filas.length === 0 ? (
                <tr><td colSpan={canEdit ? 12 : 11} className="muted">No hay gasto en este periodo con los filtros puestos.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {canEdit && manualDisponible && pendientes.length > 0 ? (
        <article className="panel meta-pendientes">
          <div className="panel-heading">
            <div>
              <h3>Quedan {pendientes.length} entradas antiguas por colocar</h3>
              <p className="panel-subtitle">
                Traen ingresos, cualificados o seguidores que Meta no sabe, pero su nombre no coincide con ninguna
                campaña. Elige a cuál va cada una y se suma. Lo que no coloques no se pierde: sigue guardado.
              </p>
            </div>
          </div>
          <ul className="meta-pendientes-list">
            {pendientes.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.campaign_name}</strong>
                  <span className="muted">
                    {[
                      Number(s.revenue) > 0 ? `${currencyFormatter.format(Number(s.revenue))} de ingresos` : null,
                      Number(s.qualified_leads) > 0 ? `${s.qualified_leads} cualificados` : null,
                      Number(s.followers_gained) > 0 ? `${s.followers_gained} seguidores` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <select value={asignando[s.id] ?? ""} onChange={(event) => setAsignando((a) => ({ ...a, [s.id]: event.target.value }))}>
                  <option value="">Elegir campaña…</option>
                  {[...campanas].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                    <option key={c.meta_id} value={c.meta_id}>{c.name}</option>
                  ))}
                </select>
                <button type="button" className="button button-compact" disabled={!asignando[s.id] || guardando} onClick={() => void asignar(s)}>
                  Colocar
                </button>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <Modal
        open={editando !== null}
        eyebrow="Meta Ads"
        title={editando?.nombre ?? ""}
        onClose={() => setEditando(null)}
      >
        <p className="muted export-range-intro">
          El gasto, las impresiones y los leads vienen de Meta y no se tocan. Aquí va lo que Meta no puede saber.
        </p>
        <div className="form-grid">
          <label>
            <span>Ingresos (€)</span>
            <input type="number" min={0} step="0.01" value={borrador.revenue}
              onChange={(event) => setBorrador((b) => ({ ...b, revenue: Number(event.target.value) || 0 }))} />
          </label>
          <label>
            <span>Leads cualificados</span>
            <input type="number" min={0} step="1" value={borrador.qualified_leads}
              onChange={(event) => setBorrador((b) => ({ ...b, qualified_leads: Number(event.target.value) || 0 }))} />
          </label>
          <label>
            <span>Seguidores ganados</span>
            <input type="number" min={0} step="1" value={borrador.followers_gained}
              onChange={(event) => setBorrador((b) => ({ ...b, followers_gained: Number(event.target.value) || 0 }))} />
          </label>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 14 }}>
          <label>
            <span>Notas</span>
            <textarea rows={3} value={borrador.notes ?? ""}
              onChange={(event) => setBorrador((b) => ({ ...b, notes: event.target.value }))} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={() => setEditando(null)}>Cancelar</button>
          <button type="button" className="button" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </Modal>
    </section>
  );
}
