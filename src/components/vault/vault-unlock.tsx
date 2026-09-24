"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type UnlockReason = "mfa_enrollment_required" | "mfa_required" | "locked";

type Factor =
  | { kind: "verified"; factorId: string }
  | { kind: "enroll"; factorId: string; qrCode: string; secret: string };

/**
 * Second factor for the vault: first-time enrolment with a QR code, and the
 * unlock prompt once the daily window has passed. Verifying refreshes the session,
 * which is what the server checks — nothing about the unlocked state is kept here.
 */
export function VaultUnlock({ reason, onUnlocked }: { reason: UnlockReason; onUnlocked: () => void }) {
  const [factor, setFactor] = useState<Factor | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      try {
        const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const verified = (factors?.totp ?? []).find((item) => item.status === "verified");
        if (verified) {
          if (active) setFactor({ kind: "verified", factorId: verified.id });
          return;
        }
        // `all` also lists half-finished enrolments, which `totp` hides. They cannot
        // show their QR again and would block a new one, so they are removed first.
        const leftovers = (factors?.all ?? []).filter((item) => item.factor_type === "totp");
        for (const pending of leftovers) await supabase.auth.mfa.unenroll({ factorId: pending.id });
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          // Unique name: Supabase rejects a second factor with a name already in use.
          friendlyName: `Intec ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
        });
        if (enrollError) throw enrollError;
        if (active) setFactor({ kind: "enroll", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      } catch (cause) {
        console.error("No se pudo preparar la verificación en dos pasos:", cause);
        if (active) setError("No se pudo preparar la verificación en dos pasos. Recarga la página e inténtalo otra vez.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: factor.factorId, code: code.replace(/\s+/g, "") });
      if (verifyError) throw verifyError;
      setCode("");
      onUnlocked();
    } catch {
      // The code is the only thing that can be wrong here; no internal detail is shown.
      setError("El código no es correcto o ha caducado. Prueba con el siguiente.");
    } finally {
      setBusy(false);
    }
  }

  const enrolling = factor?.kind === "enroll";
  const title = enrolling ? "Protege las contraseñas con tu móvil" : reason === "locked" ? "Vuelve a confirmar que eres tú" : "Verifica que eres tú";

  return (
    <div className="page-stack">
      <section className="panel vault-unlock">
        <h2>{title}</h2>
        {factor?.kind === "enroll" ? (
          <>
            <p className="muted">
              Para ver o copiar una contraseña hace falta un segundo paso. Abre <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> o la app que uses,
              escanea este código y escribe los 6 dígitos que aparezcan. Solo se hace una vez.
            </p>
            {/* Supabase returns the QR already rendered as an SVG data URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="vault-qr" src={factor.qrCode} alt="Código QR para configurar la verificación en dos pasos" width={220} height={220} />
            <p className="muted vault-secret-line">
              ¿No puedes escanearlo?{" "}
              <button type="button" className="vault-link-button" onClick={() => setShowSecret((current) => !current)}>
                {showSecret ? "Ocultar clave" : "Escribir la clave a mano"}
              </button>
            </p>
            {showSecret ? <code className="vault-secret">{factor.secret}</code> : null}
          </>
        ) : (
          <p className="muted">
            {reason === "locked"
              ? "El código se pide una vez al día. Introduce el de tu app para seguir viendo contraseñas."
              : "Introduce el código de 6 dígitos de tu app de autenticación."}
          </p>
        )}

        <form className="vault-unlock-form" onSubmit={verify}>
          <label>
            <span>Código de 6 dígitos</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              placeholder="123456"
              required
              autoFocus
            />
          </label>
          <button type="submit" className="button button-primary" disabled={busy || !factor}>
            {busy ? "Comprobando…" : enrolling ? "Activar y entrar" : "Desbloquear"}
          </button>
        </form>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </section>
    </div>
  );
}
