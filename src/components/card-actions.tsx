"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "@/components/ui/modal";
import { buildVCard, downloadVCard } from "@/lib/vcard";
import type { BusinessCard } from "@/lib/types";

function DownloadIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><path d="M10 3v9.5M6.2 9 10 12.7 13.8 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M3.5 15v.8a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
function ShareIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><circle cx="15" cy="4.8" r="2.1" stroke="currentColor" strokeWidth="1.5" /><circle cx="5" cy="10" r="2.1" stroke="currentColor" strokeWidth="1.5" /><circle cx="15" cy="15.2" r="2.1" stroke="currentColor" strokeWidth="1.5" /><path d="m6.9 8.9 6.2-3.1M6.9 11.1l6.2 3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

export function CardActions({ card, unitName }: { card: BusinessCard; unitName: string }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copiar enlace");
  const [publicUrl] = useState(() => (typeof window !== "undefined" ? `${window.location.origin}/tarjeta/${card.slug}` : ""));
  const [canNativeShare] = useState(() => typeof navigator !== "undefined" && Boolean(navigator.share));

  useEffect(() => {
    if (!shareOpen || !publicUrl) return;
    QRCode.toDataURL(publicUrl, { width: 440, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [shareOpen, publicUrl]);

  function handleSaveContact() {
    const vcard = buildVCard(card, unitName);
    downloadVCard(`${card.fullName.replace(/\s+/g, "_")}.vcf`, vcard);
  }

  function openShare() {
    setCopyLabel("Copiar enlace");
    setShareOpen(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyLabel("¡Copiado!");
      setTimeout(() => setCopyLabel("Copiar enlace"), 2000);
    } catch {
      setCopyLabel("No se pudo copiar");
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: card.fullName, url: publicUrl });
    } catch {
      /* el usuario canceló el diálogo de compartir */
    }
  }

  return (
    <div className="business-card-actions">
      <button type="button" className="business-card-save-btn" onClick={handleSaveContact}><DownloadIcon /> Guardar contacto</button>
      <button type="button" className="business-card-share-btn" onClick={openShare}><ShareIcon /> Compartir tarjeta</button>

      <Modal open={shareOpen} title="Escanea para ver esta tarjeta" onClose={() => setShareOpen(false)}>
        <div className="business-card-share-modal">
          <div className="business-card-qr-wrap">
            {qrDataUrl ? <img src={qrDataUrl} alt="Código QR de la tarjeta" /> : null}
          </div>
          <div className="business-card-share-actions">
            <button type="button" className="button button-secondary" onClick={() => void copyLink()}>{copyLabel}</button>
            {canNativeShare ? <button type="button" className="button button-primary" onClick={() => void nativeShare()}>Compartir con…</button> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
