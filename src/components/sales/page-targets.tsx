"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { TrophyIcon, EuroIcon, CalendarIcon } from "@/components/icons";
import { formatPercent } from "@/lib/format";
import { euros, filterRows, groupRows, monthLongNames, monthNames, soloUnComercial, soloUnMes, soloUno, type SummaryRow, targetsFor, targetToDate } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { writeRows } from "@/lib/supabase/write";
import type { SalesContext } from "./sales-context";
import { Panel, useSageQuery } from "./sales-ui";
import { repartirElAno, repartirTrimestre, sumaDe, TRIMESTRES, variacionSobreAnterior } from "@/lib/sales-targets";

/*
  Objetivos: el presupuesto de ventas, que no está en Sage y se pone aquí, y
  cómo se va contra él.

  Se pone por sociedad, una a una, y el del grupo es lo que suman: así marcar
  Jender arriba compara contra el objetivo de Jender y no contra el total, que
  es la única manera de que el cumplimiento de una sociedad quiera decir algo.
  Hacia abajo no se reparte solo: el objetivo de un comercial se pone a mano,
  aparte del de su sociedad y sin sustituirlo, y la página enseña si lo
  repartido entre ellos cuadra con el de la sociedad. Por eso para escribir
  hace falta una sociedad —y, si es el de alguien, un comercial de ella—.
*/

const parseAmount = (text: string): number | null => {
  const clean = text.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (clean === "") return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
};
const formatInput = (value: number | null) => (value === null ? "" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value));

export function TargetsPage({ ctx }: { ctx: SalesContext }) {
  // Los objetivos se ponen mes a mes dentro de un año: con otro periodo no hay año que enseñar.
  if (ctx.period.year === null) return <TargetsNeedYear ctx={ctx} />;
  return <TargetsOfYear ctx={ctx} shownYear={ctx.period.year} />;
}

function TargetsNeedYear({ ctx }: { ctx: SalesContext }) {
  const year = ctx.today.getFullYear();
  return (
    <section className="panel panel-padded sales-need-year">
      <h2>Los objetivos son por año</h2>
      <p className="muted">
        Se ponen mes a mes dentro de un año natural, y ahora estás mirando {ctx.period.baseLabel}. Elige un año en
        «Periodo» para ver cómo se va contra su objetivo o para ponerlo.
      </p>
      <button type="button" className="button button-primary" onClick={() => ctx.choosePeriod({ kind: "year", year })}>Ver {year}</button>
    </section>
  );
}

function TargetsOfYear({ ctx, shownYear }: { ctx: SalesContext; shownYear: number }) {
  const { filters, today, reps, repOf } = ctx;
  const months = targetsFor(ctx.targets, shownYear, filters.companies, filters.repKeys);
  const scopeKey = JSON.stringify([shownYear, filters.companies, filters.repKeys, ctx.targets]);
  // Los objetivos se guardan de uno en uno: un importe repartido entre varios
  // comerciales habría que decidir cómo se parte, y eso lo dice Dirección.
  const repKey = soloUnComercial(filters);
  const company = soloUno(filters.companies);
  /*
    Y siempre con una sociedad marcada.

    Sin ninguna, lo que se ve es la suma de las sociedades: escribir ahí
    guardaría un objetivo del grupo aparte que dejaría de leerse en cuanto
    alguien ponga el de una sociedad, y nadie entendería por qué la cifra que
    acaba de escribir no aparece en ningún sitio.
  */
  const editable = company !== null && filters.repKeys.length <= 1;
  const [draft, setDraft] = useState<string[]>(() => months.map(formatInput));
  const [draftKey, setDraftKey] = useState(scopeKey);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /*
    Los comerciales entre los que elegir.

    Salen de las fichas de Sage y no de la venta del periodo, que es de donde
    los saca el filtro de arriba: el presupuesto de un año se hace cuando ese
    año no tiene ni una venta, y de la venta no saldría nadie. Solo personas:
    los códigos comodín de Sage («GENERAL», «SAT INTEC») facturan de verdad,
    pero a un comodín no se le pone objetivo.
  */
  const comerciales = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const rep of reps) {
      if (!rep.is_person) continue;
      if (company !== null && rep.company_code !== company) continue;
      const quien = repOf(rep.company_code, rep.code);
      if (!vistos.has(quien.key)) vistos.set(quien.key, quien.label);
    }
    return [...vistos].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [reps, repOf, company]);

  const [yearTotal, setYearTotal] = useState("");
  const [growth, setGrowth] = useState("5");
  const [quarters, setQuarters] = useState<string[]>(["", "", "", ""]);
  // Otro ámbito u objetivos recién guardados: el formulario vuelve a lo que hay.
  if (draftKey !== scopeKey) {
    setDraftKey(scopeKey);
    setDraft(months.map(formatInput));
  }

  /*
    La venta del año anterior, mes a mes.

    Se trae al entrar y no solo al pulsar «Calcular», porque de ella salen
    otras tres cosas: la temporalidad con la que se reparte un total, la de
    cada trimestre, y el porcentaje que dice si lo presupuestado sube o baja
    respecto a lo que de verdad se vendió. Se pide el año entero: lo cargado
    en el panel llega hasta hoy y un presupuesto se hace contra el año
    completo.
  */
  const anteriorQuery = useSageQuery<{ year: number; rows: SummaryRow[] }>(
    JSON.stringify(["objetivos-anterior", shownYear, ctx.reloadKey]),
    async () => {
      const { data, error } = await createClient().rpc("sage_sales_summary", {
        p_from: `${shownYear - 1}-01-01`, p_to: `${shownYear - 1}-12-31`, p_basis: "albaran",
      });
      // El año viaja con las filas: sin él no hay forma de saber si lo que hay
      // en la mano es de este año o del que se miraba hace dos segundos.
      return { data: error ? null : { year: shownYear - 1, rows: (data ?? []) as SummaryRow[] }, error };
    },
  );
  /*
    La venta del año anterior, o null mientras no se sepa.

    Null de verdad, no doce ceros: al cambiar de año la consulta sigue
    enseñando lo del año que se miraba antes hasta que llega la nueva, y
    buscar en esas filas los meses del año nuevo no encuentra ninguno. Eso
    daba doce ceros, y con doce ceros «Calcular» vaciaba las doce casillas sin
    error ninguno — un «Guardar» después borraba los objetivos del año entero.
  */
  const anterior = useMemo(() => {
    const traido = anteriorQuery.data;
    if (!traido || traido.year !== shownYear - 1) return null;
    const porMes = groupRows(filterRows(traido.rows, filters, ctx.repOf, ["channel", "month"]), (row) => row.month);
    return Array.from({ length: 12 }, (_, index) => porMes.get(`${shownYear - 1}-${String(index + 1).padStart(2, "0")}`)?.net ?? 0);
  }, [anteriorQuery.data, filters, ctx.repOf, shownYear]);

  // La venta real del ámbito, mes a mes (sin canal ni mes: el objetivo es del mes entero).
  const realRows = filterRows(ctx.rows, filters, ctx.repOf, ["channel", "month"]);
  const realByMonth = groupRows(realRows, (row) => row.month);
  const real = Array.from({ length: 12 }, (_, index) => realByMonth.get(`${shownYear}-${String(index + 1).padStart(2, "0")}`)?.net ?? 0);
  const unMes = soloUnMes(filters);
  const monthIndex = unMes ? Number(unMes.slice(5, 7)) - 1 : null;
  const soFar = targetToDate(months, shownYear, today, monthIndex);
  const realSoFar = soFar ? soFar.months.reduce((sum, key) => sum + (realByMonth.get(key)?.net ?? 0), 0) : 0;
  const yearTarget = months.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const yearReal = real.reduce((sum, value) => sum + value, 0);
  const hasTargets = months.some((value) => value !== null);
  /*
    Hasta qué mes hay venta que enseñar. En un año que no ha empezado, ninguno:
    con 11 la línea de ventas se dibujaba a cero los doce meses, como si se
    hubiera presupuestado un año en el que no se vende nada.
  */
  const lastMonthIndex = shownYear > today.getFullYear() ? -1 : shownYear === today.getFullYear() ? today.getMonth() : 11;

  const upTo = (list: (number | null)[], index: number) => list.slice(0, index + 1).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const points = months.map((_, index) => ({
    label: monthNames[index],
    objetivo: Math.round(upTo(months, index)),
    // Null y no cero en los meses que aún no han pasado: con cero, la línea de
    // acumulado se cae al suelo en diciembre como si se hubiera dejado de
    // vender, cuando lo que pasa es que todavía no ha llegado.
    ventas: index <= lastMonthIndex ? Math.round(upTo(real, index)) : null,
  }));

  /*
    Lo que suman los doce meses escritos ahora mismo —no lo guardado— y cómo
    queda contra lo que se vendió el año pasado. Es la cifra que se mira al
    presupuestar: doce casillas sueltas no dicen si el año cuadra.
  */
  const totalDelAno = sumaDe(draft.map(parseAmount).map((value) => (value === null || Number.isNaN(value) ? null : value)));
  const totalAnterior = anterior ? sumaDe(anterior) : 0;
  const variacionDelAno = anterior && totalDelAno > 0 ? variacionSobreAnterior(totalDelAno, totalAnterior) : null;

  /*
    Lo que hay repartido entre los comerciales de esta sociedad.

    El objetivo de un comercial no sustituye al de su sociedad: se guarda
    aparte. Si sustituyera, poner el de tres de dieciséis haría que la
    sociedad pasara a valer lo que suman esos tres, y nadie entendería por qué
    su objetivo se ha desplomado. Pero entonces hace falta ver si el reparto
    está completo, que es lo que no se ve mirando una pantalla por comercial.
  */
  const repartido = company === null ? null : ctx.targets
    .filter((target) => target.year === shownYear && target.company_code === company && target.rep_key !== null)
    .reduce((suma, target) => suma + Number(target.amount), 0);

  const scopeLabel = [
    filters.companies.length === 0 ? "Todo el grupo" : ctx.companyLabel,
    filters.repKeys.length === 0 ? null
      : filters.repKeys.length === 1 ? ctx.repName(filters.repKeys[0])
        : `${filters.repKeys.length} comerciales`,
  ].filter(Boolean).join(" · ");

  async function save() {
    const parsed = draft.map(parseAmount);
    if (parsed.some((value) => Number.isNaN(value))) {
      setMessage({ tone: "error", text: "Hay algún importe que no es un número. Escribe solo cifras, por ejemplo 250.000." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const supabase = createClient();
    const existing = ctx.targets.filter((target) => target.year === shownYear && target.company_code === company && target.rep_key === repKey);
    const byMonth = new Map(existing.map((target) => [target.month, target]));
    const errors: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const value = parsed[index];
      const current = byMonth.get(index + 1);
      if (value === null) {
        if (current) {
          try {
            await writeRows(supabase.from("sales_targets").delete().eq("id", current.id), "No se pudo quitar el objetivo.");
          } catch { errors.push(monthLongNames[index]); }
        }
        continue;
      }
      if (current && Number(current.amount) === value) continue;
      try {
        if (current) {
          await writeRows(supabase.from("sales_targets").update({ amount: value }).eq("id", current.id), "No se pudo guardar el objetivo.");
        } else {
          const { error } = await supabase.from("sales_targets").insert({ year: shownYear, month: index + 1, company_code: company, rep_key: repKey, amount: value });
          if (error) throw error;
        }
      } catch { errors.push(monthLongNames[index]); }
    }
    setSaving(false);
    /*
      Si algo falló, no se recarga.

      Recargar repinta el formulario con lo que hay guardado, y lo que hay
      guardado en los meses que fallaron es justo lo de antes: se perdía lo
      que la persona acababa de escribir mientras el mensaje le decía «vuelve
      a intentarlo», sin nada que reintentar. Con lo escrito delante, darle a
      Guardar otra vez sí hace algo.
    */
    if (errors.length > 0) {
      setMessage({ tone: "error", text: `No se pudo guardar ${errors.join(", ")}. Lo escrito sigue aquí: vuelve a darle a Guardar.` });
      return;
    }
    ctx.reloadTargets();
    setMessage({ tone: "ok", text: "Objetivos guardados." });
  }

  function spread() {
    /*
      Reparte un total anual entre los doce meses con la forma que tuvo la
      venta del año pasado. A doceavas solo cuando no hay año pasado del que
      copiar: agosto no vende como marzo, y un presupuesto plano obliga a
      corregir a mano justo los meses que más se desvían.
    */
    const value = parseAmount(yearTotal);
    if (value === null || Number.isNaN(value)) {
      setMessage({ tone: "error", text: "Escribe el objetivo del año entero, por ejemplo 3.000.000." });
      return;
    }
    if (!anterior) {
      // Se reparte igual, pero que nadie crea que lleva la temporalidad del
      // año pasado cuando lo que ha pasado es que no se ha podido leer.
      setMessage({ tone: "error", text: anteriorQuery.loading
        ? `Todavía se está leyendo la venta de ${shownYear - 1}: espera un momento y vuelve a darle.`
        : `No se ha podido leer la venta de ${shownYear - 1}, así que esto reparte a partes iguales.` });
      if (anteriorQuery.loading) return;
    } else {
      setMessage(null);
    }
    setDraft(repartirElAno(value, anterior).map(formatInput));
  }

  /** El objetivo escrito para cada trimestre, repartido en sus tres meses. */
  function spreadQuarters() {
    const escritos = quarters.map(parseAmount);
    if (escritos.some((value) => Number.isNaN(value))) {
      setMessage({ tone: "error", text: "Hay algún trimestre que no es un número. Escribe solo cifras, por ejemplo 800.000." });
      return;
    }
    if (escritos.every((value) => value === null)) {
      setMessage({ tone: "error", text: "Escribe el objetivo de algún trimestre, por ejemplo 800.000 en T1." });
      return;
    }
    setMessage(null);
    let meses = draft.map(parseAmount).map((value) => (value === null || Number.isNaN(value) ? null : value));
    escritos.forEach((importe, trimestre) => {
      if (importe === null) return;
      meses = repartirTrimestre({ meses, trimestre, importe, anterior });
    });
    setDraft(meses.map(formatInput));
  }

  function fromLastYear() {
    // El mismo mes del año anterior más un porcentaje, que es como se suele
    // presupuestar.
    const percent = Number(growth.replace(",", "."));
    if (!Number.isFinite(percent)) {
      setMessage({ tone: "error", text: "El crecimiento tiene que ser un número, por ejemplo 5 o -2." });
      return;
    }
    if (!anterior) {
      setMessage({ tone: "error", text: anteriorQuery.loading ? `Todavía se está leyendo la venta de ${shownYear - 1}.` : `No se pudo leer la venta de ${shownYear - 1}.` });
      return;
    }
    setMessage(null);
    setDraft(anterior.map((value) => (value > 0 ? formatInput(Math.round(value * (1 + percent / 100))) : "")));
    setQuarters(["", "", "", ""]);
  }

  return (
    <div className="page-stack">
      <section className="kpi-grid kpi-grid-sales">
        <KpiCard
          label={monthIndex !== null ? `Cumplimiento de ${monthLongNames[monthIndex]}` : "Cumplimiento a hoy"}
          value={soFar ? formatPercent((realSoFar / Math.max(soFar.target, 1)) * 100) : hasTargets ? "—" : "Sin objetivo"}
          helper={soFar
            ? `${euros(realSoFar)} de ${euros(soFar.target)}`
            // Con objetivo puesto en un año que no ha empezado, decir «sin
            // objetivo» era mentira: lo que pasa es que no hay nada vendido.
            : hasTargets ? `${euros(yearTarget)} para un año que no ha empezado` : "escribe el objetivo abajo"}
          icon={<TrophyIcon />}
          tone={soFar ? (realSoFar >= soFar.target ? "emerald" : "rose") : "amber"}
          {...(soFar ? { delta: `${realSoFar >= soFar.target ? "+" : "-"}${euros(Math.abs(realSoFar - soFar.target))}`, positive: realSoFar >= soFar.target } : { delta: "Sin comparación", positive: true })}
        />
        <KpiCard label={`Objetivo ${shownYear}`} value={hasTargets ? euros(yearTarget) : "—"} helper={scopeLabel} delta="Sin comparación" icon={<CalendarIcon />} tone="indigo" />
        <KpiCard
          label="Falta para el año"
          value={hasTargets ? euros(Math.max(yearTarget - yearReal, 0)) : "—"}
          helper={hasTargets ? `vendido ${euros(yearReal)} (${formatPercent((yearReal / Math.max(yearTarget, 1)) * 100)})` : "sin objetivo"}
          delta="Sin comparación"
          icon={<EuroIcon />}
          tone="sky"
        />
      </section>

      <section className="sales-board">
        <Panel
          title={`Ventas contra objetivo, acumulado ${shownYear}`}
          subtitle={`${scopeLabel}. Pulsa un mes para filtrar`}
          className="panel chart-panel sales-board-wide"
        >
          <TrendChart
            data={points}
            series={[
              { key: "objetivo", label: "Objetivo", color: "#f59e0b" },
              { key: "ventas", label: "Ventas", color: "#4f46e5" },
            ]}
            ariaLabel={`Ventas acumuladas contra objetivo en ${shownYear}`}
            total={false}
            onSelect={(index) => index <= lastMonthIndex && ctx.toggleMonth(`${shownYear}-${String(index + 1).padStart(2, "0")}`)}
            selectedIndex={monthIndex}
          />
        </Panel>

        <Panel
          title="Objetivo por mes"
          subtitle={editable
            ? `De: ${scopeLabel}`
            : filters.companies.length === 0
              ? `${scopeLabel}: lo que suman las sociedades. Elige una abajo para poner el suyo`
              : `De: ${scopeLabel}. Esto es la suma; para cambiar un objetivo, deja un comercial solo`}
          className="panel panel-padded sales-board-narrow"
        >
          {/* La sociedad y el comercial, aquí mismo: son el ámbito del
              objetivo que se escribe debajo, y tenerlos solo en la barra de
              arriba obligaba a adivinar que el formulario cambiaba con ella. */}
          <div className="sales-targets-scope">
            <label>
              <span>Sociedad</span>
              <select
                value={filters.companies.length > 1 ? "varias" : company === null ? "" : String(company)}
                onChange={(event) => {
                  const valor = event.target.value;
                  // El comercial se cae al cambiar de sociedad: pertenece a
                  // una, y mantenerlo dejaría un ámbito que no existe.
                  ctx.setFilters({ companies: valor === "" || valor === "varias" ? [] : [Number(valor)], repKeys: [] });
                }}
              >
                <option value="">Todas: la suma de las sociedades</option>
                {filters.companies.length > 1 ? <option value="varias">{ctx.companyLabel}</option> : null}
                {ctx.companies.map((sociedad) => <option key={sociedad.code} value={sociedad.code}>{sociedad.name}</option>)}
              </select>
            </label>
            <label>
              <span>Comercial</span>
              <select
                value={filters.repKeys.length > 1 ? "varios" : repKey ?? ""}
                disabled={company === null}
                onChange={(event) => {
                  const valor = event.target.value;
                  ctx.setFilters({ repKeys: valor === "" || valor === "varios" ? [] : [valor] });
                }}
              >
                <option value="">{company === null ? "Elige antes una sociedad" : "Toda la sociedad"}</option>
                {filters.repKeys.length > 1 ? <option value="varios">{`${filters.repKeys.length} comerciales`}</option> : null}
                {comerciales.map((quien) => <option key={quien.key} value={quien.key}>{quien.label}</option>)}
              </select>
            </label>
          </div>
          <div className="sales-targets-actions">
            <label>
              <span>Total del año</span>
              <input inputMode="decimal" value={yearTotal} onChange={(event) => setYearTotal(event.target.value)} placeholder="3.000.000" />
              <button type="button" className="button button-compact button-secondary" onClick={spread} disabled={!editable}>Repartir</button>
            </label>
            <label>
              <span>{shownYear - 1} más un %</span>
              <input inputMode="decimal" value={growth} onChange={(event) => setGrowth(event.target.value)} aria-label="Crecimiento en porcentaje" />
              <button type="button" className="button button-compact button-secondary" onClick={fromLastYear} disabled={!editable}>Calcular</button>
            </label>
            {/* Por trimestre, porque es como se habla del presupuesto: cada uno
                baja a sus meses con el peso que tuvieron el año pasado. */}
            <div className="sales-targets-quarters">
              <span>Por trimestre</span>
              <button type="button" className="button button-compact button-secondary" onClick={spreadQuarters} disabled={!editable}>Repartir</button>
              <div className="sales-targets-quarter-fields">
                {TRIMESTRES.map((trimestre, indice) => {
                  const puesto = sumaDe(draft.map(parseAmount).map((value) => (value === null || Number.isNaN(value) ? null : value)), trimestre.meses);
                  return (
                    <label key={trimestre.nombre}>
                      <small>{trimestre.nombre} · {trimestre.etiqueta}</small>
                      <input
                        inputMode="decimal"
                        value={quarters[indice]}
                        placeholder={puesto > 0 ? formatInput(puesto) : "—"}
                        disabled={!editable}
                        onChange={(event) => setQuarters((current) => current.map((item, position) => (position === indice ? event.target.value : item)))}
                        aria-label={`Objetivo de ${trimestre.nombre} (${trimestre.etiqueta})`}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="sales-targets-grid">
            {draft.map((value, index) => {
              const target = parseAmount(value);
              const done = index <= lastMonthIndex && target !== null && !Number.isNaN(target) && target > 0 ? (real[index] / target) * 100 : null;
              return (
                <label key={monthLongNames[index]} className={monthIndex === index ? "is-active" : undefined}>
                  <span className="sales-capitalize">{monthLongNames[index]}</span>
                  <input
                    inputMode="decimal"
                    value={value}
                    placeholder="—"
                    disabled={!editable}
                    onChange={(event) => setDraft((current) => current.map((item, position) => (position === index ? event.target.value : item)))}
                    aria-label={`Objetivo de ${monthLongNames[index]}`}
                  />
                  <small className={done === null ? "muted" : done >= 100 ? "sales-up" : "sales-down"}>
                    {done === null ? (index <= lastMonthIndex ? euros(real[index]) : "") : formatPercent(done)}
                  </small>
                </label>
              );
            })}
          </div>
          {/* Lo que suman los doce, y si eso sube o baja respecto a lo que de
              verdad se vendió. El porcentaje suelto no dice nada: al lado van
              los euros que son esos puntos. */}
          <p className="sales-targets-suma">
            <span className="muted">Total {shownYear}</span>
            <span>
              <strong>{euros(totalDelAno)}</strong>
              {variacionDelAno !== null ? (
                <small className={variacionDelAno >= 0 ? "sales-up" : "sales-down"}>
                  {" "}{variacionDelAno >= 0 ? "+" : "−"}{formatPercent(Math.abs(variacionDelAno))} sobre {shownYear - 1} ({euros(Math.abs(totalDelAno - totalAnterior))})
                </small>
              ) : <small className="muted"> {anteriorQuery.loading ? `leyendo ${shownYear - 1}…` : `sin venta en ${shownYear - 1} con la que comparar`}</small>}
            </span>
          </p>

          {/* Si lo repartido entre los comerciales cuadra con la sociedad. */}
          {repKey === null && repartido !== null && repartido > 0 ? (
            <p className="sales-targets-reparto">
              <span className="muted">Repartido entre comerciales</span>
              <span>
                <strong>{euros(repartido)}</strong>
                {hasTargets ? (
                  <small className={Math.abs(repartido - yearTarget) < 1 ? "sales-up" : "sales-down"}>
                    {Math.abs(repartido - yearTarget) < 1
                      ? " cuadra con el objetivo de la sociedad"
                      : ` ${repartido > yearTarget ? "de más" : "sin repartir"}: ${euros(Math.abs(yearTarget - repartido))} de ${euros(yearTarget)}`}
                  </small>
                ) : <small className="muted"> la sociedad no tiene objetivo con el que cuadrarlo</small>}
              </span>
            </p>
          ) : null}

          <div className="sales-targets-footer">
            {message ? <span className={message.tone === "ok" ? "sales-up" : "sales-down"} role="status">{message.text}</span>
              : <span className="muted">{editable
                ? "Deja vacío un mes para quitarle el objetivo."
                : "Los objetivos se ponen de uno en uno: una sociedad y, si es el de alguien, un comercial de ella."}</span>}
            <button type="button" className="button button-primary" onClick={() => void save()} disabled={saving || !editable}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </Panel>
      </section>
    </div>
  );
}
