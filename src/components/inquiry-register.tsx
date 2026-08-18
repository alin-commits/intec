"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChannelTable, type ChannelTableColumn, type ChannelTableRow } from "@/components/channel-table";
import { TrendChart } from "@/components/charts/trend-chart";
import { KpiCard } from "@/components/kpi-card";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import { CONSULTAS_ROLES, hasAnyRole, inquiryChannelLabels, inquiryChannelOrder, saleTypeLabels, saleTypeOrder } from "@/lib/constants";
import { downloadCsv, downloadCsvReport, type CsvSummaryItem } from "@/lib/csv-export";
import { businessUnits as demoBusinessUnits, demoInquiries, demoSalesEntries } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { dayNumber, daysInMonth, isoWeekStart, monthKey, monthLabel, monthRange, monthShortLabel, monthWeekBuckets, previousMonthKey, previousYearMonthKey, yearOfMonth, yearRange } from "@/lib/dates";
import { currencyFormatter, formatDate, formatPercent, numberFormatter } from "@/lib/format";
import { exportElementToPdf } from "@/lib/pdf-export";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit, InquiryRecord, InquiryType, SaleType, SalesEntry } from "@/lib/types";

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

function mapSalesEntry(row: Record<string, unknown>): SalesEntry {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    saleType: row.sale_type as SaleType,
    entryMode: row.entry_mode as SalesEntry["entryMode"],
    inquiryId: row.inquiry_id ? String(row.inquiry_id) : null,
    weekStart: row.week_start ? String(row.week_start) : null,
    occurredOn: String(row.occurred_on),
    count: Number(row.count ?? 1),
    value: Number(row.value ?? 0),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
  };
}

function blankWeeklyDraft(): Record<SaleType, { count: string; value: string }> {
  return { oferta: { count: "", value: "" }, seguimiento: { count: "", value: "" }, pedido: { count: "", value: "" } };
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
  const [salesEntries, setSalesEntries] = useState<SalesEntry[]>(demoSalesEntries);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedYear, setSelectedYear] = useState(yearOfMonth(currentMonthKey));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [selectedUnit, setSelectedUnit] = useState("all");
  const [selectedType, setSelectedType] = useState<"all" | InquiryType>("all");
  const [sortColumn, setSortColumn] = useState<ChannelTableColumn>("total");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pending, setPending] = useState<{ unit: BusinessUnit; type: InquiryType } | null>(null);
  const [pendingSaleType, setPendingSaleType] = useState<SaleType | "none">("none");
  const [pendingSaleValue, setPendingSaleValue] = useState("");
  const [registrationUnitId, setRegistrationUnitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canRegister, setCanRegister] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<InquiryRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<InquiryRecord | null>(null);
  const [editDraft, setEditDraft] = useState<{ businessUnitId: string; inquiryType: InquiryType }>({ businessUnitId: "", inquiryType: "phone" });
  const [newSaleDraft, setNewSaleDraft] = useState<{ saleType: SaleType; value: string }>({ saleType: "pedido", value: "" });
  const [pendingDeleteSale, setPendingDeleteSale] = useState<SalesEntry | null>(null);
  const [saleChooserOpen, setSaleChooserOpen] = useState(false);
  const [saleChooserMode, setSaleChooserMode] = useState<"menu" | "inquiry" | "weekly">("menu");
  const [quickSaleUnitId, setQuickSaleUnitId] = useState("");
  const [quickSaleInquiryId, setQuickSaleInquiryId] = useState("");
  const [quickSaleType, setQuickSaleType] = useState<SaleType>("pedido");
  const [quickSaleValue, setQuickSaleValue] = useState("");
  const [weeklyUnitId, setWeeklyUnitId] = useState("");
  const [weeklyDate, setWeeklyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weeklyDraft, setWeeklyDraft] = useState(() => blankWeeklyDraft());
  const [editingSale, setEditingSale] = useState<SalesEntry | null>(null);
  const [saleEditDraft, setSaleEditDraft] = useState<{ businessUnitId: string; saleType: SaleType; value: string; count: string }>({ businessUnitId: "", saleType: "pedido", value: "", count: "1" });
  const [inquiriesExpanded, setInquiriesExpanded] = useState(false);
  const [salesExpanded, setSalesExpanded] = useState(false);
  const [saleUrlChecked, setSaleUrlChecked] = useState(false);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [pdfBusy, setPdfBusy] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const registrationUnit = units.find((unit) => unit.id === registrationUnitId) ?? null;
  // Solo el selector de "nueva consulta" respeta visibleInConsultas; el resto de
  // la página usa `units` sin filtrar para no perder nombre/color de marcas
  // con registros históricos que se hayan ocultado después.
  const registrableUnits = useMemo(() => units.filter((unit) => unit.visibleInConsultas), [units]);

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
      const [{ data: unitData, error: unitError }, { data: inquiryData, error: inquiryError }, { data: salesData, error: salesError }, { data: authData }] = await Promise.all([
        supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").eq("is_active", true).order("sort_order"),
        supabase.from("inquiries").select("id, business_unit_id, inquiry_type, created_by, created_at").gte("created_at", fetchStart).lt("created_at", fetchEnd).order("created_at", { ascending: false }),
        supabase.from("sales_entries").select("id, business_unit_id, sale_type, entry_mode, inquiry_id, week_start, occurred_on, count, value, created_by, created_at").gte("occurred_on", fetchStart.slice(0, 10)).lt("occurred_on", fetchEnd.slice(0, 10)).order("occurred_on", { ascending: false }),
        supabase.auth.getUser(),
      ]);
      if (unitError || inquiryError || salesError) {
        setMessage(reportSafeError(unitError ?? inquiryError ?? salesError, "No se pudieron cargar las consultas."));
        return;
      }
      setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true })));
      setRecords((inquiryData ?? []).map((row) => mapInquiry(row as Record<string, unknown>)));
      setSalesEntries((salesData ?? []).map((row) => mapSalesEntry(row as Record<string, unknown>)));
      if (authData.user) {
        setCurrentUserId(authData.user.id);
        const { data: profile } = await supabase.from("profiles").select("roles").eq("id", authData.user.id).maybeSingle();
        setCanRegister(Boolean(profile && hasAnyRole(profile.roles, ["admin", "commercial"])));
        setIsAdmin(Boolean(profile?.roles.includes("admin")));
        setAccess(profile && hasAnyRole(profile.roles, CONSULTAS_ROLES) ? "allowed" : "denied");
      } else {
        setAccess("denied");
      }
    })();
  }, [configured, selectedMonthYear, selectedYear]);

  if (!saleUrlChecked && access === "allowed" && typeof window !== "undefined") {
    setSaleUrlChecked(true);
    if (new URLSearchParams(window.location.search).get("openSale") === "1") {
      const defaultUnitId = registrationUnitId ?? units[0]?.id ?? "";
      setSaleChooserMode("menu");
      setQuickSaleUnitId(defaultUnitId);
      setQuickSaleInquiryId("");
      setQuickSaleType("pedido");
      setQuickSaleValue("");
      setWeeklyUnitId(defaultUnitId);
      setWeeklyDate(new Date().toISOString().slice(0, 10));
      setWeeklyDraft(blankWeeklyDraft());
      setSaleChooserOpen(true);
    }
  }

  useEffect(() => {
    if (!saleUrlChecked || typeof window === "undefined") return;
    if (window.location.search.includes("openSale")) window.history.replaceState(null, "", "/consultas");
  }, [saleUrlChecked]);

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

  const periodStartDate = currentPeriod.start.slice(0, 10);
  const periodEndDate = currentPeriod.end.slice(0, 10);
  const filteredSales = useMemo(() => salesEntries.filter((entry) =>
    entry.occurredOn >= periodStartDate && entry.occurredOn < periodEndDate
    && (selectedUnit === "all" || entry.businessUnitId === selectedUnit)
  ), [salesEntries, periodStartDate, periodEndDate, selectedUnit]);

  const salesSummary = useMemo(() => {
    const base: Record<SaleType, { count: number; value: number }> = { oferta: { count: 0, value: 0 }, seguimiento: { count: 0, value: 0 }, pedido: { count: 0, value: 0 } };
    for (const entry of filteredSales) {
      base[entry.saleType].count += entry.count;
      base[entry.saleType].value += entry.value;
    }
    return base;
  }, [filteredSales]);

  const recentSales = useMemo(() => filteredSales.slice().sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)).slice(0, 30), [filteredSales]);

  const recentInquiries = useMemo(() => filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30), [filtered]);

  const salesByInquiry = useMemo(() => {
    const map = new Map<string, SalesEntry[]>();
    for (const entry of salesEntries) {
      if (!entry.inquiryId) continue;
      const list = map.get(entry.inquiryId) ?? [];
      list.push(entry);
      map.set(entry.inquiryId, list);
    }
    return map;
  }, [salesEntries]);

  const editingRecordSales = useMemo(() => editingRecord ? (salesByInquiry.get(editingRecord.id) ?? []) : [], [editingRecord, salesByInquiry]);

  const quickSaleUnitRecords = useMemo(() => records
    .filter((record) => record.businessUnitId === quickSaleUnitId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30), [records, quickSaleUnitId]);

  async function confirmRegistration() {
    if (!pending || busy) return;
    let saleValue: number | null = null;
    if (pendingSaleType !== "none") {
      const trimmed = pendingSaleValue.trim();
      saleValue = Number(trimmed);
      if (trimmed === "" || Number.isNaN(saleValue) || saleValue < 0) {
        setMessage("El valor de la venta no es válido.");
        return;
      }
    }
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

      if (pendingSaleType !== "none" && saleValue !== null) {
        const occurredOn = newRecord.createdAt.slice(0, 10);
        if (!configured) {
          const entry: SalesEntry = {
            id: `SE-${Date.now()}`,
            businessUnitId: newRecord.businessUnitId,
            saleType: pendingSaleType,
            entryMode: "inquiry",
            inquiryId: newRecord.id,
            weekStart: null,
            occurredOn,
            count: 1,
            value: saleValue,
            createdBy: "demo-admin",
            createdAt: new Date().toISOString(),
          };
          setSalesEntries((current) => [entry, ...current]);
        } else {
          const { data, error } = await createClient().from("sales_entries").insert({
            business_unit_id: newRecord.businessUnitId,
            sale_type: pendingSaleType,
            entry_mode: "inquiry",
            inquiry_id: newRecord.id,
            occurred_on: occurredOn,
            count: 1,
            value: saleValue,
          }).select("id, business_unit_id, sale_type, entry_mode, inquiry_id, week_start, occurred_on, count, value, created_by, created_at").single();
          if (error) throw error;
          setSalesEntries((current) => [mapSalesEntry(data as Record<string, unknown>), ...current]);
        }
      }

      const channelLabel = pending.type === "phone" ? "telefónica" : `de ${inquiryChannelLabels[pending.type]}`;
      const saleSuffix = pendingSaleType !== "none" ? ` con una venta de tipo ${saleTypeLabels[pendingSaleType]}` : "";
      setMessage(`Consulta ${channelLabel} registrada correctamente para ${pending.unit.name}${saleSuffix}.`);
      setPending(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo registrar la consulta."));
    } finally {
      setBusy(false);
    }
  }

  function canDeleteRecord(record: InquiryRecord): boolean {
    return isAdmin || (currentUserId !== null && record.createdBy === currentUserId);
  }

  async function confirmDeleteRecord() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (configured) {
        const { error } = await createClient().from("inquiries").delete().eq("id", pendingDelete.id);
        if (error) throw error;
      }
      setRecords((current) => current.filter((record) => record.id !== pendingDelete.id));
      setMessage("Consulta eliminada.");
      setPendingDelete(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar la consulta. Solo puedes borrar tus propios registros de los últimos 10 minutos, o pide a un administrador."));
    } finally {
      setBusy(false);
    }
  }

  function openEditRecord(record: InquiryRecord) {
    setEditingRecord(record);
    setEditDraft({ businessUnitId: record.businessUnitId, inquiryType: record.inquiryType });
    setNewSaleDraft({ saleType: "pedido", value: "" });
    setMessage(null);
  }

  async function saveEditRecord() {
    if (!editingRecord) return;
    setBusy(true);
    try {
      if (configured) {
        const { error } = await createClient().from("inquiries").update({
          business_unit_id: editDraft.businessUnitId,
          inquiry_type: editDraft.inquiryType,
        }).eq("id", editingRecord.id);
        if (error) throw error;
      }
      setRecords((current) => current.map((item) => item.id === editingRecord.id
        ? { ...item, businessUnitId: editDraft.businessUnitId, inquiryType: editDraft.inquiryType }
        : item));
      setMessage("Consulta actualizada.");
      setEditingRecord(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar la consulta."));
    } finally {
      setBusy(false);
    }
  }

  function canDeleteSale(entry: SalesEntry): boolean {
    return isAdmin || (currentUserId !== null && entry.createdBy === currentUserId);
  }

  async function addSaleToInquiry() {
    if (!editingRecord) return;
    const trimmed = newSaleDraft.value.trim();
    const value = Number(trimmed);
    if (trimmed === "" || Number.isNaN(value) || value < 0) {
      setMessage("El valor de la venta no es válido.");
      return;
    }
    setBusy(true);
    try {
      const occurredOn = editingRecord.createdAt.slice(0, 10);
      if (!configured) {
        const entry: SalesEntry = {
          id: `SE-${Date.now()}`,
          businessUnitId: editDraft.businessUnitId,
          saleType: newSaleDraft.saleType,
          entryMode: "inquiry",
          inquiryId: editingRecord.id,
          weekStart: null,
          occurredOn,
          count: 1,
          value,
          createdBy: "demo-admin",
          createdAt: new Date().toISOString(),
        };
        setSalesEntries((current) => [entry, ...current]);
      } else {
        const { data, error } = await createClient().from("sales_entries").insert({
          business_unit_id: editDraft.businessUnitId,
          sale_type: newSaleDraft.saleType,
          entry_mode: "inquiry",
          inquiry_id: editingRecord.id,
          occurred_on: occurredOn,
          count: 1,
          value,
        }).select("id, business_unit_id, sale_type, entry_mode, inquiry_id, week_start, occurred_on, count, value, created_by, created_at").single();
        if (error) throw error;
        setSalesEntries((current) => [mapSalesEntry(data as Record<string, unknown>), ...current]);
      }
      setNewSaleDraft({ saleType: "pedido", value: "" });
      setMessage("Venta añadida a la consulta.");
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo añadir la venta."));
    } finally {
      setBusy(false);
    }
  }

  function openEditSale(entry: SalesEntry) {
    setEditingSale(entry);
    setSaleEditDraft({ businessUnitId: entry.businessUnitId, saleType: entry.saleType, value: String(entry.value), count: String(entry.count) });
    setMessage(null);
  }

  async function saveEditSale() {
    if (!editingSale) return;
    const trimmedValue = saleEditDraft.value.trim();
    const value = Number(trimmedValue);
    if (trimmedValue === "" || Number.isNaN(value) || value < 0) {
      setMessage("El valor de la venta no es válido.");
      return;
    }
    let count = 1;
    if (editingSale.entryMode === "weekly") {
      const trimmedCount = saleEditDraft.count.trim();
      count = Number(trimmedCount);
      if (trimmedCount === "" || Number.isNaN(count) || count < 1 || !Number.isInteger(count)) {
        setMessage("La cantidad debe ser un número entero mayor que 0.");
        return;
      }
    }
    setBusy(true);
    try {
      if (configured) {
        const { error } = await createClient().from("sales_entries").update({
          business_unit_id: saleEditDraft.businessUnitId,
          sale_type: saleEditDraft.saleType,
          value,
          count,
        }).eq("id", editingSale.id);
        if (error) throw error;
      }
      setSalesEntries((current) => current.map((entry) => entry.id === editingSale.id
        ? { ...entry, businessUnitId: saleEditDraft.businessUnitId, saleType: saleEditDraft.saleType, value, count }
        : entry));
      setMessage("Venta actualizada.");
      setEditingSale(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar la venta."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteSale() {
    if (!pendingDeleteSale) return;
    setBusy(true);
    try {
      if (configured) {
        const { error } = await createClient().from("sales_entries").delete().eq("id", pendingDeleteSale.id);
        if (error) throw error;
      }
      setSalesEntries((current) => current.filter((entry) => entry.id !== pendingDeleteSale.id));
      setMessage("Venta eliminada.");
      setPendingDeleteSale(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar la venta. Solo puedes borrar tus propios registros de los últimos 10 minutos, o pide a un administrador."));
    } finally {
      setBusy(false);
    }
  }

  function openSaleChooser() {
    const defaultUnitId = registrationUnitId ?? units[0]?.id ?? "";
    setSaleChooserMode("menu");
    setQuickSaleUnitId(defaultUnitId);
    setQuickSaleInquiryId("");
    setQuickSaleType("pedido");
    setQuickSaleValue("");
    setWeeklyUnitId(defaultUnitId);
    setWeeklyDate(new Date().toISOString().slice(0, 10));
    setWeeklyDraft(blankWeeklyDraft());
    setSaleChooserOpen(true);
    setMessage(null);
  }

  function updateWeeklyDraft(type: SaleType, field: "count" | "value", value: string) {
    setWeeklyDraft((current) => ({ ...current, [type]: { ...current[type], [field]: value } }));
  }

  async function saveQuickInquirySale() {
    if (!quickSaleInquiryId) {
      setMessage("Selecciona una consulta.");
      return;
    }
    const trimmed = quickSaleValue.trim();
    const value = Number(trimmed);
    if (trimmed === "" || Number.isNaN(value) || value < 0) {
      setMessage("El valor de la venta no es válido.");
      return;
    }
    const record = records.find((item) => item.id === quickSaleInquiryId);
    if (!record) {
      setMessage("La consulta seleccionada ya no existe.");
      return;
    }
    setBusy(true);
    try {
      const occurredOn = record.createdAt.slice(0, 10);
      if (!configured) {
        const entry: SalesEntry = {
          id: `SE-${Date.now()}`,
          businessUnitId: record.businessUnitId,
          saleType: quickSaleType,
          entryMode: "inquiry",
          inquiryId: record.id,
          weekStart: null,
          occurredOn,
          count: 1,
          value,
          createdBy: "demo-admin",
          createdAt: new Date().toISOString(),
        };
        setSalesEntries((current) => [entry, ...current]);
      } else {
        const { data, error } = await createClient().from("sales_entries").insert({
          business_unit_id: record.businessUnitId,
          sale_type: quickSaleType,
          entry_mode: "inquiry",
          inquiry_id: record.id,
          occurred_on: occurredOn,
          count: 1,
          value,
        }).select("id, business_unit_id, sale_type, entry_mode, inquiry_id, week_start, occurred_on, count, value, created_by, created_at").single();
        if (error) throw error;
        setSalesEntries((current) => [mapSalesEntry(data as Record<string, unknown>), ...current]);
      }
      setMessage("Venta registrada correctamente.");
      setSaleChooserOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo registrar la venta."));
    } finally {
      setBusy(false);
    }
  }

  async function saveWeeklySales() {
    if (!weeklyUnitId) {
      setMessage("Selecciona una unidad de negocio.");
      return;
    }
    const weekStart = isoWeekStart(weeklyDate);
    const rows = saleTypeOrder
      .map((type) => ({ type, count: Number(weeklyDraft[type].count) || 0, value: Number(weeklyDraft[type].value) || 0 }))
      .filter((row) => row.count > 0 || row.value > 0);
    if (rows.length === 0) {
      setMessage("Añade al menos una cantidad o un valor.");
      return;
    }
    if (rows.some((row) => row.count <= 0)) {
      setMessage("Indica la cantidad de ventas para cada tipo con valor registrado.");
      return;
    }
    setBusy(true);
    try {
      if (!configured) {
        const newEntries: SalesEntry[] = rows.map((row) => ({
          id: `SE-${Date.now()}-${row.type}`,
          businessUnitId: weeklyUnitId,
          saleType: row.type,
          entryMode: "weekly",
          inquiryId: null,
          weekStart,
          occurredOn: weekStart,
          count: row.count,
          value: row.value,
          createdBy: "demo-admin",
          createdAt: new Date().toISOString(),
        }));
        setSalesEntries((current) => [...newEntries, ...current]);
      } else {
        const payload = rows.map((row) => ({
          business_unit_id: weeklyUnitId,
          sale_type: row.type,
          entry_mode: "weekly" as const,
          week_start: weekStart,
          occurred_on: weekStart,
          count: row.count,
          value: row.value,
        }));
        const { data, error } = await createClient().from("sales_entries").insert(payload)
          .select("id, business_unit_id, sale_type, entry_mode, inquiry_id, week_start, occurred_on, count, value, created_by, created_at");
        if (error) throw error;
        setSalesEntries((current) => [...(data ?? []).map((row) => mapSalesEntry(row as Record<string, unknown>)), ...current]);
      }
      setMessage("Ventas de la semana registradas correctamente.");
      setSaleChooserOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudieron registrar las ventas de la semana."));
    } finally {
      setBusy(false);
    }
  }

  function exportReportCsv() {
    const periodLabel = viewMode === "month" ? selectedMonth : String(selectedYear);
    const summary: CsvSummaryItem[] = [
      { label: "Periodo", value: viewMode === "month" ? monthLabel(selectedMonth) : `Año ${selectedYear}` },
      { label: "Consultas totales", value: total },
      { label: viewMode === "month" ? "Media diaria" : "Media mensual", value: (viewMode === "month" ? dailyAverage : monthlyAverage).toFixed(1).replace(".", ",") },
      { label: "Canal principal", value: topChannel ? `${inquiryChannelLabels[topChannel.channel]} (${topChannel.count})` : "—" },
      { label: "Unidad líder", value: topUnit ? `${topUnit.unit.name} (${topUnit.count})` : "—" },
      { label: "Ofertas (valor)", value: currencyFormatter.format(salesSummary.oferta.value) },
      { label: "Seguimientos (valor)", value: currencyFormatter.format(salesSummary.seguimiento.value) },
      { label: "Pedidos (valor)", value: currencyFormatter.format(salesSummary.pedido.value) },
    ];
    const unitReportRows = units
      .filter((unit) => selectedUnit === "all" || unit.id === selectedUnit)
      .map((unit) => {
        const unitCurrent = currentRecords.filter((record) => record.businessUnitId === unit.id);
        const unitPrevious = previousRecords.filter((record) => record.businessUnitId === unit.id);
        const unitVariation = unitPrevious.length ? ((unitCurrent.length - unitPrevious.length) / unitPrevious.length) * 100 : null;
        return { name: unit.name, total: unitCurrent.length, variation: unitVariation, counts: countsByChannel(unitCurrent) };
      });
    downloadCsvReport(`informe_consultas_${periodLabel}.csv`, summary, unitReportRows, [
      { header: "Unidad", value: (row) => row.name },
      { header: "Total", value: (row) => row.total },
      { header: "Variación (%)", value: (row) => row.variation === null ? "" : row.variation.toFixed(1).replace(".", ",") },
      ...inquiryChannelOrder.map((channel) => ({ header: inquiryChannelLabels[channel], value: (row: (typeof unitReportRows)[number]) => row.counts[channel] ?? 0 })),
    ]);
  }

  async function exportReportPdf() {
    if (!reportRef.current) return;
    setPdfBusy(true);
    try {
      const periodLabel = viewMode === "month" ? selectedMonth : String(selectedYear);
      await exportElementToPdf(reportRef.current, `informe_consultas_${periodLabel}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  }

  function exportInquiriesCsv() {
    const periodLabel = viewMode === "month" ? selectedMonth : String(selectedYear);
    downloadCsv(`consultas_${periodLabel}.csv`, filtered, [
      { header: "Fecha", value: (record) => formatDate(record.createdAt) },
      { header: "Unidad", value: (record) => units.find((unit) => unit.id === record.businessUnitId)?.name ?? "" },
      { header: "Canal", value: (record) => inquiryChannelLabels[record.inquiryType] },
      { header: "Venta asociada (€)", value: (record) => (salesByInquiry.get(record.id) ?? []).reduce((sum, entry) => sum + entry.value, 0) },
    ]);
  }

  function exportSalesCsv() {
    const periodLabel = viewMode === "month" ? selectedMonth : String(selectedYear);
    downloadCsv(`ventas_${periodLabel}.csv`, filteredSales, [
      { header: "Fecha", value: (entry) => formatDate(entry.occurredOn) },
      { header: "Unidad", value: (entry) => units.find((unit) => unit.id === entry.businessUnitId)?.name ?? "" },
      { header: "Tipo", value: (entry) => saleTypeLabels[entry.saleType] },
      { header: "Origen", value: (entry) => entry.entryMode === "inquiry" ? "Consulta" : "Semanal" },
      { header: "Cantidad", value: (entry) => entry.count },
      { header: "Valor (€)", value: (entry) => entry.value },
    ]);
  }

  function changeSort(column: ChannelTableColumn) {
    if (column === sortColumn) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortColumn(column);
      setSortDirection(column === "label" ? "asc" : "desc");
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Consultas no está disponible para tu rol.</p>
        </section>
      </div>
    );
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
            {registrableUnits.map((unit) => (
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
              <div className="inquiry-card-row">
                <div className="unit-card-heading">
                  <UnitBrandMark unit={registrationUnit} size={42} />
                  <div><h3>{registrationUnit.name}</h3></div>
                </div>
                <div className="inquiry-actions-inline">
                  {inquiryChannelOrder.map((channel) => (
                    <button key={channel} type="button" onClick={() => { setPending({ unit: registrationUnit, type: channel }); setPendingSaleType("none"); setPendingSaleValue(""); }} className="channel-chip">
                      <i className={`channel-dot channel-dot-${channel}`} />{inquiryChannelLabels[channel]}
                    </button>
                  ))}
                  <button type="button" className="button button-secondary" onClick={openSaleChooser}>+ Registrar venta</button>
                </div>
              </div>
            </article>
          ) : (
            <div className="notice"><strong>Elige una marca</strong><span>Selecciona una de las marcas de arriba para registrar una consulta.</span></div>
          )}
        </>
      ) : <div className="notice"><strong>Cuenta de solo lectura</strong><span>Puedes analizar las consultas, pero no registrar nuevas.</span></div>}

      <section className="section-heading inquiries-dashboard-heading">
        <div><span className="eyebrow">Estadísticas de consultas</span><h2>Dashboard de consultas</h2><p>Elige vista mensual o anual, filtra por unidad y canal. Las tablas se pueden ordenar pulsando sus encabezados.</p></div>
        <ReportExportButtons onExportCsv={exportReportCsv} onExportPdf={() => void exportReportPdf()} pdfBusy={pdfBusy} />
      </section>

      <CollapsibleFilters
        hasActiveFilters={selectedUnit !== "all" || viewMode !== "month" || compareMode !== "previous" || selectedType !== "all" || sortColumn !== "total" || sortDirection !== "desc"}
        onClear={() => {
          setSelectedUnit("all");
          setViewMode("month");
          setSelectedMonth(currentMonthKey);
          setCompareMode("previous");
          setSelectedType("all");
          setSortColumn("total");
          setSortDirection("desc");
        }}
      >
        <div className="filter-bar">
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
        </div>
        <div className="filter-bar inquiry-filters">
          <label><span>Canal</span><select value={selectedType} onChange={(event) => setSelectedType(event.target.value as "all" | InquiryType)}>
            <option value="all">Todos los canales</option>
            {inquiryChannelOrder.map((channel) => <option key={channel} value={channel}>{inquiryChannelLabels[channel]}</option>)}
          </select></label>
          <label><span>Orden inicial</span><select value={`${sortColumn}-${sortDirection}`} onChange={(event) => { const [column, direction] = event.target.value.split("-") as [ChannelTableColumn, "asc" | "desc"]; setSortColumn(column); setSortDirection(direction); }}>
            <option value="total-desc">Mayor total</option>
            <option value="trailing-desc">Mayor crecimiento</option>
            <option value="label-asc">Nombre A–Z</option>
          </select></label>
        </div>
      </CollapsibleFilters>

      <div ref={reportRef}>
      <section className="kpi-grid inquiry-kpi-grid">
        <KpiCard label="Consultas totales" value={numberFormatter.format(total)} delta={variation === null ? "Sin comparación" : formatPercent(Math.abs(variation))} positive={variation === null || variation >= 0} helper={comparisonHelper} />
        <KpiCard label={viewMode === "month" ? "Media diaria" : "Media mensual"} value={(viewMode === "month" ? dailyAverage : monthlyAverage).toFixed(1).replace(".", ",")} delta={viewMode === "month" ? `${elapsedDays} días analizados` : `${monthsElapsedInYear} meses analizados`} helper="" />
        <KpiCard label="Canal principal" value={topChannel ? inquiryChannelLabels[topChannel.channel] : "—"} delta={topChannel ? `${numberFormatter.format(topChannel.count)} consultas` : "Sin datos"} helper="" />
        <KpiCard label="Unidad líder" value={topUnit ? topUnit.unit.name : "—"} delta={topUnit ? `${numberFormatter.format(topUnit.count)} consultas` : "Sin datos"} helper="" />
      </section>

      <section className="section-heading">
        <div><span className="eyebrow">Ventas comerciales</span><h2>Ofertas, seguimientos y pedidos del periodo</h2><p>Cada venta se registra por consulta (al editarla) o de golpe por semana. La cantidad indica cuántas ventas componen el valor total.</p></div>
      </section>
      <section className="sales-summary-grid">
        {saleTypeOrder.map((type) => (
          <KpiCard key={type} label={saleTypeLabels[type]} value={currencyFormatter.format(salesSummary[type].value)} delta={`${numberFormatter.format(salesSummary[type].count)} ventas`} helper="del periodo seleccionado" />
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel chart-panel-wide">
          <div className="panel-heading"><div><span className="eyebrow">Evolución</span><h2>{viewMode === "month" ? monthLabel(selectedMonth) : `Año ${selectedYear}`}</h2></div><span className="muted">Web y telefónicas</span></div>
          <TrendChart
            data={trendData}
            series={[
              { key: "web", label: "Web", color: "#2563eb" },
              { key: "phone", label: "Telefónicas", color: "#06b6d4" },
            ]}
            ariaLabel="Evolución de consultas web y telefónicas"
          />
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
      </div>

      <section className="panel table-panel recent-inquiries">
        <div className="panel-heading">
          <div><span className="eyebrow">Control</span><h2>Últimos registros del periodo</h2></div>
          <div className="panel-heading-trailing">
            <span className="muted">Corrige un error editando el registro (unidad, canal o ventas asociadas), o elimínalo si no debía existir</span>
            <button type="button" className="button button-compact button-secondary" onClick={exportInquiriesCsv}>Exportar CSV</button>
          </div>
        </div>
        <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Canal</th><th>Ventas</th><th></th></tr></thead><tbody>{recentInquiries.slice(0, inquiriesExpanded ? recentInquiries.length : 5).map((record) => {
          const unit = units.find((item) => item.id === record.businessUnitId);
          const recordSales = salesByInquiry.get(record.id) ?? [];
          const recordSalesTotal = recordSales.reduce((sum, entry) => sum + entry.value, 0);
          return (
            <tr key={record.id}>
              <td>{formatDate(record.createdAt)}</td>
              <td>{unit?.name ?? "—"}</td>
              <td><span className={`badge badge-channel-${record.inquiryType}`}>{inquiryChannelLabels[record.inquiryType]}</span></td>
              <td>{recordSalesTotal ? currencyFormatter.format(recordSalesTotal) : "—"}</td>
              <td className="recent-inquiries-actions">
                {canRegister ? <button type="button" className="button button-compact button-secondary" onClick={() => openEditRecord(record)}>Editar</button> : null}
                {canDeleteRecord(record) ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDelete(record)}>Eliminar</button> : null}
              </td>
            </tr>
          );
        })}</tbody></table></div>
        {recentInquiries.length > 5 ? (
          <div className="table-panel-footer">
            <button type="button" className="button button-secondary button-compact" onClick={() => setInquiriesExpanded((current) => !current)}>
              {inquiriesExpanded ? "Mostrar menos" : `Mostrar más (${recentInquiries.length - 5} más)`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel table-panel recent-inquiries">
        <div className="panel-heading">
          <div><span className="eyebrow">Control</span><h2>Ventas recientes del periodo</h2></div>
          <div className="panel-heading-trailing">
            <span className="muted">Incluye ventas por consulta y bloques semanales. Corrige un error editando la venta, o elimínala si no debía existir</span>
            <button type="button" className="button button-compact button-secondary" onClick={exportSalesCsv}>Exportar CSV</button>
          </div>
        </div>
        <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Unidad</th><th>Tipo</th><th>Origen</th><th>Cantidad</th><th>Valor</th><th></th></tr></thead><tbody>{recentSales.slice(0, salesExpanded ? recentSales.length : 5).map((entry) => {
          const unit = units.find((item) => item.id === entry.businessUnitId);
          return (
            <tr key={entry.id}>
              <td>{formatDate(entry.occurredOn)}</td>
              <td>{unit?.name ?? "—"}</td>
              <td><span className="badge">{saleTypeLabels[entry.saleType]}</span></td>
              <td>{entry.entryMode === "inquiry" ? "Consulta" : "Semanal"}</td>
              <td>{numberFormatter.format(entry.count)}</td>
              <td>{currencyFormatter.format(entry.value)}</td>
              <td className="recent-inquiries-actions">
                {canRegister ? <button type="button" className="button button-compact button-secondary" onClick={() => openEditSale(entry)}>Editar</button> : null}
                {canDeleteSale(entry) ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDeleteSale(entry)}>Eliminar</button> : null}
              </td>
            </tr>
          );
        })}
        {recentSales.length === 0 ? <tr><td colSpan={7} className="muted">Sin ventas registradas en este periodo.</td></tr> : null}
        </tbody></table></div>
        {recentSales.length > 5 ? (
          <div className="table-panel-footer">
            <button type="button" className="button button-secondary button-compact" onClick={() => setSalesExpanded((current) => !current)}>
              {salesExpanded ? "Mostrar menos" : `Mostrar más (${recentSales.length - 5} más)`}
            </button>
          </div>
        ) : null}
      </section>

      <ConfirmationDialog
        open={Boolean(pending)}
        title={pending ? `¿Quieres registrar ${pending.type === "phone" ? "una consulta telefónica" : `una consulta de ${inquiryChannelLabels[pending.type]}`} para ${pending.unit.name}?` : "¿Quieres registrar la consulta?"}
        confirmLabel="Registrar consulta"
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmRegistration()}
      >
        {pending ? (
          <>
            <div className="confirmation-summary"><span>Unidad de negocio</span><strong>{pending.unit.name}</strong><span>Canal</span><strong>{inquiryChannelLabels[pending.type]}</strong><p>La fecha, la hora y tu usuario se guardarán automáticamente.</p></div>
            <div className="confirmation-sale-form">
              <label><span>Venta asociada (opcional)</span>
                <select value={pendingSaleType} onChange={(event) => setPendingSaleType(event.target.value as SaleType | "none")}>
                  <option value="none">Sin venta</option>
                  {saleTypeOrder.map((type) => <option key={type} value={type}>{saleTypeLabels[type]}</option>)}
                </select>
              </label>
              {pendingSaleType !== "none" ? (
                <label><span>Valor (€)</span><input type="number" min="0" step="0.01" placeholder="0,00" value={pendingSaleValue} onChange={(event) => setPendingSaleValue(event.target.value)} /></label>
              ) : null}
            </div>
          </>
        ) : null}
      </ConfirmationDialog>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar este registro?"
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteRecord()}
      >
        <p>Se eliminará esta consulta de las estadísticas. Esta acción no se puede deshacer.</p>
      </ConfirmationDialog>

      <Modal open={Boolean(editingRecord)} title="Editar consulta" eyebrow="Corregir registro" onClose={() => setEditingRecord(null)}>
        <div className="form-grid">
          <label><span>Unidad de negocio</span>
            <select value={editDraft.businessUnitId} onChange={(event) => setEditDraft((current) => ({ ...current, businessUnitId: event.target.value }))}>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label><span>Canal</span>
            <select value={editDraft.inquiryType} onChange={(event) => setEditDraft((current) => ({ ...current, inquiryType: event.target.value as InquiryType }))}>
              {inquiryChannelOrder.map((channel) => <option key={channel} value={channel}>{inquiryChannelLabels[channel]}</option>)}
            </select>
          </label>
        </div>

        <h3>Ventas de esta consulta</h3>
        {editingRecordSales.length > 0 ? (
          <div className="sale-entry-list">
            {editingRecordSales.map((entry) => (
              <div className="sale-entry-row" key={entry.id}>
                <div className="sale-entry-row-info">
                  <span className="badge">{saleTypeLabels[entry.saleType]}</span>
                  <strong>{currencyFormatter.format(entry.value)}</strong>
                </div>
                {canDeleteSale(entry) ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDeleteSale(entry)}>Eliminar</button> : null}
              </div>
            ))}
          </div>
        ) : <p className="muted">Todavía no hay ventas registradas en esta consulta.</p>}
        {canRegister ? (
          <div className="sale-entry-add-form">
            <label><span>Tipo</span>
              <select value={newSaleDraft.saleType} onChange={(event) => setNewSaleDraft((current) => ({ ...current, saleType: event.target.value as SaleType }))}>
                {saleTypeOrder.map((type) => <option key={type} value={type}>{saleTypeLabels[type]}</option>)}
              </select>
            </label>
            <label><span>Valor (€)</span>
              <input type="number" min="0" step="0.01" placeholder="0,00" value={newSaleDraft.value} onChange={(event) => setNewSaleDraft((current) => ({ ...current, value: event.target.value }))} />
            </label>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void addSaleToInquiry()}>Añadir venta</button>
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={() => setEditingRecord(null)}>Cerrar</button>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveEditRecord()}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingDeleteSale)}
        title="¿Eliminar esta venta?"
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onCancel={() => setPendingDeleteSale(null)}
        onConfirm={() => void confirmDeleteSale()}
      >
        {pendingDeleteSale ? <div className="confirmation-summary"><span>Tipo</span><strong>{saleTypeLabels[pendingDeleteSale.saleType]}</strong><span>Valor</span><strong>{currencyFormatter.format(pendingDeleteSale.value)}</strong></div> : null}
      </ConfirmationDialog>

      <Modal open={Boolean(editingSale)} title="Editar venta" eyebrow="Corregir registro" onClose={() => setEditingSale(null)}>
        <div className="form-grid">
          <label><span>Unidad de negocio</span>
            <select value={saleEditDraft.businessUnitId} onChange={(event) => setSaleEditDraft((current) => ({ ...current, businessUnitId: event.target.value }))}>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label><span>Tipo de venta</span>
            <select value={saleEditDraft.saleType} onChange={(event) => setSaleEditDraft((current) => ({ ...current, saleType: event.target.value as SaleType }))}>
              {saleTypeOrder.map((type) => <option key={type} value={type}>{saleTypeLabels[type]}</option>)}
            </select>
          </label>
          <label><span>Valor (€)</span>
            <input type="number" min="0" step="0.01" value={saleEditDraft.value} onChange={(event) => setSaleEditDraft((current) => ({ ...current, value: event.target.value }))} />
          </label>
          {editingSale?.entryMode === "weekly" ? (
            <label><span>Cantidad</span>
              <input type="number" min="1" step="1" value={saleEditDraft.count} onChange={(event) => setSaleEditDraft((current) => ({ ...current, count: event.target.value }))} />
            </label>
          ) : null}
        </div>
        {editingSale?.entryMode === "inquiry" ? <p className="muted">Esta venta está vinculada a una consulta concreta, por eso la cantidad es siempre 1.</p> : null}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={() => setEditingSale(null)}>Cerrar</button>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveEditSale()}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </Modal>

      <Modal
        open={saleChooserOpen}
        title="Registrar venta"
        eyebrow={saleChooserMode === "menu" ? "Elige un tipo de registro" : saleChooserMode === "inquiry" ? "Venta de una consulta" : "Venta por periodo"}
        onClose={() => setSaleChooserOpen(false)}
      >
        {saleChooserMode === "menu" ? (
          <section className="brand-picker">
            <button type="button" className="brand-tile department-tile" onClick={() => setSaleChooserMode("inquiry")}>
              <strong>Venta de una consulta</strong>
              <span>Vincula el tipo y el valor de la venta a una consulta ya registrada.</span>
            </button>
            <button type="button" className="brand-tile department-tile" onClick={() => setSaleChooserMode("weekly")}>
              <strong>Venta por periodo</strong>
              <span>Registra de golpe el total de ventas de una semana, por tipo.</span>
            </button>
          </section>
        ) : null}

        {saleChooserMode === "inquiry" ? (
          <>
            <div className="form-grid">
              <label><span>Unidad de negocio</span>
                <select value={quickSaleUnitId} onChange={(event) => { setQuickSaleUnitId(event.target.value); setQuickSaleInquiryId(""); }}>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </label>
              <label><span>Consulta</span>
                <select value={quickSaleInquiryId} onChange={(event) => setQuickSaleInquiryId(event.target.value)}>
                  <option value="">Selecciona una consulta</option>
                  {quickSaleUnitRecords.map((record) => (
                    <option key={record.id} value={record.id}>{formatDate(record.createdAt)} · {inquiryChannelLabels[record.inquiryType]}</option>
                  ))}
                </select>
              </label>
              <label><span>Tipo de venta</span>
                <select value={quickSaleType} onChange={(event) => setQuickSaleType(event.target.value as SaleType)}>
                  {saleTypeOrder.map((type) => <option key={type} value={type}>{saleTypeLabels[type]}</option>)}
                </select>
              </label>
              <label><span>Valor (€)</span>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={quickSaleValue} onChange={(event) => setQuickSaleValue(event.target.value)} />
              </label>
            </div>
            {quickSaleUnitRecords.length === 0 ? <p className="muted">No hay consultas recientes registradas para esta unidad.</p> : null}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setSaleChooserMode("menu")}>Atrás</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveQuickInquirySale()}>{busy ? "Guardando…" : "Guardar venta"}</button>
            </div>
          </>
        ) : null}

        {saleChooserMode === "weekly" ? (
          <>
            <div className="form-grid">
              <label><span>Unidad de negocio</span>
                <select value={weeklyUnitId} onChange={(event) => setWeeklyUnitId(event.target.value)}>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </label>
              <label><span>Semana (elige cualquier día)</span>
                <input type="date" value={weeklyDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setWeeklyDate(event.target.value)} />
              </label>
            </div>
            <p className="muted">Semana del {formatDate(isoWeekStart(weeklyDate))}. Indica cuántas ventas de cada tipo y su valor total en euros.</p>
            <div className="weekly-sales-grid">
              {saleTypeOrder.map((type) => (
                <div className="weekly-sales-row" key={type}>
                  <strong>{saleTypeLabels[type]}</strong>
                  <label><span>Cantidad</span><input type="number" min="0" step="1" placeholder="0" value={weeklyDraft[type].count} onChange={(event) => updateWeeklyDraft(type, "count", event.target.value)} /></label>
                  <label><span>Valor total (€)</span><input type="number" min="0" step="0.01" placeholder="0,00" value={weeklyDraft[type].value} onChange={(event) => updateWeeklyDraft(type, "value", event.target.value)} /></label>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setSaleChooserMode("menu")}>Atrás</button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveWeeklySales()}>{busy ? "Guardando…" : "Guardar ventas"}</button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
