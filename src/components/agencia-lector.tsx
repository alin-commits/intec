"use client";

import { useState, type ChangeEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { partidasQueSeSolapan, type PartidaDeAgencia } from "@/lib/agencia";
import type { PartidaPropuesta } from "@/lib/agencia-lector";
import { reportSafeError } from "@/lib/errors";
import { euros } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { writeRows } from "@/lib/supabase/write";
import type { BusinessUnit } from "@/lib/types";

/*
  Leer con IA el presupuesto de la agencia.

  Se sube el PDF o el Excel que manda la agencia, Claude lo pasa a partidas
  con los nombres del Hub y aquí se revisan una a una antes de guardar: la IA
  propone, no guarda. Las que coinciden con una que ya está —misma marca,
  mismo concepto, algún mes en común— salen desmarcadas, para que cargar dos
  veces el mismo presupuesto no duplique el gasto.
*/

const MAXIMO_BYTES = 4 * 1024 * 1024;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

type Propuesta = PartidaPropuesta & { clave: number; incluir: boolean; unaVez: boolean };

export function AgenciaLector({ abierto, marcas, partidas, nombreDelMes, onCerrar, onGuardado }: {
  abierto: boolean;
  marcas: BusinessUnit[];
  partidas: PartidaDeAgencia[];
  nombreDelMes: (mes: string) => string;
  onCerrar: () => void;
  onGuardado: (cuantas: number) => void;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lectura, setLectura] = useState<{ resumen: string; avisos: string[]; propuestas: Propuesta[] } | null>(null);

  const nombreDeMarca = (id: string | null) => (id ? marcas.find((marca) => marca.id === id)?.name ?? "Otra marca" : "Todas, sin repartir");
  const solapes = (propuesta: Propuesta) => partidasQueSeSolapan(propuesta, partidas);

  const cerrar = () => {
    if (leyendo || guardando) return;
    setArchivo(null);
    setLectura(null);
    setError(null);
    onCerrar();
  };

  const elegir = (evento: ChangeEvent<HTMLInputElement>) => {
    const elegido = evento.target.files?.[0] ?? null;
    setError(elegido && elegido.size > MAXIMO_BYTES ? "El archivo pasa de 4 MB. Prueba con un PDF más ligero o con el Excel." : null);
    setArchivo(elegido && elegido.size <= MAXIMO_BYTES ? elegido : null);
    setLectura(null);
  };

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    setError(null);
    try {
      const formulario = new FormData();
      formulario.append("archivo", archivo);
      const respuesta = await fetch("/api/agencia/leer-presupuesto", { method: "POST", body: formulario });
      const datos = await respuesta.json().catch(() => ({})) as { error?: string; resumen?: string; avisos?: string[]; partidas?: PartidaPropuesta[] };
      if (!respuesta.ok || !datos.partidas) {
        setError(datos.error ?? "No se pudo leer el presupuesto. Prueba otra vez.");
        return;
      }
      const propuestas = datos.partidas.map((partida, clave) => {
        const propuesta: Propuesta = { ...partida, clave, incluir: true, unaVez: partida.endMonth === partida.startMonth };
        return { ...propuesta, incluir: partidasQueSeSolapan(propuesta, partidas).length === 0 };
      });
      setLectura({ resumen: datos.resumen ?? "", avisos: datos.avisos ?? [], propuestas });
    } catch (causa) {
      setError(reportSafeError(causa, "No se pudo leer el presupuesto. Prueba otra vez."));
    } finally {
      setLeyendo(false);
    }
  };

  const cambiar = (clave: number, cambios: Partial<Propuesta>) =>
    setLectura((actual) => (actual ? { ...actual, propuestas: actual.propuestas.map((propuesta) => (propuesta.clave === clave ? { ...propuesta, ...cambios } : propuesta)) } : actual));

  const elegidas = lectura?.propuestas.filter((propuesta) => propuesta.incluir) ?? [];

  const guardar = async () => {
    const mal = elegidas.find((propuesta) => !propuesta.concept.trim() || !Number.isFinite(propuesta.monthlyAmount) || propuesta.monthlyAmount < 0
      || !MES.test(propuesta.startMonth) || (!propuesta.unaVez && propuesta.endMonth !== null && (!MES.test(propuesta.endMonth) || propuesta.endMonth < propuesta.startMonth)));
    if (mal) {
      setError(`Revisa «${mal.concept.trim() || "la partida sin concepto"}»: falta el concepto, el importe o los meses no cuadran.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const filas = elegidas.map((propuesta) => {
        const hasta = propuesta.unaVez ? propuesta.startMonth : propuesta.endMonth;
        return {
          business_unit_id: propuesta.businessUnitId,
          concept: propuesta.concept.trim(),
          monthly_amount: Math.round(propuesta.monthlyAmount * 100) / 100,
          start_month: `${propuesta.startMonth}-01`,
          end_month: hasta ? `${hasta}-01` : null,
          notes: [propuesta.notes, propuesta.deDonde ? `Leído con IA de: ${propuesta.deDonde}` : null].filter(Boolean).join(" · ").slice(0, 500) || null,
        };
      });
      await writeRows(createClient().from("agency_budget_lines").insert(filas), "No tienes permiso para cambiar el presupuesto de la agencia.", "id");
      setArchivo(null);
      setLectura(null);
      onGuardado(filas.length);
    } catch (causa) {
      setError(reportSafeError(causa, "No se pudieron guardar las partidas."));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open={abierto} title="Leer el presupuesto con IA" eyebrow="Presupuesto de la agencia" onClose={cerrar} large scrollInside>
      <div className="agencia-lector">
        <p className="agencia-lector-intro">
          Sube el presupuesto tal como lo manda la agencia, en PDF o Excel. La IA lo pasa a partidas con nuestras marcas y
          conceptos, y aquí las revisas antes de guardarlas. Nada se guarda hasta que pulses «Guardar».
        </p>

        <div className="agencia-lector-archivo">
          <input type="file" accept=".pdf,.xlsx,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={elegir} disabled={leyendo || guardando} aria-label="Presupuesto de la agencia" />
          <button type="button" className="button button-primary" disabled={!archivo || leyendo || guardando} onClick={() => void leer()}>
            {leyendo ? "Leyendo…" : lectura ? "Leer otra vez" : "Leer con IA"}
          </button>
        </div>
        {leyendo ? <p className="muted" role="status">La IA está leyendo el documento. Puede tardar hasta un minuto o dos.</p> : null}
        {error ? <p className="agencia-lector-error" role="alert">{error}</p> : null}

        {lectura ? (
          <>
            {lectura.resumen ? <p className="agencia-lector-resumen"><strong>Qué es:</strong> {lectura.resumen}</p> : null}
            {lectura.avisos.length > 0 ? (
              <div className="notice">
                <strong>Para revisar</strong>
                <ul className="agencia-lector-avisos">{lectura.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul>
              </div>
            ) : null}
            {lectura.propuestas.length === 0 ? (
              <p className="muted">La IA no ha encontrado partidas que proponer en este documento.</p>
            ) : (
              <ul className="agencia-propuestas">
                {lectura.propuestas.map((propuesta) => {
                  const iguales = solapes(propuesta);
                  return (
                    <li key={propuesta.clave} className={propuesta.incluir ? "" : "is-fuera"}>
                      <label className="agencia-propuesta-incluir">
                        <input type="checkbox" checked={propuesta.incluir} onChange={(evento) => cambiar(propuesta.clave, { incluir: evento.target.checked })} />
                        <span>{propuesta.incluir ? "Se guarda" : "No se guarda"}</span>
                      </label>
                      <div className="agencia-propuesta-campos">
                        <label><span>Marca</span>
                          <select value={propuesta.businessUnitId ?? ""} onChange={(evento) => cambiar(propuesta.clave, { businessUnitId: evento.target.value || null })}>
                            {marcas.map((marca) => <option key={marca.id} value={marca.id}>{marca.name}</option>)}
                            <option value="">Todas, sin repartir</option>
                          </select>
                        </label>
                        <label><span>Concepto</span>
                          <input value={propuesta.concept} maxLength={80} list="agencia-conceptos" onChange={(evento) => cambiar(propuesta.clave, { concept: evento.target.value })} />
                        </label>
                        <label><span>{propuesta.unaVez ? "Importe (€)" : "Al mes (€)"}</span>
                          <input type="number" min="0" step="0.01" inputMode="decimal" value={propuesta.monthlyAmount}
                            onChange={(evento) => cambiar(propuesta.clave, { monthlyAmount: Number(evento.target.value) })} />
                        </label>
                        <label><span>Cómo</span>
                          <select value={propuesta.unaVez ? "una" : "mes"} onChange={(evento) => cambiar(propuesta.clave, { unaVez: evento.target.value === "una" })}>
                            <option value="mes">Cada mes</option>
                            <option value="una">Una vez</option>
                          </select>
                        </label>
                        <label><span>{propuesta.unaVez ? "Mes" : "Desde"}</span>
                          <input type="month" value={propuesta.startMonth} pattern="\d{4}-\d{2}" onChange={(evento) => cambiar(propuesta.clave, { startMonth: evento.target.value })} />
                        </label>
                        {!propuesta.unaVez ? (
                          <label><span>Hasta</span>
                            <input type="month" value={propuesta.endMonth ?? ""} pattern="\d{4}-\d{2}" placeholder="sigue"
                              onChange={(evento) => cambiar(propuesta.clave, { endMonth: evento.target.value || null })} />
                          </label>
                        ) : null}
                      </div>
                      <p className="agencia-propuesta-origen">
                        {propuesta.deDonde ? <>Sacado de: {propuesta.deDonde}</> : null}
                        {propuesta.notes ? <> · {propuesta.notes}</> : null}
                      </p>
                      {iguales.length > 0 ? (
                        <p className="agencia-propuesta-solape">
                          Ya hay «{iguales[0].concept}» de {nombreDeMarca(iguales[0].businessUnitId)} en esos meses
                          ({euros(iguales[0].monthlyAmount)}{iguales[0].endMonth === iguales[0].startMonth ? "" : "/mes"}, {iguales[0].endMonth === null ? `desde ${nombreDelMes(iguales[0].startMonth)}` : `hasta ${nombreDelMes(iguales[0].endMonth)}`}).
                          {propuesta.incluir ? " Si la guardas, ese gasto contará dos veces." : " Por eso sale sin marcar."}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={cerrar} disabled={leyendo || guardando}>Cerrar</button>
          {lectura && lectura.propuestas.length > 0 ? (
            <button type="button" className="button button-primary" disabled={elegidas.length === 0 || guardando} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : `Guardar ${elegidas.length} partida${elegidas.length === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
