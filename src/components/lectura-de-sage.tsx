"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { estadoDeLaLectura, ultimaLecturaDeSage } from "@/lib/sage-lectura";

/*
  Cuándo se leyó Sage, al pie del menú: en todas las pantallas, sin tener que
  ir a Ventas a buscarlo.

  Se mantiene al día sola: el «hace 12 min» avanza con el reloj y la hora se
  vuelve a pedir cada cinco minutos y al volver a la pestaña. El agente lee a
  y 46; quien deja el Hub abierto toda la mañana tiene que ver que la lectura
  se renueva, o que deja de hacerlo.
*/
export function LecturaDeSage() {
  const [leida, setLeida] = useState<string | null | undefined>(undefined);
  // El reloj se mira al cargar y en el intervalo, nunca al pintar: mirarlo
  // mientras se dibuja es impuro y el compilador de React lo rechaza.
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let vivo = true;
    const cargar = async () => {
      const cuando = await ultimaLecturaDeSage(createClient());
      if (!vivo) return;
      setLeida(cuando);
      setAhora(Date.now());
    };
    void cargar();
    const reloj = window.setInterval(() => setAhora(Date.now()), 30_000);
    const releer = window.setInterval(() => void cargar(), 5 * 60_000);
    const alVolver = () => {
      if (document.visibilityState === "visible") void cargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      window.clearInterval(reloj);
      window.clearInterval(releer);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  if (leida === undefined || ahora === null) return null;
  if (leida === null) {
    return (
      <p className="lectura-sage is-old" role="status">
        <span className="lectura-sage-punto" aria-hidden="true" />
        <span>Sage: sin lecturas todavía</span>
      </p>
    );
  }

  const estado = estadoDeLaLectura(leida, ahora);
  return (
    <p className={estado.atrasada ? "lectura-sage is-old" : "lectura-sage"} role="status"
      title={`Última lectura de Sage: ${estado.exacta}. El agente lee cada hora${estado.atrasada ? "; lleva más de dos sin leer, algo lo ha parado" : ""}.`}>
      <span className="lectura-sage-punto" aria-hidden="true" />
      <span>Sage leído {estado.texto}</span>
    </p>
  );
}
