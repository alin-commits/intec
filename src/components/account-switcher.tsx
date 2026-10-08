"use client";

import { useRef, useState } from "react";
import { LogoutIcon } from "@/components/icons";
import { useClickOutside } from "@/components/ui/use-click-outside";
import { roleLabels } from "@/lib/constants";
import { entrarComo, miCuentaGuardada, sePuedeGuardarLaSesion, volverAMiCuenta } from "@/lib/preview-accounts";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

export type CuentaDePrueba = { id: string; fullName: string; roles: AppRole[] };

/**
 * El chip de la esquina, convertido en cambiador de cuenta: desde tu sesión se
 * entra en las cuentas de prueba para ver la aplicación como cada rol, y se
 * vuelve de un clic. Quien no pueda cambiar ve el chip de siempre.
 */
export function AccountSwitcher({
  fullName,
  roles,
  initials,
  isPreview,
  cuentas,
  onSignOut,
}: {
  fullName: string;
  roles: AppRole[];
  initials: string;
  isPreview: boolean;
  cuentas: CuentaDePrueba[];
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [yendoA, setYendoA] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapperRef, () => setOpen(false));

  const puedeCambiar = cuentas.length > 0 || isPreview;

  async function cambiarA(cuenta: CuentaDePrueba) {
    setYendoA(cuenta.id);
    setError(null);
    try {
      await entrarComo(cuenta.id, fullName);
      // Recarga entera a propósito: así ninguna pantalla se queda con datos
      // cargados con la sesión anterior.
      window.location.reload();
    } catch (cause) {
      setYendoA(null);
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar de cuenta.");
    }
  }

  async function volver() {
    setYendoA("mia");
    setError(null);
    if (await volverAMiCuenta()) {
      window.location.reload();
      return;
    }
    // Sin sesión guardada no hay vuelta posible: se sale por la puerta normal.
    setYendoA(null);
    await createClient().auth.signOut();
    // Navegación dura a propósito: se acaba de cambiar la sesión y nada de lo
    // que hay cargado en memoria sirve ya.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  if (!puedeCambiar) {
    return (
      <div className="user-chip" title={fullName}>
        <span className="user-avatar" aria-hidden="true">{initials}</span>
        <div className="user-chip-text">
          <strong>{fullName}</strong>
          <small>{roles.map((role) => roleLabels[role]).join(" + ")}</small>
        </div>
      </div>
    );
  }

  return (
    <div className="topbar-popover" ref={wrapperRef}>
      <button
        type="button"
        className={isPreview ? "user-chip user-chip-button user-chip-preview" : "user-chip user-chip-button"}
        aria-expanded={open}
        aria-haspopup="menu"
        title={fullName}
        onClick={() => setOpen((actual) => !actual)}
      >
        <span className="user-avatar" aria-hidden="true">{initials}</span>
        <div className="user-chip-text">
          <strong>{fullName}</strong>
          <small>{isPreview ? "Cuenta de prueba" : roles.map((role) => roleLabels[role]).join(" + ")}</small>
        </div>
        <span className="user-chip-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="popover-panel popover-panel-cuentas" role="menu" aria-label="Cambiar de cuenta">
          {isPreview ? (
            <>
              <p className="popover-note">Estás viendo la aplicación como <strong>{fullName}</strong>. Lo que hagas aquí queda a su nombre.</p>
              <button type="button" className="cuenta-opcion" role="menuitem" disabled={yendoA !== null} onClick={() => void volver()}>
                <span className="cuenta-avatar" aria-hidden="true">↩</span>
                <span className="cuenta-texto"><strong>Volver a mi cuenta</strong><small>Sales de la vista de prueba</small></span>
              </button>
            </>
          ) : (
            <>
              <p className="popover-note">Entra en una cuenta de prueba para ver la aplicación como ese rol. Tu sesión se queda guardada en este navegador.</p>
              {cuentas.map((cuenta) => (
                <button
                  key={cuenta.id}
                  type="button"
                  className="cuenta-opcion"
                  role="menuitem"
                  disabled={yendoA !== null}
                  onClick={() => void cambiarA(cuenta)}
                >
                  <span className="cuenta-avatar" aria-hidden="true">{cuenta.roles.map((role) => roleLabels[role]).join("")[0] ?? "?"}</span>
                  <span className="cuenta-texto">
                    <strong>{cuenta.roles.map((role) => roleLabels[role]).join(" + ")}</strong>
                    <small>{yendoA === cuenta.id ? "Entrando…" : cuenta.fullName}</small>
                  </span>
                </button>
              ))}
              {!sePuedeGuardarLaSesion() ? (
                <p className="popover-note popover-note-warning">Este navegador no deja guardar nada: si cambias de cuenta, para volver tendrás que entrar otra vez con la tuya.</p>
              ) : null}
            </>
          )}
          {error ? <p className="popover-note popover-note-warning">{error}</p> : null}
          <button type="button" className="cuenta-opcion cuenta-opcion-salir" role="menuitem" onClick={onSignOut}>
            <span className="cuenta-avatar" aria-hidden="true"><LogoutIcon /></span>
            <span className="cuenta-texto"><strong>Cerrar sesión</strong></span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** La franja de aviso mientras se mira con otra cuenta. Imposible de no ver. */
export function PreviewBanner({ fullName, roles }: { fullName: string; roles: AppRole[] }) {
  const [saliendo, setSaliendo] = useState(false);
  return (
    <div className="preview-banner" role="status">
      <span>
        Estás viendo la aplicación como <strong>{fullName}</strong>
        {roles.length ? ` · ${roles.map((role) => roleLabels[role]).join(" + ")}` : ""}. Es una cuenta de prueba: lo que hagas queda a su nombre.
      </span>
      <button
        type="button"
        className="button button-compact button-secondary"
        disabled={saliendo}
        onClick={() => {
          setSaliendo(true);
          void (async () => {
            if (await volverAMiCuenta()) { window.location.reload(); return; }
            await createClient().auth.signOut();
            // Igual que arriba: la sesión ha cambiado, se empieza de cero.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/login");
          })();
        }}
      >
        {saliendo ? "Volviendo…" : miCuentaGuardada() ? "Volver a mi cuenta" : "Salir"}
      </button>
    </div>
  );
}
