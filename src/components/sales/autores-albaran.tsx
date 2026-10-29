"use client";

import { useState } from "react";
import {
  autoresVistos,
  enlacesPorNumero,
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

  Qué usuarios de Sage son de cada comercial se dice aquí mismo, empezando
  por los comerciales: el número de usuario no es el de comercial y no se
  puede deducir. Los usuarios que no son de ningún comercial son otros
  empleados, sin tener que marcarlos: en Sage hay decenas y comerciales son
  unos pocos.
*/

/** Lo que dice la base cuando la función o la tabla todavía no existen: falta la migración. */
const SIN_PREPARAR = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);
const sinPreparar = (error: unknown) => SIN_PREPARAR.has(String((error as { code?: string } | null)?.code ?? ""));

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

  /*
    De quién es cada usuario: primero los operadores del TPV que se enlazan
    solos con su comisionista por el número; encima, lo apuntado a mano, que
    manda —también para quitar uno de esos enlaces—; y encima, lo que se
    acaba de cambiar en esta pantalla.
  */
  const vistos = autoresVistos(filas.data?.filas ?? []);
  const enlazados = enlacesPorNumero(vistos, ctx.repOf);
  const automaticos = new Set(enlazados.map((enlace) => enlace.author));
  const quienEs = new Map(enlazados.map((enlace) => [enlace.author, enlace]));
  for (const fila of apuntados.data ?? []) {
    quienEs.set(fila.author, fila);
    automaticos.delete(fila.author);
  }
  for (const [author, fila] of Object.entries(cambios)) {
    automaticos.delete(author);
    if (fila) quienEs.set(author, fila);
    else quienEs.delete(author);
  }

  /** "comisionista 51", o los varios que tenga en distintas sociedades: lo que se ve en Sage. */
  const comoComisionista = (key: string) => {
    const codigos = [...new Set(ctx.reps.filter((rep) => ctx.repOf(rep.company_code, rep.code).key === key).map((rep) => rep.code))].sort((a, b) => a - b);
    return codigos.length === 0 ? "" : `comisionista ${codigos.join(", ")}`;
  };

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

  /*
    Para decir de quién es cada usuario se parte de los comerciales con venta
    en el panel —y de los que ya tienen alguno, para poder quitárselo—. Los
    usuarios que se ofrecen son los que han hecho albaranes en el periodo.
  */
  const deQuienEs = (author: string) => quienEs.get(author)?.rep_key ?? null;
  const conVenta = ctx.model.byRep.filter((rep) => rep.isPerson && rep.assigned && rep.bucket.net > 0).map((rep) => ({ key: rep.key, label: rep.name }));
  const conUsuario = [...new Set([...quienEs.values()].map((quien) => quien.rep_key).filter((key): key is string => Boolean(key)))]
    .filter((key) => !conVenta.some((rep) => rep.key === key))
    .map((key) => ({ key, label: ctx.repName(key) }));
  const delPanel = [...conVenta, ...conUsuario].sort((a, b) => a.label.localeCompare(b.label, "es"));
  const libres = vistos.filter((autor) => deQuienEs(autor.author) === null);
  const usuariosDe = (key: string) => [...quienEs.values()].filter((quien) => quien.rep_key === key).map((quien) => quien.author);
  const nombreDelAutor = (author: string) => vistos.find((autor) => autor.author === author)?.nombre ?? origenDelAutor(author);
  const hayAsignados = [...quienEs.values()].some((quien) => Boolean(quien.rep_key));
  // La primera vez no hay nada apuntado y la tabla saldría vacía: el editor se abre solo.
  const conEditor = editando || !hayAsignados;

  /*
    Le da un usuario de Sage a un comercial, o se lo quita (null). Quitar no
    borra la fila: la deja sin comercial, porque un operador del TPV que se
    enlaza solo volvería a enlazarse si no quedara apuntado que no es él.
  */
  const guardar = async (author: string, repKey: string | null) => {
    setGuardando(author);
    setFallo(null);
    const supabase = createClient();
    const fila: QuienEs = { author, rep_key: repKey, is_office: false };
    const { error } = await supabase.from("sage_author_reps").upsert({ ...fila, updated_at: new Date().toISOString() }, { onConflict: "author" });
    setGuardando(null);
    if (error) {
      console.error("No se pudo apuntar quién es el autor:", error);
      setFallo("No se pudo guardar. Solo administración y dirección pueden decir qué usuarios son de cada comercial.");
      return;
    }
    setCambios((actuales) => ({ ...actuales, [author]: fila }));
  };

  const columnas: Column<FilaDeComercial>[] = [
    {
      key: "comercial", header: "Comercial", text: true, sort: (fila) => fila.label,
      render: (fila) => <>{fila.label}{comoComisionista(fila.key) ? <small className="autores-codigo">{comoComisionista(fila.key).replace("comisionista ", "")}</small> : null}</>,
    },
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

  /** "usuario 24" o "TPV 150, sociedad 1": corto, para la lista. */
  const origenCorto = (author: string) => origenDelAutor(author).replace("Usuario ", "usuario ").replace(" de Sage", "").replace("TPV de la sociedad ", "TPV, sociedad ");

  const editor = (
    <div className="autores-editor">
      <p className="autores-editor-intro">
        Los comisionistas con venta en el panel. A cada uno, el usuario o los usuarios de Sage con los que hace albaranes. Su
        operador del TPV se enlaza solo, porque lleva su mismo número de comisionista; el usuario de Sage hay que elegirlo, porque
        su número no coincide. Se guarda al elegir. Los usuarios que no son de ningún comisionista cuentan como otros empleados.
      </p>
      {fallo ? <p className="autores-fallo" role="alert">{fallo}</p> : null}
      <ul className="autores-lista">
        {delPanel.map((rep) => {
          const suyos = usuariosDe(rep.key);
          // Los que se parecen por el nombre, primero: solo ordena, no decide nada.
          const parecidos = libres.filter((autor) => sugerirComercial(autor.nombre, personas)?.key === rep.key);
          const resto = libres.filter((autor) => !parecidos.includes(autor));
          const opcion = (autor: (typeof libres)[number]) => (
            <option key={autor.author} value={autor.author}>
              {autor.nombre} · {origenCorto(autor.author)} · {numberFormatter.format(autor.documentos)} albaranes
            </option>
          );
          return (
            <li key={rep.key} className={`autores-fila${suyos.length === 0 ? " is-pendiente" : ""}`}>
              <div className="autores-quien">
                <strong>{rep.label}</strong>
                <span>
                  {[comoComisionista(rep.key), suyos.length === 0 ? "sin usuario de Sage: no hace albaranes, o falta elegirlo" : `${suyos.length} usuario${suyos.length === 1 ? "" : "s"} de Sage`].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="autores-usuarios">
                {suyos.map((author) => (
                  <span key={author} className="autores-usuario">
                    {nombreDelAutor(author)} <small>{origenCorto(author)}{automaticos.has(author) ? " · por su número" : ""}</small>
                    <button type="button" aria-label={`Quitar ${nombreDelAutor(author)} de ${rep.label}`} disabled={guardando === author}
                      onClick={() => void guardar(author, null)}>×</button>
                  </span>
                ))}
                <select value="" disabled={guardando !== null || libres.length === 0} aria-label={`Añadir un usuario de Sage a ${rep.label}`}
                  onChange={(event) => { if (event.target.value) void guardar(event.target.value, rep.key); }}>
                  <option value="">{libres.length === 0 ? "No quedan usuarios sin comercial" : "+ Añadir usuario de Sage…"}</option>
                  {parecidos.length > 0 ? <optgroup label="Parecidos por el nombre">{parecidos.map(opcion)}</optgroup> : null}
                  {resto.length > 0 ? <optgroup label={parecidos.length > 0 ? "Los demás" : "Usuarios sin comercial"}>{resto.map(opcion)}</optgroup> : null}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const otros = reparto.otros;
  return (
    <Panel
      title="Albaranes por comercial"
      subtitle={`Albaranes de ${ctx.periodName}: los que hace cada comercial en Sage, cuántos van a su facturación y cuántos se facturan a otro comisionista porque el cliente es suyo. Pulsa uno para ver a quién${filters.channels.length > 0 ? " · sin filtro de canal" : ""}`}
      trailing={(
        <button type="button" className="sales-chip" aria-expanded={conEditor} onClick={() => setEditando((actual) => !actual)}>
          Usuarios de cada comercial
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
                {fila.deQuien.length > 0 ? "Los de su facturación que le hizo otro: quién" : "Nadie más le ha hecho albaranes de su facturación"}
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
        empty={!hayAsignados
          ? "Todavía no hay usuarios de Sage asignados: elige arriba los de cada comercial y aquí saldrá lo que hace cada uno."
          : conComercial ? "Ningún usuario de Sage asignado a este comercial ha hecho albaranes en este periodo." : "Ningún comercial ha hecho albaranes en este periodo."}
      />
      {/* Lo que no es de ningún comercial, para que el total cuadre con los albaranes del periodo. */}
      {!conComercial ? (
        <div className="sales-inline-stats">
          {otros.hechos.documentos > 0 ? (
            <span title={otros.aQuien.slice(0, 5).map((destino) => `${destino.label}: ${numberFormatter.format(destino.documentos)}`).join(" · ")}>
              Otros empleados <strong>{numberFormatter.format(otros.hechos.documentos)} · {euros(otros.hechos.neto)}</strong>
              de ellos facturados a comerciales <strong>{numberFormatter.format(otros.aComerciales.documentos)} · {share(otros.aComerciales.documentos, otros.hechos.documentos)}</strong>
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
