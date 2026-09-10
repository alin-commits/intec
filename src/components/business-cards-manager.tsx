"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import { CARDS_ROLES, hasAnyRole } from "@/lib/constants";
import { businessUnits as demoBusinessUnits, demoBusinessCards } from "@/lib/demo-data";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessCard, BusinessUnit } from "@/lib/types";

type CardDraft = {
  businessUnitId: string;
  slug: string;
  fullName: string;
  position: string;
  phone: string;
  email: string;
  website: string;
  companyAddress: string;
  instagramUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  primaryColor: string;
  active: boolean;
};

const DIACRITICS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function slugify(value: string): string {
  return value
    .normalize("NFD").replace(DIACRITICS_PATTERN, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function blankDraft(defaultUnitId: string, defaultColor: string): CardDraft {
  return {
    businessUnitId: defaultUnitId,
    slug: "",
    fullName: "",
    position: "",
    phone: "",
    email: "",
    website: "",
    companyAddress: "",
    instagramUrl: "",
    facebookUrl: "",
    linkedinUrl: "",
    primaryColor: defaultColor,
    active: true,
  };
}

function mapCardRow(row: Record<string, unknown>): BusinessCard {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    slug: String(row.slug),
    fullName: String(row.full_name),
    position: String(row.position),
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    website: row.website ? String(row.website) : null,
    companyAddress: row.company_address ? String(row.company_address) : null,
    instagramUrl: row.instagram_url ? String(row.instagram_url) : null,
    facebookUrl: row.facebook_url ? String(row.facebook_url) : null,
    linkedinUrl: row.linkedin_url ? String(row.linkedin_url) : null,
    primaryColor: row.primary_color ? String(row.primary_color) : "#2563eb",
    active: Boolean(row.is_active),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  };
}

export function BusinessCardsManager() {
  const configured = isSupabaseConfigured();
  const [units, setUnits] = useState<BusinessUnit[]>(() => configured ? [] : demoBusinessUnits);
  const [cards, setCards] = useState<BusinessCard[]>(() => configured ? [] : demoBusinessCards);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDraft>(() => blankDraft(units[0]?.id ?? "", units[0]?.accent ?? "#2563eb"));
  const [slugTouched, setSlugTouched] = useState(false);
  const [colorTouched, setColorTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BusinessCard | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  async function loadRealData() {
    const supabase = createClient();
    const [{ data: unitData, error: unitError }, { data: cardData, error: cardError }, { data: authData }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").eq("is_active", true).order("sort_order"),
      supabase.from("business_cards").select("id, business_unit_id, slug, full_name, position, phone, email, website, company_address, instagram_url, facebook_url, linkedin_url, primary_color, is_active, created_by, created_at").order("created_at", { ascending: false }),
      supabase.auth.getUser(),
    ]);
    if (unitError || cardError) {
      setMessage(reportSafeError(unitError ?? cardError, "No se pudieron cargar las tarjetas."));
      return;
    }
    const mappedUnits = (unitData ?? []).map((row) => ({
      id: String(row.id), name: String(row.name), slug: String(row.slug),
      accent: row.brand_color ? String(row.brand_color) : "#2563eb",
      active: Boolean(row.is_active), logo: row.logo_url ? String(row.logo_url) : null,
      sortOrder: Number(row.sort_order ?? 0),
      visibleInConsultas: row.visible_in_consultas !== false,
      visibleInLeads: row.visible_in_leads !== false,
    }));
    setUnits(mappedUnits);
    setCards((cardData ?? []).map((row) => mapCardRow(row as Record<string, unknown>)));

    const user = authData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      setAccess(profile && hasAnyRole(profile.roles, CARDS_ROLES) ? "allowed" : "denied");
    } else {
      setAccess("denied");
    }
  }

  function unitOf(id: string): BusinessUnit | undefined {
    return units.find((unit) => unit.id === id);
  }

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft(units[0]?.id ?? "", units[0]?.accent ?? "#2563eb"));
    setSlugTouched(false);
    setColorTouched(false);
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(card: BusinessCard) {
    setEditingId(card.id);
    setDraft({
      businessUnitId: card.businessUnitId,
      slug: card.slug,
      fullName: card.fullName,
      position: card.position,
      phone: card.phone ?? "",
      email: card.email ?? "",
      website: card.website ?? "",
      companyAddress: card.companyAddress ?? "",
      instagramUrl: card.instagramUrl ?? "",
      facebookUrl: card.facebookUrl ?? "",
      linkedinUrl: card.linkedinUrl ?? "",
      primaryColor: card.primaryColor,
      active: card.active,
    });
    setSlugTouched(true);
    setColorTouched(true);
    setEditorOpen(true);
    setMessage(null);
  }

  function updateFullName(fullName: string) {
    setDraft((current) => ({ ...current, fullName, slug: slugTouched ? current.slug : slugify(fullName) }));
  }

  function updateUnit(businessUnitId: string) {
    setDraft((current) => ({
      ...current,
      businessUnitId,
      primaryColor: colorTouched ? current.primaryColor : (unitOf(businessUnitId)?.accent ?? current.primaryColor),
    }));
  }

  async function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.fullName.trim() || !draft.position.trim() || !draft.slug.trim() || !draft.businessUnitId) {
      setMessage("Indica al menos la marca, el nombre, el puesto y el identificador (slug).");
      return;
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(draft.primaryColor)) {
      setMessage("El color principal debe ser un hexadecimal válido, por ejemplo #2563EB.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        business_unit_id: draft.businessUnitId,
        slug: draft.slug.trim(),
        full_name: draft.fullName.trim(),
        position: draft.position.trim(),
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        website: draft.website.trim() || null,
        company_address: draft.companyAddress.trim() || null,
        instagram_url: draft.instagramUrl.trim() || null,
        facebook_url: draft.facebookUrl.trim() || null,
        linkedin_url: draft.linkedinUrl.trim() || null,
        primary_color: draft.primaryColor,
        is_active: draft.active,
      };

      if (!configured) {
        const nextCard: BusinessCard = {
          id: editingId ?? `demo-card-${Date.now()}`,
          businessUnitId: payload.business_unit_id,
          slug: payload.slug,
          fullName: payload.full_name,
          position: payload.position,
          phone: payload.phone,
          email: payload.email,
          website: payload.website,
          companyAddress: payload.company_address,
          instagramUrl: payload.instagram_url,
          facebookUrl: payload.facebook_url,
          linkedinUrl: payload.linkedin_url,
          primaryColor: payload.primary_color,
          active: payload.is_active,
          createdBy: "demo-admin",
          createdAt: editingId ? (cards.find((card) => card.id === editingId)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
        };
        setCards((current) => editingId ? current.map((card) => card.id === editingId ? nextCard : card) : [nextCard, ...current]);
        setMessage(editingId ? "Tarjeta actualizada en el modo demostración." : "Tarjeta creada en el modo demostración.");
        setEditorOpen(false);
        return;
      }

      const supabase = createClient();
      const result = editingId
        ? await supabase.from("business_cards").update(payload).eq("id", editingId)
        : await supabase.from("business_cards").insert(payload);
      if (result.error) throw result.error;
      await loadRealData();
      setMessage(editingId ? "Tarjeta actualizada correctamente." : "Tarjeta creada correctamente.");
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar la tarjeta. Comprueba que el identificador (slug) no esté ya en uso."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteCard() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        setCards((current) => current.filter((card) => card.id !== pendingDelete.id));
        setMessage("Tarjeta eliminada en el modo demostración.");
        setPendingDelete(null);
        return;
      }
      const { error } = await createClient().from("business_cards").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      setCards((current) => current.filter((card) => card.id !== pendingDelete.id));
      setMessage("Tarjeta eliminada correctamente.");
      setPendingDelete(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar la tarjeta."));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function copyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tarjeta/${slug}`);
      setMessage("Enlace copiado.");
    } catch {
      setMessage("No se pudo copiar el enlace.");
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Tarjetas no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Equipo</span><h2>Tarjetas de visita</h2><p>Tarjetas digitales para empleados: mismo diseño para todas, con el color y el logo de su marca.</p></div>
        <button type="button" className="button button-primary" onClick={openNew}>+ Nueva tarjeta</button>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <section className="units-grid">
        {cards.map((card) => {
          const unit = unitOf(card.businessUnitId);
          const publicUrl = `/tarjeta/${card.slug}`;
          return (
            <article className="panel unit-summary" key={card.id}>
              <div className="unit-summary-heading">
                {unit ? <UnitBrandMark unit={unit} size={40} /> : null}
                <span className="unit-dot" style={{ background: card.primaryColor }} />
                {card.active ? null : <span className="badge">Inactiva</span>}
              </div>
              <h3>{card.fullName}</h3>
              <p className="muted">{card.position}</p>
              <p className="muted">{unit?.name ?? "—"} · /tarjeta/{card.slug}</p>
              <div className="modal-actions unit-summary-actions">
                <a href={publicUrl} target="_blank" rel="noreferrer" className="button button-compact button-secondary">Ver tarjeta</a>
                <button type="button" className="button button-compact button-secondary" onClick={() => void copyLink(card.slug)}>Copiar enlace</button>
                <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(card)}>Editar</button>
                <button type="button" className="button button-compact button-secondary" onClick={() => setPendingDelete(card)}>Eliminar</button>
              </div>
            </article>
          );
        })}
        {cards.length === 0 ? <div className="notice"><strong>Sin tarjetas</strong><span>Crea la primera tarjeta para un empleado.</span></div> : null}
      </section>

      <Modal open={editorOpen} title={editingId ? "Editar tarjeta" : "Nueva tarjeta"} eyebrow="Equipo" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveCard}>
          <div className="form-grid">
            <label><span>Marca / empresa *</span>
              <select value={draft.businessUnitId} onChange={(event) => updateUnit(event.target.value)}>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <label><span>Color principal</span>
              <div className="color-input-pair">
                <input
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(draft.primaryColor) ? draft.primaryColor : "#2563eb"}
                  onChange={(event) => { setColorTouched(true); setDraft((current) => ({ ...current, primaryColor: event.target.value })); }}
                />
                <input
                  type="text"
                  value={draft.primaryColor}
                  maxLength={7}
                  placeholder="#2563eb"
                  onChange={(event) => {
                    let value = event.target.value.trim();
                    if (value && !value.startsWith("#")) value = `#${value}`;
                    setColorTouched(true);
                    setDraft((current) => ({ ...current, primaryColor: value }));
                  }}
                />
              </div>
            </label>
            <label><span>Nombre completo *</span><input value={draft.fullName} onChange={(event) => updateFullName(event.target.value)} required /></label>
            <label><span>Puesto *</span><input value={draft.position} onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))} required /></label>
            <label><span>Identificador (slug) *</span><input value={draft.slug} onChange={(event) => { setSlugTouched(true); setDraft((current) => ({ ...current, slug: event.target.value })); }} required /></label>
            <label><span>Teléfono / WhatsApp</span><input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="+34600000000" /></label>
            <label><span>Email</span><input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
            <label><span>Web</span><input value={draft.website} onChange={(event) => setDraft((current) => ({ ...current, website: event.target.value }))} placeholder="https://…" /></label>
            <label className="form-field-wide"><span>Dirección de la empresa</span><input value={draft.companyAddress} onChange={(event) => setDraft((current) => ({ ...current, companyAddress: event.target.value }))} /></label>
            <label><span>Instagram</span><input value={draft.instagramUrl} onChange={(event) => setDraft((current) => ({ ...current, instagramUrl: event.target.value }))} placeholder="https://instagram.com/…" /></label>
            <label><span>Facebook</span><input value={draft.facebookUrl} onChange={(event) => setDraft((current) => ({ ...current, facebookUrl: event.target.value }))} placeholder="https://facebook.com/…" /></label>
            <label><span>LinkedIn</span><input value={draft.linkedinUrl} onChange={(event) => setDraft((current) => ({ ...current, linkedinUrl: event.target.value }))} placeholder="https://linkedin.com/in/…" /></label>
            <label><span>Estado</span>
              <select value={draft.active ? "active" : "inactive"} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.value === "active" }))}>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar tarjeta"}</button>
          </div>
        </form>
      </Modal>

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Eliminar esta tarjeta?"
        confirmLabel="Eliminar"
        destructive
        busy={deleteBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteCard()}
      >
        {pendingDelete ? (
          <div className="confirmation-summary">
            <span>Tarjeta</span><strong>{pendingDelete.fullName}</strong>
            <p>El enlace público de esta tarjeta dejará de funcionar.</p>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
