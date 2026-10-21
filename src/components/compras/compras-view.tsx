"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { CalendarIcon, ClockIcon, EuroIcon, XCircleIcon } from "@/components/icons";
import { PageLoadFailed, PageLoader } from "@/components/ui/page-loader";
import { TablePagination } from "@/components/ui/table-pagination";
import { currencyFormatter, numberFormatter } from "@/lib/format";
import { downloadCsv, type CsvColumn } from "@/lib/csv-export";
import { downloadXlsx } from "@/lib/excel-export";
import { todayKey } from "@/lib/dates";
import { COMPRAS_ROLES, hasAnyRole } from "@/lib/constants";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types";

/*
  Compras: qué falta por recibir y a quién hay que reclamarle la fecha.

  El pedido se manda, el proveedor confirma por correo una fecha estimada y
  alguien la teclea en Sage. Cuando no contesta, hoy no hay quien lleve la
  cuenta de a quién reclamar ni cuántas veces, y el pedido se olvida hasta que
  alguien lo echa de menos.

  Aquí se ve lo mismo que en Sage pero puesto del derecho: por proveedor, con lo
  que lleva esperando cada pedido y qué líneas siguen sin fecha. El proveedor
  confirma por línea, así que una línea con fecha ya no se reclama aunque el
  resto del pedido siga a medias.

  Los datos los manda el agente de Sage; aquí no se escribe nada en el ERP.
*/

const POR_PAGINA = 15;

type Pedido = {
  company_code: number;
  year: number;
  series: string;
  number: number;
  order_date: string;
  supplier_code: string | null;
  expected_on: string | null;
  net_amount: number;
  pending_amount: number;
  lines: number;
  pending_units: number;
};

type Linea = {
  company_code: number;
  year: number;
  series: string;
  number: number;
  line_number: number;
  article_code: string | null;
  description: string;
  pending_units: number;
  expected_on: string | null;
  net_amount: number;
};

type Proveedor = { company_code: number; code: string; name: string; email: string | null };

const clave = (fila: { company_code: number; year: number; series: string; number: number }) =>
  `${fila.company_code}-${fila.year}-${fila.series}-${fila.number}`;

/** Los días que lleva esperando desde que se pidió. */
function diasDesde(dia: string, hoy: string): number {
  const desde = new Date(`${dia}T00:00:00Z`).getTime();
  const hasta = new Date(`${hoy}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((hasta - desde) / 86_400_000));
}

export function ComprasView() {
  const configured = isSupabaseConfigured();
  const [acceso, setAcceso] = useState<"comprobando" | "permitido" | "denegado">("comprobando");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [falloCarga, setFalloCarga] = useState<string | null>(null);
  const [hoy, setHoy] = useState("");
  const [filtro, setFiltro] = useState<"sin_fecha" | "con_fecha" | "vencidos" | "todos">("sin_fecha");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      // Todo dentro del cargador: React 19 no deja cambiar estado nada más
      // entrar en un efecto, y la hora tampoco se puede mirar al pintar.
      if (vivo) setHoy(todayKey());
      if (!configured) { if (vivo) setAcceso("denegado"); return; }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (vivo) setAcceso("denegado"); return; }
      const { data: perfil } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      const roles = (perfil?.roles ?? []) as AppRole[];
      if (!vivo) return;
      if (!hasAnyRole(roles, COMPRAS_ROLES)) { setAcceso("denegado"); return; }
      setAcceso("permitido");

      const [pedidosRes, lineasRes, proveedoresRes] = await Promise.all([
        supabase.from("sage_purchase_orders").select("company_code, year, series, number, order_date, supplier_code, expected_on, net_amount, pending_amount, lines, pending_units").gt("pending_units", 0).order("order_date"),
        supabase.from("sage_purchase_order_lines").select("company_code, year, series, number, line_number, article_code, description, pending_units, expected_on, net_amount").gt("pending_units", 0),
        supabase.from("sage_suppliers").select("company_code, code, name, email"),
      ]);
      if (!vivo) return;
      // Ojo: si la tabla todavía no existe, PostgREST no da error — devuelve
      // una lista vacía. Así que "no hay datos" y "falta la migración" se ven
      // igual desde aquí, y por eso el aviso de abajo cubre los dos casos en vez
      // de afirmar cuál es.
      if (pedidosRes.error) { setFalloCarga(pedidosRes.error.message); return; }
      setPedidos((pedidosRes.data ?? []) as Pedido[]);
      setLineas((lineasRes.data ?? []) as Linea[]);
      setProveedores((proveedoresRes.data ?? []) as Proveedor[]);
    })();
    return () => { vivo = false; };
  }, [configured]);

  const nombreProveedor = useMemo(() => {
    const mapa = new Map<string, Proveedor>();
    for (const fila of proveedores) mapa.set(`${fila.company_code}-${fila.code}`, fila);
    return mapa;
  }, [proveedores]);

  const lineasPorPedido = useMemo(() => {
    const mapa = new Map<string, Linea[]>();
    for (const linea of lineas) {
      const llave = clave(linea);
      mapa.set(llave, [...(mapa.get(llave) ?? []), linea]);
    }
    // Ordenadas aquí y no al pintarlas: ordenar al pintar tocaría estos mismos
    // arrays en pleno render, y además se repetiría en cada repintado.
    for (const suyas of mapa.values()) suyas.sort((a, b) => a.line_number - b.line_number);
    return mapa;
  }, [lineas]);

  /**
   * Un pedido está confirmado cuando todas sus líneas pendientes tienen fecha.
   * Manda la línea: si el proveedor confirmó la mitad, la otra mitad se reclama.
   * Si no hay líneas (todavía no han llegado), vale la fecha de la cabecera.
   */
  const estadoDe = useMemo(() => {
    const mapa = new Map<string, { sinFecha: number; fecha: string | null }>();
    for (const pedido of pedidos) {
      const llave = clave(pedido);
      const suyas = lineasPorPedido.get(llave) ?? [];
      if (suyas.length === 0) {
        mapa.set(llave, { sinFecha: pedido.expected_on ? 0 : 1, fecha: pedido.expected_on });
        continue;
      }
      const sinFecha = suyas.filter((linea) => !linea.expected_on && !pedido.expected_on).length;
      const fechas = suyas.map((linea) => linea.expected_on ?? pedido.expected_on).filter(Boolean) as string[];
      mapa.set(llave, { sinFecha, fecha: fechas.length ? fechas.sort().at(-1) ?? null : null });
    }
    return mapa;
  }, [pedidos, lineasPorPedido]);

  const conEstado = useMemo(() => pedidos.map((pedido) => {
    const estado = estadoDe.get(clave(pedido)) ?? { sinFecha: 1, fecha: null };
    const proveedor = pedido.supplier_code ? nombreProveedor.get(`${pedido.company_code}-${pedido.supplier_code}`) : undefined;
    const vencido = Boolean(estado.fecha && hoy && estado.fecha < hoy);
    return { pedido, ...estado, vencido, proveedorNombre: proveedor?.name ?? pedido.supplier_code ?? "Sin proveedor", proveedorEmail: proveedor?.email ?? null };
  }), [pedidos, estadoDe, nombreProveedor, hoy]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return conEstado.filter((fila) => {
      const encaja = filtro === "todos"
        || (filtro === "sin_fecha" && fila.sinFecha > 0)
        || (filtro === "con_fecha" && fila.sinFecha === 0)
        || (filtro === "vencidos" && fila.vencido);
      if (!encaja) return false;
      if (!texto) return true;
      return `${fila.proveedorNombre} ${fila.pedido.series}${fila.pedido.number} ${fila.pedido.supplier_code ?? ""}`.toLowerCase().includes(texto);
    });
  }, [conEstado, filtro, busqueda]);

  const resumen = useMemo(() => ({
    sinFecha: conEstado.filter((fila) => fila.sinFecha > 0).length,
    conFecha: conEstado.filter((fila) => fila.sinFecha === 0).length,
    vencidos: conEstado.filter((fila) => fila.vencido).length,
    importe: conEstado.reduce((suma, fila) => suma + Number(fila.pedido.pending_amount), 0),
    proveedores: new Set(conEstado.filter((fila) => fila.sinFecha > 0).map((fila) => fila.proveedorNombre)).size,
  }), [conEstado]);

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas - 1);
  const enPantalla = visibles.slice(paginaActual * POR_PAGINA, paginaActual * POR_PAGINA + POR_PAGINA);

  const columnas: CsvColumn<(typeof conEstado)[number]>[] = [
    { header: "Sociedad", value: (fila) => fila.pedido.company_code },
    { header: "Pedido", value: (fila) => `${fila.pedido.series}${fila.pedido.number}` },
    { header: "Fecha del pedido", value: (fila) => fila.pedido.order_date },
    { header: "Días esperando", value: (fila) => (hoy ? diasDesde(fila.pedido.order_date, hoy) : "") },
    { header: "Proveedor", value: (fila) => fila.proveedorNombre },
    { header: "Correo", value: (fila) => fila.proveedorEmail },
    { header: "Líneas sin fecha", value: (fila) => fila.sinFecha },
    { header: "Fecha prevista", value: (fila) => fila.fecha },
    { header: "Vencido", value: (fila) => (fila.vencido ? "Sí" : "No") },
    { header: "Pendiente (€)", value: (fila) => Number(fila.pedido.pending_amount) },
  ];

  if (acceso === "comprobando") return <PageLoader label="Cargando compras…" />;
  if (acceso === "denegado") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes permiso para ver esta página</h2>
          <p>El control de pedidos a proveedor es de compras y dirección.</p>
        </section>
      </div>
    );
  }
  if (falloCarga) return <PageLoadFailed message={falloCarga} onRetry={() => window.location.reload()} />;

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Compras</span>
          <h2>Pedidos pendientes de recibir</h2>
          <p>
            Lo que falta por llegar y de qué falta la fecha. El proveedor confirma por línea, así que una línea con
            fecha ya no se reclama aunque el resto del pedido siga a medias. Los datos los trae el agente de Sage.
          </p>
        </div>
        {visibles.length > 0 ? (
          <div className="panel-heading-trailing">
            <button type="button" className="button button-compact button-secondary"
              onClick={() => void downloadXlsx("pedidos_a_proveedor.xlsx", [{ name: "Pendientes", columns: columnas, rows: visibles }] as never[])}>Exportar Excel</button>
            <button type="button" className="button button-compact button-secondary"
              onClick={() => downloadCsv("pedidos_a_proveedor.csv", visibles, columnas)}>CSV</button>
          </div>
        ) : null}
      </section>

      {pedidos.length === 0 ? (
        <section className="panel panel-padded">
          <h3>Todavía no ha llegado ningún pedido a proveedor</h3>
          <p className="muted">Para que esto se llene hacen falta dos cosas, y se pueden hacer en cualquier orden:</p>
          <ol className="muted">
            <li>Aplicar la migración <code>202610210002_compras_pedidos_a_proveedor.sql</code>.</li>
            <li>Copiar al servidor de Sage la versión nueva del agente (<code>2026-10-21 compras</code>), que es la que lee los pedidos a proveedor.</li>
          </ol>
          <p className="muted">En la primera lectura del agente aparecerá aquí todo lo pendiente de recibir.</p>
        </section>
      ) : (
        <>
          <section className="kpi-grid kpi-grid-main">
            <KpiCard label="Sin fecha" value={numberFormatter.format(resumen.sinFecha)} delta="Sin comparación"
              helper={`${numberFormatter.format(resumen.proveedores)} proveedores a los que reclamar`} icon={<ClockIcon />} tone="rose" />
            <KpiCard label="Confirmados" value={numberFormatter.format(resumen.conFecha)} delta="Sin comparación"
              helper="con fecha en todas sus líneas" icon={<CalendarIcon />} tone="emerald" />
            <KpiCard label="Vencidos" value={numberFormatter.format(resumen.vencidos)} delta="Sin comparación"
              helper="pasó su fecha y no han llegado" icon={<XCircleIcon />} tone="amber" />
            <KpiCard label="Pendiente" value={currencyFormatter.format(resumen.importe)} delta="Sin comparación"
              helper="de lo que falta por recibir" icon={<EuroIcon />} tone="indigo" />
          </section>

          <section className="panel table-panel">
            <div className="panel-heading">
              <div className="view-tabs" role="tablist" aria-label="Qué pedidos ver">
                {([["sin_fecha", "Sin fecha"], ["vencidos", "Vencidos"], ["con_fecha", "Confirmados"], ["todos", "Todos"]] as const).map(([clave_, etiqueta]) => (
                  <button key={clave_} type="button" role="tab" aria-selected={filtro === clave_}
                    className={filtro === clave_ ? "view-tab active" : "view-tab"}
                    onClick={() => { setFiltro(clave_); setPagina(0); }}>{etiqueta}</button>
                ))}
              </div>
              <span className="muted">{numberFormatter.format(visibles.length)} pedidos</span>
            </div>

            <label className="list-search">
              <span className="sr-only">Buscar</span>
              <input type="search" value={busqueda} placeholder="Buscar por proveedor o número de pedido"
                onChange={(evento) => { setPagina(0); setBusqueda(evento.target.value); }} />
            </label>

            <div className="table-scroll"><table><thead><tr>
              <th>Pedido</th><th>Proveedor</th><th>Pedido el</th><th>Esperando</th><th>Fecha prevista</th><th>Pendiente</th><th></th>
            </tr></thead><tbody>
              {enPantalla.map((fila) => {
                const llave = clave(fila.pedido);
                const suyas = lineasPorPedido.get(llave) ?? [];
                return [
                  <tr key={llave} className={fila.vencido ? "fila-vencida" : undefined}>
                    <td><strong>{fila.pedido.series}{fila.pedido.number}</strong><small className="muted"> · {fila.pedido.lines} líneas</small></td>
                    <td>
                      <span className="sales-article">
                        <strong>{fila.proveedorNombre}</strong>
                        <small>{fila.proveedorEmail ?? "sin correo en Sage"}</small>
                      </span>
                    </td>
                    <td>{fila.pedido.order_date}</td>
                    <td>{hoy ? `${numberFormatter.format(diasDesde(fila.pedido.order_date, hoy))} días` : "—"}</td>
                    <td>
                      {fila.sinFecha > 0
                        ? <span className="badge badge-lost">{fila.sinFecha === fila.pedido.lines ? "sin fecha" : `${fila.sinFecha} líneas sin fecha`}</span>
                        : <span className={fila.vencido ? "badge badge-lost" : "badge badge-active"}>{fila.fecha}{fila.vencido ? " · vencido" : ""}</span>}
                    </td>
                    <td>{currencyFormatter.format(Number(fila.pedido.pending_amount))}</td>
                    <td className="recent-inquiries-actions">
                      {suyas.length > 0 ? (
                        <button type="button" className="button button-compact button-secondary"
                          onClick={() => setAbierto(abierto === llave ? null : llave)}>{abierto === llave ? "Ocultar" : "Ver líneas"}</button>
                      ) : null}
                    </td>
                  </tr>,
                  abierto === llave ? (
                    <tr key={`${llave}-lineas`} className="fila-detalle">
                      <td colSpan={7}>
                        <ul className="lineas-pedido">
                          {suyas.map((linea) => (
                            <li key={linea.line_number}>
                              <span><strong>{linea.description || linea.article_code || `Línea ${linea.line_number}`}</strong>
                                <small className="muted"> · {numberFormatter.format(Number(linea.pending_units))} pendientes</small></span>
                              {linea.expected_on
                                ? <span className="badge badge-active">{linea.expected_on}</span>
                                : <span className="badge badge-lost">sin fecha</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
              {enPantalla.length === 0 ? <tr><td colSpan={7} className="muted">Ningún pedido con estos filtros.</td></tr> : null}
            </tbody></table></div>
            <TablePagination page={paginaActual} pageCount={paginas} total={visibles.length} label="pedidos" onChange={setPagina} />
          </section>
        </>
      )}
    </div>
  );
}
