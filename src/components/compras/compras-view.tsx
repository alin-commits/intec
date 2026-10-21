"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { CalendarIcon, ClockIcon, EuroIcon, XCircleIcon } from "@/components/icons";
import { PageLoadFailed, PageLoader } from "@/components/ui/page-loader";
import { TablePagination } from "@/components/ui/table-pagination";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { DateField, MonthField } from "@/components/ui/date-field";
import { currencyFormatter, numberFormatter } from "@/lib/format";
import { downloadCsv, type CsvColumn } from "@/lib/csv-export";
import { downloadXlsx } from "@/lib/excel-export";
import { monthKey, todayKey } from "@/lib/dates";
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

/*
  Por qué columna se ordena. "Esperando" y "Pedido el" son el mismo dato del
  derecho y del revés —los días son hoy menos la fecha—, así que ordenar por
  una es ordenar por la otra al contrario; se dejan las dos porque cada uno
  mira una cosa.
*/
type ClaveOrden = "pedido" | "proveedor" | "fecha_pedido" | "esperando" | "prevista" | "pendiente";
type Orden = { clave: ClaveOrden; sentido: "asc" | "desc" };
/* Las que se miran de mayor a menor: el que más lleva esperando y el que más dinero tiene detrás. */
const PRIMERO_DESCENDENTE: ClaveOrden[] = ["esperando", "pendiente"];
const COLUMNAS_ORDENABLES: { clave: ClaveOrden; etiqueta: string }[] = [
  { clave: "pedido", etiqueta: "Pedido" },
  { clave: "proveedor", etiqueta: "Proveedor" },
  { clave: "fecha_pedido", etiqueta: "Pedido el" },
  { clave: "esperando", etiqueta: "Esperando" },
  { clave: "prevista", etiqueta: "Fecha prevista" },
  { clave: "pendiente", etiqueta: "Pendiente" },
];

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

/** Lo nuestro sobre un pedido: a quién se ha reclamado y qué ha contestado. */
type Seguimiento = {
  company_code: number; year: number; series: string; number: number;
  state: string; level: number; last_chased_at: string | null;
  replied_at: string | null; confirmed_on: string | null; notes: string | null;
};

/** El correo preparado, tal como va a salir, antes de darle a enviar. */
type Reclamacion = {
  companyCode: number;
  supplierCode: string;
  proveedor: string;
  numeros: number[];
  destinatario: string | null;
  asunto: string;
  html: string;
  enviando: boolean;
  /** Por dónde sale: el buzón de compras (graph) o nuestro servidor (resend). */
  via?: "graph" | "resend";
  /** Si responde sobre el correo con el que se mandó el pedido. */
  enHilo?: boolean;
  asuntoDelHilo?: string | null;
  /** Si los envíos están desviados a un buzón de pruebas. */
  redirigido?: string | null;
  /** De dónde sale; lo dice el servidor, que es quien lo sabe. */
  remitente?: string;
};

/** Qué periodo se está mirando. "todo" existe porque el atasco es de hace meses. */
type Vista = "mes" | "anio" | "todo";

const clave = (fila: { company_code: number; year: number; series: string; number: number }) =>
  `${fila.company_code}-${fila.year}-${fila.series}-${fila.number}`;

/** Los días que lleva esperando desde que se pidió. */
function diasDesde(dia: string, hoy: string): number {
  const desde = new Date(`${dia}T00:00:00Z`).getTime();
  const hasta = new Date(`${hoy}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((hasta - desde) / 86_400_000));
}

const COLUMNAS_SEGUIMIENTO = "company_code, year, series, number, state, level, last_chased_at, replied_at, confirmed_on, notes";
/** Lo mismo sin lo que trae la migración de reclamaciones. */
const COLUMNAS_SEGUIMIENTO_VIEJAS = "company_code, year, series, number, state, level, last_chased_at, confirmed_on, notes";

/**
 * El seguimiento, aguantando que la migración de reclamaciones no esté puesta.
 *
 * Si falta una columna, PostgREST responde 42703 y se vuelve a pedir sin ella:
 * así la pantalla sigue entera —pedidos, fechas, exportaciones— y solo falta lo
 * de reclamar, que es justo lo que trae esa migración.
 */
async function leerSeguimiento(supabase: ReturnType<typeof createClient>): Promise<{ filas: Seguimiento[]; faltaMigracion: boolean }> {
  const primera = await supabase.from("purchase_order_tracking").select(COLUMNAS_SEGUIMIENTO);
  if (!primera.error) return { filas: (primera.data ?? []) as Seguimiento[], faltaMigracion: false };
  if (primera.error.code !== "42703") return { filas: [], faltaMigracion: false };
  const segunda = await supabase.from("purchase_order_tracking").select(COLUMNAS_SEGUIMIENTO_VIEJAS);
  return { filas: (segunda.data ?? []).map((fila) => ({ ...fila, replied_at: null })) as Seguimiento[], faltaMigracion: true };
}

export function ComprasView() {
  const configured = isSupabaseConfigured();
  const [acceso, setAcceso] = useState<"comprobando" | "permitido" | "denegado">("comprobando");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [falloCarga, setFalloCarga] = useState<string | null>(null);
  const [hoy, setHoy] = useState("");
  const [filtro, setFiltro] = useState<"sin_fecha" | "con_fecha" | "vencidos" | "contestados" | "todos">("sin_fecha");
  // De entrada, el que más lleva esperando arriba: es el que hay que reclamar antes.
  const [orden, setOrden] = useState<Orden>({ clave: "esperando", sentido: "desc" });
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [seguimientos, setSeguimientos] = useState<Seguimiento[]>([]);
  /** Si la migración de reclamaciones todavía no está, se avisa en vez de callar. */
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  // El periodo. Arranca en el mes en curso, pero la fecha no se puede mirar al
  // pintar, así que el valor lo pone el cargador igual que `hoy`.
  const [vista, setVista] = useState<Vista>("mes");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState(0);
  // Los dos diálogos: el de reclamar (con el correo delante) y el de apuntar
  // que han contestado.
  const [reclamando, setReclamando] = useState<Reclamacion | null>(null);
  const [contestando, setContestando] = useState<{ llave: string; pedido: Pedido; proveedor: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      // Todo dentro del cargador: React 19 no deja cambiar estado nada más
      // entrar en un efecto, y la hora tampoco se puede mirar al pintar.
      if (vivo) {
        const ahora = todayKey();
        setHoy(ahora);
        setMes(monthKey(new Date(`${ahora}T00:00:00Z`)));
        setAnio(Number(ahora.slice(0, 4)));
      }
      if (!configured) { if (vivo) setAcceso("denegado"); return; }
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (vivo) setAcceso("denegado"); return; }
      const { data: perfil } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      const roles = (perfil?.roles ?? []) as AppRole[];
      if (!vivo) return;
      if (!hasAnyRole(roles, COMPRAS_ROLES)) { setAcceso("denegado"); return; }
      setAcceso("permitido");

      const [pedidosRes, lineasRes, proveedoresRes, seguimientoRes] = await Promise.all([
        supabase.from("sage_purchase_orders").select("company_code, year, series, number, order_date, supplier_code, expected_on, net_amount, pending_amount, lines, pending_units").gt("pending_units", 0).order("order_date"),
        supabase.from("sage_purchase_order_lines").select("company_code, year, series, number, line_number, article_code, description, pending_units, expected_on, net_amount").gt("pending_units", 0),
        supabase.from("sage_suppliers").select("company_code, code, name, email"),
        leerSeguimiento(supabase),
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
      setSeguimientos(seguimientoRes.filas);
      setFaltaMigracion(seguimientoRes.faltaMigracion);
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

  const seguimientoDe = useMemo(() => {
    const mapa = new Map<string, Seguimiento>();
    for (const fila of seguimientos) mapa.set(clave(fila), fila);
    return mapa;
  }, [seguimientos]);

  const conEstado = useMemo(() => pedidos.map((pedido) => {
    const estado = estadoDe.get(clave(pedido)) ?? { sinFecha: 1, fecha: null };
    const proveedor = pedido.supplier_code ? nombreProveedor.get(`${pedido.company_code}-${pedido.supplier_code}`) : undefined;
    const vencido = Boolean(estado.fecha && hoy && estado.fecha < hoy);
    const suyo = seguimientoDe.get(clave(pedido));
    return {
      pedido, ...estado, vencido,
      proveedorNombre: proveedor?.name ?? pedido.supplier_code ?? "Sin proveedor",
      proveedorEmail: proveedor?.email ?? null,
      seguimiento: suyo ?? null,
      contestado: suyo?.state === "contestado",
    };
  }), [pedidos, estadoDe, nombreProveedor, hoy, seguimientoDe]);

  /*
    El periodo se mira por la fecha del pedido. De entrada, el mes en curso:
    es lo que se está trabajando. Lo de atrás no desaparece —está en "Todo" y
    en los meses anteriores—, pero no entra en los números del día a día.
  */
  const delPeriodo = useMemo(() => {
    if (vista === "todo" || !hoy) return conEstado;
    const prefijo = vista === "mes" ? mes : String(anio);
    if (!prefijo) return conEstado;
    return conEstado.filter((fila) => fila.pedido.order_date.startsWith(prefijo));
  }, [conEstado, vista, mes, anio, hoy]);

  /** Los años que hay pedidos, para no ofrecer años vacíos. */
  const anios = useMemo(() => {
    const vistos = new Set(pedidos.map((p) => Number(p.order_date.slice(0, 4))));
    return [...vistos].sort((a, b) => b - a);
  }, [pedidos]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return delPeriodo.filter((fila) => {
      const encaja = filtro === "todos"
        || (filtro === "sin_fecha" && fila.sinFecha > 0)
        || (filtro === "con_fecha" && fila.sinFecha === 0)
        || (filtro === "vencidos" && fila.vencido)
        || (filtro === "contestados" && fila.contestado);
      if (!encaja) return false;
      if (!texto) return true;
      return `${fila.proveedorNombre} ${fila.pedido.series}${fila.pedido.number} ${fila.pedido.supplier_code ?? ""}`.toLowerCase().includes(texto);
    });
  }, [delPeriodo, filtro, busqueda]);

  const ordenadas = useMemo(() => {
    // Lo que no tiene fecha prevista se va al final en los dos sentidos: no es
    // ni la más próxima ni la más lejana, simplemente no la hay.
    const valor = (fila: (typeof visibles)[number]): string | number | null => {
      switch (orden.clave) {
        case "pedido": return `${fila.pedido.company_code}-${fila.pedido.series}-${String(fila.pedido.number).padStart(10, "0")}`;
        case "proveedor": return fila.proveedorNombre.toLowerCase();
        case "fecha_pedido": case "esperando": return fila.pedido.order_date;
        case "prevista": return fila.fecha;
        case "pendiente": return Number(fila.pedido.pending_amount);
      }
    };
    // "Esperando" es al revés que la fecha del pedido: más días es más antiguo.
    const factor = (orden.sentido === "asc" ? 1 : -1) * (orden.clave === "esperando" ? -1 : 1);
    return [...visibles].sort((a, b) => {
      const izq = valor(a);
      const der = valor(b);
      if (izq === null || izq === "") return der === null || der === "" ? 0 : 1;
      if (der === null || der === "") return -1;
      return izq < der ? -factor : izq > der ? factor : 0;
    });
  }, [visibles, orden]);

  function cambiarOrden(clave: ClaveOrden) {
    setPagina(0);
    setOrden((actual) => actual.clave === clave
      ? { clave, sentido: actual.sentido === "asc" ? "desc" : "asc" }
      : { clave, sentido: PRIMERO_DESCENDENTE.includes(clave) ? "desc" : "asc" });
  }

  const resumen = useMemo(() => ({
    sinFecha: delPeriodo.filter((fila) => fila.sinFecha > 0).length,
    conFecha: delPeriodo.filter((fila) => fila.sinFecha === 0).length,
    vencidos: delPeriodo.filter((fila) => fila.vencido).length,
    contestados: delPeriodo.filter((fila) => fila.contestado).length,
    importe: delPeriodo.reduce((suma, fila) => suma + Number(fila.pedido.pending_amount), 0),
    proveedores: new Set(delPeriodo.filter((fila) => fila.sinFecha > 0).map((fila) => fila.proveedorNombre)).size,
  }), [delPeriodo]);

  /* Sin fecha en total, para que al filtrar por mes no parezca que el atasco se ha ido. */
  const sinFechaEnTotal = useMemo(() => conEstado.filter((fila) => fila.sinFecha > 0).length, [conEstado]);

  const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, paginas - 1);
  const enPantalla = ordenadas.slice(paginaActual * POR_PAGINA, paginaActual * POR_PAGINA + POR_PAGINA);

  /*
    Reclamar va en dos pasos a propósito: primero se pide el correo hecho y se
    enseña, y solo si alguien le da a enviar sale. Esto se manda a una empresa
    de fuera; no debería poder salir de un clic despistado.
  */
  async function prepararReclamacion(fila: (typeof conEstado)[number]) {
    const { pedido } = fila;
    if (!pedido.supplier_code) { setAviso("Este pedido no tiene proveedor en Sage."); return; }
    setReclamando({
      companyCode: pedido.company_code, supplierCode: pedido.supplier_code, proveedor: fila.proveedorNombre,
      numeros: [pedido.number], destinatario: null, asunto: "", html: "", enviando: true,
    });
    try {
      const respuesta = await fetch("/api/compras/reclamar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode: pedido.company_code, supplierCode: pedido.supplier_code, numeros: [pedido.number], previsualizar: true }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) { setReclamando(null); setAviso(datos.error ?? "No se pudo preparar el correo."); return; }
      setReclamando((actual) => actual && {
        ...actual, destinatario: datos.destinatario, asunto: datos.asunto, html: datos.html, enviando: false,
        via: datos.via, enHilo: datos.enHilo, asuntoDelHilo: datos.asuntoDelHilo, redirigido: datos.redirigido, remitente: datos.remitente,
      });
    } catch {
      setReclamando(null);
      setAviso("No se pudo preparar el correo.");
    }
  }

  async function enviarReclamacion() {
    if (!reclamando || reclamando.enviando) return;
    setReclamando({ ...reclamando, enviando: true });
    try {
      const respuesta = await fetch("/api/compras/reclamar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode: reclamando.companyCode, supplierCode: reclamando.supplierCode, numeros: reclamando.numeros }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) { setReclamando({ ...reclamando, enviando: false }); setAviso(datos.error ?? "No se pudo enviar el correo."); return; }
      setAviso(datos.redirigido
        ? `Prueba enviada a ${datos.destinatario}. El proveedor no ha recibido nada y el pedido sigue sin reclamar.`
        : `Reclamación enviada a ${datos.destinatario}${datos.enHilo ? ", sobre el hilo del pedido" : ""}.`);
      setReclamando(null);
      await recargarSeguimiento();
    } catch {
      setReclamando({ ...reclamando, enviando: false });
      setAviso("No se pudo enviar el correo.");
    }
  }

  async function recargarSeguimiento() {
    const supabase = createClient();
    const { data } = await supabase.from("purchase_order_tracking")
      .select("company_code, year, series, number, state, level, last_chased_at, replied_at, confirmed_on, notes");
    setSeguimientos((data ?? []) as Seguimiento[]);
  }

  /**
   * Apuntar que el proveedor ha contestado. El buzón no se lee solo: esto lo
   * marca quien ve la respuesta, y la fecha se queda aquí hasta que alguien la
   * teclee en Sage. En cuanto el agente la traiga, el pedido pasa a confirmado
   * y se cae de la lista solo.
   */
  async function guardarContestado(fecha: string, nota: string) {
    if (!contestando) return;
    const { pedido } = contestando;
    const supabase = createClient();
    const ahora = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("purchase_order_tracking").upsert({
      company_code: pedido.company_code, year: pedido.year, series: pedido.series, number: pedido.number,
      state: "contestado", replied_at: ahora, replied_by: user?.id ?? null,
      confirmed_on: fecha || null,
      confirmed_source: fecha ? "a_mano" : null,
      confirmed_at: fecha ? ahora : null,
      notes: nota.trim() || null,
      updated_at: ahora,
    }, { onConflict: "company_code,year,series,number" });
    if (error) { setAviso("No se pudo guardar."); return; }
    setContestando(null);
    setAviso(fecha ? `Apuntado: ${contestando.proveedor} da el ${fecha}.` : `Apuntado: ${contestando.proveedor} ha contestado.`);
    await recargarSeguimiento();
  }

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
    { header: "Reclamado", value: (fila) => (fila.seguimiento?.level ? `${fila.seguimiento.level} ${fila.seguimiento.level === 1 ? "vez" : "veces"}` : "No") },
    { header: "Última reclamación", value: (fila) => fila.seguimiento?.last_chased_at?.slice(0, 10) ?? "" },
    { header: "Ha contestado", value: (fila) => (fila.contestado ? "Sí" : "No") },
    { header: "Fecha que dio", value: (fila) => fila.seguimiento?.confirmed_on ?? "" },
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
        {ordenadas.length > 0 ? (
          <div className="panel-heading-trailing">
            <button type="button" className="button button-compact button-secondary"
              onClick={() => void downloadXlsx("pedidos_a_proveedor.xlsx", [{ name: "Pendientes", columns: columnas, rows: ordenadas }] as never[])}>Exportar Excel</button>
            <button type="button" className="button button-compact button-secondary"
              onClick={() => downloadCsv("pedidos_a_proveedor.csv", ordenadas, columnas)}>CSV</button>
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
          <div className="filter-bar">
            <label>
              <span>Periodo</span>
              <select value={vista} onChange={(evento) => { setPagina(0); setVista(evento.target.value as Vista); }}>
                <option value="mes">Por mes</option>
                <option value="anio">Por año</option>
                <option value="todo">Todo</option>
              </select>
            </label>
            {vista === "mes" ? (
              <label><span>Mes</span><MonthField value={mes} max={hoy.slice(0, 7)} onChange={(valor) => { setPagina(0); setMes(valor); }} /></label>
            ) : null}
            {vista === "anio" ? (
              <label>
                <span>Año</span>
                <select value={anio} onChange={(evento) => { setPagina(0); setAnio(Number(evento.target.value)); }}>
                  {anios.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              <span>Se mira por</span>
              <select value="pedido" disabled>
                <option value="pedido">Fecha del pedido</option>
              </select>
            </label>
          </div>

          {faltaMigracion ? (
            <section className="panel panel-padded">
              <h3>Falta aplicar una migración</h3>
              <p className="muted">
                Los pedidos se ven bien, pero para reclamar la fecha por correo falta
                aplicar <code>202610220001_compras_reclamaciones.sql</code>. Hasta entonces, los botones de reclamar
                no guardarían el seguimiento.
              </p>
            </section>
          ) : null}

          <section className="kpi-grid kpi-grid-main">
            <KpiCard label="Sin fecha" value={numberFormatter.format(resumen.sinFecha)} delta="Sin comparación"
              helper={vista === "todo"
                ? `${numberFormatter.format(resumen.proveedores)} proveedores a los que reclamar`
                : `${numberFormatter.format(resumen.proveedores)} proveedores · ${numberFormatter.format(sinFechaEnTotal)} sin fecha en total`}
              icon={<ClockIcon />} tone="rose" />
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
                {([["sin_fecha", "Sin fecha"], ["vencidos", "Vencidos"], ["contestados", "Contestados"], ["con_fecha", "Confirmados"], ["todos", "Todos"]] as const).map(([clave_, etiqueta]) => (
                  <button key={clave_} type="button" role="tab" aria-selected={filtro === clave_}
                    className={filtro === clave_ ? "view-tab active" : "view-tab"}
                    onClick={() => { setFiltro(clave_); setPagina(0); }}>
                    {etiqueta}
                    {clave_ === "contestados" && resumen.contestados > 0 ? ` (${numberFormatter.format(resumen.contestados)})` : ""}
                  </button>
                ))}
              </div>
              <span className="muted">{numberFormatter.format(ordenadas.length)} pedidos</span>
            </div>

            <label className="list-search">
              <span className="sr-only">Buscar</span>
              <input type="search" value={busqueda} placeholder="Buscar por proveedor o número de pedido"
                onChange={(evento) => { setPagina(0); setBusqueda(evento.target.value); }} />
            </label>

            <div className="table-scroll"><table><thead><tr>
              {COLUMNAS_ORDENABLES.map((columna) => {
                const activa = orden.clave === columna.clave;
                return (
                  <th key={columna.clave} aria-sort={activa ? (orden.sentido === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className={activa ? "sort-header active" : "sort-header"} onClick={() => cambiarOrden(columna.clave)} title="Ordenar">
                      {columna.etiqueta}
                      <span aria-hidden="true">{activa ? (orden.sentido === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
              <th>Reclamado</th>
              <th></th>
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
                        ? <span className="badge badge-lost">{fila.sinFecha === fila.pedido.lines ? "sin fecha" : `${fila.sinFecha} ${fila.sinFecha === 1 ? "línea" : "líneas"} sin fecha`}</span>
                        : <span className={fila.vencido ? "badge badge-lost" : "badge badge-active"}>{fila.fecha}{fila.vencido ? " · vencido" : ""}</span>}
                    </td>
                    <td>{currencyFormatter.format(Number(fila.pedido.pending_amount))}</td>
                    <td>
                      {fila.contestado ? (
                        <span className="sales-article">
                          <span className="badge badge-active">ha contestado</span>
                          <small>{fila.seguimiento?.confirmed_on ? `dice el ${fila.seguimiento.confirmed_on}` : "sin fecha todavía"}</small>
                        </span>
                      ) : fila.seguimiento?.level ? (
                        <span className="sales-article">
                          <strong>{fila.seguimiento.level === 1 ? "1 vez" : `${fila.seguimiento.level} veces`}</strong>
                          <small>{fila.seguimiento.last_chased_at ? `el ${fila.seguimiento.last_chased_at.slice(0, 10)}` : ""}</small>
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="recent-inquiries-actions">
                      {fila.sinFecha > 0 && fila.pedido.supplier_code ? (
                        <button type="button" className="button button-compact" disabled={!fila.proveedorEmail}
                          title={fila.proveedorEmail ? `Escribir a ${fila.proveedorEmail}` : "Este proveedor no tiene correo en Sage"}
                          onClick={() => void prepararReclamacion(fila)}>Reclamar</button>
                      ) : null}
                      {fila.seguimiento?.level && !fila.contestado ? (
                        <button type="button" className="button button-compact button-secondary"
                          onClick={() => setContestando({ llave, pedido: fila.pedido, proveedor: fila.proveedorNombre })}>Ha contestado</button>
                      ) : null}
                      {suyas.length > 0 ? (
                        <button type="button" className="button button-compact button-secondary"
                          onClick={() => setAbierto(abierto === llave ? null : llave)}>{abierto === llave ? "Ocultar" : "Ver líneas"}</button>
                      ) : null}
                    </td>
                  </tr>,
                  abierto === llave ? (
                    <tr key={`${llave}-lineas`} className="fila-detalle">
                      <td colSpan={8}>
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
              {enPantalla.length === 0 ? <tr><td colSpan={8} className="muted">Ningún pedido con estos filtros.</td></tr> : null}
            </tbody></table></div>
            <TablePagination page={paginaActual} pageCount={paginas} total={ordenadas.length} label="pedidos" onChange={setPagina} />
          </section>
        </>
      )}

      {/* El correo tal cual va a salir. Se pinta en un marco aparte para que
          sus estilos no se mezclen con los de la aplicación. */}
      <Modal open={Boolean(reclamando)} title="Reclamar la fecha" eyebrow={reclamando?.proveedor} onClose={() => setReclamando(null)} scrollInside>
        {reclamando ? (
          <div className="page-stack">
            {reclamando.html ? (
              <>
                {reclamando.redirigido ? (
                  <p className="form-error" style={{ margin: 0 }}>
                    Los envíos están desviados a <strong>{reclamando.redirigido}</strong>: esto no llega al proveedor.
                  </p>
                ) : null}
                <p className="muted" style={{ margin: 0 }}>
                  {reclamando.enHilo
                    ? <>Se responde sobre el correo con el que se mandó el pedido, desde el buzón de compras. El proveedor lo verá debajo, y su respuesta vuelve a ese hilo.</>
                    : reclamando.via === "graph"
                      ? <>Sale del buzón de compras como correo nuevo: no se ha encontrado el correo con el que se mandó el pedido.</>
                      : <>Sale de <strong>{reclamando.remitente}</strong>, pero sin pasar por el buzón: no quedará en Enviados.</>}
                </p>
                <p className="muted" style={{ margin: 0 }}>Para <strong>{reclamando.destinatario}</strong>.</p>
                <p style={{ margin: 0 }}><strong>Asunto:</strong> {reclamando.enHilo && reclamando.asuntoDelHilo ? `RE: ${reclamando.asuntoDelHilo}` : reclamando.asunto}</p>
                <iframe title="Vista previa del correo" sandbox="" srcDoc={reclamando.html}
                  style={{ width: "100%", height: 380, border: "1px solid var(--border)", borderRadius: 12, background: "#f5f7fb" }} />
                <div className="modal-actions">
                  <button type="button" className="button button-secondary" onClick={() => setReclamando(null)}>Cancelar</button>
                  <button type="button" className="button" disabled={reclamando.enviando || !reclamando.destinatario}
                    onClick={() => void enviarReclamacion()}>{reclamando.enviando ? "Enviando…" : "Enviar"}</button>
                </div>
              </>
            ) : <p className="muted">Preparando el correo…</p>}
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(contestando)} title="Ha contestado el proveedor" eyebrow={contestando?.proveedor} onClose={() => setContestando(null)}>
        {contestando ? <FormularioContestado onGuardar={guardarContestado} onCancelar={() => setContestando(null)} /> : null}
      </Modal>

      <Toast message={aviso} onDismiss={() => setAviso(null)} />
    </div>
  );
}

/**
 * Lo que se apunta cuando el proveedor contesta.
 *
 * La fecha es opcional porque muchas respuestas no la traen ("la semana que
 * viene te digo"): lo que importa es que quede marcado que ha contestado, para
 * no seguir reclamándole mientras tanto.
 */
function FormularioContestado({ onGuardar, onCancelar }: {
  onGuardar: (fecha: string, nota: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [fecha, setFecha] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  return (
    <form className="page-stack" onSubmit={(evento) => {
      evento.preventDefault();
      if (guardando) return;
      setGuardando(true);
      void onGuardar(fecha, nota).finally(() => setGuardando(false));
    }}>
      <p className="muted" style={{ margin: 0 }}>
        Queda apuntado aquí y el pedido deja de reclamarse. La fecha sigue haciendo falta en Sage:
        en cuanto esté, el pedido pasa a confirmado él solo.
      </p>
      <label>
        <span>Fecha que ha dado <small className="muted">(si ha dado alguna)</small></span>
        <DateField value={fecha} onChange={setFecha} />
      </label>
      <label>
        <span>Nota <small className="muted">(opcional)</small></span>
        <textarea rows={3} value={nota} onChange={(evento) => setNota(evento.target.value)}
          placeholder="Lo que haya dicho: que falta material, que lo confirma la semana que viene…" />
      </label>
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="button" disabled={guardando}>{guardando ? "Guardando…" : "Apuntar"}</button>
      </div>
    </form>
  );
}
