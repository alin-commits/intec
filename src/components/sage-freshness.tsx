"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/*
  Cuándo se leyó Sage por última vez.

  Va arriba del todo y en todas las pantallas que beben de Sage, porque la
  pregunta "¿esto es de hoy?" se hace nada más entrar, no al final. Antes solo
  estaba en Ventas y además al pie, debajo de todo el cuadro de mando: quien
  miraba una cifra rara no llegaba a leerlo.
*/

type Run = { started_at: string; ok: boolean };

export function SageFreshness({ provisionalDays }: { provisionalDays?: number }) {
  const [run, setRun] = useState<Run | null>(null);
  /* Si la última lectura es de hace más de un día conviene que se note. Se
     decide al cargar y no al pintar: mirar el reloj mientras se dibuja es
     impuro y el compilador de React lo rechaza, con razón. */
  const [viejo, setViejo] = useState(false);
  const [cargado, setCargado] = useState(!isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let vivo = true;
    void (async () => {
      const { data } = await createClient()
        .from("sage_sync_runs")
        .select("started_at, ok")
        .eq("ok", true)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!vivo) return;
      const fila = (data as Run | null) ?? null;
      setRun(fila);
      setViejo(fila ? Date.now() - new Date(fila.started_at).getTime() > 24 * 60 * 60 * 1000 : false);
      setCargado(true);
    })();
    return () => { vivo = false; };
  }, []);

  if (!cargado) return null;

  const cuando = run ? new Date(run.started_at) : null;

  return (
    <p className={viejo ? "sage-freshness is-old" : "sage-freshness"} role="status">
      {cuando
        ? `Última lectura de Sage: ${cuando.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}${viejo ? " — hace más de un día" : ""}.`
        : "Todavía no consta ninguna lectura de Sage."}
      {provisionalDays
        ? ` Los últimos ${provisionalDays} días son provisionales: se siguen corrigiendo albaranes y facturando, así que esas cifras aún se mueven.`
        : ""}
      {" "}Si un número no cuadra con Sage, manda Sage.
    </p>
  );
}
