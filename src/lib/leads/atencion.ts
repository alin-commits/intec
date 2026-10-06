// Import relativo y con extensión, como en el resto de lo que cubren los tests:
// el runner de node no entiende el alias "@/".
import { dateKeyInMadrid, madridMidnightIso } from "../dates.ts";

/*
  Cuánto se tarda en atender un lead, y a partir de cuándo eso es tarde.

  Para qué está: un lead que entra bien y se queda dos días sin que nadie lo
  toque no es un problema de marketing. Sin esto, lo único que se ve es "no se
  cerró", y eso se discute; con la hora delante, no hay nada que discutir.

  Se mide desde que entra el lead hasta el primer cambio de estado que lo saca
  de "Nuevo", sea cual sea: ese es el momento en que alguien lo miró. Si acabó
  ganado, perdido o no válido es otra conversación —aquí solo se mira cuánto
  tardó en recibir la primera señal.

  No cuentan ni sábados ni domingos. Un lead que entra el viernes a las siete y
  se atiende el lunes a las nueve no es culpa de nadie, y una medida que acusa a
  quien no estaba trabajando se deja de mirar a la semana. El día se parte por
  la medianoche de Madrid, no por la del servidor, que está en UTC: si no, un
  lead de las 23:30 contaría como del día siguiente.
*/

/**
 * Un día de trabajo para dar la primera señal.
 *
 * El número sale de mirar los leads de verdad: con 24 h se señalan los que se
 * durmieron sin acusar a todo el mundo. Si algún día se queda corto o largo, se
 * cambia aquí y cambia en todas partes.
 */
export const HORAS_PARA_ATENDER = 24;

export type CambioDeEstado = { newStatus: string; changedAt: string };

export type LeadParaAtender = {
  createdAt: string;
  status: string;
  statusHistory?: CambioDeEstado[];
};

export type Atencion = {
  /**
   *  · `a-tiempo`: lo atendieron dentro del plazo.
   *  · `tarde`: lo atendieron, pero pasado el plazo.
   *  · `sin-atender`: sigue en "Nuevo" y ya se pasó el plazo.
   *  · `esperando`: sigue en "Nuevo" pero todavía está en plazo.
   */
  estado: "a-tiempo" | "tarde" | "sin-atender" | "esperando";
  /** Horas laborables que tardaron en atenderlo, o que lleva esperando. */
  horas: number;
};

/** Las horas entre dos instantes, descontando sábados y domingos (hora de Madrid). */
export function horasLaborables(desdeIso: string, hastaIso: string): number {
  const desde = new Date(desdeIso).getTime();
  const hasta = new Date(hastaIso).getTime();
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta <= desde) return 0;

  let horas = 0;
  let cursor = desde;
  while (cursor < hasta) {
    const clave = dateKeyInMadrid(new Date(cursor).toISOString());
    const [ano, mes, dia] = clave.split("-").map(Number);
    // El día siguiente a medianoche de Madrid; madridMidnightIso admite que el
    // día se desborde, así que el 31 + 1 cae solo en el mes que toca.
    const finDelDia = new Date(madridMidnightIso(ano, mes - 1, dia + 1)).getTime();
    const corte = Math.min(finDelDia, hasta);
    if (corte <= cursor) break; // nunca debería pasar; mejor que un bucle infinito
    // El mediodía evita que el huso mueva el día de la semana.
    const diaDeLaSemana = new Date(`${clave}T12:00:00Z`).getUTCDay();
    if (diaDeLaSemana !== 0 && diaDeLaSemana !== 6) horas += (corte - cursor) / 3600000;
    cursor = corte;
  }
  return horas;
}

/** Cuándo alguien tocó el lead por primera vez, o null si sigue intacto. */
export function primerToque(cambios: CambioDeEstado[] | undefined): string | null {
  let primero: string | null = null;
  for (const cambio of cambios ?? []) {
    if (cambio.newStatus === "new") continue;
    if (!primero || new Date(cambio.changedAt).getTime() < new Date(primero).getTime()) primero = cambio.changedAt;
  }
  return primero;
}

export function atencionDeLead(lead: LeadParaAtender, ahora = new Date().toISOString()): Atencion {
  const toque = primerToque(lead.statusHistory);
  if (toque) {
    const horas = horasLaborables(lead.createdAt, toque);
    return { estado: horas > HORAS_PARA_ATENDER ? "tarde" : "a-tiempo", horas };
  }
  // Sin ningún cambio guardado: si ya no está en "Nuevo", alguien lo movió
  // antes de que existiera el registro de cambios. No se puede acusar a nadie.
  if (lead.status !== "new") return { estado: "a-tiempo", horas: 0 };
  const horas = horasLaborables(lead.createdAt, ahora);
  return { estado: horas > HORAS_PARA_ATENDER ? "sin-atender" : "esperando", horas };
}

/** "6 h", "1 día laborable", "3 días laborables": para decirlo sin dar un número crudo. */
export function horasEnPalabras(horas: number): string {
  if (horas < 1) return "menos de 1 h";
  if (horas < HORAS_PARA_ATENDER) return `${Math.round(horas)} h`;
  const dias = Math.floor(horas / HORAS_PARA_ATENDER);
  return dias === 1 ? "1 día laborable" : `${dias} días laborables`;
}
