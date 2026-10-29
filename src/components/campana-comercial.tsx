"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellIcon, RefreshIcon } from "@/components/icons";
import { useClickOutside } from "@/components/ui/use-click-outside";
import { cargarPorCerrar, cargarSinAtender, type LeadSinAtender, type PorCerrar } from "@/lib/avisos-comercial";
import { esperaDetallada, HORAS_PARA_ATENDER } from "@/lib/leads/atencion";
import { DIAS_PARA_CERRAR } from "@/lib/por-cerrar";

/*
  La campana de abajo a la derecha: lo que el comercial tiene pendiente, siempre
  a la vista.

  Los dos avisos de entrada salen una vez, al entrar, y se callan una hora.
  Esto no se calla: está en todas las pantallas y se pone al día sola —cada
  cinco minutos y al volver a la pestaña—, así que quien deja el Hub abierto
  toda la mañana sin recargar se entera igual de que le ha entrado un lead o
  de que una consulta lleva una semana parada.

  Cuenta lo mismo que los avisos porque lo saca del mismo sitio,
  avisos-comercial.ts. Y esas consultas van directas a la base, sin pasar por
  el servidor de la web: preguntar cada cinco minutos no suma tráfico de Vercel.
*/

const CADA_MINUTOS = 5;
/** Volver a la pestaña no vuelve a preguntar si se preguntó hace menos de esto. */
const MINIMO_ENTRE_CARGAS_MS = 60_000;
const CUANTOS_POR_GRUPO = 5;

const enDias = (dias: number) => (dias === 1 ? "1 día" : `${dias} días`);

function haceCuanto(desde: number, ahora: number): string {
  const minutos = Math.floor((ahora - desde) / 60_000);
  if (minutos < 1) return "ahora mismo";
  if (minutos === 1) return "hace 1 minuto";
  return `hace ${minutos} minutos`;
}

export function CampanaComercial({ userId }: { userId: string }) {
  const [sinAtender, setSinAtender] = useState<LeadSinAtender[]>([]);
  const [porCerrar, setPorCerrar] = useState<{ leads: PorCerrar[]; consultas: PorCerrar[] }>({ leads: [], consultas: [] });
  const [actualizadoEn, setActualizadoEn] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [open, setOpen] = useState(false);
  /** Sube para volver a preguntar: el reloj, volver a la pestaña o el botón. */
  const [vuelta, setVuelta] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  const ultimaCarga = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapperRef, () => setOpen(false));

  useEffect(() => {
    let activo = true;
    void (async () => {
      const [leadsTarde, abiertos] = await Promise.all([cargarSinAtender(userId), cargarPorCerrar(userId)]);
      if (!activo) return;
      ultimaCarga.current = Date.now();
      setSinAtender(leadsTarde);
      setPorCerrar(abiertos);
      setActualizadoEn(Date.now());
      setCargando(false);
    })();
    return () => { activo = false; };
  }, [userId, vuelta]);

  useEffect(() => {
    const reloj = setInterval(() => setVuelta((n) => n + 1), CADA_MINUTOS * 60_000);
    // El «hace X minutos» del pie, al día aunque nadie toque nada.
    const minutero = setInterval(() => setAhora(Date.now()), 30_000);
    // Al volver a la pestaña o a la ventana, si hace rato que no se preguntó:
    // es justo cuando alguien se ha ido a otra cosa y vuelve.
    function alVolver() {
      if (document.visibilityState !== "visible") return;
      setAhora(Date.now());
      if (Date.now() - ultimaCarga.current > MINIMO_ENTRE_CARGAS_MS) setVuelta((n) => n + 1);
    }
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      clearInterval(reloj);
      clearInterval(minutero);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, []);

  function actualizarYa() {
    setCargando(true);
    setVuelta((n) => n + 1);
  }

  const total = sinAtender.length + porCerrar.leads.length + porCerrar.consultas.length;
  // Rojo si hay algún lead sin atender, que es lo que no puede esperar; ámbar
  // si solo hay cosas por cerrar, que pueden esperar a la tarde.
  const tono = sinAtender.length > 0 ? "is-urgente" : total > 0 ? "is-pendiente" : "";

  const grupo = (titulo: string, items: PorCerrar[]) => (items.length === 0 ? null : (
    <section className="campana-grupo">
      <h3>{titulo} · {items.length}</h3>
      <ul className="pending-leads-list">
        {items.slice(0, CUANTOS_POR_GRUPO).map((item) => (
          <li key={item.clave}>
            <Link href={item.enlace} className="pending-lead-link" onClick={() => setOpen(false)}>
              <span className="pending-lead-name">
                <strong>{item.nombre}</strong>
                <small>{[item.estado, item.empresa && item.empresa !== item.nombre ? item.empresa : null].filter(Boolean).join(" · ")}</small>
              </span>
              <span className="pending-lead-delay por-cerrar-delay">{enDias(item.dias)}</span>
            </Link>
          </li>
        ))}
        {items.length > CUANTOS_POR_GRUPO ? <li className="por-cerrar-mas muted">Y {items.length - CUANTOS_POR_GRUPO} más.</li> : null}
      </ul>
    </section>
  ));

  return (
    <div className="campana-comercial" ref={wrapperRef}>
      {open ? (
        <div className="campana-panel" role="dialog" aria-label="Tus pendientes">
          <div className="popover-header">
            <strong className="popover-title">Tus pendientes</strong>
            <button type="button" className="button button-compact button-secondary" onClick={actualizarYa} disabled={cargando} aria-label="Actualizar ahora">
              <RefreshIcon />{cargando ? "Mirando…" : "Actualizar"}
            </button>
          </div>

          {total === 0 ? (
            <p className="campana-vacia">Todo al día: nada sin atender ni por cerrar.</p>
          ) : null}

          {sinAtender.length > 0 ? (
            <section className="campana-grupo">
              <h3>Leads sin atender · {sinAtender.length}</h3>
              <p className="muted campana-nota">Más de {HORAS_PARA_ATENDER} horas laborables esperando desde que entraron.</p>
              <ul className="pending-leads-list">
                {sinAtender.slice(0, CUANTOS_POR_GRUPO).map((lead) => (
                  <li key={lead.id}>
                    <Link href={`/leads?lead=${lead.id}`} className="pending-lead-link" onClick={() => setOpen(false)}>
                      <span className="pending-lead-name">
                        <strong>{lead.nombre}</strong>
                        {lead.empresa && lead.empresa !== lead.nombre ? <small>{lead.empresa}</small> : null}
                      </span>
                      <span className="pending-lead-delay">{esperaDetallada(lead.horas)}</span>
                    </Link>
                  </li>
                ))}
                {sinAtender.length > CUANTOS_POR_GRUPO ? <li className="por-cerrar-mas muted">Y {sinAtender.length - CUANTOS_POR_GRUPO} más.</li> : null}
              </ul>
            </section>
          ) : null}

          {porCerrar.leads.length + porCerrar.consultas.length > 0 ? (
            <p className="muted campana-nota">Por cerrar: {DIAS_PARA_CERRAR} días o más contactados o interesados. Ganado o perdido.</p>
          ) : null}
          {grupo("Leads por cerrar", porCerrar.leads)}
          {grupo("Consultas por cerrar", porCerrar.consultas)}

          <p className="muted campana-pie">
            {actualizadoEn ? `Actualizado ${haceCuanto(actualizadoEn, ahora)}. Se pone al día solo cada ${CADA_MINUTOS} minutos.` : "Mirando…"}
          </p>
        </div>
      ) : null}

      <button
        type="button"
        className={`campana-boton ${tono}`}
        aria-label={total ? `Tus pendientes: ${total}` : "Tus pendientes: ninguno"}
        aria-expanded={open}
        onClick={() => { setOpen((abierto) => !abierto); setAhora(Date.now()); }}
      >
        <BellIcon />
        {total > 0 ? <span className="campana-cifra">{total > 99 ? "99+" : total}</span> : null}
      </button>
    </div>
  );
}
