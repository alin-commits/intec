"use client";

import { useMemo, useState } from "react";
import { formatDate, numberFormatter } from "@/lib/format";
import { euros } from "@/lib/sales-model";
import { NOMBRES_DE_PROVINCIA, PROVINCIAS_CON_MUNICIPIOS, encuadreDe, intensidadDeColor } from "@/lib/zonas-mapa";
import { MUNICIPIOS_CV_SVG } from "@/lib/zonas-svg-cv";
import { MAPA_ALTO, MAPA_ANCHO, PROVINCIAS_SVG } from "@/lib/zonas-svg";
import { Modal } from "@/components/ui/modal";
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
  municipalities: { ine: string | null; name: string; customers: number; net: number }[] | null;
};

/** Qué mide el mapa: cuántos clientes hay o cuánto compran. */
type Medida = "customers" | "net_amount";

type ClienteDelMunicipio = {
  company_code: number;
  customer_code: string;
  name: string;
  trade_name: string | null;
  rep_code: number | null;
  rep_name: string | null;
  phone: string | null;
  net_amount: number;
  documents: number;
  last_purchase: string | null;
};

type MuniRow = {
  ine: string;
  name: string;
  customers: number;
  net_amount: number;
  documents: number;
};

/*
  Al desplegar una provincia salen TODOS sus municipios.

  Antes salían los doce primeros y una línea con «y N más». Para lo que se
  usa esto —ver dónde flojea la cartera de un comercial— el municipio que
  falta es justo el interesante: el que tiene un cliente o ninguno. Alicante
  tiene 124, así que van en varias columnas y el panel se desplaza.
*/

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

/*
  El mapa de una provincia, municipio a municipio.

  Aquí el blanco es la información: un municipio sin clientes rodeado de
  vecinos azules es exactamente el hueco que se viene a buscar. Por eso se
  dibujan los 141 de Alicante y no solo aquellos donde hay cartera.
*/
function MapaDeMunicipios({ provincia, filas, medida, marcado, onMarcar }: {
  provincia: string;
  filas: MuniRow[];
  medida: Medida;
  marcado: string | null;
  onMarcar: (ine: string | null) => void;
}) {
  const dibujo = useMemo(() => MUNICIPIOS_CV_SVG.filter((m) => m.ine.startsWith(provincia)), [provincia]);
  const encuadre = useMemo(() => encuadreDe(dibujo), [dibujo]);
  const porIne = new Map(filas.map((fila) => [fila.ine, fila]));
  const maximo = Math.max(0, ...filas.map((fila) => Number(fila[medida])));
  const comoSeLee = (valor: number) => (medida === "customers"
    ? `${numberFormatter.format(valor)} ${valor === 1 ? "cliente" : "clientes"}`
    : euros(valor));
  if (!encuadre) return null;

  return (
    <svg viewBox={`${encuadre.x} ${encuadre.y} ${encuadre.w} ${encuadre.h}`} className="zonas-svg zonas-svg-municipios"
         role="img" aria-label={`Municipios de ${NOMBRES_DE_PROVINCIA[provincia] ?? provincia}`}>
      {dibujo.map(({ ine, name, d }) => {
        const dato = porIne.get(ine);
        const valor = dato ? Number(dato[medida]) : 0;
        const activo = marcado === ine;
        return (
          <path
            key={ine}
            d={d}
            className={activo ? "zonas-municipio activo" : "zonas-municipio"}
            style={{ "--peso": intensidadDeColor(valor, maximo) } as React.CSSProperties}
            onClick={() => onMarcar(activo ? null : ine)}
          >
            <title>{valor > 0 ? `${name}: ${comoSeLee(valor)}` : `${name}: ningún cliente`}</title>
          </path>
        );
      })}
    </svg>
  );
}

export function ZonesPage({ ctx }: { ctx: SalesContext }) {
  const { period } = ctx;
  const reload = ctx.reloadKey;
  const [medida, setMedida] = useState<Medida>("customers");
  const [marcada, setMarcada] = useState<string | null>(null);
  const [municipioMarcado, setMunicipioMarcado] = useState<string | null>(null);

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

  /*
    Los municipios solo se piden cuando se está mirando una provincia que
    tiene mapa dibujado: no tiene sentido traerse los de Madrid para no poder
    pintarlos.
  */
  const conMapaMunicipal = marcada !== null && PROVINCIAS_CON_MUNICIPIOS.includes(marcada);
  const municipios = useSageQuery<MuniRow[]>(
    conMapaMunicipal ? JSON.stringify(["municipios", marcada, args, reload]) : null,
    async () => await createClient().rpc("sage_customer_municipalities", { p_province: marcada, ...args }),
  );

  /*
    Y los clientes del municipio que se pulse. Se piden solo entonces: son la
    lista de un pueblo, no hace falta tenerlos todos cargados por si acaso.
  */
  const clientes = useSageQuery<ClienteDelMunicipio[]>(
    municipioMarcado ? JSON.stringify(["clientes-municipio", municipioMarcado, args, reload]) : null,
    async () => await createClient().rpc("sage_municipality_customers", { p_ine: municipioMarcado, ...args }),
  );

  const filas = zonas.data ?? [];
  const totalClientes = filas.reduce((suma, fila) => suma + Number(fila.customers), 0);
  const totalVenta = filas.reduce((suma, fila) => suma + Number(fila.net_amount), 0);
  const descuadradas = filas.reduce((suma, fila) => suma + Number(fila.mismatched), 0);
  const sinProvincia = filas.find((fila) => fila.province === "Sin provincia");
  const conProvincia = filas.filter((fila) => fila.province !== "Sin provincia");
  const laMarcada = marcada ? filas.find((fila) => fila.province_code === marcada) ?? null : null;
  const municipioElegido = municipioMarcado
    ? (municipios.data ?? []).find((fila) => fila.ine === municipioMarcado)
      ?? { ine: municipioMarcado, name: MUNICIPIOS_CV_SVG.find((m) => m.ine === municipioMarcado)?.name ?? municipioMarcado, customers: 0, net_amount: 0, documents: 0 }
    : null;

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

  const columnasDeClientes: Column<ClienteDelMunicipio>[] = [
    {
      key: "cliente", header: "Cliente", text: true,
      render: (fila) => (
        <>
          <strong>{fila.trade_name || fila.name}</strong>
          <small>{[fila.trade_name ? fila.name : null, fila.rep_name].filter(Boolean).join(" · ") || "—"}</small>
        </>
      ),
      sort: (fila) => (fila.trade_name || fila.name).toLocaleLowerCase("es"),
      total: () => <strong>Total</strong>,
    },
    {
      key: "venta", header: "Venta",
      render: (fila) => euros(Number(fila.net_amount)),
      sort: (fila) => Number(fila.net_amount),
      total: (rows) => euros(rows.reduce((suma, fila) => suma + Number(fila.net_amount), 0)),
    },
    {
      key: "albaranes", header: "Albaranes", optional: true,
      render: (fila) => numberFormatter.format(Number(fila.documents)),
      sort: (fila) => Number(fila.documents),
      total: (rows) => numberFormatter.format(rows.reduce((suma, fila) => suma + Number(fila.documents), 0)),
    },
    {
      key: "ultima", header: "Última compra", optional: true,
      render: (fila) => (fila.last_purchase ? formatDate(fila.last_purchase) : <span className="muted">—</span>),
      sort: (fila) => fila.last_purchase ?? "",
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
          : <MapaDeEspana filas={filas} medida={medida} marcada={marcada} onMarcar={(code) => { setMunicipioMarcado(null); setMarcada(code); }} />}

        {conMapaMunicipal && marcada ? (
          <div className="zonas-municipal">
            <p className="zonas-municipal-titulo">
              <strong>{NOMBRES_DE_PROVINCIA[marcada] ?? marcada}, municipio a municipio</strong>
              <span className="muted">En blanco, los municipios donde no hay ni un cliente</span>
            </p>
            {municipios.loading && !municipios.data
              ? <PendingDetail what="los municipios" />
              : municipios.failed
                ? <p className="muted">No se pudieron cargar los municipios. ¿Está aplicada la migración 202610280003?</p>
                : <MapaDeMunicipios provincia={marcada} filas={municipios.data ?? []} medida={medida}
                                    marcado={municipioMarcado} onMarcar={setMunicipioMarcado} />}
          </div>
        ) : null}

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
          onRowClick={(fila) => { setMunicipioMarcado(null); setMarcada(marcada === fila.province_code ? null : fila.province_code); }}
          initialSort={{ key: medida === "customers" ? "clientes" : "venta", desc: true }}
          expand={(fila) => {
            const municipios = fila.municipalities ?? [];
            if (municipios.length === 0) return null;
            return (
              <div className="zonas-detalle">
                <p className="zonas-detalle-titulo">
                  {fila.province}, los {numberFormatter.format(municipios.length)} municipios con clientes
                </p>
                <ul className="zonas-municipios">
                  {municipios.map((municipio) => {
                    /*
                      Se puede pulsar si sabemos su código del INE, que es lo
                      que hace falta para pedir sus clientes. Fuera de donde
                      hay mapeo de códigos postales no lo hay, y entonces la
                      fila es solo texto: más vale que no se pueda pulsar a
                      que se pulse y no pase nada.
                    */
                    const contenido = (
                      <>
                        <span className="zonas-municipio-nombre">{municipio.name}</span>
                        <span className="zonas-municipio-clientes">{numberFormatter.format(Number(municipio.customers))}</span>
                        <span className="zonas-municipio-venta">{euros(Number(municipio.net))}</span>
                      </>
                    );
                    const clave = municipio.ine ?? municipio.name;
                    if (!municipio.ine) return <li key={clave}>{contenido}</li>;
                    const elegido = municipioMarcado === municipio.ine;
                    return (
                      <li key={clave} className={elegido ? "elegido" : undefined}>
                        <button
                          type="button"
                          className="zonas-municipio-boton"
                          aria-pressed={elegido}
                          onClick={() => {
                            setMarcada(fila.province_code);
                            setMunicipioMarcado(elegido ? null : municipio.ine);
                          }}
                        >
                          {contenido}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          }}
          empty={zonas.loading ? "Cargando…" : "Ningún cliente con compras en este periodo."}
        />
      </Panel>

      {/*
        Los clientes de un municipio, en una ventana.

        Da igual si se ha pulsado el municipio en el mapa o en la lista de la
        tabla: la respuesta sale siempre en el mismo sitio, encima de todo, y
        no hay que ir a buscarla a otra parte de la página. Y pulsar un
        cliente abre su ficha de siempre.
      */}
      <Modal
        open={Boolean(municipioMarcado)}
        title={municipioElegido?.name ?? "Municipio"}
        eyebrow={marcada ? NOMBRES_DE_PROVINCIA[marcada] ?? "Zona" : "Zona"}
        scrollInside
        large
        onClose={() => setMunicipioMarcado(null)}
      >
        {municipioElegido ? (
          <p className="zonas-elegida">
            <span>{numberFormatter.format(Number(municipioElegido.customers))} clientes</span>
            <span>{euros(Number(municipioElegido.net_amount))}</span>
            <span className="muted">en {ctx.periodName}</span>
          </p>
        ) : null}
        {clientes.failed
          ? <p className="muted">No se pudieron cargar los clientes. ¿Está aplicada la migración 202610280004?</p>
          : clientes.loading && !clientes.data
            ? <PendingDetail what="los clientes" />
            : (
              <DataTable
                rows={clientes.data ?? []}
                columns={columnasDeClientes}
                rowKey={(fila) => `${fila.company_code}:${fila.customer_code}`}
                onRowClick={(fila) => {
                  /*
                    Se cierra esta antes de abrir la ficha: dos ventanas una
                    encima de otra no se entienden, y de la ficha se vuelve al
                    mapa, que sigue como estaba.
                  */
                  setMunicipioMarcado(null);
                  ctx.openCustomer({
                    company_code: fila.company_code,
                    customer_code: fila.customer_code,
                    name: fila.trade_name || fila.name,
                  });
                }}
                initialSort={{ key: "venta", desc: true }}
                empty="Ningún cliente con compras aquí en este periodo."
              />
            )}
      </Modal>
    </>
  );
}
