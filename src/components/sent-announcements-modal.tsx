"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";

type SentRecipient = { name: string; readAt: string | null };
type SentAnnouncement = { id: string; title: string; body: string; createdAt: string; recipients: SentRecipient[] };

const dateFormatter = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SentAnnouncementsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<SentAnnouncement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const { data, error: loadError } = await createClient().rpc("list_sent_announcements");
      if (!active) return;
      if (loadError) {
        setError("No se pudo cargar el historial de avisos.");
        setItems([]);
        return;
      }
      setError(null);
      setItems(((data ?? []) as { id: string; title: string; body: string; created_at: string; recipients: SentRecipient[] }[]).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        createdAt: row.created_at,
        recipients: row.recipients ?? [],
      })));
    })();
    return () => { active = false; };
  }, [open]);

  return (
    <Modal open={open} title="Avisos enviados" eyebrow="Comunicación interna" onClose={onClose}>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {items === null ? (
        <p className="muted">Cargando…</p>
      ) : items.length === 0 ? (
        error ? null : <p className="muted">Todavía no has enviado ningún aviso.</p>
      ) : (
        <ul className="sent-list">
          {items.map((item) => {
            const readCount = item.recipients.filter((recipient) => recipient.readAt).length;
            const allRead = readCount === item.recipients.length;
            return (
              <li key={item.id} className="sent-item">
                <details>
                  <summary>
                    <span className="sent-item-main">
                      <strong>{item.title}</strong>
                      <small>{dateFormatter.format(new Date(item.createdAt))}</small>
                    </span>
                    <span className={allRead ? "sent-read-count sent-read-count-done" : "sent-read-count"}>
                      Leído por {readCount} de {item.recipients.length}
                    </span>
                  </summary>
                  <p className="sent-body">{item.body}</p>
                  <ul className="sent-recipients">
                    {item.recipients.map((recipient, index) => (
                      <li key={`${recipient.name}-${index}`} className={recipient.readAt ? "is-read" : undefined}>
                        <span>{recipient.name}</span>
                        <small>{recipient.readAt ? `✓ Leído · ${dateFormatter.format(new Date(recipient.readAt))}` : "Sin leer"}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
