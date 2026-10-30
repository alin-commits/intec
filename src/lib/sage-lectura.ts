import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Cuándo se leyó Sage por última vez, dicho para que se entienda de un vistazo.

  El agente lee cada hora, a y 46, de día y de noche: una lectura normal tiene
  menos de una hora. Con más de dos se ha saltado al menos una pasada, y eso
  tiene que notarse, que es lo primero que conviene saber antes de fiarse de
  una cifra.

  Las horas van siempre en hora de Madrid: la base guarda UTC y confundirlas
  ya hizo parecer una vez que el agente se había parado.
*/

/** Pasado esto sin leer, el agente se ha saltado alguna pasada. */
export const ATRASADA_A_LOS_MINUTOS = 120;

const ZONA = "Europe/Madrid";
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
const DIA_CORTO = new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, day: "2-digit", month: "2-digit" });
const HORA = new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, hour: "2-digit", minute: "2-digit" });
const ENTERA = new Intl.DateTimeFormat("es-ES", {
  timeZone: ZONA, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export type EstadoDeLaLectura = {
  /** «hace 12 min», «hace 3 h», «ayer a las 23:46», «el 27/10 a las 15:46». */
  texto: string;
  /** La fecha y hora enteras, para quien quiera el detalle. */
  exacta: string;
  atrasada: boolean;
};

export function estadoDeLaLectura(leidaAt: string, ahora: number): EstadoDeLaLectura {
  const leida = new Date(leidaAt);
  const minutos = Math.max(0, Math.floor((ahora - leida.getTime()) / 60000));
  const dia = DIA.format(leida);
  const hora = HORA.format(leida);

  let texto: string;
  if (minutos < 2) texto = "hace un momento";
  else if (minutos < 60) texto = `hace ${minutos} min`;
  else if (dia === DIA.format(new Date(ahora))) texto = `hace ${Math.floor(minutos / 60)} h`;
  else if (dia === DIA.format(new Date(ahora - 86400000))) texto = `ayer a las ${hora}`;
  else texto = `el ${DIA_CORTO.format(leida)} a las ${hora}`;

  return { texto, exacta: ENTERA.format(leida), atrasada: minutos > ATRASADA_A_LOS_MINUTOS };
}

/**
 * La hora de la última lectura que terminó bien.
 *
 * Null si no consta ninguna; undefined si no se puede saber, y entonces no se
 * enseña nada antes que enseñar algo falso. Va por sage_ultima_lectura, que la
 * da a cualquiera del equipo. Mientras esa función no exista en la base, quien
 * puede leer la tabla de lecturas —dirección y administración— la lee ahí; a
 * los demás la tabla les sale vacía, y vacía no quiere decir «nunca».
 */
export async function ultimaLecturaDeSage(supabase: SupabaseClient): Promise<string | null | undefined> {
  const { data, error } = await supabase.rpc("sage_ultima_lectura");
  if (!error) return (data as string | null) ?? null;

  const { data: fila, error: errorTabla } = await supabase
    .from("sage_sync_runs")
    .select("started_at, finished_at")
    .eq("ok", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorTabla || !fila) return undefined;
  const { started_at, finished_at } = fila as { started_at: string; finished_at: string | null };
  return finished_at ?? started_at;
}
