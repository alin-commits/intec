"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SIGNED_URL_TTL_SECONDS = 600;

type AttachmentItem = { id: string; path: string; url: string | null; isImage: boolean };

export function AttachmentGallery({ ticketId }: { ticketId: string }) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    supabase
      .from("ticket_attachments")
      .select("id, path")
      .eq("ticket_id", ticketId)
      .order("created_at")
      .then(async ({ data: rows }) => {
        if (!active) return;
        if (!rows || rows.length === 0) {
          setItems([]);
          setLoading(false);
          return;
        }
        const resolved = await Promise.all(rows.map(async (row) => {
          const isImage = /\.(jpg|jpeg|png)$/i.test(row.path);
          const { data } = await supabase.storage.from("ticket-attachments").createSignedUrl(row.path, SIGNED_URL_TTL_SECONDS);
          return { id: row.id, path: row.path, url: data?.signedUrl ?? null, isImage };
        }));
        if (active) {
          setItems(resolved);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [ticketId]);

  const images = items.filter((item) => item.isImage);

  if (loading) return <p className="muted">Cargando adjuntos…</p>;
  if (items.length === 0) return <p className="muted">Sin archivos adjuntos.</p>;

  return (
    <>
      <div className="attachment-gallery">
        {items.map((item) => (
          item.isImage ? (
            <button
              key={item.id}
              type="button"
              className="attachment-thumb"
              onClick={() => setLightboxIndex(images.findIndex((image) => image.id === item.id))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {item.url ? <img src={item.url} alt="Adjunto de la incidencia" /> : null}
            </button>
          ) : (
            <a key={item.id} href={item.url ?? "#"} target="_blank" rel="noreferrer" className="attachment-thumb attachment-thumb-file">PDF</a>
          )
        ))}
      </div>

      {lightboxIndex !== null && images[lightboxIndex] ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setLightboxIndex(null)}>
          <div className="attachment-lightbox" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[lightboxIndex].url ?? ""} alt="Adjunto de la incidencia" />
            <div className="attachment-lightbox-actions">
              {images.length > 1 ? (
                <>
                  <button type="button" className="button button-secondary" onClick={() => setLightboxIndex((current) => current === null ? null : (current - 1 + images.length) % images.length)}>‹ Anterior</button>
                  <button type="button" className="button button-secondary" onClick={() => setLightboxIndex((current) => current === null ? null : (current + 1) % images.length)}>Siguiente ›</button>
                </>
              ) : null}
              <button type="button" className="button button-secondary" onClick={() => setLightboxIndex(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
