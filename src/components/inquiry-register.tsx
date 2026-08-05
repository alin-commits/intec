"use client";

import { useEffect, useMemo, useState } from "react";
import { ChannelTable, type ChannelTableColumn, type ChannelTableRow } from "@/components/channel-table";
import { TrendChart } from "@/components/charts/trend-chart";
import { KpiCard } from "@/components/kpi-card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import { inquiryChannelLabels, inquiryChannelOrder } from "@/lib/constants";
import { businessUnits as demoBusinessUnits, demoInquiries } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { dayNumber, daysInMonth, monthKey, monthLabel, monthRange, monthShortLabel, monthWeekBuckets, previousMonthKey, previousYearMonthKey, yearOfMonth, yearRange } from "@/lib/dates";
import { formatDate, formatPercent, numberFormatter } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit, InquiryRecord, InquiryType } from "@/lib/types";

type ViewMode = "month" | "year";
type CompareMode = "previous" | "current" | "previous_year" | "none";

const compareModeHelpers: Record<CompareMode, string> = {
  previous: "frente al mes anterior",
  current: "frente al mes actual",
  previous_year: "frente al mismo mes del año anterior",
  none: "sin periodo de comparación",
};

function mapInquiry(row: Record<string, unknown>): InquiryRecord {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    inquiryType: row.inquiry_type as InquiryType,
    createdAt: String(row.created_at),
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

function inRange(record: InquiryRecord, start: string, end: string) {
  return record.createdAt >= start && record.createdAt < end;
}

function countsByChannel(records: InquiryRecord[]): Partial<Record<InquiryType, number>> {
  const counts: Partial<Record<InquiryType, number>> = {};
  for (const record of records) counts[record.inquiryType] = (counts[record.inquiryType] ?? 0) + 1;
  return counts;
}

function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

export function InquiryRegister() {
  const configured = isSupabaseConfigured();
  const currentMonthKey = monthKey();
  const [units, setUnits] = useState<BusinessUnit[]>(() => demoBusinessUnits.filter((unit) => unit.active));
  const [records, setRecords] = useState<InquiryRecord[]>(demoInquiries);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedYear, setSelectedYear] = useState(yearOfMonth(currentMonthKey));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [selectedUnit, setSelectedUnit] = useState("all");
  const [selectedType, setSelectedType] = useState<"all" | InquiryType>("all");
  const [sortColumn, setSortColumn] = useState<ChannelTableColumn>("total");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pending, setPending] = useState<{ unit: BusinessUnit; type: InquiryType } | null>(null);
  const [registrationUnitId, setRegistrationUnitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canRegister, setCanRegister] = useState(true);

  const registrationUnit = units.find((unit) => unit.id === registrationUnitId) ?? null;

  const selectedMonthYear = yearOfMonth(selectedMonth);
  const monthRangeValue = useMemo(() => monthRange(selectedMonth), [selectedMonth]);
  const annualRangeForMonth = useMemo(() => yearRange(selectedMonthYear), [selectedMonthYear]);
  const weekBuckets = useMemo(() => monthWeekBuckets(selectedMonth), [selectedMonth]);
  const yearRangeValue = useMemo(() => yearRange(selectedYear), [selectedYear]);

  const currentPeriod = viewMode === "month" ? monthRangeValue : yearRangeValue;
  const previousPeriod = useMemo(() => {
    if (viewMode === "year") return yearRange(selectedYear - 1);
    if (compareMode === "none") return null;
    const key = compareMode === "current" ? currentMonthKey : compareMode === "previous" ? previousMonthKey(selectedMonth) : previousYearMonthKey(selectedMonth);
    return monthRange(key);
  }, [compareMode, currentMonthKey, selectedMonth, selectedYear, viewMode]);

  useEffect(() => {
    if (!configured) return;
    const fetchFromYear = Math.min(selectedYear, selectedMonthYear) - 1;
    const fetchToYear = Math.max(selectedYear, selectedMonthYear) + 1;
    const fetchStart = yearRange(fetchFromYear).start;
    const fetchEnd = yearRange(fetchToYear).end;
    void (async () => {
      const supabase = createClient();
      const [{ data: unitData, error: unitError }, { data: inquiryData, error: inquiryError }, { data: authData }] = await Promise.all([
        supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active").eq("is_active", true).order("name"),
        supabase.from("inquiries").select("id, business_unit_id, inquiry_type, created_by, created_at").gte("created_at", fetchStart).lt("created_at", fetchEnd).order("created_at", { ascending: false }),
        supabase.auth.getUser(),
      ]);
      if (unitError || inquiryError) {
        setMessage(reportSafeError(unitError ?? inquiryError, "No se pudieron cargar las consultas."));
        return;
      }
      setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url })));
      setRecords((inquiryData ?? []).map((row) => mapInquiry(row as Record<string, unknown>)));
      if (authData.user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
        setCanRegister(profile?.role !== "viewer");
      }
    })();
  }, [configured, selectedMonthYear, selectedYear]);

  const currentRecords = useMemo(() => records.filter((record) => inRange(record, currentPeriod.start, currentPeriod.end)), [currentPeriod.end, currentPeriod.start, records]);
  const previousRecords = useMemo(() => previousPeriod ? records.filter((record) => inRange(record, previousPeriod.start, previousPeriod.end)) : [], [previousPeriod, records]);
  const yearRecordsForMonth = useMemo(() => records.filter((record) => inRange(record, annualRangeForMonth.start, annualRangeForMonth.end)), [annualRangeForMonth.end, annualRangeForMonth.start, records]);

  const filtered = useMemo(() => currentRecords.filter((record) => (selectedUnit === "all" || record.businessUnitId === selectedUnit) && (selectedType === "all" || record.inquiryType === selectedType)), [currentRecords, selectedType, selectedUnit]);
  const filteredPrevious = useMemo(() => previousRecords.filter((record) => (selectedUnit === "all" || record.businessUnitId === selectedUnit) && (selectedType === "all" || record.inquiryType === selectedType)), [previousRecords, selectedType, selectedUnit]);

  const webTotal = filtered.filter((record) => record.inquiryType !== "phone").length;
  const phoneTotal = filtered.filter((record) => record.inquiryType === "phone").length;
  const total = filtered.length;
  const previousTotal = filteredPrevious.length;
  const hasComparison = previousPeriod !== null && filteredPrevious.length > 0;
  const variation = hasComparison ? ((total - previousTotal) / previousTotal) * 100 : null;
  const elapsedDays = selectedMonth === currentMonthKey ? Math.max(1, dayNumber(new Date().toISOString())) : daysInMonth(selectedMonth);
  const monthsElapsedInYear = selectedYear === yearOfMonth(currentMonthKey) ? Number(currentMonthKey.split("-")[1]) : 12;
  const dailyAverage = total / elapsedDays;
  const monthlyAverage = total / monthsElapsedInYear;
  const comparisonHelper = viewMode === "year" ? `frente a ${selectedYear - 1}` : compareModeHelpers[compareMode];

  const topChannel = useMemo(() => {
    const counts = countsByChannel(filtered);
    let best: { channel: InquiryType; count: number } | null = null;
    for (const channel of inquiryChannelOrder) {
      const count = counts[channel] ?? 0;
      if (count > 0 && (!best || count > best.count)) best = { channel, count };
    }
    return best;
  }, [filtered]);

  const topUnit = useMemo(() => {
    const source = currentRecords.filter((record) => selectedType === "all" || record.inquiryType === selectedType);
    const counts = new Map<string, number>();
    for (const record of source) counts.set(record.businessUnitId, (counts.get(record.businessUnitId) ?? 0) + 1);
    let best: { unitId: string; count: number } | null = null;
    for (const [unitId, count] of counts) {
      if (!best || count > best.count) best = { unitId, count };
    }
    if (!best) return null;
    const unit = units.find((item) => item.id === best!.unitId);
    return unit ? { unit, count: best.count } : null;
  }, [currentRecords, selectedType, units]);

  const trendData = useMemo(() => {
    if (viewMode === "month") {
      return Array.from({ length: daysInMonth(selectedMonth) }, (_, index) => {
        const day = index + 1;
        const rows = filtered.filter((record) => dayNumber(record.createdAt) === day);
        return { label: String(day), web: rows.filter((record) => record.inquiryType !== "phone").length, phone: rows.filter((record) => record.inquiryType === "phone").length };
      });
    }
    return monthsOfYear(selectedYear).map((month) => {
      const monthR = monthRange(month);
      const rows = filtered.filter((record) => inRange(record, monthR.start, monthR.end));
      return { label: monthShortLabel(month), web: rows.filter((record) => record.inquiryType !== "phone").length, phone: rows.filter((record) => record.inquiryType === "phone").length };
    });
  }, [filtered, selectedMonth, selectedYear, viewMode]);

  const unitCurrentRecords = useMemo(() => currentRecords.filter((record) => selectedUnit === "all" || record.businessUnitId === selectedUnit), [currentRecords, selectedUnit]);
  const unitYearRecordsForMonth = useMemo(() => yearRecordsForMonth.filter((record) => selectedUnit === "all" || record.businessUnitId === selectedUnit), [yearRecordsForMonth, selectedUnit]);

  const periodRows: ChannelTableRow[] = useMemo(() => {
    if (viewMode === "month") {
      return weekBuckets.map((bucket) => {
        const bucketRecords = unitCurrentRecords.filter((record) => inRange(record, bucket.start, bucket.end));
        return { key: bucket.key, label: bucket.label, counts: countsByChannel(bucketRecords), total: bucketRecords.length };
      });
    }
    return monthsOfYear(selectedYear).map((month) => {
      const monthR = monthRange(month);
      const monthRecords = unitCurrentRecords.filter((record) => inRange(record, monthR.start, monthR.end));
      return { key: month, label: monthShortLabel(month), counts: countsByChannel(monthRecords), total: monthRecords.length };
    });
  }, [selectedYear, unitCurrentRecords, viewMode, weekBuckets]);

  const periodFooterRow: ChannelTableRow = useMemo(() => ({
    key: "period-total",
    label: viewMode === "month" ? "Total mes" : "Total año",
    counts: countsByChannel(unitCurrentRecords),
    total: unitCurrentRecords.length,
  }), [unitCurrentRecords, viewMode]);

  const annualCountsForMonth = useMemo(() => countsByChannel(unitYearRecordsForMonth), [unitYearRecordsForMonth]);

  const unitTableRows: ChannelTableRow[] = useMemo(() => {
    const rows = units
      .filter((unit) => selectedUnit === "all" || unit.id === selectedUnit)
      .map((unit) => {
        const unitCurrent = currentRecords.filter((record) => record.businessUnitId === unit.id);
        const unitPrevious = previousRecords.filter((record) => record.businessUnitId === unit.id);
        const unitVariation = unitPrevious.length ? ((unitCurrent.length - unitPrevious.length) / unitPrevious.length) * 100 : null;
        return {
          key: unit.id,
          label: <span className="unit-name"><i style={{ background: unit.accent }} />{unit.name}</span>,
          name: unit.name,
          counts: countsByChannel(unitCurrent),
          total: unitCurrent.length,
          variation: unitVariation,
          trailing: unitVariation === null
            ? <span className="muted">Sin comparación</span>
            : <span className={unitVariation >= 0 ? "trend trend-positive" : "trend trend-negative"}>{unitVariation >= 0 ? "↑" : "↓"} {formatPercent(Math.abs(unitVariation))}</span>,
        };
      });

    return rows.sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      if (sortColumn === "label") return a.name.localeCompare(b.name) * direction;
      if (sortColumn === "total") return (a.total - b.total) * direction;
      if (sortColumn === "trailing") return ((a.variation ?? Number.NEGATIVE_INFINITY) - (b.variation ?? Number.NEGATIVE_INFINITY)) * direction;
      return ((a.counts[sortColumn] ?? 0) - (b.counts[sortColumn] ?? 0)) * direction;
    });
  }, [currentRecords, previousRecords, selectedUnit, sortColumn, sortDirection, units]);

  async function confirmRegistration() {
    if (!pending || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      let newRecord: InquiryRecord;
      if (!configured) {
        newRecord = {
          id: `INQ-${Date.now()}`,
          businessUnitId: pending.unit.id,
          inquiryType: pending.type,
          createdAt: new Date().toISOString(),
          createdBy: "demo-admin",
        };
      } else {
        const { data, error } = await createClient().from("inquiries").insert({
          business_unit_id: pending.unit.id,
          inquiry_type: pending.type,
        }).select("id, business_unit_id, inquiry_type, created_by, created_at").single();
        if (error) throw error;
        newRecord = mapInquiry(data as Record<string, unknown>);
      }
      setRecords((current) => [newRecord, ...current]);
      const channelLabel = pending.type === "phone" ? "telefónica" : `de ${inquiryChannelLabels[pending.type]}`;
      setMessage(`Consulta ${channelLabel} registrada correctamente para ${pending.unit.name}.`);
      setPending(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo registrar la consulta."));
    } finally {
      setBusy(false);
    }
  }

  function changeSort(column: ChannelTableColumn) {
    if (column === sortColumn) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortColumn(column);
      setSortDirection(column === "label" ? "asc" : "desc");
    }
  }

  return (
    <div className="page-stack">
      <section className="intro-grid">
        <div><span className="eyebrow">Registro controlado</span><h2>Registrar consulta</h2><p>Selecciona el canal. Antes de guardar aparecerá una confirmación con la unidad y el canal de consulta.</p></div>
        <div className="notice"><strong>{configured ? "Datos conectados" : "Modo demostración"}</strong><span>{message ?? "La fecha, la hora y el usuario se asignan automáticamente."}</span></div>
      </section>

      {canRegister ? (
        <>
          <section className="brand-picker">
            {units.map((unit) => (
              <button
                key={unit.id}
                type="button"
                className={unit.id === registrationUnitId ? "brand-tile active" : "brand-tile"}
                onClick={() => setRegistrationUnitId(unit.id)}
              >
                <UnitBrandMark unit={unit} width={150} height={56} />
              </button>
            ))}
          </section>
          {registrationUnit ? (
            <article className="panel inquiry-card">
              <div className="unit-card-heading">
                <UnitBrandMark unit={registrationUnit} size={42} />
                <div><h3>{registrationUnit.name}</h3><span>El registro requiere confirmación</span></div>
              </div>
              <div className="inquiry-actions inquiry-actions-spaced">
                {inquiryChannelOrder.map((channel) => (
                  <button key={channel} type="button" onClick={() => setPending({ unit: registrationUnit, type: channel })} className="channel-action">
                    <span className="channel-action-label"><i className={`channel-dot channel-dot-${channel}`} /><span>{inquiryChannelLabels[channel]}</span></span>
                    <span className="channel-action-plus">+</span>
                  </button>
                ))}
              </div>
            </article>
          ) : (
            <div className="notice"><strong>Elige una marca</strong><span>Selecciona una de las marcas de arriba para registrar una consulta.</span></div>
          )}
        </>
      ) : <div className="notice"><strong>Cuenta de solo lectura</strong><span>Puedes analizar las consultas, pero no registrar nuevas.</span></div>}

      <section className="section-heading inquiries-dashboard-heading">
        <div><span className="eyebrow">Estadísticas de consultas</span><h2>Dashboard de consultas</h2><p>Elige vista mensual o anual, filtra por unidad y canal. Las tablas se pueden ordenar pulsando sus encabezados.</p></div>
      </section>

      <section className="panel filter-bar">
        <label>
          <span>Unidad de negocio</span>
          <select value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}>
            <option value="all">Todas las unidades</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
        <label>
          <span>Vista</span>
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
            <option value="month">Mensual</option>
            <option value="year">Anual</option>
          </select>
        </label>
        {viewMode === "month" ? (
          <label><span>Mes</span><input type="month" value={selectedMonth} max={currentMonthKey} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        ) : (
          <label>
            <span>Año</span>
            <input type="number" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value) || selectedYear)} />
          </label>
        )}
        {viewMode === "month" ? (
          <label>
            <span>Comparar con</span>
            <select value={compareMode} onChange={(event) => setCompareMode(event.target.value as CompareMode)}>
              <option value="previous">Mes anterior</option>
              <option value="current">Mes actual</option>
              <option value="previous_year">Mismo mes del año anterior</option>
              <option value="none">Sin comparación</option>
            </select>
          </label>
        ) : (
          <div className="filter-summary"><span>Comparando con</span><strong>Año {selectedYear - 1}</strong></div>
        )}
      </section>

      <section className="panel filter-bar inquiry-filters">
        <label><span>Canal</span><select value={selectedType} onChange={(event) => setSelectedType(event.target.value as "all" | InquiryType)}>
          <option value="all">Todos los canales</option>
          {inquiryChannelOrder.map((channel) => <option key={channel} value={channel}>{inquiryChannelLabels[channel]}</option>)}
        </select></label>
        <label><span>Orden inicial</span><select value={`${sortColumn}-${sortDirection}`} onChange={(event) => { const [column, direction] = event.target.value.split("-") as [ChannelTableColumn, "asc" | "desc"]; setSortColumn(column); setSortDirection(direction); }}>
          <option value="total-desc">Mayor total</option>
          <option value="trailing-desc">Mayor crecimiento</option>
          <option value="label-asc">Nombre A–Z</option>
        </select></label>
      </section>

      <section className="kpi-grid inquiry-kpi-grid">
        <KpiCard label="Consultas totales" value={numberFormatter.format(total)} delta={variation === null ? "Sin comparación" : formatPercent(Math.abs(variation))} positive={variation === null || variation >= 0} helper={comparisonHelper} />
        <KpiCard label={viewMode === "month" ? "Media diaria" : "Media mensual"} value={(viewMode === "month" ? dailyAverage : monthlyAverage).toFixed(1).replace(".", ",")} delta={viewMode === "month" ? `${elapsedDays} días analizados` : `${monthsElapsedInYear} meses analizados`} helper="" />
        <KpiCard label="Canal principal" value={topChannel ? inquiryChannelLabels[topChannel.channel] : "—"} delta={topChannel ? `${numberFormatter.format(topChannel.count)} consultas` : "Sin datos"} helper="" />
        <KpiCard label="Unidad líder" value={topUnit ? topUnit.unit.name : "—"} delta={topUnit ? `${numberFormatter.format(topUnit.count)} consultas` : "Sin datos"} helper="" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel chart-panel-wide">
          <div className="panel-heading"><div><span className="eyebrow">Evolución</span><h2>{viewMode === "month" ? monthLabel(selectedMonth) : `Año ${selectedYear}`}</h2></div><span className="muted">Web y telefónicas</span></div>
          <TrendChart data={trendData} />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span className="eyebrow">Distribución</span><h2>Canales del periodo</h2></div></div>
          <div className="channel-breakdown">
            <div><span>Web</span><strong>{webTotal}</strong><small>{total ? formatPercent((webTotal / total) * 100) : "0,0 %"}</small></div>
            <div><span>Teléfono</span><strong>{phoneTotal}</strong><small>{total ? formatPercent((phoneTotal / total) * 100) : "0,0 %"}</small></div>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">{viewMode === "month" ? "Detalle semanal" : "Detalle mensual"}</span><h2>{viewMode === "month" ? `Consultas por semana — ${monthLabel(selectedMonth)}` : `Consultas por mes — ${selectedYear}`}</h2></div>
          <span className="muted">{viewMode === "month" ? "Semanas dentro del mes, como en el control histórico" : "Cada fila es un mes natural"}</span>
        </div>
        <ChannelTable rowHeaderLabel={viewMode === "month" ? "Semana" : "Mes"} rows={periodRows} footerRow={periodFooterRow} />
      </section>

      {viewMode === "month" ? (
        <section className="panel table-panel">
          <div className="panel-heading"><div><span className="eyebrow">Acumulado</span><h2>Total anual {selectedMonthYear}</h2></div></div>
          <div className="annual-summary">
            {inquiryChannelOrder.map((channel) => (
              <div key={channel}><span>{inquiryChannelLabels[channel]}</span><strong>{numberFormatter.format(annualCountsForMonth[channel] ?? 0)}</strong></div>
            ))}
            <div><span>Total</span><strong>{numberFormatter.format(unitYearRecordsForMonth.length)}</strong></div>
          </div>
        </section>
      ) : null}

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Comparativa</span><h2>Consultas por unidad</h2></div><span className="muted">Pulsa un encabezado para ordenar</span></div>
        <ChannelTable
          rowHeaderLabel="Unidad"
          rows={unitTableRows}
          trailingHeader="Variación"
          sort={{ activeColumn: sortColumn, direction: sortDirection, onSort: changeSort }}
        />
      </section>

      <section className="panel table-panel recent-inquiries">
        <div className="panel-heading"><div><span className="eyebrow">Control</span><h2>Últimos registros del periodo</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Canal</th></tr></thead><tbody>{filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map((record) => {
          const unit = units.find((item) => item.id === record.businessUnitId);
          return <tr key={record.id}><td>{formatDate(record.createdAt)}</td><td>{unit?.name ?? "—"}</td><td><span className={`badge badge-channel-${record.inquiryType}`}>{inquiryChannelLabels[record.inquiryType]}</span></td></tr>;
        })}</tbody></table></div>
      </section>

      <ConfirmationDialog
        open={Boolean(pending)}
        title={pending ? `¿Quieres registrar ${pending.type === "phone" ? "una consulta telefónica" : `una consulta de ${inquiryChannelLabels[pending.type]}`} para ${pending.unit.name}?` : "¿Quieres registrar la consulta?"}
        confirmLabel="Registrar consulta"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmRegistration()}
      >
        {pending ? <div className="confirmation-summary"><span>Unidad de negocio</span><strong>{pending.unit.name}</strong><span>Canal</span><strong>{inquiryChannelLabels[pending.type]}</strong><p>La fecha, la hora y tu usuario se guardarán automáticamente.</p></div> : null}
      </ConfirmationDialog>
    </div>
  );
}
