"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Status = "checking" | "ready" | "invalid" | "done";

export function ResetPasswordForm() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [status, setStatus] = useState<Status>(() => {
    if (!configured || typeof window === "undefined") return configured ? "checking" : "invalid";
    return new URLSearchParams(window.location.search).get("token_hash") ? "checking" : "invalid";
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || typeof window === "undefined") return;
    const tokenHash = new URLSearchParams(window.location.search).get("token_hash");
    if (!tokenHash) return;
    createClient().auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }).then(({ error: verifyError }) => {
      setStatus(verifyError ? "invalid" : "ready");
    });
  }, [configured]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setStatus("done");
      setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 1500);
    } catch (cause) {
      setError(reportSafeError(cause, "No se ha podido actualizar la contraseña. Solicita un nuevo enlace."));
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return <p>Supabase todavía no está configurado.</p>;
  }

  if (status === "checking") {
    return <p>Comprobando el enlace…</p>;
  }

  if (status === "done") {
    return <p>Contraseña actualizada. Redirigiendo…</p>;
  }

  if (status === "invalid") {
    return (
      <div>
        <p>Este enlace no es válido o ha caducado.</p>
        <div className="login-actions">
          <Link href="/forgot-password" className="button button-secondary">Solicitar un nuevo enlace</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>Nueva contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" autoComplete="new-password" minLength={8} required /></label>
      <label>Confirmar contraseña<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="••••••••" autoComplete="new-password" minLength={8} required /></label>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="login-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar nueva contraseña"}</button>
      </div>
    </form>
  );
}
