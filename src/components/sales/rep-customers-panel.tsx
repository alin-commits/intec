"use client";

import { useMemo, useState } from "react";
import { currencyFormatter, numberFormatter } from "@/lib/format";
import { downloadCsv, type CsvColumn } from "@/lib/csv-export";
import { downloadXlsx } from "@/lib/excel-export";
import type { SalesContext } from "./sales-context";
import { rpcAllRows } from "./sales-queries";
import { euros, type SalesFilters } from "@/lib/sales-model";
import { Cifras } from "@/components/ui/cifras";
import { Column, DataTable, LoadFailed, Panel, shortDate, useSageQuery } from "./sales-ui";

/*
  La cartera de un comercial: quién le compra y quién no.

  El panel sabía decir quién compró en un periodo. Lo que faltaba era lo
  contrario —de los clientes que lleva, cuáles no han comprado nada—, que es la
  lista con la que se trabaja el teléfono. Y para los que sí compran, de qué
  familias, para saber qué más se les podría vender.

  Dos avisos que se ven en pantalla, porque callarlos sería peor:

   · El comercial es el que tiene asignado el cliente en Sage, no quien firmó
     cada albarán.
   · El reparto por familias en Sage es mensual, así que un periodo que corte un
     mes por la mitad cuenta ese mes entero. Por eso las familias van aparte y
     no se suman al neto del periodo, que sí es exacto.
*/

export type RepCustomerRow = {
  company_code: number;
  customer_code: string;
  name: string | null;
  trade_name: string | null;
  rep_code: number | null;
  province: string | null;
  municipality: string | null;
  phone: string | null;
  email: string | null;
  left_on: string | null;
  net_amount: number;
  documents: number;
  previous_amount: number;
  first_purchase: string | null;
  last_purchase: string | null;
  days_since_last: number | null;
  families: { code: string; name: string; net: number }[];
};

const nombreDe = (fila: RepCustomerRow) => fila.name || fila.trade_name || fila.customer_code;

/** De quién es la cartera que se está viendo. */
const carteraDe = (filters: SalesFilters) =>
  (filters.repKeys.length === 0 ? "todos los comerciales"
    : filters.repKeys.length === 1 ? "este comercial"
      : `estos ${filters.repKeys.length} comerciales`);

export function RepCustomersPanel({ ctx }: { ctx: SalesContext }) {
  const [verCarteraEntera, setVerCarteraEntera] = useState(false);

  const args = { p_from: ctx.period.from, p_to: ctx.period.to, ...ctx.rpc };
  const resultado = useSageQuery<RepCustomerRow[]>(
    ctx.detail.customers ? JSON.stringify(["cartera-comercial", args, ctx.reloadKey]) : null,
    async () => rpcAllRows<RepCustomerRow>("sage_rep_customers", args, [
      { column: "net_amount", ascending: false },
      { column: "customer_code" },
    ]),
  );
  const filas = useMemo(() => resultado.data ?? [], [resultado.data]);

  const conVentas = useMemo(() => filas.filter((fila) => Number(fila.net_amount) > 0), [filas]);
  const sinVentasTodos = useMemo(() => filas.filter((fila) => Number(fila.net_amount) <= 0), [filas]);
  // Los que compraban antes y ahora no son los que se pueden recuperar; el
  // resto de la cartera es ruido salvo que se pida verla.
  const sinVentas = useMemo(
    () => (verCarteraEntera ? sinVentasTodos : sinVentasTodos.filter((fila) => Number(fila.previous_amount) > 0)),
    [sinVentasTodos, verCarteraEntera],
  );

  /** Lo vendido por familia a estos clientes, para las tarjetas y su hoja de Excel. */
  const porFamilia = useMemo(() => {
    const acumulado = new Map<string, { code: string; name: string; net: number; clientes: number }>();
    for (const fila of conVentas) {
      for (const familia of fila.families ?? []) {
        const actual = acumulado.get(familia.code) ?? { code: familia.code, name: familia.name, net: 0, clientes: 0 };
        actual.net += Number(familia.net) || 0;
        actual.clientes += 1;
        acumulado.set(familia.code, actual);
      }
    }
    return [...acumulado.values()].filter((f) => f.net > 0).sort((a, b) => b.net - a.net);
  }, [conVentas]);

  const neto = conVentas.reduce((suma, fila) => suma + Number(fila.net_amount), 0);
  const perdido = sinVentas.reduce((suma, fila) => suma + Number(fila.previous_amount), 0);

  const columnasComunes = (conImporte: boolean): Column<RepCustomerRow>[] => [
    {
      key: "cliente", header: "Cliente", text: true,
      render: (fila) => (
        <span className="sales-article">
          <strong>{nombreDe(fila)}</strong>
          <small>
            {[fila.municipality, fila.province].filter(Boolean).join(", ") || fila.customer_code}
            {fila.left_on ? " · dado de baja" : ""}
          </small>
        </span>
      ),
      sort: (fila) => nombreDe(fila),
      total: (filas) => `Total · ${numberFormatter.format(filas.length)} clientes`,
    },
    {
      key: "comercial", header: "Comercial", text: true, optional: true,
      render: (fila) => (fila.rep_code === null ? <span className="muted">Sin asignar</span> : ctx.repOf(fila.company_code, fila.rep_code).label),
      sort: (fila) => (fila.rep_code === null ? "" : ctx.repOf(fila.company_code, fila.rep_code).label),
    },
    conImporte
      ? { key: "neto", header: "Comprado", render: (fila) => euros(Number(fila.net_amount)), sort: (fila) => Number(fila.net_amount), total: (filas) => euros(filas.reduce((suma, fila) => suma + Number(fila.net_amount), 0)) }
      : { key: "antes", header: "Compraba antes", render: (fila) => (Number(fila.previous_amount) > 0 ? euros(Number(fila.previous_amount)) : <span className="muted">nunca</span>), sort: (fila) => Number(fila.previous_amount), total: (filas) => euros(filas.reduce((suma, fila) => suma + Number(fila.previous_amount), 0)) },
    {
      key: "ultima", header: "Última compra", optional: true,
      render: (fila) => (fila.last_purchase ? <>{shortDate(fila.last_purchase)}{fila.days_since_last !== null ? <small className="muted"> · hace {numberFormatter.format(fila.days_since_last)} días</small> : null}</> : <span className="muted">nunca</span>),
      sort: (fila) => fila.last_purchase ?? "",
    },
    conImporte
      ? {
        key: "familias", header: "Familias", text: true,
        render: (fila) => (fila.families?.length
          ? <span className="familia-chips">{fila.families.slice(0, 3).map((familia) => <span key={familia.code} className="badge">{familia.name}</span>)}{fila.families.length > 3 ? <small className="muted"> +{fila.families.length - 3}</small> : null}</span>
          : <span className="muted">—</span>),
        sort: (fila) => fila.families?.length ?? 0,
      }
      : { key: "telefono", header: "Teléfono", text: true, optional: true, render: (fila) => fila.phone || <span className="muted">—</span>, sort: (fila) => fila.phone ?? "" },
  ];

  const columnasExcel = (conImporte: boolean): CsvColumn<RepCustomerRow>[] => [
    { header: "Código", value: (fila) => fila.customer_code },
    { header: "Cliente", value: (fila) => nombreDe(fila) },
    { header: "Comercial", value: (fila) => (fila.rep_code === null ? "Sin asignar" : ctx.repOf(fila.company_code, fila.rep_code).label) },
    { header: "Población", value: (fila) => fila.municipality },
    { header: "Provincia", value: (fila) => fila.province },
    { header: "Teléfono", value: (fila) => fila.phone },
    { header: "Correo", value: (fila) => fila.email },
    { header: conImporte ? "Comprado (€)" : "Compraba antes (€)", value: (fila) => Number(conImporte ? fila.net_amount : fila.previous_amount) },
    { header: "Albaranes", value: (fila) => Number(fila.documents) },
    { header: "Primera compra", value: (fila) => fila.first_purchase },
    { header: "Última compra", value: (fila) => fila.last_purchase },
    { header: "Días sin comprar", value: (fila) => fila.days_since_last },
    { header: "Familias", value: (fila) => (fila.families ?? []).map((familia) => `${familia.name}: ${familia.net}`).join(" · ") },
  ];

  const nombreArchivo = `cartera_${ctx.periodName.replace(/\s+/g, "_")}`;

  function exportarExcel() {
    void downloadXlsx(`${nombreArchivo}.xlsx`, [
      { name: "Con ventas", columns: columnasExcel(true), rows: conVentas },
      { name: "Sin ventas", columns: columnasExcel(false), rows: sinVentas },
      {
        name: "Por familia",
        columns: [
          { header: "Familia", value: (fila: typeof porFamilia[number]) => fila.name },
          { header: "Código", value: (fila: typeof porFamilia[number]) => fila.code },
          { header: "Vendido (€)", value: (fila: typeof porFamilia[number]) => Number(fila.net.toFixed(2)) },
          { header: "Clientes", value: (fila: typeof porFamilia[number]) => fila.clientes },
        ],
        rows: porFamilia,
      },
    ] as never[]);
  }

  if (!ctx.detail.customers) return null;
  if (resultado.failed) return <LoadFailed what="la cartera" />;

  return (
    <>
      <section className="section-heading">
        <div>
          <span className="eyebrow">Cartera</span>
          <h2>Clientes de {carteraDe(ctx.filters)} en {ctx.periodName}</h2>
          <p>
            Quién compra y quién no, y de qué familias. El comercial es el que tiene asignado el cliente en Sage,
            no quien firmó el albarán.
          </p>
        </div>
        <div className="panel-heading-trailing">
          <button type="button" className="button button-compact button-secondary" disabled={filas.length === 0} onClick={exportarExcel}>Exportar Excel</button>
          <button type="button" className="button button-compact button-secondary" disabled={filas.length === 0}
            onClick={() => downloadCsv(`${nombreArchivo}.csv`, [...conVentas, ...sinVentas], columnasExcel(true))}>CSV</button>
        </div>
      </section>

      <Cifras
        className="panel panel-padded"
        cifras={[
          { key: "compran", etiqueta: "Con compra", valor: numberFormatter.format(conVentas.length), nota: `${euros(neto)} en el periodo`, tono: "bueno" },
          { key: "sin", etiqueta: "Sin compra", valor: numberFormatter.format(sinVentas.length), nota: verCarteraEntera ? "de toda la cartera" : `compraban ${euros(perdido)} el año anterior`, tono: sinVentas.length > 0 ? "malo" : undefined },
          { key: "cartera", etiqueta: "Cartera", valor: numberFormatter.format(filas.length), nota: "clientes asignados, compren o no" },
          { key: "porCliente", etiqueta: "Venta por cliente", valor: conVentas.length ? currencyFormatter.format(neto / conVentas.length) : "—", nota: "de media entre los que compran" },
        ]}
      />

      {porFamilia.length > 0 ? (
        <Cifras
          className="panel panel-padded"
          titulo="Qué les vende"
          subtitulo="En Sage el reparto por familia es mensual: un periodo que corte un mes cuenta ese mes entero, así que estas cifras orientan y no cuadran al céntimo con el neto de arriba"
          cifras={porFamilia.slice(0, 8).map((familia) => ({
            key: familia.code,
            etiqueta: familia.name,
            valor: euros(familia.net),
            nota: `${numberFormatter.format(familia.clientes)} ${familia.clientes === 1 ? "cliente" : "clientes"}`,
          }))}
        />
      ) : null}

      <Panel title={`Compran (${numberFormatter.format(conVentas.length)})`} subtitle="ordenados por lo que llevan comprado">
        <DataTable rows={conVentas} columns={columnasComunes(true)} rowKey={(fila) => `${fila.company_code}-${fila.customer_code}`}
          onRowClick={(fila) => ctx.openCustomer({ company_code: fila.company_code, customer_code: fila.customer_code, name: nombreDe(fila) })}
          initialSort={{ key: "neto", desc: true }} limit={12}
          empty={resultado.loading ? "Cargando…" : "Ningún cliente con compras en este periodo."} />
      </Panel>

      <Panel
        title={`No compran (${numberFormatter.format(sinVentas.length)})`}
        subtitle={verCarteraEntera ? "toda la cartera sin compras en el periodo" : "compraban el año anterior y este periodo, nada"}
        trailing={(
          <label className="inline-check">
            <input type="checkbox" checked={verCarteraEntera} onChange={(evento) => setVerCarteraEntera(evento.target.checked)} />
            <span>Ver toda la cartera</span>
          </label>
        )}
      >
        <DataTable rows={sinVentas} columns={columnasComunes(false)} rowKey={(fila) => `${fila.company_code}-${fila.customer_code}`}
          onRowClick={(fila) => ctx.openCustomer({ company_code: fila.company_code, customer_code: fila.customer_code, name: nombreDe(fila) })}
          initialSort={{ key: "antes", desc: true }} limit={12}
          empty={resultado.loading ? "Cargando…" : "Todos los clientes de la cartera han comprado."} />
      </Panel>
    </>
  );
}
