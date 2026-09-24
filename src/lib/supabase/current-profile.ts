"use client";

import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

export type CurrentProfile = { id: string; email: string | null; fullName: string; roles: AppRole[] } | null;

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
    const { data } = await supabase.from("profiles").select("full_name, roles").eq("id", user.id).maybeSingle();
    return {
      id: user.id,
      email: user.email ?? null,
      fullName: (data?.full_name as string | null) || user.email || "Usuario",
      roles: (data?.roles ?? []) as AppRole[],
    };
  })();

  // A failed lookup must not stay cached, or the page never recovers.
  pending.catch(() => { pending = null; });
  return pending;
}

export function forgetCurrentProfile() {
  pending = null;
}
