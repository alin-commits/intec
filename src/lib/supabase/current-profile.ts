"use client";

import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

export type CurrentProfile = { id: string; email: string | null; fullName: string; roles: AppRole[]; isPreview: boolean } | null;

/**
 * Who is signed in, asked once and shared. Several parts of the page need it at
 * the same time (the menu, the tabs, the view itself) and each one asking on its
 * own meant three round trips before anything could be drawn.
 */
let pending: Promise<CurrentProfile> | null = null;
let listening = false;

export function loadCurrentProfile(): Promise<CurrentProfile> {
  if (pending) return pending;

  pending = (async (): Promise<CurrentProfile> => {
    const supabase = createClient();
    if (!supabase) return null;

    if (!listening) {
      listening = true;
      // Signing in or out makes what we cached wrong, so it is thrown away.
      supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") pending = null;
      });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // De esta consulta cuelga la aplicación entera: el menú, las pestañas y
    // cada pantalla. Si la columna de las cuentas de prueba todavía no está
    // migrada, se pide sin ella en vez de dejar a todo el mundo sin roles.
    let { data, error } = await supabase.from("profiles").select("full_name, roles, is_preview").eq("id", user.id).maybeSingle();
    if (error?.code === "42703") {
      ({ data, error } = await supabase.from("profiles").select("full_name, roles").eq("id", user.id).maybeSingle());
    }
    // Supabase no lanza cuando la consulta falla: devuelve el error. Sin esto,
    // un fallo pasajero se guardaba en la caché como "esta persona no tiene
    // ningún rol" y el menú se quedaba vacío hasta recargar entera la página.
    if (error) throw error;
    return {
      id: user.id,
      email: user.email ?? null,
      fullName: (data?.full_name as string | null) || user.email || "Usuario",
      roles: (data?.roles ?? []) as AppRole[],
      isPreview: Boolean(data?.is_preview),
    };
  })();

  // A failed lookup must not stay cached, or the page never recovers.
  pending.catch(() => { pending = null; });
  return pending;
}

export function forgetCurrentProfile() {
  pending = null;
}
