"use client";

import { useEffect, useState } from "react";
import { adsPlatformDe, adsPlatformLabels, type AdsPlatform } from "@/lib/ads/platforms";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/*
  Cuándo se trajo por última vez lo de cada plataforma de anuncios.

  Misma idea que el aviso de Sage: quien mira los leads que entran por campañas
  necesita saber si lo que ve es de hoy o de anteayer, y tiene que saberlo nada
  más entrar, no buscándolo.

  Habla de todas las plataformas que sincronicen, no solo de Meta: el día que
  entre otra, si su sincronización se para, aquí se ve sin tocar nada.
*/

const UN_DIA = 24 * 60 * 60 * 1000;

/** "viejo" se decide al traer el dato: la hora no se puede mirar al pintar. */
type Lectura = { platform: AdsPlatform; cuando: string; viejo: boolean };

export function AdsFreshness() {
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [cargado, setCargado] = useState(!isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let vivo = true;
    void (async () => {
      // Las pasadas más recientes; de ahí se queda la primera de cada
      // plataforma, que por el orden es la última que hubo.
      const { data } = await createClient()
        .from("ads_sync_runs")
        .select("platform, started_at")
        .order("started_at", { ascending: false })
        .limit(50);
      if (!vivo) return;
      const ultima = new Map<AdsPlatform, string>();
      for (const fila of (data ?? []) as { platform: unknown; started_at: string }[]) {
        const platform = adsPlatformDe(fila.platform);
        if (!ultima.has(platform)) ultima.set(platform, fila.started_at);
      }
      const ahora = Date.now();
      setLecturas([...ultima.entries()].map(([platform, cuando]) => ({
        platform,
        cuando,
        viejo: ahora - new Date(cuando).getTime() > UN_DIA,
      })));
      setCargado(true);
    })();
    return () => { vivo = false; };
  }, []);

  if (!cargado) return null;

  if (lecturas.length === 0) {
    return <p className="sage-freshness" role="status">Todavía no consta ninguna lectura de las plataformas de anuncios.</p>;
  }

  const alguienViejo = lecturas.some((lectura) => lectura.viejo);
  const texto = lecturas
    .map((lectura) => {
      const cuando = new Date(lectura.cuando).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
      return `${adsPlatformLabels[lectura.platform]}: ${cuando}${lectura.viejo ? " — hace más de un día" : ""}`;
    })
    .join(" · ");

  return (
    <p className={alguienViejo ? "sage-freshness is-old" : "sage-freshness"} role="status">
      Última lectura · {texto}. Los leads que entran por campañas se traen solos cada hora.
    </p>
  );
}
