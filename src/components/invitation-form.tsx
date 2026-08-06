"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function InvitationForm() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.subscription.unsubscribe();
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
      setDone(true);
      setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 1500);
    } catch (cause) {
      setError(reportSafeError(cause, "No se ha podido activar la cuenta. Pide a un administrador que te reenvíe la invitación."));
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return <p>Supabase todavía no está configurado.</p>;
  }

  if (done) {
    return <p>Cuenta activada. Redirigiendo…</p>;
  }

  if (!ready) {
    return (
      <div>
        <p>Este enlace de invitación no es válido o ha caducado.</p>
        <div className="login-actions">
          <Link href="/login" className="button button-secondary">Ir a iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" autoComplete="new-password" minLength={8} required /></label>
      <label>Confirmar contraseña<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="••••••••" autoComplete="new-password" minLength={8} required /></label>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="login-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Activando…" : "Activar mi cuenta"}</button>
      </div>
    </form>
  );
}
