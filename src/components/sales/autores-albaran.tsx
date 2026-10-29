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
  Albaranes por comercial: los que hace y a quién se facturan.

  La venta se le cuenta al comercial del cliente, y muchos clientes ya tienen
  uno asignado: el albarán lo hace quien lo hace, pero se factura al del
  cliente. Aquí se ve, por comercial, cuántos hace, cuántos van a su
  facturación y cuántos se facturan a otro; y al revés, todo lo que entra en
  su facturación y cuánto de eso le hicieron otros.

  Quién es cada usuario de Sage se dice aquí mismo, en «Quién es quién»: el
  número de usuario no es el de comercial y no se puede deducir.
*/

/** Lo que dice la base cuando la función o la tabla todavía no existen: falta la migración. */
const SIN_PREPARAR = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);
const sinPreparar = (error: unknown) => SIN_PREPARAR.has(String((error as { code?: string } | null)?.code ?? ""));

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
  // Un comercial que no hace albaranes no tiene de qué sacar el porcentaje.
  if (de.documentos === 0) return <span className="muted">—</span>;
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

  /*
    Si la base todavía no tiene lo de los autores, no es un fallo de carga: es
    que falta prepararla. Se dice eso, en vez de «no se pudo cargar», que hace
    pensar que algo se ha roto.
  */
  const filas = useSageQuery<{ preparada: boolean; filas: FilaDeAutor[] }>(JSON.stringify(["autores", from, to, ctx.reloadKey]), async () => {
    const { data, error } = await rpcAllRows<FilaDeAutor>("sage_authors_summary", { p_from: from, p_to: to }, ["month", "company_code", "author", "author_name", "rep_code"].map((column) => ({ column })));
    if (error && sinPreparar(error)) return { data: { preparada: false, filas: [] }, error: null };
    return { data: error ? null : { preparada: true, filas: data ?? [] }, error };
  });
  const apuntados = useSageQuery<QuienEs[]>(JSON.stringify(["quien-es", ctx.reloadKey]), async () => {
    const { data, error } = await createClient().from("sage_author_reps").select("author, rep_key, is_office");
    if (error && sinPreparar(error)) return { data: [], error: null };
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
      <Panel title="Albaranes por comercial" className="panel panel-padded sales-board-full">
        <LoadFailed what="los albaranes por comercial" />
      </Panel>
    );
  }
  if (!filas.data || !apuntados.data) {
    return (
      <Panel title="Albaranes por comercial" className="panel panel-padded sales-board-full">
        <p className="muted">Cargando…</p>
      </Panel>
    );
  }
  if (!filas.data.preparada || filas.data.filas.length === 0) {
    return (
      <Panel title="Albaranes por comercial" className="panel panel-padded sales-board-full">
        <div className="sales-pending">
          <strong>{filas.data.preparada ? "Pendiente de la próxima lectura de Sage" : "Falta preparar la base de datos"}</strong>
          <span>
            Aquí se verá, por comercial, cuántos albaranes hace, cuántos van a su facturación y cuántos se facturan a otro
            comercial porque el cliente ya está asignado.{" "}
            {filas.data.preparada
              ? "Llega en cuanto el programa del servidor de Sage mande quién hace cada albarán. No hace falta hacer nada aquí: se rellena solo."
              : "Antes hay que poner en la base de datos la parte que guarda quién hace cada albarán; en cuanto esté, se rellena con la siguiente lectura de Sage."}
          </span>
        </div>
      </Panel>
    );
  }

  const delPeriodo = filas.data.filas.filter((fila) => marcado(filters.companies, fila.company_code) && mesMarcado(filters, fila.month));
  const reparto = repartirAutores(delPeriodo, [...quienEs.values()], ctx.repOf, ctx.repName);
  const conComercial = filters.repKeys.length > 0;
  const comerciales = reparto.comerciales.filter((fila) => comercialMarcado(filters, fila.key));

  // Todos los autores del periodo cargado, para decir quién es cada uno: los que faltan, primero.
  const vistos = autoresVistos(filas.data.filas);
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
    { key: "comercial", header: "Comercial", text: true, render: (fila) => fila.label, sort: (fila) => fila.label },
    { key: "hechos", header: "Albaranes hechos", render: (fila) => cuenta(fila.hechos), sort: (fila) => fila.hechos.documentos, total: (todas) => cuenta(sumaDe(todas, "hechos")) },
    {
      key: "propios", header: "A su facturación",
      render: (fila) => parte(fila.propios, fila.hechos), sort: (fila) => fila.propios.documentos,
      total: (todas) => parte(sumaDe(todas, "propios"), sumaDe(todas, "hechos")),
    },
    {
      key: "otros", header: "Facturados a otro comercial",
      render: (fila) => <strong>{parte(fila.paraOtros, fila.hechos)}</strong>, sort: (fila) => fila.paraOtros.documentos,
      total: (todas) => parte(sumaDe(todas, "paraOtros"), sumaDe(todas, "hechos")),
    },
    {
      key: "sin", header: "Sin comercial", optional: true,
      render: (fila) => parte(fila.sinComercial, fila.hechos), sort: (fila) => fila.sinComercial.documentos,
      total: (todas) => parte(sumaDe(todas, "sinComercial"), sumaDe(todas, "hechos")),
    },
    /*
      La otra cara: todo lo que entra en su facturación, lo haya hecho quien
      sea, y cuánto de eso le hicieron otros. Con esto se ve a quien no hace
      albaranes pero factura, porque otro se los hace.
    */
    {
      key: "factura", header: "En su facturación", sort: (fila) => fila.enSuFacturacion.documentos,
      render: (fila) => <>
        {numberFormatter.format(fila.enSuFacturacion.documentos)}
        <span className="sales-change-amount">
          {euros(fila.enSuFacturacion.neto)}
          {fila.hechosPorOtros.documentos > 0 ? ` · ${numberFormatter.format(fila.hechosPorOtros.documentos)} se los hizo otro` : ""}
        </span>
      </>,
      total: (todas) => cuenta({ documentos: todas.reduce((suma, fila) => suma + fila.enSuFacturacion.documentos, 0), neto: todas.reduce((suma, fila) => suma + fila.enSuFacturacion.neto, 0) }),
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
      title="Albaranes por comercial"
      subtitle={`Albaranes de ${ctx.periodName}: los que hace cada comercial en Sage, cuántos van a su facturación y cuántos se facturan a otro porque el cliente ya está asignado. Pulsa uno para ver a quién${filters.channels.length > 0 ? " · sin filtro de canal" : ""}`}
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
        initialSort={{ key: "hechos", desc: true }}
        expand={(fila) => (fila.key === abierto ? (
          <div className="sales-row-detail-inner sales-two-columns">
            <div>
              <p className="sales-row-detail-title">
                {fila.aQuien.length > 0 ? "Los que hace y se facturan a otro: a quién" : "No ha hecho albaranes que se facturen a otro comercial"}
              </p>
              {fila.aQuien.length > 0 ? (
                <RankList items={fila.aQuien.map((destino) => ({
                  key: destino.key, label: destino.label, value: destino.documentos,
                  valueLabel: numberFormatter.format(destino.documentos), extra: euros(destino.neto),
                }))} />
              ) : null}
            </div>
            <div>
              <p className="sales-row-detail-title">
                {fila.deQuien.length > 0 ? "Los de su facturación que le hizo otro: quién" : "Nadie le ha hecho albaranes de su facturación (de los usuarios ya asignados)"}
              </p>
              {fila.deQuien.length > 0 ? (
                <RankList items={fila.deQuien.map((origen) => ({
                  key: origen.key, label: origen.label, value: origen.documentos,
                  valueLabel: numberFormatter.format(origen.documentos), extra: euros(origen.neto),
                }))} />
              ) : null}
            </div>
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
