"use client";

import { useState } from "react";
import { numberFormatter } from "@/lib/format";
import { euros } from "@/lib/sales-model";
import { CUADRICULA_DE_ESPANA, intensidadDeColor } from "@/lib/zonas-mapa";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { DataTable, LoadFailed, Panel, PendingDetail, share, useSageQuery, type Column } from "./sales-ui";

/*
  Zonas: dónde está la cartera de cada comercial.

  La pregunta que contesta es «¿dónde tengo masa y dónde tengo hueco?», para
  decidir a qué zona mandar a alguien. Con un comercial marcado arriba, todo
  lo de esta página es suyo.

  La provincia no sale del campo «provincia» de Sage, que viene escrito a mano
  y con 57 grafías distintas para 52 provincias —y que a veces contradice al
  código postal—, sino de los dos primeros dígitos del CP, que son la
  provincia por definición. Lo hace la base; aquí solo se pinta. El detalle y
  los números de por qué están en la migración 202610280001.
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

/** Qué mide el mapa: la cantidad de clientes o lo que compran. */
type Medida = "customers" | "net_amount";



function MapaDeProvincias({ filas, medida, marcada, onMarcar }: {
  filas: ZoneRow[];
  medida: Medida;
  marcada: string | null;
  onMarcar: (code: string | null) => void;
}) {
  const porCodigo = new Map(filas.map((fila) => [fila.province_code, fila]));
  const maximo = Math.max(0, ...filas.map((fila) => Number(fila[medida])));
  const comoSeLee = (valor: number) => (medida === "customers" ? `${numberFormatter.format(valor)} clientes` : euros(valor));

  return (
    <div className="zonas-mapa" role="group" aria-label="Mapa de provincias">
      {CUADRICULA_DE_ESPANA.map(({ code, corto, col, fila }) => {
        const dato = porCodigo.get(code);
        const valor = dato ? Number(dato[medida]) : 0;
        const peso = intensidadDeColor(valor, maximo);
        const activa = marcada === code;
        return (
          <button
            key={code}
            type="button"
            className={activa ? "zonas-casilla activa" : "zonas-casilla"}
            style={{ gridColumn: col, gridRow: fila, "--peso": peso } as React.CSSProperties}
            // El título lleva el nombre entero: las siglas de las matrículas
            // las lee cualquiera de aquí, pero no todo el mundo sabe que SG es
            // Segovia.
            title={dato ? `${dato.province}: ${comoSeLee(valor)}` : "Sin clientes en este periodo"}
            aria-pressed={activa}
            onClick={() => onMarcar(activa ? null : code)}
          >
            <span className="zonas-sigla">{corto}</span>
            {valor > 0 ? <span className="zonas-cifra">{medida === "customers" ? numberFormatter.format(valor) : euros(valor)}</span> : null}
          </button>
        );
      })}
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
        subtitle={`${numberFormatter.format(totalClientes)} clientes con compras en ${ctx.periodName}, repartidos por la provincia de su código postal`}
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
          : <MapaDeProvincias filas={filas} medida={medida} marcada={marcada} onMarcar={setMarcada} />}
        {/*
          Lo que no cuadra se dice, no se esconde: son fichas que se pueden
          arreglar en Sage, y mientras no se arreglen el mapa las coloca donde
          dice su código postal.
        */}
        {descuadradas > 0 || sinProvincia ? (
          <p className="muted zonas-aviso">
            {sinProvincia ? `${numberFormatter.format(Number(sinProvincia.customers))} clientes sin código postal ni provincia, así que no salen en el mapa. ` : ""}
            {descuadradas > 0 ? `En ${numberFormatter.format(descuadradas)} fichas la provincia escrita no coincide con el código postal; manda el código postal.` : ""}
          </p>
        ) : null}
      </Panel>

      <Panel title="Provincias" subtitle="Pulsa una para ver sus municipios">
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
            return (
              <div className="sales-row-detail-inner">
                <p className="sales-row-detail-title">{fila.province}, municipio a municipio</p>
                <ol className="zonas-municipios">
                  {municipios.map((municipio) => (
                    <li key={municipio.name}>
                      <span>{municipio.name}</span>
                      <strong>{numberFormatter.format(Number(municipio.customers))}</strong>
                      <span className="muted">{euros(Number(municipio.net))}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          }}
          empty={zonas.loading ? "Cargando…" : "Ningún cliente con compras en este periodo."}
        />
      </Panel>
    </>
  );
}
