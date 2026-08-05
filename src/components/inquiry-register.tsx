"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { KpiCard } from "@/components/kpi-card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { businessUnits as demoBusinessUnits, demoInquiries } from "@/lib/demo-data";
import { dayNumber, daysInMonth, monthKey, monthLabel, monthRange } from "@/lib/dates";
import { formatDate, formatPercent, numberFormatter } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit, InquiryRecord, InquiryType } from "@/lib/types";

type SortKey = "name" | "web" | "phone" | "total" | "variation";

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

export function InquiryRegister() {
  const configured = isSupabaseConfigured();
  const [units, setUnits] = useState<BusinessUnit[]>(demoBusinessUnits);
  const [records, setRecords] = useState<InquiryRecord[]>(demoInquiries);
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [selectedUnit, setSelectedUnit] = useState("all");
  const [selectedType, setSelectedType] = useState<"all" | InquiryType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pending, setPending] = useState<{ unit: BusinessUnit; type: InquiryType } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canRegister, setCanRegister] = useState(true);

  const range = useMemo(() => monthRange(selectedMonth), [selectedMonth]);

  useEffect(() => {
    if (!configured) return;
    const previousStart = range.previousStart;
    const end = range.end;
    void (async () => {
      const supabase = createClient();
      const [{ data: unitData, error: unitError }, { data: inquiryData, error: inquiryError }, { data: authData }] = await Promise.all([
        supabase.from("business_units").select("id, name, slug, brand_color, is_active").eq("is_active", true).order("name"),
        supabase.from("inquiries").select("id, business_unit_id, inquiry_type, created_by, created_at").gte("created_at", previousStart).lt("created_at", end).order("created_at", { ascending: false }),
        supabase.auth.getUser(),
      ]);
      if (unitError || inquiryError) {
        setMessage(unitError?.message || inquiryError?.message || "No se pudieron cargar las consultas.");
        return;
      }
      setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active })));
      setRecords((inquiryData ?? []).map((row) => mapInquiry(row as Record<string, unknown>)));
      if (authData.user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
        setCanRegister(profile?.role !== "viewer");
      }
    })();
  }, [configured, range.end, range.previousStart]);

  const currentRecords = useMemo(() => records.filter((record) => inRange(record, range.start, range.end)), [range.end, range.start, records]);
  const previousRecords = useMemo(() => records.filter((record) => inRange(record, range.previousStart, range.start)), [range.previousStart, range.start, records]);
  const filtered = useMemo(() => currentRecords.filter((record) => (selectedUnit === "all" || record.businessUnitId === selectedUnit) && (selectedType === "all" || record.inquiryType === selectedType)), [currentRecords, selectedType, selectedUnit]);
  const filteredPrevious = useMemo(() => previousRecords.filter((record) => (selectedUnit === "all" || record.businessUnitId === selectedUnit) && (selectedType === "all" || record.inquiryType === selectedType)), [previousRecords, selectedType, selectedUnit]);

  const webTotal = filtered.filter((record) => record.inquiryType === "web").length;
  const phoneTotal = filtered.filter((record) => record.inquiryType === "phone").length;
  const total = filtered.length;
  const previousTotal = filteredPrevious.length;
  const variation = previousTotal ? ((total - previousTotal) / previousTotal) * 100 : null;
  const currentMonthKey = monthKey();
  const elapsedDays = selectedMonth === currentMonthKey ? Math.max(1, dayNumber(new Date().toISOString())) : daysInMonth(selectedMonth);
  const dailyAverage = total / elapsedDays;

  const trendData = useMemo(() => Array.from({ length: daysInMonth(selectedMonth) }, (_, index) => {
    const day = index + 1;
    const rows = filtered.filter((record) => dayNumber(record.createdAt) === day);
    return {
      label: String(day),
      web: rows.filter((record) => record.inquiryType === "web").length,
      phone: rows.filter((record) => record.inquiryType === "phone").length,
    };
  }), [filtered, selectedMonth]);

  const summaryRows = useMemo(() => {
    const rows = units.map((unit) => {
      const unitCurrent = currentRecords.filter((record) => record.businessUnitId === unit.id && (selectedType === "all" || record.inquiryType === selectedType));
      const unitPrevious = previousRecords.filter((record) => record.businessUnitId === unit.id && (selectedType === "all" || record.inquiryType === selectedType));
      const web = unitCurrent.filter((record) => record.inquiryType === "web").length;
      const phone = unitCurrent.filter((record) => record.inquiryType === "phone").length;
      const unitTotal = unitCurrent.length;
      const unitVariation = unitPrevious.length ? ((unitTotal - unitPrevious.length) / unitPrevious.length) * 100 : null;
      return { unit, web, phone, total: unitTotal, variation: unitVariation };
    }).filter((row) => selectedUnit === "all" || row.unit.id === selectedUnit);

    return rows.sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      if (sortKey === "name") return a.unit.name.localeCompare(b.unit.name) * direction;
      const aValue = sortKey === "variation" ? a.variation ?? Number.NEGATIVE_INFINITY : a[sortKey];
      const bValue = sortKey === "variation" ? b.variation ?? Number.NEGATIVE_INFINITY : b[sortKey];
      return (aValue - bValue) * direction;
    });
  }, [currentRecords, previousRecords, selectedType, selectedUnit, sortDirection, sortKey, units]);

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
      setMessage(`Consulta ${pending.type === "web" ? "web" : "telefónica"} registrada correctamente para ${pending.unit.name}.`);
      setPending(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo registrar la consulta.");
    } finally {
      setBusy(false);
    }
  }

  function changeSort(next: SortKey) {
    if (next === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className="page-stack">
      <section className="intro-grid">
        <div><span className="eyebrow">Registro controlado</span><h2>Registrar consulta</h2><p>Selecciona el canal. Antes de guardar aparecerá una confirmación con la unidad y el tipo de consulta.</p></div>
        <div className="notice"><strong>{configured ? "Datos conectados" : "Modo demostración"}</strong><span>{message ?? "La fecha, la hora y el usuario se asignan automáticamente."}</span></div>
      </section>

      {canRegister ? <section className="inquiry-grid">
        {units.map((unit) => (
          <article className="panel inquiry-card" key={unit.id}>
            <div className="unit-card-heading">
              <span className="unit-monogram" style={{ background: unit.accent }}>{unit.name.charAt(0)}</span>
              <div><h3>{unit.name}</h3><span>El registro requiere confirmación</span></div>
            </div>
            <div className="inquiry-actions inquiry-actions-spaced">
              <button type="button" onClick={() => setPending({ unit, type: "web" })} className="button button-channel button-web">+ Consulta web</button>
              <button type="button" onClick={() => setPending({ unit, type: "phone" })} className="button button-channel button-phone">+ Telefónica</button>
            </div>
          </article>
        ))}
      </section> : <div className="notice"><strong>Cuenta de solo lectura</strong><span>Puedes analizar las consultas, pero no registrar nuevas.</span></div>}

      <section className="section-heading inquiries-dashboard-heading">
        <div><span className="eyebrow">Estadísticas de consultas</span><h2>Dashboard mensual</h2><p>Filtra por mes, unidad y canal. Las tablas se pueden ordenar pulsando sus encabezados.</p></div>
      </section>

      <section className="panel filter-bar inquiry-filters">
        <label><span>Mes</span><input type="month" value={selectedMonth} max={currentMonthKey} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        <label><span>Unidad</span><select value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}><option value="all">Todas las unidades</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label><span>Canal</span><select value={selectedType} onChange={(event) => setSelectedType(event.target.value as "all" | InquiryType)}><option value="all">Web y teléfono</option><option value="web">Solo web</option><option value="phone">Solo teléfono</option></select></label>
        <label><span>Orden inicial</span><select value={`${sortKey}-${sortDirection}`} onChange={(event) => { const [key, direction] = event.target.value.split("-") as [SortKey, "asc" | "desc"]; setSortKey(key); setSortDirection(direction); }}><option value="total-desc">Mayor total</option><option value="web-desc">Más web</option><option value="phone-desc">Más telefónicas</option><option value="variation-desc">Mayor crecimiento</option><option value="name-asc">Nombre A–Z</option></select></label>
      </section>

      <section className="kpi-grid inquiry-kpi-grid">
        <KpiCard label="Consultas web" value={numberFormatter.format(webTotal)} delta={selectedType === "phone" ? "Canal oculto" : "del periodo"} helper="" />
        <KpiCard label="Telefónicas" value={numberFormatter.format(phoneTotal)} delta={selectedType === "web" ? "Canal oculto" : "del periodo"} helper="" />
        <KpiCard label="Consultas totales" value={numberFormatter.format(total)} delta={variation === null ? "Sin comparación" : formatPercent(Math.abs(variation))} positive={variation === null || variation >= 0} />
        <KpiCard label="Media diaria" value={dailyAverage.toFixed(1).replace(".", ",")} delta={`${elapsedDays} días analizados`} helper="" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel chart-panel-wide">
          <div className="panel-heading"><div><span className="eyebrow">Evolución diaria</span><h2>{monthLabel(selectedMonth)}</h2></div><span className="muted">Web y telefónicas</span></div>
          <TrendChart data={trendData} />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span className="eyebrow">Distribución</span><h2>Canales del mes</h2></div></div>
          <div className="channel-breakdown">
            <div><span>Web</span><strong>{webTotal}</strong><small>{total ? formatPercent((webTotal / total) * 100) : "0,0 %"}</small></div>
            <div><span>Teléfono</span><strong>{phoneTotal}</strong><small>{total ? formatPercent((phoneTotal / total) * 100) : "0,0 %"}</small></div>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Comparativa</span><h2>Consultas por unidad</h2></div><span className="muted">Pulsa un encabezado para ordenar</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th><button className="sort-button" onClick={() => changeSort("name")}>Unidad</button></th>
              <th><button className="sort-button" onClick={() => changeSort("web")}>Web</button></th>
              <th><button className="sort-button" onClick={() => changeSort("phone")}>Teléfono</button></th>
              <th><button className="sort-button" onClick={() => changeSort("total")}>Total</button></th>
              <th><button className="sort-button" onClick={() => changeSort("variation")}>Variación</button></th>
            </tr></thead>
            <tbody>{summaryRows.map((row) => <tr key={row.unit.id}>
              <td><span className="unit-name"><i style={{ background: row.unit.accent }} />{row.unit.name}</span></td>
              <td>{row.web}</td><td>{row.phone}</td><td><strong>{row.total}</strong></td>
              <td>{row.variation === null ? <span className="muted">Sin comparación</span> : <span className={row.variation >= 0 ? "trend trend-positive" : "trend trend-negative"}>{row.variation >= 0 ? "↑" : "↓"} {formatPercent(Math.abs(row.variation))}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel recent-inquiries">
        <div className="panel-heading"><div><span className="eyebrow">Control</span><h2>Últimos registros del periodo</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Tipo</th></tr></thead><tbody>{filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12).map((record) => {
          const unit = units.find((item) => item.id === record.businessUnitId);
          return <tr key={record.id}><td>{formatDate(record.createdAt)}</td><td>{unit?.name ?? "—"}</td><td><span className={record.inquiryType === "web" ? "badge badge-new" : "badge badge-contacted"}>{record.inquiryType === "web" ? "Web" : "Telefónica"}</span></td></tr>;
        })}</tbody></table></div>
      </section>

      <ConfirmationDialog
        open={Boolean(pending)}
        title="¿Quieres registrar la consulta?"
        confirmLabel="Registrar consulta"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmRegistration()}
      >
        {pending ? <div className="confirmation-summary"><span>Unidad de negocio</span><strong>{pending.unit.name}</strong><span>Tipo de consulta</span><strong>{pending.type === "web" ? "Consulta web" : "Consulta telefónica"}</strong><p>La fecha, la hora y tu usuario se guardarán automáticamente.</p></div> : null}
      </ConfirmationDialog>
    </div>
  );
}
