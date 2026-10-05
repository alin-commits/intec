"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/*
  Cuándo se trajo por última vez lo de Meta.

  Misma idea que el aviso de Sage: quien mira los leads que entran por campañas
  necesita saber si lo que ve es de hoy o de anteayer, y tiene que saberlo nada
  más entrar, no buscándolo.
*/

export function MetaFreshness() {
  const [cuando, setCuando] = useState<string | null>(null);
  const [viejo, setViejo] = useState(false);
  const [cargado, setCargado] = useState(!isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let vivo = true;
    void (async () => {
      const { data } = await createClient()
        .from("meta_sync_runs")
        .select("started_at")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!vivo) return;
      const fila = (data as { started_at: string } | null) ?? null;
      setCuando(fila?.started_at ?? null);
      setViejo(fila ? Date.now() - new Date(fila.started_at).getTime() > 24 * 60 * 60 * 1000 : false);
      setCargado(true);
    })();
    return () => { vivo = false; };
  }, []);

  if (!cargado) return null;

  return (
    <p className={viejo ? "sage-freshness is-old" : "sage-freshness"} role="status">
      {cuando
        ? `Última lectura de Meta: ${new Date(cuando).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}${viejo ? " — hace más de un día" : ""}. Los leads que entran por campañas se traen solos cada hora.`
        : "Todavía no consta ninguna lectura de Meta."}
    </p>
  );
}
