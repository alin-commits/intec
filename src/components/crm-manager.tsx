"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { CRM_EDIT_ROLES, CRM_ROLES, hasAnyRole } from "@/lib/constants";
import { downloadCsv } from "@/lib/csv-export";
import { businessUnits as demoBusinessUnits, demoCrmContacts } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit, CrmContact } from "@/lib/types";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";

type ContactDraft = {
  businessUnitId: string;
  fullName: string;
  companyName: string;
  phone: string;
  city: string;
  companyEmail: string;
  notes: string;
};

function blankDraft(units: BusinessUnit[]): ContactDraft {
  return {
    businessUnitId: units[0]?.id ?? "",
    fullName: "",
    companyName: "",
    phone: "",
    city: "",
    companyEmail: "",
    notes: "",
  };
}

function mapContactRow(row: Record<string, unknown>): CrmContact {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    fullName: String(row.full_name ?? ""),
    companyName: row.company_name ? String(row.company_name) : null,
    phone: row.phone ? String(row.phone) : null,
    city: row.city ? String(row.city) : null,
    companyEmail: row.company_email ? String(row.company_email) : null,
    notes: row.notes ? String(row.notes) : null,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function CrmManager() {
  const configured = isSupabaseConfigured();
  const [contacts, setContacts] = useState<CrmContact[]>(() => configured ? [] : demoCrmContacts);
  const [units, setUnits] = useState<BusinessUnit[]>(() => demoBusinessUnits.filter((unit) => unit.active));
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(() => blankDraft(demoBusinessUnits.filter((unit) => unit.active)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(!configured);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [pendingDelete, setPendingDelete] = useState<CrmContact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [viewingContact, setViewingContact] = useState<CrmContact | null>(null);

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  async function loadRealData() {
    const supabase = createClient();
    const [{ data: unitData, error: unitError }, { data: contactData, error: contactError }, { data: authData }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").eq("is_active", true).order("sort_order"),
      supabase.from("crm_contacts").select("id, business_unit_id, full_name, company_name, phone, city, company_email, notes, created_by, created_at, updated_at").order("created_at", { ascending: false }),
      supabase.auth.getUser(),
    ]);
    if (unitError || contactError) {
      setMessage(reportSafeError(unitError ?? contactError, "No se pudieron cargar los contactos."));
      return;
    }
    const mappedUnits: BusinessUnit[] = (unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true }));
    setUnits(mappedUnits);
    setContacts((contactData ?? []).map((row) => mapContactRow(row as Record<string, unknown>)));
    const user = authData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      setCanEdit(Boolean(profile && hasAnyRole(profile.roles, CRM_EDIT_ROLES)));
      setAccess(profile && hasAnyRole(profile.roles, CRM_ROLES) ? "allowed" : "denied");
    } else {
      setAccess("denied");
    }
  }

  const visibleContacts = useMemo(() => contacts.filter((contact) => {
    const matchesQuery = `${contact.fullName} ${contact.companyName ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unitFilter === "all" || contact.businessUnitId === unitFilter);
  }), [contacts, query, unitFilter]);

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft(units));
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(contact: CrmContact) {
    setEditingId(contact.id);
    setDraft({
      businessUnitId: contact.businessUnitId,
      fullName: contact.fullName,
      companyName: contact.companyName ?? "",
      phone: contact.phone ?? "",
      city: contact.city ?? "",
      companyEmail: contact.companyEmail ?? "",
      notes: contact.notes ?? "",
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.fullName.trim() || !draft.businessUnitId) {
      setMessage("Indica al menos el nombre y la unidad de negocio.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const previous = editingId ? contacts.find((contact) => contact.id === editingId) : null;
        const nextContact: CrmContact = {
          id: editingId ?? `demo-crm-${Date.now()}`,
          businessUnitId: draft.businessUnitId,
          fullName: draft.fullName.trim(),
          companyName: draft.companyName.trim() || null,
          phone: draft.phone.trim() || null,
          city: draft.city.trim() || null,
          companyEmail: draft.companyEmail.trim() || null,
          notes: draft.notes.trim() || null,
          createdBy: previous?.createdBy ?? "demo-admin",
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setContacts((current) => editingId ? current.map((contact) => contact.id === editingId ? nextContact : contact) : [nextContact, ...current]);
        setMessage(editingId ? "Contacto actualizado en el modo demostración." : "Contacto creado en el modo demostración.");
        setEditorOpen(false);
        return;
      }

      const supabase = createClient();
      const payload = {
        business_unit_id: draft.businessUnitId,
        full_name: draft.fullName.trim(),
        company_name: draft.companyName.trim() || null,
        phone: draft.phone.trim() || null,
        city: draft.city.trim() || null,
        company_email: draft.companyEmail.trim() || null,
        notes: draft.notes.trim() || null,
      };
      const result = editingId
        ? await supabase.from("crm_contacts").update(payload).eq("id", editingId)
        : await supabase.from("crm_contacts").insert(payload);
      if (result.error) throw result.error;
      await loadRealData();
      setMessage(editingId ? "Contacto actualizado correctamente." : "Contacto creado correctamente.");
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar el contacto."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteContact() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        setContacts((current) => current.filter((contact) => contact.id !== pendingDelete.id));
        setMessage("Contacto eliminado en el modo demostración.");
        setPendingDelete(null);
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.from("crm_contacts").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      setContacts((current) => current.filter((contact) => contact.id !== pendingDelete.id));
      setMessage("Contacto eliminado correctamente.");
      setPendingDelete(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar el contacto."));
    } finally {
      setDeleteBusy(false);
    }
  }

  function exportContactsCsv() {
    const unit = unitFilter === "all" ? null : units.find((item) => item.id === unitFilter);
    const scopeSlug = unit ? unit.slug : "todas";
    downloadCsv(`crm_contactos_${scopeSlug}_${new Date().toISOString().slice(0, 10)}.csv`, visibleContacts, [
      { header: "Nombre", value: (contact) => contact.fullName },
      { header: "Empresa", value: (contact) => contact.companyName ?? "" },
      { header: "Unidad", value: (contact) => units.find((item) => item.id === contact.businessUnitId)?.name ?? "" },
      { header: "Teléfono", value: (contact) => contact.phone ?? "" },
      { header: "Correo", value: (contact) => contact.companyEmail ?? "" },
      { header: "Población", value: (contact) => contact.city ?? "" },
      { header: "Notas", value: (contact) => contact.notes ?? "" },
      { header: "Creado", value: (contact) => formatDate(contact.createdAt) },
    ]);
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>CRM no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Base comercial</span><h2>CRM</h2><p>Contactos generados a través de campañas o consultas, organizados por empresa.</p></div>
        <div className="panel-heading-trailing">
          <button type="button" className="button button-compact button-secondary" onClick={exportContactsCsv}>Exportar CSV</button>
          {canEdit ? <button type="button" className="button button-primary" onClick={openNew}>+ Nuevo contacto</button> : null}
        </div>
      </section>

      {!canEdit ? <div className="notice"><strong>Cuenta de solo lectura</strong><span>Puedes consultar los contactos, pero no crear ni editar registros.</span></div> : null}

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <CollapsibleFilters
        hasActiveFilters={query !== "" || unitFilter !== "all"}
        onClear={() => { setQuery(""); setUnitFilter("all"); }}
        resultCount={visibleContacts.length}
        resultLabel="Contactos"
      >
        <div className="filter-bar">
          <label><span>Buscar</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Nombre o empresa" /></label>
          <label><span>Unidad</span>
            <select value={unitFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setUnitFilter(event.target.value)}>
              <option value="all">Todas</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
        </div>
      </CollapsibleFilters>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nombre</th><th>Empresa</th><th>Unidad</th><th>Teléfono</th><th>Correo</th><th>Población</th><th>Creado</th><th></th></tr></thead>
            <tbody>
              {visibleContacts.map((contact) => {
                const unit = units.find((item) => item.id === contact.businessUnitId);
                return (
                  <tr key={contact.id} className="table-row-clickable" onClick={() => setViewingContact(contact)}>
                    <td><strong>{contact.fullName}</strong></td>
                    <td>{contact.companyName || "—"}</td>
                    <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span></td>
                    <td>{contact.phone || "—"}</td>
                    <td>{contact.companyEmail || "—"}</td>
                    <td>{contact.city || "—"}</td>
                    <td>{formatDate(contact.createdAt)}</td>
                    <td>{canEdit ? <button type="button" className="button button-compact button-secondary" onClick={(event) => { event.stopPropagation(); openEdit(contact); }}>Editar</button> : null}</td>
                  </tr>
                );
              })}
              {visibleContacts.length === 0 ? <tr><td colSpan={8} className="muted">Sin contactos que coincidan con los filtros.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={editorOpen} title={editingId ? "Editar contacto" : "Nuevo contacto"} eyebrow="CRM" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveContact}>
          <div className="form-grid">
            <label><span>Unidad de negocio *</span>
              <select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value)}>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <label><span>Nombre *</span><input value={draft.fullName} readOnly={!canEdit} onChange={(event) => updateDraft("fullName", event.target.value)} /></label>
            <label><span>Empresa</span><input value={draft.companyName} readOnly={!canEdit} onChange={(event) => updateDraft("companyName", event.target.value)} /></label>
            <label><span>Teléfono</span><input value={draft.phone} readOnly={!canEdit} onChange={(event) => updateDraft("phone", event.target.value)} /></label>
            <label><span>Correo</span><input type="email" value={draft.companyEmail} readOnly={!canEdit} onChange={(event) => updateDraft("companyEmail", event.target.value)} /></label>
            <label><span>Población</span><input value={draft.city} readOnly={!canEdit} onChange={(event) => updateDraft("city", event.target.value)} /></label>
            <label className="form-field-wide"><span>Notas</span><textarea rows={4} value={draft.notes} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>
            {canEdit && editingId ? <button type="button" className="button button-danger" onClick={() => { setEditorOpen(false); setPendingDelete(contacts.find((item) => item.id === editingId) ?? null); }}>Eliminar</button> : null}
            {canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar contacto"}</button> : null}
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(viewingContact)} title={viewingContact?.fullName ?? "Contacto"} eyebrow="CRM" onClose={() => setViewingContact(null)}>
        {viewingContact ? (
          <div className="ticket-details">
            <div className="ticket-details-grid">
              <div><span>Empresa</span><strong>{viewingContact.companyName || "—"}</strong></div>
              <div><span>Unidad</span><strong>{units.find((unit) => unit.id === viewingContact.businessUnitId)?.name ?? "—"}</strong></div>
              <div><span>Teléfono</span><strong>{viewingContact.phone || "—"}</strong></div>
              <div><span>Correo</span><strong>{viewingContact.companyEmail || "—"}</strong></div>
              <div><span>Población</span><strong>{viewingContact.city || "—"}</strong></div>
              <div><span>Creado</span><strong>{formatDate(viewingContact.createdAt)}</strong></div>
            </div>
            <div className="ticket-details-section">
              <h3>Notas</h3>
              <p>{viewingContact.notes || "Sin notas."}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setViewingContact(null)}>Cerrar</button>
              {canEdit ? <button type="button" className="button button-primary" onClick={() => { const contact = viewingContact; setViewingContact(null); if (contact) openEdit(contact); }}>Editar</button> : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar este contacto?"
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteContact()}
      >
        {pendingDelete ? (
          <div className="confirmation-summary">
            <span>Contacto</span><strong>{pendingDelete.fullName}</strong>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
