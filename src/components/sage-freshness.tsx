"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { estadoDeLaLectura, ultimaLecturaDeSage } from "@/lib/sage-lectura";

/*
  Cuándo se leyó Sage por última vez.

  Va arriba del todo y en todas las pantallas que beben de Sage, porque la
  pregunta "¿esto es de hoy?" se hace nada más entrar, no al final. Antes solo
  estaba en Ventas y además al pie, debajo de todo el cuadro de mando: quien
  miraba una cifra rara no llegaba a leerlo.

  Dice lo mismo que la línea del pie del menú, y con el mismo criterio de
  cuándo una lectura está atrasada: dos avisos que discrepan no los cree nadie.
*/

export function SageFreshness({ provisionalDays }: { provisionalDays?: number }) {
  const [leida, setLeida] = useState<string | null | undefined>(undefined);
  /* Se mira el reloj al cargar y no al pintar: mirarlo mientras se dibuja es
     impuro y el compilador de React lo rechaza, con razón. */
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let vivo = true;
    void (async () => {
      const cuando = await ultimaLecturaDeSage(createClient());
      if (!vivo) return;
      setLeida(cuando);
      setAhora(Date.now());
    })();
    return () => { vivo = false; };
  }, []);

  // Sin saber cuándo fue, mejor no decir nada que decir «nunca».
  if (leida === undefined || ahora === null) return null;

  const estado = leida ? estadoDeLaLectura(leida, ahora) : null;

  return (
    <p className={estado?.atrasada ? "sage-freshness is-old" : "sage-freshness"} role="status">
      {estado
        ? `Última lectura de Sage: ${estado.exacta} (${estado.texto})${estado.atrasada ? " — el agente lee cada hora y lleva más de dos sin leer" : ""}.`
        : "Todavía no consta ninguna lectura de Sage."}
      {provisionalDays
        ? ` Los últimos ${provisionalDays} días son provisionales: se siguen corrigiendo albaranes y facturando, así que esas cifras aún se mueven.`
        : ""}
      {" "}Si un número no cuadra con Sage, manda Sage.
    </p>
  );
}
