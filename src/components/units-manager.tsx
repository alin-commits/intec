"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import { hasAnyRole } from "@/lib/constants";
import { businessUnits as demoBusinessUnits, monthlyStats as demoMonthlyStats } from "@/lib/demo-data";
import { monthKey, monthRange } from "@/lib/dates";
import { reportSafeError } from "@/lib/errors";
import { formatPercent } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit } from "@/lib/types";

const LOGO_BUCKET = "business-unit-logos";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

type UnitDraft = { name: string; slug: string; accent: string; active: boolean; visibleInConsultas: boolean; visibleInLeads: boolean };
type UnitStats = { inquiries: number; leads: number; won: number };

const DIACRITICS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function slugify(value: string): string {
  return value
    .normalize("NFD").replace(DIACRITICS_PATTERN, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function blankDraft(): UnitDraft {
  return { name: "", slug: "", accent: "#2563eb", active: true, visibleInConsultas: true, visibleInLeads: true };
}

function mapUnitRow(row: Record<string, unknown>): BusinessUnit {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    accent: row.brand_color ? String(row.brand_color) : "#2563eb",
    active: Boolean(row.is_active),
    logo: row.logo_url ? String(row.logo_url) : null,
    sortOrder: Number(row.sort_order ?? 0),
    visibleInConsultas: row.visible_in_consultas !== false,
    visibleInLeads: row.visible_in_leads !== false,
  };
}

function demoStats(): Record<string, UnitStats> {
  const currentMonth = monthKey();
  const entries = demoBusinessUnits.map((unit) => {
    const row = demoMonthlyStats.find((item) => item.month === currentMonth && item.businessUnitId === unit.id);
    return [unit.id, { inquiries: (row?.web ?? 0) + (row?.phone ?? 0), leads: row?.leads ?? 0, won: row?.won ?? 0 }] as const;
  });
  return Object.fromEntries(entries);
}

export function UnitsManager() {
  const configured = isSupabaseConfigured();
  const [units, setUnits] = useState<BusinessUnit[]>(() => configured ? [] : demoBusinessUnits);
  const [stats, setStats] = useState<Record<string, UnitStats>>(() => configured ? {} : demoStats());
  const [isAdmin, setIsAdmin] = useState(!configured);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UnitDraft>(() => blankDraft());
  const [slugTouched, setSlugTouched] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BusinessUnit | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  async function loadRealData() {
    const supabase = createClient();
    const range = monthRange(monthKey());
    const [{ data: unitData, error: unitError }, { data: inquiryData }, { data: leadData }, { data: authData }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").order("sort_order"),
      supabase.from("inquiries").select("business_unit_id").gte("created_at", range.start).lt("created_at", range.end),
      supabase.from("leads").select("business_unit_id, status").gte("created_at", range.start).lt("created_at", range.end),
      supabase.auth.getUser(),
    ]);
    if (unitError) {
      setMessage(reportSafeError(unitError, "No se pudieron cargar las unidades."));
      return;
    }
    setUnits((unitData ?? []).map((row) => mapUnitRow(row as Record<string, unknown>)));

    const nextStats: Record<string, UnitStats> = {};
    function bucket(id: string): UnitStats {
      if (!nextStats[id]) nextStats[id] = { inquiries: 0, leads: 0, won: 0 };
      return nextStats[id];
    }
    for (const row of inquiryData ?? []) bucket(row.business_unit_id as string).inquiries += 1;
    for (const row of leadData ?? []) {
      const entry = bucket(row.business_unit_id as string);
      entry.leads += 1;
      if (row.status === "won") entry.won += 1;
    }
    setStats(nextStats);

    const user = authData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      setIsAdmin(Boolean(profile && hasAnyRole(profile.roles, ["admin"])));
      setAccess("allowed");
    } else {
      setAccess("denied");
    }
  }

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft());
    setSlugTouched(false);
    setLogoFile(null);
    setLogoError(null);
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(unit: BusinessUnit) {
    setEditingId(unit.id);
    setDraft({ name: unit.name, slug: unit.slug, accent: unit.accent, active: unit.active, visibleInConsultas: unit.visibleInConsultas, visibleInLeads: unit.visibleInLeads });
    setSlugTouched(true);
    setLogoFile(null);
    setLogoError(null);
    setEditorOpen(true);
    setMessage(null);
  }

  function updateName(name: string) {
    setDraft((current) => ({ ...current, name, slug: slugTouched ? current.slug : slugify(name) }));
  }

  function handleLogoChange(fileList: FileList | null) {
    setLogoError(null);
    const file = fileList?.[0] ?? null;
    if (!file) {
      setLogoFile(null);
      return;
    }
    if (!ALLOWED_LOGO_TYPES[file.type]) {
      setLogoError("El logo debe ser JPG, PNG, WEBP o SVG.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("El logo debe pesar como máximo 2 MB.");
      return;
    }
    setLogoFile(file);
  }

  async function saveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.slug.trim()) {
      setMessage("Indica un nombre y un identificador (slug) para la unidad.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const previous = editingId ? units.find((unit) => unit.id === editingId) : null;
        const nextUnit: BusinessUnit = {
          id: editingId ?? `demo-${Date.now()}`,
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          accent: draft.accent,
          active: draft.active,
          logo: logoFile ? URL.createObjectURL(logoFile) : (previous?.logo ?? null),
          sortOrder: previous?.sortOrder ?? units.length,
          visibleInConsultas: draft.visibleInConsultas,
          visibleInLeads: draft.visibleInLeads,
        };
        setUnits((current) => editingId ? current.map((unit) => unit.id === editingId ? nextUnit : unit) : [...current, nextUnit]);
        setMessage(editingId ? "Unidad actualizada en el modo demostración." : "Unidad creada en el modo demostración.");
        setEditorOpen(false);
        return;
      }

      const supabase = createClient();
      let logoUrl: string | null = editingId ? (units.find((unit) => unit.id === editingId)?.logo ?? null) : null;
      if (logoFile) {
        const extension = ALLOWED_LOGO_TYPES[logoFile.type];
        const path = `${draft.slug.trim()}-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, logoFile, { contentType: logoFile.type });
        if (uploadError) throw uploadError;
        logoUrl = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const payload = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        brand_color: draft.accent,
        is_active: draft.active,
        logo_url: logoUrl,
        visible_in_consultas: draft.visibleInConsultas,
        visible_in_leads: draft.visibleInLeads,
        ...(editingId ? {} : { sort_order: units.length }),
      };
      const result = editingId
        ? await supabase.from("business_units").update(payload).eq("id", editingId)
        : await supabase.from("business_units").insert(payload);
      if (result.error) throw result.error;
      await loadRealData();
      setMessage(editingId ? "Unidad actualizada correctamente." : "Unidad creada correctamente.");
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar la unidad. Comprueba que el nombre y el identificador no estén ya en uso."));
    } finally {
      setBusy(false);
    }
  }

  async function moveUnit(unit: BusinessUnit, direction: "up" | "down") {
    const sorted = [...units].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = sorted.findIndex((item) => item.id === unit.id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const other = sorted[swapIndex];
    setUnits((current) => current.map((item) => {
      if (item.id === unit.id) return { ...item, sortOrder: other.sortOrder };
      if (item.id === other.id) return { ...item, sortOrder: unit.sortOrder };
      return item;
    }));
    if (!configured) return;
    const supabase = createClient();
    const [a, b] = await Promise.all([
      supabase.from("business_units").update({ sort_order: other.sortOrder }).eq("id", unit.id),
      supabase.from("business_units").update({ sort_order: unit.sortOrder }).eq("id", other.id),
    ]);
    if (a.error || b.error) {
      setMessage(reportSafeError(a.error ?? b.error, "No se pudo reordenar la unidad."));
      await loadRealData();
    }
  }

  async function confirmDeleteUnit() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        setUnits((current) => current.filter((unit) => unit.id !== pendingDelete.id));
        setMessage("Unidad eliminada en el modo demostración.");
        setPendingDelete(null);
        return;
      }
      const supabase = createClient();
      const [{ count: inquiriesCount }, { count: leadsCount }, { count: campaignsCount }, { count: salesCount }] = await Promise.all([
        supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("business_unit_id", pendingDelete.id),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_unit_id", pendingDelete.id),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("business_unit_id", pendingDelete.id),
        supabase.from("sales_entries").select("id", { count: "exact", head: true }).eq("business_unit_id", pendingDelete.id),
      ]);
      if ((inquiriesCount ?? 0) + (leadsCount ?? 0) + (campaignsCount ?? 0) + (salesCount ?? 0) > 0) {
        setMessage("No se puede eliminar: esta unidad tiene consultas, leads, campañas o ventas registradas. Desactívala en su lugar para conservar el historial.");
        setPendingDelete(null);
        return;
      }
      const { error } = await supabase.from("business_units").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      if (pendingDelete.logo?.includes(`/${LOGO_BUCKET}/`)) {
        const logoPath = pendingDelete.logo.split(`/${LOGO_BUCKET}/`)[1];
        if (logoPath) await supabase.storage.from(LOGO_BUCKET).remove([logoPath]);
      }
      setUnits((current) => current.filter((unit) => unit.id !== pendingDelete.id));
      setMessage("Unidad eliminada correctamente.");
      setPendingDelete(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar la unidad."));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Unidades no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Configuración</span><h2>Unidades de negocio</h2><p>Las marcas internas organizan consultas, campañas, leads y estadísticas.</p></div>
        {isAdmin ? <button type="button" className="button button-primary" onClick={openNew}>+ Nueva unidad</button> : null}
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <section className="units-grid">
        {[...units].sort((a, b) => a.sortOrder - b.sortOrder).map((unit, index, sorted) => {
          const unitStats = stats[unit.id] ?? { inquiries: 0, leads: 0, won: 0 };
          const conversion = unitStats.leads ? (unitStats.won / unitStats.leads) * 100 : 0;
          return (
            <article className="panel unit-summary" key={unit.id}>
              <div className="unit-summary-heading">
                <UnitBrandMark unit={unit} size={48} />
                {unit.active ? null : <span className="badge">Inactiva</span>}
              </div>
              <h3>{unit.name}</h3>
              <p>{unitStats.inquiries} consultas · {unitStats.leads} leads · {formatPercent(conversion)} conversión</p>
              <p className="muted">{unit.visibleInConsultas ? "En Consultas" : "Oculta en Consultas"} · {unit.visibleInLeads ? "En Leads" : "Oculta en Leads"}</p>
              {isAdmin ? (
                <div className="modal-actions unit-summary-actions">
                  <button type="button" className="button button-compact button-secondary" onClick={() => moveUnit(unit, "up")} disabled={index === 0} aria-label={`Subir ${unit.name}`}>↑</button>
                  <button type="button" className="button button-compact button-secondary" onClick={() => moveUnit(unit, "down")} disabled={index === sorted.length - 1} aria-label={`Bajar ${unit.name}`}>↓</button>
                  <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(unit)}>Editar</button>
                  <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDelete(unit)}>Eliminar</button>
                </div>
              ) : null}
            </article>
          );
        })}
        {units.length === 0 ? <div className="notice"><strong>Sin unidades</strong><span>Crea la primera unidad de negocio para empezar.</span></div> : null}
      </section>

      <Modal open={editorOpen} title={editingId ? "Editar unidad" : "Nueva unidad"} eyebrow="Configuración" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveUnit}>
          <div className="form-grid">
            <label><span>Nombre *</span><input value={draft.name} onChange={(event) => updateName(event.target.value)} required /></label>
            <label><span>Identificador (slug) *</span><input value={draft.slug} onChange={(event) => { setSlugTouched(true); setDraft((current) => ({ ...current, slug: event.target.value })); }} required /></label>
            <label><span>Color de marca</span><input type="color" value={draft.accent} onChange={(event) => setDraft((current) => ({ ...current, accent: event.target.value }))} /></label>
            <label><span>Estado</span>
              <select value={draft.active ? "active" : "inactive"} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.value === "active" }))}>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>
            </label>
            <label className="form-field-wide"><span>Logo (JPG, PNG, WEBP o SVG, máx. 2 MB)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={(event) => handleLogoChange(event.target.files)} />
            </label>
            <div className="form-field-wide visibility-toggle-group">
              <span className="visibility-toggle-group-label">Visibilidad por categoría</span>
              <label className="visibility-toggle">
                <span>Aparece en Consultas</span>
                <span className="switch">
                  <input type="checkbox" checked={draft.visibleInConsultas} onChange={(event) => setDraft((current) => ({ ...current, visibleInConsultas: event.target.checked }))} />
                  <span className="switch-track"><span className="switch-thumb" /></span>
                </span>
              </label>
              <label className="visibility-toggle">
                <span>Aparece en Leads</span>
                <span className="switch">
                  <input type="checkbox" checked={draft.visibleInLeads} onChange={(event) => setDraft((current) => ({ ...current, visibleInLeads: event.target.checked }))} />
                  <span className="switch-track"><span className="switch-thumb" /></span>
                </span>
              </label>
            </div>
          </div>
          {logoError ? <div className="form-error form-field-wide" role="alert">{logoError}</div> : null}
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar unidad"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar esta unidad?"
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteUnit()}
      >
        {pendingDelete ? (
          <div className="confirmation-summary">
            <span>Unidad</span><strong>{pendingDelete.name}</strong>
            <p>Solo se puede eliminar si no tiene consultas, leads, campañas ni ventas registradas. Si las tiene, desactívala en su lugar.</p>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
