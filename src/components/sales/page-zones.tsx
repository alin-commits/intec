"use client";

import { useState } from "react";
import { numberFormatter } from "@/lib/format";
import { euros } from "@/lib/sales-model";
import { NOMBRES_DE_PROVINCIA, intensidadDeColor } from "@/lib/zonas-mapa";
import { MAPA_ALTO, MAPA_ANCHO, PROVINCIAS_SVG } from "@/lib/zonas-svg";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { DataTable, LoadFailed, Panel, PendingDetail, share, useSageQuery, type Column } from "./sales-ui";

/*
  Zonas: dónde está la cartera de cada comercial.

  La pregunta que contesta es «¿dónde tengo masa y dónde tengo hueco?», para
  decidir a qué zona mandar a alguien. Con un comercial marcado arriba, todo
  lo de esta página es suyo.

  Ni la provincia ni el municipio salen tal cual vienen de Sage: los escribe
  quien da de alta la ficha y llegan con 57 grafías para 52 provincias, y con
  el mismo pueblo escrito de tres maneras. La provincia se saca del código
  postal y los municipios se unifican por mayúsculas, tildes y la barra
  bilingüe. Lo hace la base; el porqué y los números están en las migraciones
  202610280001 y 202610280002.
*/

type ZoneRow = {
  province_code: string;
  province: string;
  region: string;
  customers: number;
  net_amount: number;
  documents: number;
  mismatched: number;
  municipalities: { name: string; customers: number; net: number }[] | null;
};

/** Qué mide el mapa: cuántos clientes hay o cuánto compran. */
type Medida = "customers" | "net_amount";

/** Cuántos municipios se enseñan al desplegar una provincia. */
const MUNICIPIOS_A_LA_VISTA = 12;

function MapaDeEspana({ filas, medida, marcada, onMarcar }: {
  filas: ZoneRow[];
  medida: Medida;
  marcada: string | null;
  onMarcar: (code: string | null) => void;
}) {
  const porCodigo = new Map(filas.map((fila) => [fila.province_code, fila]));
  const maximo = Math.max(0, ...filas.map((fila) => Number(fila[medida])));
  const comoSeLee = (valor: number) => (medida === "customers"
    ? `${numberFormatter.format(valor)} ${valor === 1 ? "cliente" : "clientes"}`
    : euros(valor));

  return (
    <div className="zonas-mapa">
      <svg viewBox={`0 0 ${MAPA_ANCHO} ${MAPA_ALTO}`} className="zonas-svg" role="img"
           aria-label="Mapa de España con los clientes de cada provincia">
        {PROVINCIAS_SVG.map(({ code, d }) => {
          const dato = porCodigo.get(code);
          const valor = dato ? Number(dato[medida]) : 0;
          const nombre = NOMBRES_DE_PROVINCIA[code] ?? code;
          const activa = marcada === code;
          return (
            <path
              key={code}
              d={d}
              className={activa ? "zonas-provincia activa" : "zonas-provincia"}
              style={{ "--peso": intensidadDeColor(valor, maximo) } as React.CSSProperties}
              onClick={() => onMarcar(activa ? null : code)}
            >
              {/* El título es el que sale al pasar por encima; sin librería de
                  por medio, que un mapa no necesita una. */}
              <title>{valor > 0 ? `${nombre}: ${comoSeLee(valor)}` : `${nombre}: sin clientes en este periodo`}</title>
            </path>
          );
        })}
      </svg>
      <div className="zonas-leyenda">
        <span className="muted">{medida === "customers" ? "Menos clientes" : "Menos venta"}</span>
        <span className="zonas-escala" aria-hidden="true" />
        <span className="muted">{maximo > 0 ? comoSeLee(maximo) : "—"}</span>
      </div>
    </div>
  );
}

export function ZonesPage({ ctx }: { ctx: SalesContext }) {
  const { period } = ctx;
  const reload = ctx.reloadKey;
  const [medida, setMedida] = useState<Medida>("customers");
  const [marcada, setMarcada] = useState<string | null>(null);

  const conMeses = ctx.rpc.p_months ? { p_months: ctx.rpc.p_months } : {};
  const conSociedades = ctx.rpc.p_companies ? { p_companies: ctx.rpc.p_companies } : {};
  const conFamilias = ctx.rpc.p_families ? { p_families: ctx.rpc.p_families } : {};
  const conSubfamilias = ctx.rpc.p_subfamilies ? { p_subfamilies: ctx.rpc.p_subfamilies } : {};
  const args = {
    p_from: period.from, p_to: period.to,
    ...conSociedades, ...conFamilias, ...conSubfamilias, ...conMeses,
    p_reps: ctx.rpc.p_reps ?? null, p_series: ctx.rpc.p_series ?? null,
  };

  const zonas = useSageQuery<ZoneRow[]>(
    JSON.stringify(["zonas", args, reload]),
    async () => await createClient().rpc("sage_customer_zones", args),
  );

  const filas = zonas.data ?? [];
  const totalClientes = filas.reduce((suma, fila) => suma + Number(fila.customers), 0);
  const totalVenta = filas.reduce((suma, fila) => suma + Number(fila.net_amount), 0);
  const descuadradas = filas.reduce((suma, fila) => suma + Number(fila.mismatched), 0);
  const sinProvincia = filas.find((fila) => fila.province === "Sin provincia");
  const conProvincia = filas.filter((fila) => fila.province !== "Sin provincia");
  const laMarcada = marcada ? filas.find((fila) => fila.province_code === marcada) ?? null : null;

  const columnas: Column<ZoneRow>[] = [
    {
      key: "provincia", header: "Provincia", text: true,
      render: (fila) => <><strong>{fila.province}</strong><small>{fila.region}</small></>,
      sort: (fila) => fila.province,
      total: () => <strong>Total</strong>,
    },
    {
      key: "clientes", header: "Clientes",
      render: (fila) => numberFormatter.format(Number(fila.customers)),
      sort: (fila) => Number(fila.customers),
      total: (rows) => numberFormatter.format(rows.reduce((suma, fila) => suma + Number(fila.customers), 0)),
    },
    {
      key: "venta", header: "Venta",
      render: (fila) => euros(Number(fila.net_amount)),
      sort: (fila) => Number(fila.net_amount),
      total: (rows) => euros(rows.reduce((suma, fila) => suma + Number(fila.net_amount), 0)),
    },
    {
      key: "peso", header: "% de la venta", optional: true,
      render: (fila) => share(Number(fila.net_amount), totalVenta),
      sort: (fila) => Number(fila.net_amount),
      total: () => "100 %",
    },
    {
      // Distingue «tengo 40 clientes pequeños» de «tengo 4 que valen oro»,
      // que no es lo mismo a la hora de reforzar una zona.
      key: "media", header: "Media por cliente", optional: true,
      render: (fila) => (Number(fila.customers) > 0 ? euros(Number(fila.net_amount) / Number(fila.customers)) : <span className="muted">—</span>),
      sort: (fila) => (Number(fila.customers) > 0 ? Number(fila.net_amount) / Number(fila.customers) : 0),
      total: (rows) => {
        const clientes = rows.reduce((suma, fila) => suma + Number(fila.customers), 0);
        const venta = rows.reduce((suma, fila) => suma + Number(fila.net_amount), 0);
        return clientes > 0 ? euros(venta / clientes) : <span className="muted">—</span>;
      },
    },
  ];

  if (zonas.failed) return <LoadFailed what="las zonas" />;

  return (
    <>
      <Panel
        title="Dónde están los clientes"
        subtitle={`${numberFormatter.format(totalClientes)} clientes con compras en ${ctx.periodName}, repartidos en ${numberFormatter.format(conProvincia.length)} provincias`}
        trailing={
          <label className="zonas-medida">
            <span className="sr-only">Qué pinta el mapa</span>
            <select className="table-select" value={medida} onChange={(event) => setMedida(event.target.value as Medida)}>
              <option value="customers">Por número de clientes</option>
              <option value="net_amount">Por venta</option>
            </select>
          </label>
        }
      >
        {zonas.loading && filas.length === 0
          ? <PendingDetail what="el mapa" />
          : <MapaDeEspana filas={filas} medida={medida} marcada={marcada} onMarcar={setMarcada} />}

        {laMarcada ? (
          <p className="zonas-elegida">
            <strong>{laMarcada.province}</strong>
            <span>{numberFormatter.format(Number(laMarcada.customers))} clientes</span>
            <span>{euros(Number(laMarcada.net_amount))}</span>
            <span className="muted">{share(Number(laMarcada.net_amount), totalVenta)} de la venta</span>
            <button type="button" className="button button-compact button-secondary" onClick={() => setMarcada(null)}>Quitar</button>
          </p>
        ) : null}

        {/*
          Lo que no cuadra se dice, no se esconde: son fichas que se arreglan
          en Sage, y hasta que se arreglen el mapa coloca cada cliente donde
          dice su código postal.
        */}
        {sinProvincia || descuadradas > 0 ? (
          <p className="muted zonas-aviso">
            {sinProvincia ? `${numberFormatter.format(Number(sinProvincia.customers))} clientes sin código postal ni provincia: no salen en el mapa, pero sí en la tabla. ` : ""}
            {descuadradas > 0 ? `En ${numberFormatter.format(descuadradas)} fichas la provincia escrita no coincide con su código postal; manda el código postal.` : ""}
          </p>
        ) : null}
      </Panel>

      <Panel title="Provincias" subtitle="Pulsa una fila para ver sus municipios">
        <DataTable
          rows={filas}
          columns={columnas}
          rowKey={(fila) => fila.province_code}
          activeKey={marcada}
          onRowClick={(fila) => setMarcada(marcada === fila.province_code ? null : fila.province_code)}
          initialSort={{ key: medida === "customers" ? "clientes" : "venta", desc: true }}
          expand={(fila) => {
            const municipios = fila.municipalities ?? [];
            if (municipios.length === 0) return null;
            const aLaVista = municipios.slice(0, MUNICIPIOS_A_LA_VISTA);
            const resto = municipios.length - aLaVista.length;
            return (
              <div className="zonas-detalle">
                <p className="zonas-detalle-titulo">{fila.province}, municipio a municipio</p>
                <ul className="zonas-municipios">
                  {aLaVista.map((municipio) => (
                    <li key={municipio.name}>
                      <span className="zonas-municipio-nombre">{municipio.name}</span>
                      <span className="zonas-municipio-clientes">{numberFormatter.format(Number(municipio.customers))}</span>
                      <span className="zonas-municipio-venta">{euros(Number(municipio.net))}</span>
                    </li>
                  ))}
                </ul>
                {resto > 0 ? (
                  <p className="muted zonas-detalle-resto">
                    y {numberFormatter.format(resto)} municipios más, con {euros(municipios.slice(MUNICIPIOS_A_LA_VISTA).reduce((suma, m) => suma + Number(m.net), 0))} entre todos
                  </p>
                ) : null}
              </div>
            );
          }}
          empty={zonas.loading ? "Cargando…" : "Ningún cliente con compras en este periodo."}
        />
      </Panel>
    </>
  );
}
