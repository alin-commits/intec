"use client";

import { useState } from "react";
import {
  autoresVistos,
  origenDelAutor,
  repartirAutores,
  sugerirComercial,
  type Cuenta,
  type FilaDeAutor,
  type FilaDeComercial,
  type Persona,
  type QuienEs,
} from "@/lib/autores-albaran";
import { numberFormatter } from "@/lib/format";
import { comercialMarcado, euros, marcado, mesMarcado } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { rpcAllRows } from "./sales-queries";
import { DataTable, LoadFailed, Panel, RankList, share, useSageQuery, type Column } from "./sales-ui";

/*
  Quién hace los albaranes y a quién se le apuntan.

  La venta se le cuenta al comercial del cliente, pero el albarán lo hace
  quien lo hace: aquí se ve cuántos hace cada comercial que acaban contando
  para otro. Quién es cada usuario de Sage se dice aquí mismo, en «Quién es
  quién»: el número de usuario no es el de comercial y no se puede deducir.
*/

const OFICINA = "oficina";

/** Cuántos albaranes y, debajo, lo que suman. */
function cuenta({ documentos, neto }: Cuenta) {
  return <>{numberFormatter.format(documentos)}<span className="sales-change-amount">{euros(neto)}</span></>;
}

const sumaDe = (filas: FilaDeComercial[], campo: "hechos" | "propios" | "paraOtros" | "sinComercial"): Cuenta => ({
  documentos: filas.reduce((suma, fila) => suma + fila[campo].documentos, 0),
  neto: filas.reduce((suma, fila) => suma + fila[campo].neto, 0),
});

/** "12 · 8,3 %" y los euros debajo: un porcentaje nunca va sin lo que es en dinero. */
function parte(trozo: Cuenta, de: Cuenta) {
  return <>{numberFormatter.format(trozo.documentos)} · {share(trozo.documentos, de.documentos)}<span className="sales-change-amount">{euros(trozo.neto)}</span></>;
}

export function AutoresDeAlbaran({ ctx }: { ctx: SalesContext }) {
  const { filters } = ctx;
  // El periodo entero: los meses marcados se filtran aquí, como en el resto de la página.
  const { from, to } = ctx.period.base;
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  /** Lo apuntado desde que se abrió la página: null es «quitado». */
  const [cambios, setCambios] = useState<Record<string, QuienEs | null>>({});

  const filas = useSageQuery<FilaDeAutor[]>(JSON.stringify(["autores", from, to, ctx.reloadKey]), async () =>
    await rpcAllRows<FilaDeAutor>("sage_authors_summary", { p_from: from, p_to: to }, ["month", "company_code", "author", "author_name", "rep_code"].map((column) => ({ column }))));
  const apuntados = useSageQuery<QuienEs[]>(JSON.stringify(["quien-es", ctx.reloadKey]), async () => {
    const { data, error } = await createClient().from("sage_author_reps").select("author, rep_key, is_office");
    return { data: data as QuienEs[] | null, error };
  });

  const quienEs = new Map((apuntados.data ?? []).map((fila) => [fila.author, fila]));
  for (const [author, fila] of Object.entries(cambios)) {
    if (fila) quienEs.set(author, fila);
    else quienEs.delete(author);
  }

  // Los comerciales a los que se puede asignar un usuario: las personas, sin los comodines de Sage.
  const personas: Persona[] = [];
  for (const rep of ctx.reps) {
    const quien = ctx.repOf(rep.company_code, rep.code);
    if (quien.isPerson && !personas.some((persona) => persona.key === quien.key)) personas.push({ key: quien.key, label: quien.label });
  }
  personas.sort((a, b) => a.label.localeCompare(b.label, "es"));

  if (filas.failed || apuntados.failed) {
    return (
      <Panel title="Quién hace los albaranes" className="panel panel-padded sales-board-full">
        <LoadFailed what="quién hace cada albarán" />
      </Panel>
    );
  }
  if (!filas.data || !apuntados.data) {
    return (
      <Panel title="Quién hace los albaranes" className="panel panel-padded sales-board-full">
        <p className="muted">Cargando…</p>
      </Panel>
    );
  }
  if (filas.data.length === 0) {
    return (
      <Panel title="Quién hace los albaranes" className="panel panel-padded sales-board-full">
        <div className="sales-pending">
          <strong>Pendiente de la próxima lectura de Sage</strong>
          <span>
            Aquí se verá cuántos albaranes hace cada comercial que se le apuntan a otro. Llega en cuanto el programa del
            servidor de Sage mande quién hace cada albarán. No hace falta hacer nada aquí: se rellena solo.
          </span>
        </div>
      </Panel>
    );
  }

  const delPeriodo = filas.data.filter((fila) => marcado(filters.companies, fila.company_code) && mesMarcado(filters, fila.month));
  const reparto = repartirAutores(delPeriodo, [...quienEs.values()], ctx.repOf, ctx.repName);
  const conComercial = filters.repKeys.length > 0;
  const comerciales = reparto.comerciales.filter((fila) => comercialMarcado(filters, fila.key));

  // Todos los autores del periodo cargado, para decir quién es cada uno: los que faltan, primero.
  const vistos = autoresVistos(filas.data);
  const valorDe = (author: string) => {
    const quien = quienEs.get(author);
    return quien?.is_office ? OFICINA : quien?.rep_key ?? "";
  };
  const sinDecir = vistos.filter((autor) => valorDe(autor.author) === "");
  const porDecir = [...sinDecir, ...vistos.filter((autor) => valorDe(autor.author) !== "")];
  // La primera vez no hay nada apuntado y la tabla saldría vacía: el editor se abre solo.
  const conEditor = editando || quienEs.size === 0;

  const guardar = async (author: string, valor: string) => {
    setGuardando(author);
    setFallo(null);
    const supabase = createClient();
    const fila: QuienEs | null = valor === "" ? null : { author, rep_key: valor === OFICINA ? null : valor, is_office: valor === OFICINA };
    const { error } = fila
      ? await supabase.from("sage_author_reps").upsert({ ...fila, updated_at: new Date().toISOString() }, { onConflict: "author" })
      : await supabase.from("sage_author_reps").delete().eq("author", author);
    setGuardando(null);
    if (error) {
      console.error("No se pudo apuntar quién es el autor:", error);
      setFallo("No se pudo guardar. Solo administración y dirección pueden decir quién es quién.");
      return;
    }
    setCambios((actuales) => ({ ...actuales, [author]: fila }));
  };

  const columnas: Column<FilaDeComercial>[] = [
    { key: "comercial", header: "Quién los hace", text: true, render: (fila) => fila.label, sort: (fila) => fila.label },
    { key: "hechos", header: "Albaranes hechos", render: (fila) => cuenta(fila.hechos), sort: (fila) => fila.hechos.documentos, total: (todas) => cuenta(sumaDe(todas, "hechos")) },
    {
      key: "propios", header: "Propios", optional: true,
      render: (fila) => parte(fila.propios, fila.hechos), sort: (fila) => fila.propios.documentos,
      total: (todas) => parte(sumaDe(todas, "propios"), sumaDe(todas, "hechos")),
    },
    {
      key: "otros", header: "Para otro comercial",
      render: (fila) => <strong>{parte(fila.paraOtros, fila.hechos)}</strong>, sort: (fila) => fila.paraOtros.documentos,
      total: (todas) => parte(sumaDe(todas, "paraOtros"), sumaDe(todas, "hechos")),
    },
    {
      key: "sin", header: "Sin comercial", optional: true,
      render: (fila) => parte(fila.sinComercial, fila.hechos), sort: (fila) => fila.sinComercial.documentos,
      total: (todas) => parte(sumaDe(todas, "sinComercial"), sumaDe(todas, "hechos")),
    },
  ];

  const editor = (
    <div className="autores-editor">
      <p className="autores-editor-intro">
        Cada usuario de Sage que ha hecho albaranes en este periodo, con el comercial que es. Se guarda al elegir. Los de
        oficina y tienda van aparte: no son comerciales, pero se ve a quién apuntan lo que hacen.
      </p>
      {fallo ? <p className="autores-fallo" role="alert">{fallo}</p> : null}
      <ul className="autores-lista">
        {porDecir.map((autor) => {
          const valor = valorDe(autor.author);
          const propuesta = valor === "" ? sugerirComercial(autor.nombre, personas) : null;
          return (
            <li key={autor.author} className={`autores-fila${valor === "" ? " is-pendiente" : ""}`}>
              <div className="autores-quien">
                <strong>{autor.nombre}</strong>
                <span>{origenDelAutor(autor.author)} · {numberFormatter.format(autor.documentos)} albaranes</span>
              </div>
              <select
                value={valor}
                disabled={guardando === autor.author}
                aria-label={`Quién es ${autor.nombre}`}
                onChange={(event) => void guardar(autor.author, event.target.value)}
              >
                <option value="">Sin decir</option>
                <option value={OFICINA}>Oficina o tienda</option>
                <optgroup label="Comerciales">
                  {personas.map((persona) => <option key={persona.key} value={persona.key}>{persona.label}</option>)}
                  {valor !== "" && valor !== OFICINA && !personas.some((persona) => persona.key === valor)
                    ? <option value={valor}>{ctx.repName(valor)}</option> : null}
                </optgroup>
              </select>
              {propuesta ? (
                <button type="button" className="sales-chip autores-propuesta" disabled={guardando === autor.author} onClick={() => void guardar(autor.author, propuesta.key)}>
                  ¿Es {propuesta.label}?
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const oficina = reparto.oficina;
  return (
    <Panel
      title="Quién hace los albaranes"
      subtitle={`Albaranes de ${ctx.periodName} según quién los hace en Sage y a qué comercial se le apunta la venta. Pulsa uno para ver a quién${filters.channels.length > 0 ? " · sin filtro de canal" : ""}`}
      trailing={(
        <button type="button" className="sales-chip" aria-expanded={conEditor} onClick={() => setEditando((actual) => !actual)}>
          Quién es quién{sinDecir.length > 0 ? ` · ${numberFormatter.format(sinDecir.length)} sin decir` : ""}
        </button>
      )}
      className="panel panel-padded sales-board-full"
    >
      {conEditor ? editor : null}
      <DataTable
        rows={comerciales}
        columns={columnas}
        rowKey={(fila) => fila.key}
        activeKey={abierto}
        onRowClick={(fila) => setAbierto((actual) => (actual === fila.key ? null : fila.key))}
        initialSort={{ key: "otros", desc: true }}
        expand={(fila) => (fila.key === abierto ? (
          <div className="sales-row-detail-inner">
            <p className="sales-row-detail-title">
              {fila.aQuien.length > 0 ? `A quién se apuntan los albaranes que ${fila.label} hace para otros` : `${fila.label} no ha hecho albaranes para otros comerciales en este periodo`}
            </p>
            {fila.aQuien.length > 0 ? (
              <RankList items={fila.aQuien.map((destino) => ({
                key: destino.key, label: destino.label, value: destino.documentos,
                valueLabel: numberFormatter.format(destino.documentos), extra: euros(destino.neto),
              }))} />
            ) : null}
          </div>
        ) : null)}
        empty={quienEs.size === 0
          ? "Todavía no se ha dicho quién es quién: asigna cada usuario de Sage a su comercial y aquí saldrá lo que hace cada uno."
          : conComercial ? "Ningún usuario de Sage asignado a este comercial ha hecho albaranes en este periodo." : "Ningún comercial ha hecho albaranes en este periodo."}
      />
      {/* Lo que no es de ningún comercial, para que el total cuadre con los albaranes del periodo. */}
      {!conComercial ? (
        <div className="sales-inline-stats">
          {oficina.hechos.documentos > 0 ? (
            <span title={oficina.aQuien.slice(0, 5).map((destino) => `${destino.label}: ${numberFormatter.format(destino.documentos)}`).join(" · ")}>
              Oficina y tienda <strong>{numberFormatter.format(oficina.hechos.documentos)} · {euros(oficina.hechos.neto)}</strong>
              de ellos a comerciales <strong>{numberFormatter.format(oficina.aComerciales.documentos)} · {share(oficina.aComerciales.documentos, oficina.hechos.documentos)}</strong>
            </span>
          ) : null}
          {reparto.sinDecir.length > 0 ? (
            <span>
              De usuarios sin decir quién son <strong>{numberFormatter.format(reparto.sinDecir.reduce((suma, autor) => suma + autor.documentos, 0))}</strong>
            </span>
          ) : null}
          {reparto.sinAutor.documentos > 0 ? (
            <span>Sin usuario en Sage <strong>{numberFormatter.format(reparto.sinAutor.documentos)} · {euros(reparto.sinAutor.neto)}</strong></span>
          ) : null}
          <span>Todos los albaranes <strong>{numberFormatter.format(reparto.total.documentos)} · {euros(reparto.total.neto)}</strong></span>
        </div>
      ) : null}
    </Panel>
  );
}
