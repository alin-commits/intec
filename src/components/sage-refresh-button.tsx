"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
  "Actualizar desde Sage": pide al servidor de Sage que lea ahora mismo, además
  de las lecturas programadas.

  El Hub no puede entrar en el servidor de la oficina, así que deja una petición
  y el agente de allí, que pregunta cada minuto, la recoge. Por eso el botón
  pasa por "esperando al servidor" antes de "leyendo", y si el servidor no
  pregunta (tarea parada, servidor apagado) lo dice en vez de esperar sin fin.
*/

type RefreshStatus = "pendiente" | "leyendo" | "hecho" | "error" | "caducada";
type RefreshRequest = {
  id: string;
  status: RefreshStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
};

const POLL_MS = 4000;
/** Sin señales del agente en este tiempo, algo le pasa a la tarea del servidor. */
const AGENT_SILENT_MS = 3 * 60 * 1000;
/**
 * Pasado este rato, un fallo deja de ser noticia. El botón enseña el estado de
 * la última petición, sea de cuando sea, así que una que caducó por la mañana
 * seguía pintando la alarma en rojo el resto del día aunque el servidor llevara
 * horas respondiendo con normalidad.
 */
const FALLO_RECIENTE_MS = 30 * 60 * 1000;

const time = (value: string) => new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const isActive = (request: RefreshRequest | null) => request?.status === "pendiente" || request?.status === "leyendo";

export function SageRefreshButton({ onUpdated }: { onUpdated: () => void }) {
  const [request, setRequest] = useState<RefreshRequest | null>(null);
  const [agentLastPoll, setAgentLastPoll] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** La hora de la última consulta: con ella se decide si el servidor tarda demasiado. */
  const [checkedAt, setCheckedAt] = useState(0);
  /** La petición que se siguió desde esta pantalla: solo al acabar esa se recarga el panel. */
  const watchedId = useRef<string | null>(null);
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  });

  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/sage/refresh", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { request: RefreshRequest | null; agentLastPoll: string | null };
      setCheckedAt(Date.now());
      setAgentLastPoll(payload.agentLastPoll);
      setRequest(payload.request);
      if (payload.request && isActive(payload.request)) watchedId.current = payload.request.id;
      if (payload.request && payload.request.id === watchedId.current && payload.request.status === "hecho") {
        watchedId.current = null;
        onUpdatedRef.current();
      }
    } catch {
      // Sin conexión un momento: se vuelve a mirar en la siguiente vuelta.
    }
  }, []);

  // Al entrar se mira si hay una lectura en marcha (la pudo pedir otra persona).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await check();
    })();
    return () => { cancelled = true; };
  }, [check]);

  // Mientras hay una lectura en marcha, se sigue cada pocos segundos.
  const active = isActive(request);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, check]);

  async function ask() {
    setAsking(true);
    setFailure(null);
    try {
      const response = await fetch("/api/sage/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 2 }),
      });
      const payload = (await response.json().catch(() => ({}))) as { request?: RefreshRequest | null; error?: string };
      if (!response.ok || !payload.request) {
        setFailure(payload.error ?? "No se pudo pedir la lectura.");
        return;
      }
      watchedId.current = payload.request.id;
      setRequest(payload.request);
    } catch {
      setFailure("No se pudo pedir la lectura. Comprueba la conexión.");
    } finally {
      setAsking(false);
    }
  }

  const agentSilent = checkedAt > 0 && (!agentLastPoll || checkedAt - new Date(agentLastPoll).getTime() > AGENT_SILENT_MS);
  const waitingLong = checkedAt > 0 && request?.status === "pendiente" && checkedAt - new Date(request.requested_at).getTime() > 90 * 1000;
  /** Cuándo se dio por perdida la última petición. */
  const failedAt = request?.finished_at ?? request?.requested_at ?? null;
  // Se avisa del fallo si acaba de pasar, o si el agente sigue sin dar señales
  // (entonces no es historia: el problema sigue ahí ahora mismo).
  const warnAboutFailure = Boolean(
    checkedAt > 0 && failedAt
    && (checkedAt - new Date(failedAt).getTime() < FALLO_RECIENTE_MS || agentSilent),
  );

  let label = "Actualizar desde Sage";
  let status: { text: string; tone: "info" | "ok" | "bad" } | null = null;
  if (request?.status === "pendiente") {
    label = "Esperando al servidor…";
    status = waitingLong && agentSilent
      ? { text: "El servidor de Sage no está recogiendo peticiones. Revisa la tarea «Intec - Sage a peticion».", tone: "bad" }
      : { text: "El servidor de Sage la recogerá en menos de un minuto.", tone: "info" };
  } else if (request?.status === "leyendo") {
    label = "Leyendo Sage…";
    status = { text: "Suele tardar menos de un minuto.", tone: "info" };
  } else if (request?.status === "hecho" && request.finished_at) {
    status = { text: `Actualizado a las ${time(request.finished_at)}.`, tone: "ok" };
  } else if (request?.status === "error" && warnAboutFailure) {
    status = { text: `${request.message ?? "La lectura falló"} (${time(failedAt!)}).`, tone: "bad" };
  } else if (request?.status === "caducada" && warnAboutFailure) {
    status = agentSilent
      ? { text: `El servidor de Sage no responde desde las ${time(failedAt!)}. Revisa que el servidor y la tarea «Intec - Sage a peticion» estén en marcha.`, tone: "bad" }
      : { text: `El servidor de Sage no respondió a las ${time(failedAt!)}. Vuelve a intentarlo.`, tone: "bad" };
  }
  if (failure) status = { text: failure, tone: "bad" };

  return (
    <div className="sage-refresh">
      <button
        type="button"
        className="button button-secondary sage-refresh-button"
        onClick={() => void ask()}
        disabled={asking || active}
        aria-live="polite"
      >
        {active ? <span className="sage-refresh-spinner" aria-hidden="true" /> : null}
        {asking ? "Pidiendo…" : label}
      </button>
      {status ? <span className={`sage-refresh-status is-${status.tone}`} role="status">{status.text}</span> : null}
    </div>
  );
}
