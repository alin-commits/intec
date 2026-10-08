"use client";

import { createClient } from "@/lib/supabase/client";
import { forgetCurrentProfile } from "@/lib/supabase/current-profile";

/**
 * Cambiar de cuenta sin cerrar sesión, como en Instagram: entras con la tuya y
 * desde ahí saltas a las cuentas de prueba para ver la aplicación con los ojos
 * de cada rol.
 *
 * Tu sesión se guarda en este navegador antes de saltar, y es la única forma de
 * volver: desde una cuenta de prueba el servidor no reparte sesiones, así que
 * si esto se pierde hay que entrar otra vez por la pantalla de siempre.
 */

const CLAVE = "intec.cuenta-principal";

export type CuentaGuardada = { userId: string; fullName: string; accessToken: string; refreshToken: string };

/** El almacén del navegador falla en ventanas privadas: nunca debe tirar la página. */
function leer(): CuentaGuardada | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const valor = JSON.parse(crudo) as Partial<CuentaGuardada>;
    if (!valor.accessToken || !valor.refreshToken) return null;
    return { userId: valor.userId ?? "", fullName: valor.fullName ?? "mi cuenta", accessToken: valor.accessToken, refreshToken: valor.refreshToken };
  } catch {
    return null;
  }
}

function escribir(cuenta: CuentaGuardada | null) {
  try {
    if (cuenta) window.localStorage.setItem(CLAVE, JSON.stringify(cuenta));
    else window.localStorage.removeItem(CLAVE);
  } catch {
    // Sin almacén no se puede volver con un clic, pero se avisa al saltar.
  }
}

export function miCuentaGuardada(): CuentaGuardada | null {
  return leer();
}

export function sePuedeGuardarLaSesion(): boolean {
  try {
    const prueba = "intec.prueba-de-almacen";
    window.localStorage.setItem(prueba, "1");
    window.localStorage.removeItem(prueba);
    return true;
  } catch {
    return false;
  }
}

export class CambioDeCuentaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CambioDeCuentaError";
  }
}

/**
 * Salta a una cuenta de prueba. Guarda la tuya antes de pedir nada: si el salto
 * sale bien ya no hay forma de recuperarla desde el servidor.
 */
export async function entrarComo(userId: string, nombre: string): Promise<void> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new CambioDeCuentaError("Tu sesión ha caducado. Vuelve a entrar.");

  escribir({
    userId: session.user.id,
    fullName: nombre,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });

  const respuesta = await fetch("/api/preview-accounts/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const datos = (await respuesta.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; error?: string };
  if (!respuesta.ok || !datos.accessToken || !datos.refreshToken) {
    escribir(null);
    throw new CambioDeCuentaError(datos.error ?? "No se pudo entrar en la cuenta de prueba.");
  }

  const { error } = await supabase.auth.setSession({ access_token: datos.accessToken, refresh_token: datos.refreshToken });
  if (error) {
    escribir(null);
    throw new CambioDeCuentaError("No se pudo abrir la sesión de prueba.");
  }
  forgetCurrentProfile();
}

/** Vuelve a la cuenta con la que se empezó. Devuelve false si ya no se puede. */
export async function volverAMiCuenta(): Promise<boolean> {
  const guardada = leer();
  if (!guardada) return false;

  const supabase = createClient();
  const { error } = await supabase.auth.setSession({ access_token: guardada.accessToken, refresh_token: guardada.refreshToken });
  if (error) return false;

  // El testigo guardado ya se ha gastado: dejarlo ahí solo serviría para
  // intentar volver con algo que la próxima vez no valdrá.
  escribir(null);
  forgetCurrentProfile();
  return true;
}
