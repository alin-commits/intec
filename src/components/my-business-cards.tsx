"use client";

import { useEffect, useState } from "react";
import { Toast } from "@/components/ui/toast";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessCard, BusinessUnit } from "@/lib/types";

export function MyBusinessCards({ cards, units, currentUserId }: { cards: BusinessCard[]; units: BusinessUnit[]; currentUserId: string }) {
  const configured = isSupabaseConfigured();
  const myCards = cards.filter((card) => card.assignedUserId === currentUserId);
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    createClient().from("business_card_preferences").select("card_id").eq("user_id", currentUserId).maybeSingle()
      .then(({ data }) => setPreferredId(data ? String(data.card_id) : null));
  }, [configured, currentUserId]);

  function unitOf(id: string): BusinessUnit | undefined {
    return units.find((unit) => unit.id === id);
  }

  async function markPreferred(cardId: string) {
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        setPreferredId(cardId);
        setMessage("Preferencia guardada en el modo demostración.");
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.from("business_card_preferences").upsert({ user_id: currentUserId, card_id: cardId });
      if (error) throw error;
      setPreferredId(cardId);
      setMessage("Preferencia guardada.");
    } catch {
      setMessage("No se pudo guardar la preferencia.");
    } finally {
      setBusy(false);
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

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Equipo</span><h2>Mis tarjetas de visita</h2><p>Estas son las tarjetas que tienes asignadas. Marca la que usas normalmente para encontrarla rápido.</p></div>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <section className="units-grid">
        {myCards.map((card) => {
          const unit = unitOf(card.businessUnitId);
          const publicUrl = `/tarjeta/${card.slug}`;
          const isPreferred = preferredId === card.id;
          return (
            <article className="panel unit-summary" key={card.id}>
              <div className="unit-summary-heading">
                {unit ? <UnitBrandMark unit={unit} size={40} /> : null}
                <span className="unit-dot" style={{ background: card.primaryColor }} />
                {isPreferred ? <span className="badge">La que uso</span> : null}
              </div>
              <h3>{card.fullName}</h3>
              <p className="muted">{card.position}</p>
              <p className="muted">{unit?.name ?? "—"} · /tarjeta/{card.slug}</p>
              <div className="modal-actions unit-summary-actions">
                <a href={publicUrl} target="_blank" rel="noreferrer" className="button button-compact button-secondary">Ver tarjeta</a>
                <button type="button" className="button button-compact button-secondary" onClick={() => void copyLink(card.slug)}>Copiar enlace</button>
                {!isPreferred ? <button type="button" className="button button-compact button-primary" disabled={busy} onClick={() => void markPreferred(card.id)}>Usar esta</button> : null}
              </div>
            </article>
          );
        })}
        {myCards.length === 0 ? <div className="notice"><strong>Sin tarjetas asignadas</strong><span>Todavía no tienes ninguna tarjeta de visita asignada.</span></div> : null}
      </section>
    </div>
  );
}
