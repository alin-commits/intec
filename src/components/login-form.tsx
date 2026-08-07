"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!configured) {
      setError("Supabase todavía no está configurado. Puedes entrar en la demo.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(reportSafeError(cause, "No se ha podido iniciar sesión. Comprueba el email y la contraseña."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" autoComplete="email" required /></label>
      <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" autoComplete="current-password" required /></label>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="login-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Accediendo…" : "Iniciar sesión"}</button>
        {!configured ? <Link href="/dashboard" className="button button-secondary">Entrar en la demo</Link> : null}
      </div>
      {configured ? <Link href="/forgot-password" className="login-forgot">¿Olvidaste tu contraseña?</Link> : null}
    </form>
  );
}
