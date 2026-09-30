"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasAnyRole, LEADS_ROLES, SALES_ROLES } from "@/lib/constants";
import { INVOICE_DATES_FROM, invoiceComparisonAvailable, invoiceYears } from "@/lib/sage-panel";
import {
  buildRepIdentities,
  channelLabel,
  computeSalesModel,
  makeRepOf,
  monthName,
  noFilters,
  periodOf,
  PROVISIONAL_DAYS,
  repPairsFor,
  sameDayPreviousYear,
  seriesFor,
  UNASSIGNED_KEY,
  type Company,
  type Rep,
  type SalesFilters,
  type SalesTarget,
  type SummaryRow,
  type SyncRun,
} from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { SageRefreshButton } from "@/components/sage-refresh-button";
import { chipNote, SalesFilterBar, type ActiveChip } from "./sales-filter-bar";
import { salesPages, type FamilyName, type ListRequest, type SageDetail, type SalesContext, type SalesPageKey } from "./sales-context";
import { SalesListModal } from "./sales-list-modal";
import { SummaryPage } from "./page-summary";
import { SalesMarginPage } from "./page-sales";
import { CommercialPage } from "./page-commercial";
import { ProductsPage } from "./page-products";
import { CustomersPage } from "./page-customers";
import { TargetsPage } from "./page-targets";
import { PageLoader } from "@/components/ui/page-loader";

/*
  El cuadro de mando de ventas, por páginas y con filtros cruzados como en
  Power BI: pulsar un mes, un comercial, un canal, una sociedad o una familia
  filtra todas las páginas, y pulsar una cifra de clientes, ofertas o pedidos
  abre la lista de quién hay detrás.

  Los filtros y la página van en la dirección (?p=clientes&m=2026-08...), así
  que una vista concreta se puede guardar o mandar a alguien.
*/

const noDetail: SageDetail = { customers: false, articles: false, offers: false, orders: false, incidents: false };

/** Lee de la dirección los filtros y la página con los que se entra. */
function readUrl(): { page: SalesPageKey | null; year: number | null; basis: "albaran" | "factura" | null; filters: SalesFilters } {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("p");
  const year = Number(params.get("y"));
  const month = params.get("m");
  const company = params.get("s");
  return {
    page: salesPages.some((item) => item.key === page) ? (page as SalesPageKey) : null,
    year: Number.isInteger(year) && year > 2000 ? year : null,
    basis: params.get("b") === "factura" ? "factura" : null,
    filters: {
      company: company && /^\d+$/.test(company) ? Number(company) : null,
      channel: params.get("c") || null,
      repKey: params.get("r") || null,
      month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
      family: params.get("f") || null,
    },
  };
}

export function SalesDashboard() {
  const [stage, setStage] = useState<"loading" | "denied" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => new Date());
  const [page, setPage] = useState<SalesPageKey>("resumen");
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [basis, setBasis] = useState<"albaran" | "factura">("albaran");
  /** Los filtros tal como se eligieron; los que no existen en el año cargado no se aplican. */
  const [requested, setRequested] = useState<SalesFilters>(noFilters);
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [previousRows, setPreviousRows] = useState<SummaryRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [families, setFamilies] = useState<FamilyName[]>([]);
  const [lastRun, setLastRun] = useState<SyncRun | null>(null);
  const [comparisonIsPartial, setComparisonIsPartial] = useState(false);
  const [comparisonAvailable, setComparisonAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  /** A qué año pertenecen las filas de ahora: mientras llega otro se sigue pintando este. */
  const [dataYear, setDataYear] = useState<number | null>(null);
  /** Sube cuando termina una lectura pedida con el botón: todo el panel se recarga. */
  const [reloadKey, setReloadKey] = useState(0);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [targetsKey, setTargetsKey] = useState(0);
  const [detail, setDetail] = useState<SageDetail>(noDetail);
  const [canSeeLeads, setCanSeeLeads] = useState(false);
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);

  // Quién entra, qué hay en Sage y con qué filtros se llega. Solo una vez.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await loadCurrentProfile();
        if (!active) return;
        if (!profile || !hasAnyRole(profile.roles, SALES_ROLES)) {
          setStage("denied");
          return;
        }
        const supabase = createClient();
        const exists = (table: string) => supabase.from(table).select("company_code").limit(1);
        const [yearRows, companyRows, repRows, runRows, familyRows, customers, articles, offers, orders, incidents] = await Promise.all([
          supabase.rpc("sage_sales_years"),
          supabase.from("sage_companies").select("code, name, is_active").order("code"),
          supabase.from("sage_reps").select("company_code, code, name, is_person"),
          supabase.from("sage_sync_runs").select("started_at, ok, covered_from, covered_to").eq("ok", true).order("started_at", { ascending: false }).limit(1),
          supabase.from("sage_families").select("company_code, code, name"),
          exists("sage_customer_days"),
          exists("sage_article_sales_monthly"),
          exists("sage_offer_documents"),
          exists("sage_order_documents"),
          exists("sage_incidents_daily"),
        ]);
        // supabase-js no lanza cuando Postgres devuelve un error: resuelve con
        // data a null. Sin mirar esto, un fallo del servidor se convertiría en
        // "todavía no han llegado datos de Sage", que es mentira.
        const failure = yearRows.error ?? companyRows.error ?? repRows.error ?? runRows.error;
        if (failure) throw failure;
        if (!active) return;
        const found = (yearRows.data ?? []).map((row: { year: number }) => row.year);
        const fromUrl = readUrl();
        const wantedBasis = fromUrl.basis ?? "albaran";
        const allowed = wantedBasis === "factura" ? invoiceYears(found) : found;
        const wantedYear = fromUrl.year ?? new Date().getFullYear();
        setYears(found);
        setBasis(wantedBasis);
        setYear(allowed.includes(wantedYear) ? wantedYear : allowed[0] ?? wantedYear);
        if (fromUrl.page) setPage(fromUrl.page);
        setRequested(fromUrl.filters);
        setCompanies((companyRows.data ?? []) as Company[]);
        setReps((repRows.data ?? []) as Rep[]);
        setFamilies((familyRows.data ?? []) as FamilyName[]);
        setLastRun(((runRows.data ?? [])[0] as SyncRun) ?? null);
        const has = (result: { data: unknown[] | null; error: unknown }) => !result.error && (result.data ?? []).length > 0;
        setDetail({ customers: has(customers), articles: has(articles), offers: has(offers), orders: has(orders), incidents: has(incidents) });
        setCanSeeLeads(hasAnyRole(profile.roles, LEADS_ROLES));
        setStage("ready");
      } catch (cause) {
        console.error("No se pudo preparar el panel de ventas:", cause);
        if (active) setError("No se pudieron cargar los datos. Comprueba tu conexión y recarga la página.");
      }
    })();
    return () => { active = false; };
  }, []);

  // El año elegido y el anterior, para poder comparar.
  useEffect(() => {
    if (stage !== "ready") return;
    let active = true;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const supabase = createClient();
        // Un año en curso se compara contra el mismo tramo del anterior, no
        // contra el año entero: si no, en septiembre siempre parecería que se
        // ha vendido un 30 % menos.
        const now = new Date();
        const partial = year === now.getFullYear();
        // Por fecha de factura no hay nada antes del 16/10/2025: comparar 2026
        // con 2025 sería comparar contra casi nada.
        const comparable = basis === "albaran" || invoiceComparisonAvailable(year);
        const [current, before, runRows] = await Promise.all([
          supabase.rpc("sage_sales_summary", { p_from: `${year}-01-01`, p_to: `${year}-12-31`, p_basis: basis }),
          comparable
            ? supabase.rpc("sage_sales_summary", {
                p_from: `${year - 1}-01-01`,
                p_to: partial ? sameDayPreviousYear(year, now) : `${year - 1}-12-31`,
                p_basis: basis,
              })
            : Promise.resolve({ data: [], error: null }),
          supabase.from("sage_sync_runs").select("started_at, ok, covered_from, covered_to").eq("ok", true).order("started_at", { ascending: false }).limit(1),
        ]);
        const failure = current.error ?? before.error;
        if (failure) throw failure;
        if (!active) return;
        if (!runRows.error) setLastRun(((runRows.data ?? [])[0] as SyncRun) ?? null);
        setComparisonIsPartial(partial);
        setComparisonAvailable(comparable);
        setRows((current.data ?? []) as SummaryRow[]);
        setPreviousRows((before.data ?? []) as SummaryRow[]);
        setDataYear(year);
        setBusy(false);
      } catch (cause) {
        console.error("No se pudieron cargar las ventas:", cause);
        if (!active) return;
        setError("No se pudieron cargar las ventas de ese periodo.");
        setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [stage, year, basis, reloadKey]);

  // Los objetivos del año, que no están en Sage sino en el Hub.
  useEffect(() => {
    if (stage !== "ready") return;
    let active = true;
    void (async () => {
      const { data, error: failure } = await createClient()
        .from("sales_targets")
        .select("id, year, month, company_code, rep_key, amount")
        .eq("year", year);
      if (!active) return;
      if (failure) {
        console.error("No se pudieron cargar los objetivos:", failure);
        return;
      }
      setTargets((data ?? []) as SalesTarget[]);
    })();
    return () => { active = false; };
  }, [stage, year, targetsKey]);

  // La vista va en la dirección: al recargar o al mandar el enlace se ve lo mismo.
  useEffect(() => {
    if (stage !== "ready") return;
    const params = new URLSearchParams();
    if (page !== "resumen") params.set("p", page);
    if (year !== today.getFullYear()) params.set("y", String(year));
    if (basis === "factura") params.set("b", "factura");
    if (requested.month) params.set("m", requested.month);
    if (requested.company !== null) params.set("s", String(requested.company));
    if (requested.channel) params.set("c", requested.channel);
    if (requested.repKey) params.set("r", requested.repKey);
    if (requested.family) params.set("f", requested.family);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [stage, page, year, basis, requested, today]);

  const identities = useMemo(() => buildRepIdentities(reps), [reps]);
  const repOf = useMemo(() => makeRepOf(reps, identities), [reps, identities]);
  /** El año de las filas que hay cargadas, que mientras carga no es el elegido. */
  const shownYear = dataYear ?? year;

  /**
   * Un canal o un comercial elegido en un año puede no existir en otro: las
   * series nuevas no existen antes de octubre de 2025. Si el filtro se quedara
   * puesto, el panel enseñaría un cero rotundo para un año que sí tuvo ventas.
   * Así que un filtro que no existe en lo cargado no se aplica (pero se queda
   * dicho, en gris, para que al volver a un año donde sí existe no reaparezca
   * sin que nadie entienda por qué).
   */
  const available = useMemo(() => ({
    channels: new Set(rows.map((row) => channelLabel(row.series))),
    reps: new Set(rows.map((row) => repOf(row.company_code, row.rep_code).key)),
  }), [rows, repOf]);
  const missing = {
    channel: requested.channel !== null && !available.channels.has(requested.channel),
    repKey: requested.repKey !== null && !available.reps.has(requested.repKey),
    month: requested.month !== null && !requested.month.startsWith(`${shownYear}-`),
  };
  const filters = useMemo<SalesFilters>(() => ({
    company: requested.company,
    channel: missing.channel ? null : requested.channel,
    repKey: missing.repKey ? null : requested.repKey,
    month: missing.month ? null : requested.month,
    family: requested.family,
  }), [requested, missing.channel, missing.repKey, missing.month]);

  const model = useMemo(
    () => computeSalesModel({ rows, previousRows, filters, shownYear, companies, repOf, comparisonIsPartial, today }),
    [rows, previousRows, filters, shownYear, companies, repOf, comparisonIsPartial, today],
  );
  const period = useMemo(() => periodOf(shownYear, filters.month, today), [shownYear, filters.month, today]);

  const allSeries = useMemo(
    () => [...new Set([...rows, ...previousRows].map((row) => row.series))],
    [rows, previousRows],
  );
  const rpc = useMemo(() => ({
    p_company: filters.company,
    p_reps: repPairsFor(filters.repKey, reps, identities, companies.map((company) => company.code)),
    p_series: seriesFor(filters.channel, allSeries),
    p_family: filters.family,
  }), [filters, reps, identities, companies, allSeries]);

  const repLabels = useMemo(() => {
    const map = new Map<string, string>([[UNASSIGNED_KEY, "Sin comercial asignado"]]);
    for (const identity of identities.values()) map.set(identity.key, identity.label);
    return map;
  }, [identities]);
  const repName = useCallback((key: string) => repLabels.get(key) ?? key, [repLabels]);

  const familyNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const family of families) if (!map.has(family.code)) map.set(family.code, family.name);
    return map;
  }, [families]);
  const familyName = useCallback(
    (code: string) => familyNames.get(code) ?? (code ? `Familia ${code}` : "Sin familia"),
    [familyNames],
  );

  const setFilters = useCallback((patch: Partial<SalesFilters>) => setRequested((current) => ({ ...current, ...patch })), []);
  const toggle = useCallback(<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) => {
    setRequested((current) => ({ ...current, [key]: current[key] === value ? null : value }));
  }, []);

  function changeYear(next: number) {
    setYear(next);
    // El mes elegido se lleva al año nuevo; si ese mes aún no ha llegado, se quita.
    setRequested((current) => {
      if (!current.month) return current;
      const month = `${next}-${current.month.slice(5, 7)}`;
      const future = next > today.getFullYear() || (next === today.getFullYear() && Number(month.slice(5, 7)) > today.getMonth() + 1);
      return { ...current, month: future ? null : month };
    });
  }
  function changeBasis(next: "albaran" | "factura") {
    setBasis(next);
    // Un año sin fechas de factura se quedaría en blanco: se salta al último que sí las tiene.
    const allowed = next === "factura" ? invoiceYears(years) : years;
    if (allowed.length > 0 && !allowed.includes(year)) changeYear(allowed[0]);
  }

  const companyLabel = filters.company === null
    ? "todas las sociedades"
    : companies.find((item) => item.code === filters.company)?.name ?? `Sociedad ${filters.company}`;
  const comparisonHelper = !comparisonAvailable
    ? `${shownYear - 1} no tiene fecha de factura`
    : filters.month
      ? `frente a ${monthName(filters.month)} de ${shownYear - 1}${period.partial ? " (mismos días)" : ""}`
      : comparisonIsPartial ? `frente al mismo tramo de ${shownYear - 1}` : `frente a ${shownYear - 1}`;

  const context: SalesContext = {
    year,
    shownYear,
    basis,
    filters,
    setFilters,
    toggle,
    companies,
    reps,
    families,
    familyName,
    repOf,
    repName,
    rows,
    previousRows,
    model,
    period,
    rpc,
    companyLabel,
    comparisonHelper,
    comparisonAvailable,
    comparisonIsPartial,
    reloadKey,
    today,
    targets,
    reloadTargets: () => setTargetsKey((key) => key + 1),
    detail,
    openList: setListRequest,
    goTo: setPage,
    canSeeLeads,
  };

  if (stage === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes acceso a esta página</h2>
          <p>Las ventas de Sage solo las ven dirección y administración.</p>
        </section>
      </div>
    );
  }
  if (error && dataYear === null) {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No se pudo cargar</h2>
          <p>{error}</p>
        </section>
      </div>
    );
  }
  if (stage === "loading") return <PageLoader label="Cargando las ventas de Sage…" />;
  if (years.length === 0) {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>Todavía no han llegado datos de Sage</h2>
          <p className="muted">El programa que lee Sage aún no ha enviado nada. En cuanto lo haga, esta página se llena sola.</p>
        </section>
      </div>
    );
  }

  const pageInfo = salesPages.find((item) => item.key === page) ?? salesPages[0];
  const yearOptions = basis === "factura" ? invoiceYears(years) : years;
  const lastMonthIndex = shownYear === today.getFullYear() ? today.getMonth() : 11;
  const monthOptions = Array.from({ length: lastMonthIndex + 1 }, (_, index) => `${shownYear}-${String(index + 1).padStart(2, "0")}`);
  const familyOptions = [...familyNames].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  const repOptions = model.byRep
    .map((rep) => ({ value: rep.key, label: rep.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

  const chips: ActiveChip[] = [];
  if (requested.month) {
    chips.push({ key: "month", label: `Mes: ${monthName(requested.month)} ${requested.month.slice(0, 4)}`, note: chipNote("month", pageInfo.applies, missing.month, shownYear) });
  }
  if (requested.company !== null) chips.push({ key: "company", label: companyLabel, note: chipNote("company", pageInfo.applies, false, shownYear) });
  if (requested.channel) chips.push({ key: "channel", label: `Canal: ${requested.channel}`, note: chipNote("channel", pageInfo.applies, missing.channel, shownYear) });
  if (requested.repKey) chips.push({ key: "repKey", label: `Comercial: ${repName(requested.repKey)}`, note: chipNote("rep", pageInfo.applies, missing.repKey, shownYear) });
  if (requested.family) chips.push({ key: "family", label: `Familia: ${familyName(requested.family)}`, note: chipNote("family", pageInfo.applies, false, shownYear) });

  const invoiceStart = new Date(`${INVOICE_DATES_FROM}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="page-stack sales-dashboard">
      <section className="section-heading">
        <div>
          <p>
            Ventas, margen, clientes y actividad comercial según Sage, {basis === "albaran" ? "por fecha de albarán" : "por fecha de factura"}, en {companyLabel}.
            Pulsa cualquier gráfico o cifra para filtrar o ver el detalle.
          </p>
        </div>
        <div className="panel-heading-trailing">
          <SageRefreshButton onUpdated={() => setReloadKey((key) => key + 1)} />
        </div>
      </section>

      <div className="view-tabs sales-tabs" role="tablist" aria-label="Páginas del cuadro de mando de ventas">
        {salesPages.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={page === item.key}
            className={page === item.key ? "view-tab active" : "view-tab"}
            onClick={() => setPage(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <SalesFilterBar
        year={year}
        yearOptions={yearOptions}
        onYear={changeYear}
        basis={basis}
        onBasis={changeBasis}
        requested={requested}
        monthOptions={monthOptions}
        companyOptions={companies.filter((company) => company.is_active || company.code === requested.company).map((company) => ({ value: String(company.code), label: company.name }))}
        channelOptions={[...model.byChannel.real].sort((a, b) => a.localeCompare(b, "es"))}
        repOptions={repOptions}
        familyOptions={familyOptions}
        onChange={setFilters}
        chips={chips}
        onClearAll={() => setRequested(noFilters)}
      />

      {error ? (
        <section className="panel sales-broken">
          <div>
            <strong>{error}</strong>
            <span>Lo que se ve abajo es de {shownYear}, que es lo último que sí llegó. Vuelve a elegir el año para intentarlo otra vez.</span>
          </div>
        </section>
      ) : null}

      {busy ? <p className="sales-busy" role="status">Actualizando…</p> : null}

      {basis === "factura" ? (
        <section className="panel notice">
          <strong>Estás viendo la venta por fecha de factura.</strong>
          <span>
            Lo servido y todavía sin facturar no aparece aquí, así que el mes en curso siempre parece más pequeño de
            lo que es. Para saber cuánto se ha vendido, mira por fecha de albarán.
            {" "}Además, por fecha de factura solo hay datos desde el {invoiceStart}, cuando se cambiaron las series en
            Sage: antes los albaranes no guardaban la fecha de factura.
            {comparisonAvailable ? "" : ` Por eso aquí no se compara con ${shownYear - 1}.`}
          </span>
        </section>
      ) : null}

      <div role="tabpanel" aria-label={pageInfo.label} className="sales-page">
        {page === "resumen" ? <SummaryPage ctx={context} /> : null}
        {page === "ventas" ? <SalesMarginPage ctx={context} /> : null}
        {page === "comercial" ? <CommercialPage ctx={context} /> : null}
        {page === "productos" ? <ProductsPage ctx={context} /> : null}
        {page === "clientes" ? <CustomersPage ctx={context} /> : null}
        {page === "objetivos" ? <TargetsPage ctx={context} /> : null}
      </div>

      <section className="panel sales-footnote">
        <p className="muted">
          {lastRun
            ? `Última lectura de Sage: ${new Date(lastRun.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}.`
            : "Todavía no consta ninguna lectura de Sage."}
          {shownYear === today.getFullYear() ? ` Los últimos ${PROVISIONAL_DAYS} días son provisionales: se siguen corrigiendo albaranes y facturando, así que esas cifras aún se mueven.` : ""}
          {" "}Si un número no cuadra con Sage, manda Sage.
        </p>
      </section>

      <SalesListModal request={listRequest} ctx={context} onClose={() => setListRequest(null)} />
    </div>
  );
}
