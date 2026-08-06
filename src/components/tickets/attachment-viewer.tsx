"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SIGNED_URL_TTL_SECONDS = 600;

export function AttachmentViewer({ attachmentPath }: { attachmentPath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    createClient()
      .storage.from("ticket-attachments")
      .createSignedUrl(attachmentPath, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error: signError }) => {
        if (!active) return;
        if (signError || !data) {
          setError("No se pudo generar el enlace del archivo.");
          return;
        }
        setUrl(data.signedUrl);
      });
    return () => { active = false; };
  }, [attachmentPath]);

  if (error) return <p className="form-error">{error}</p>;
  if (!url) return <p>Generando enlace…</p>;

  const isImage = /\.(jpg|jpeg|png)$/i.test(attachmentPath);

  return (
    <div className="attachment-viewer">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Adjunto de la incidencia" />
      ) : null}
      <a href={url} target="_blank" rel="noreferrer" className="button button-secondary">
        {isImage ? "Abrir en tamaño completo" : "Descargar PDF"}
      </a>
    </div>
  );
}
