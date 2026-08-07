"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo enviar el correo.");
      setSent(true);
    } catch (cause) {
      // /api/auth/forgot-password ya devuelve mensajes seguros y en español;
      // aquí solo cubrimos errores de red inesperados.
      setError(cause instanceof Error ? cause.message : "No se ha podido enviar el correo. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div>
        <p>Si el email existe en el sistema, te hemos enviado un enlace para restablecer tu contraseña.</p>
        <div className="login-actions">
          <Link href="/login" className="button button-secondary">Volver a iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" autoComplete="email" required /></label>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="login-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Enviando…" : "Enviar enlace"}</button>
        <Link href="/login" className="button button-secondary">Cancelar</Link>
      </div>
    </form>
  );
}
