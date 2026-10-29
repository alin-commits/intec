"use client";

import { useEffect, useMemo, useState } from "react";
import { SageRefreshButton } from "@/components/sage-refresh-button";
import { useSearchParams } from "next/navigation";
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
import { estaPendiente, nombreDelEstado } from "@/lib/compras/reclamaciones";
import { fechaEnDisputa } from "@/lib/compras/respuestas";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
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
  /** El estado de Sage. Los servidos no llegan aquí: se filtran al leer. */
  status: number | null;
  /**
   * «Pasado a proveedor» en Sage. Nulo mientras el agente no mande la columna.
   *
   * En «no» el proveedor todavía no lo ha recibido: el aviso automático lo
   * salta, y aquí se avisa sin quitar el botón, porque quien lleva compras
   * puede tener un motivo que el automático no conoce.
   */
  sent_to_supplier: boolean | null;
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
  /** Lo que el bot entendió de la respuesta del proveedor. */
  proposed_on: string | null; proposed_sure: boolean | null; reply_summary: string | null;
  confirmed_at: string | null; confirmed_source: string | null;
  /** El último aviso de expedición: el material ha salido, pero sigue sin haber fecha. */
  shipping_notice: string | null; shipping_notice_at: string | null;
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
  /** Cuántos de estos pedidos siguen sin pasar a proveedor en Sage. */
  sinPasarAProveedor?: number;
};

/** Un correo que salió. */
type EnvioHecho = {
  id: string;
  company_code: number;
  supplier_code: string;
  level: number;
  kind: string;
  sent_at: string;
  to_email: string | null;
  ok: boolean;
  message: string | null;
  via: string | null;
  in_thread: boolean | null;
  orders: { year: number; series: string; number: number }[];
};

/** Un correo que llegó. */
type RespuestaRecibida = {
  message_id: string;
  company_code: number;
  supplier_code: string;
  from_email: string | null;
  subject: string | null;
  received_at: string;
  kind: string;
  summary: string | null;
  proposed_on: string | null;
  proposed_sure: boolean | null;
  /**
   * Los pedidos del correo. Desde que la IA lee pedido a pedido, cada uno trae
   * lo que se dijo de él; las respuestas de antes solo traen el número.
   */
  orders: {
    year: number; series: string; number: number;
    answered?: boolean; proposed_on?: string | null; proposed_sure?: boolean; summary?: string | null;
  }[];
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

const COLUMNAS_SEGUIMIENTO = "company_code, year, series, number, state, level, last_chased_at, replied_at, confirmed_on, confirmed_at, confirmed_source, notes, proposed_on, proposed_sure, reply_summary, shipping_notice, shipping_notice_at";
/** Lo mismo sin lo que trae la migración de reclamaciones. */
const COLUMNAS_SEGUIMIENTO_VIEJAS = "company_code, year, series, number, state, level, last_chased_at, replied_at, confirmed_on, confirmed_at, confirmed_source, notes";

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
  return { filas: (segunda.data ?? []).map((fila) => ({ ...fila, proposed_on: null, proposed_sure: false, reply_summary: null, shipping_notice: null, shipping_notice_at: null })) as Seguimiento[], faltaMigracion: true };
}

export function ComprasView() {
  const configured = isSupabaseConfigured();
  const [acceso, setAcceso] = useState<"comprobando" | "permitido" | "denegado">("comprobando");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [falloCarga, setFalloCarga] = useState<string | null>(null);
  const [hoy, setHoy] = useState("");
  const [filtro, setFiltro] = useState<"sin_fecha" | "con_fecha" | "vencidos" | "reclamados" | "contestados" | "disputa" | "todos">("sin_fecha");
  // De entrada, el que más lleva esperando arriba: es el que hay que reclamar antes.
  const [orden, setOrden] = useState<Orden>({ clave: "esperando", sentido: "desc" });
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const [seguimientos, setSeguimientos] = useState<Seguimiento[]>([]);
  const [envios, setEnvios] = useState<EnvioHecho[]>([]);
  const [respuestas, setRespuestas] = useState<RespuestaRecibida[]>([]);
  /** El pedido cuya ficha está abierta. */
  const [ficha, setFicha] = useState<string | null>(null);
  /*
    Se puede llegar con un pedido ya elegido: del aviso de entrada, o de un
    enlace que alguien se pase por chat. La ficha se abre sola, mire el mes que
    mire el filtro, porque busca entre todos los pedidos y no entre los del
    periodo.
  */
  const searchParams = useSearchParams();
  const pedidoDeLaUrl = searchParams.get("pedido") ?? "";
  const [pedidoYaAbierto, setPedidoYaAbierto] = useState("");
  if (pedidoDeLaUrl && pedidoDeLaUrl !== pedidoYaAbierto) {
    setPedidoYaAbierto(pedidoDeLaUrl);
    setFicha(pedidoDeLaUrl);
  }
  /** Si la migración de reclamaciones todavía no está, se avisa en vez de callar. */
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  // El periodo. Arranca en el mes en curso, pero la fecha no se puede mirar al
  // pintar, así que el valor lo pone el cargador igual que `hoy`.
  const [vista, setVista] = useState<Vista>("mes");
  /*
    Qué estados de Sage se miran. Se abre en pendientes, que es el trabajo; los
    demás están a un clic porque esconderlos del todo obliga a salirse a Sage
    para comprobar cualquier duda.
  */
  const [estadoSage, setEstadoSage] = useState<"pendientes" | "servidos" | "todos">("pendientes");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState(0);
  // Los dos diálogos: el de reclamar (con el correo delante) y el de apuntar
  // que han contestado.
  const [reclamando, setReclamando] = useState<Reclamacion | null>(null);
  const [contestando, setContestando] = useState<{ llave: string; pedido: Pedido; proveedor: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  /** Sube al acabar una lectura de Sage: lo vuelve a cargar todo. */
  const [recarga, setRecarga] = useState(0);

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

      const [pedidosRes, lineasRes, proveedoresRes, seguimientoRes, enviosRes, respuestasRes] = await Promise.all([
        fetchAllPages((desde, hasta) => supabase.from("sage_purchase_orders").select("company_code, year, series, number, order_date, supplier_code, expected_on, net_amount, pending_amount, lines, pending_units, status, sent_to_supplier").gt("pending_units", 0).order("company_code").order("number").range(desde, hasta)),
        fetchAllPages((desde, hasta) => supabase.from("sage_purchase_order_lines").select("company_code, year, series, number, line_number, article_code, description, pending_units, expected_on, net_amount").gt("pending_units", 0).order("company_code").order("number").order("line_number").range(desde, hasta)),
        supabase.from("sage_suppliers").select("company_code, code, name, email"),
        leerSeguimiento(supabase),
        // El historial. Si sus migraciones no están, se queda vacío y la ficha
        // lo dice; el resto de la pantalla no se entera.
        supabase.from("purchase_order_chases").select("id, company_code, supplier_code, level, kind, sent_at, to_email, ok, message, via, in_thread, orders").order("sent_at", { ascending: false }),
        supabase.from("purchase_order_replies").select("message_id, company_code, supplier_code, from_email, subject, received_at, kind, summary, proposed_on, proposed_sure, orders").order("received_at", { ascending: false }),
      ]);
      if (!vivo) return;
      // Ojo: si la tabla todavía no existe, PostgREST no da error — devuelve
      // una lista vacía. Así que "no hay datos" y "falta la migración" se ven
      // igual desde aquí, y por eso el aviso de abajo cubre los dos casos en vez
      // de afirmar cuál es.
      if (pedidosRes.error) {
        const fallo = pedidosRes.error as { message?: string };
        setFalloCarga(fallo.message ?? "No se pudieron leer los pedidos.");
        return;
      }
      /*
        Las líneas son las que dicen a qué pedido le falta fecha: con ellas a
        medias, la pantalla recalcula «sin fecha» y «Confirmados» sobre datos
        incompletos y enseña como confirmado lo que no lo está. Eso no se
        puede dejar pasar en silencio, que es desde donde alguien le da al
        botón de escribir al proveedor.
      */
      if (lineasRes.error) {
        const fallo = lineasRes.error as { message?: string };
        setFalloCarga(fallo.message ?? "No se pudieron leer las líneas de los pedidos.");
        return;
      }
      setPedidos((pedidosRes.data ?? []) as Pedido[]);
      setLineas((lineasRes.data ?? []) as Linea[]);
      setProveedores((proveedoresRes.data ?? []) as Proveedor[]);
      setSeguimientos(seguimientoRes.filas);
      setFaltaMigracion(seguimientoRes.faltaMigracion);
      setEnvios((enviosRes.data ?? []) as EnvioHecho[]);
      setRespuestas((respuestasRes.data ?? []) as RespuestaRecibida[]);
    })();
    return () => { vivo = false; };
  }, [configured, recarga]);

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
    // `fechas` son todas las de las líneas, no solo la del pedido: hacen falta
    // para saber si lo que dice el proveedor cuadra con alguna de ellas.
    const mapa = new Map<string, { sinFecha: number; fecha: string | null; fechas: string[] }>();
    for (const pedido of pedidos) {
      const llave = clave(pedido);
      const suyas = lineasPorPedido.get(llave) ?? [];
      if (suyas.length === 0) {
        mapa.set(llave, {
          sinFecha: pedido.expected_on ? 0 : 1,
          fecha: pedido.expected_on,
          fechas: pedido.expected_on ? [pedido.expected_on] : [],
        });
        continue;
      }
      /*
        Una línea sin fecha es una línea sin fecha, tenga o no la cabecera.

        Antes, si la cabecera traía fecha se daban por confirmadas TODAS sus
        líneas, y el pedido salía en «Confirmados». Pero el aviso automático y
        el reclamo a mano cuentan solo la fecha de la línea, así que a ese
        mismo pedido le seguían reclamando: confirmado en la pantalla y
        reclamable para el robot. Manda la línea, que es como lo confirma el
        proveedor y como lo cuenta todo lo demás.
      */
      const sinFecha = suyas.filter((linea) => !linea.expected_on).length;
      const fechas = suyas.map((linea) => linea.expected_on ?? pedido.expected_on).filter(Boolean) as string[];
      mapa.set(llave, { sinFecha, fecha: fechas.length ? [...fechas].sort().at(-1) ?? null : null, fechas });
    }
    return mapa;
  }, [pedidos, lineasPorPedido]);

  /*
    Los correos de cada pedido. Un mismo correo puede ir de varios pedidos —al
    agrupar por proveedor—, así que se indexa por cada uno de los suyos y no al
    revés.
  */
  function porPedido<T extends { company_code: number; orders: { year: number; series: string; number: number }[] }>(filas: T[]) {
    const mapa = new Map<string, T[]>();
    for (const fila of filas) {
      for (const pedido of fila.orders ?? []) {
        const llave = clave({ company_code: fila.company_code, year: pedido.year, series: pedido.series, number: pedido.number });
        mapa.set(llave, [...(mapa.get(llave) ?? []), fila]);
      }
    }
    return mapa;
  }
  const enviosDe = useMemo(() => porPedido(envios), [envios]);
  const respuestasDe = useMemo(() => porPedido(respuestas), [respuestas]);

  const seguimientoDe = useMemo(() => {
    const mapa = new Map<string, Seguimiento>();
    for (const fila of seguimientos) mapa.set(clave(fila), fila);
    return mapa;
  }, [seguimientos]);

  const conEstado = useMemo(() => pedidos.map((pedido) => {
    const estado = estadoDe.get(clave(pedido)) ?? { sinFecha: 1, fecha: null, fechas: [] };
    const proveedor = pedido.supplier_code ? nombreProveedor.get(`${pedido.company_code}-${pedido.supplier_code}`) : undefined;
    const vencido = Boolean(estado.fecha && hoy && estado.fecha < hoy);
    const suyo = seguimientoDe.get(clave(pedido));
    return {
      pedido, ...estado, vencido,
      proveedorNombre: proveedor?.name ?? pedido.supplier_code ?? "Sin proveedor",
      proveedorEmail: proveedor?.email ?? null,
      seguimiento: suyo ?? null,
      /*
        Que el proveedor haya contestado es un hecho, y no deja de serlo
        porque luego entre la fecha en Sage. Antes esto llevaba un
        `&& sinFecha > 0`, y el efecto era que en cuanto la fecha llegaba el
        pedido se caía de la pestaña de contestados y volvía a verse como un
        reclamado más, con su botón de «Ha contestado» otra vez.
      */
      contestado: suyo?.state === "contestado",
      /*
        La fecha que ha dado el proveedor cuando no es ninguna de las que hay
        en Sage. El pedido está «confirmado» para todo lo demás —tiene fecha,
        no se reclama— y sin esto nadie se enteraría de que esa fecha ya la ha
        desmentido quien tiene que traer el material.
      */
      enDisputa: fechaEnDisputa({
        dicha: suyo?.confirmed_on ?? suyo?.proposed_on,
        enSage: estado.fechas,
        sinFecha: estado.sinFecha,
      }),
    };
  }), [pedidos, estadoDe, nombreProveedor, hoy, seguimientoDe]);

  /*
    El periodo se mira por la fecha del pedido. De entrada, el mes en curso:
    es lo que se está trabajando. Lo de atrás no desaparece —está en "Todo" y
    en los meses anteriores—, pero no entra en los números del día a día.
  */
  const porEstadoSage = useMemo(() => {
    if (estadoSage === "todos") return conEstado;
    const quiero = estadoSage === "pendientes";
    return conEstado.filter((fila) => estaPendiente(fila.pedido.status) === quiero);
  }, [conEstado, estadoSage]);

  const delPeriodo = useMemo(() => {
    if (vista === "todo" || !hoy) return porEstadoSage;
    const prefijo = vista === "mes" ? mes : String(anio);
    if (!prefijo) return porEstadoSage;
    return porEstadoSage.filter((fila) => fila.pedido.order_date.startsWith(prefijo));
  }, [porEstadoSage, vista, mes, anio, hoy]);

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
        || (filtro === "reclamados" && (fila.seguimiento?.level ?? 0) > 0)
        || (filtro === "contestados" && fila.contestado)
        || (filtro === "disputa" && Boolean(fila.enDisputa));
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
    reclamados: delPeriodo.filter((fila) => (fila.seguimiento?.level ?? 0) > 0).length,
    contestados: delPeriodo.filter((fila) => fila.contestado).length,
    enDisputa: delPeriodo.filter((fila) => fila.enDisputa).length,
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
        sinPasarAProveedor: Number(datos.sinPasarAProveedor ?? 0),
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

  /**
   * Aceptar la fecha que ha entendido el bot.
   *
   * Hasta aquí era una propuesta: la IA lee el correo y dice lo que ha
   * entendido, pero la fecha del pedido no la pone ella. Este clic es el que
   * la convierte en fecha, y queda apuntado que vino de ahí.
   */
  async function aceptarFecha(fila: (typeof conEstado)[number]) {
    const propuesta = fila.seguimiento?.proposed_on;
    if (!propuesta) return;
    const { pedido } = fila;
    const supabase = createClient();
    const ahora = new Date().toISOString();
    const { error } = await supabase.from("purchase_order_tracking").upsert({
      company_code: pedido.company_code, year: pedido.year, series: pedido.series, number: pedido.number,
      confirmed_on: propuesta, confirmed_source: "ia", confirmed_at: ahora, updated_at: ahora,
    }, { onConflict: "company_code,year,series,number" });
    if (error) { setAviso("No se pudo guardar."); return; }
    setAviso(`Apuntado: ${fila.proveedorNombre} da el ${propuesta}. Falta pasarlo a Sage.`);
    await recargarSeguimiento();
  }

  /**
   * Pedirle al buzón lo que haya llegado desde la última pasada.
   *
   * Solo lee: no sale ningún correo de aquí. Se cuenta lo que ha encontrado
   * para que se note que ha hecho algo aunque no haya nada nuevo.
   */
  async function buscarRespuestas() {
    if (buscando) return;
    setBuscando(true);
    try {
      const respuesta = await fetch("/api/compras/leer-respuestas", { method: "POST" });
      const datos = await respuesta.json();
      if (!respuesta.ok) { setAviso(datos.error ?? "No se pudo leer el buzón."); return; }
      const nuevas = Number(datos.respuestas ?? 0) + Number(datos.expediciones ?? 0);
      setAviso(nuevas > 0
        ? `${nuevas} ${nuevas === 1 ? "respuesta nueva" : "respuestas nuevas"}${Number(datos.conFecha ?? 0) > 0 ? `, ${datos.conFecha} con fecha` : ""}.`
        : "Nada nuevo en el buzón.");
      await recargarSeguimiento();
    } catch {
      setAviso("No se pudo leer el buzón.");
    } finally {
      setBuscando(false);
    }
  }

  /*
    Releer el seguimiento por la misma puerta que la carga inicial.

    Antes tenía su propia lista de columnas, más corta, y cada vez que algo
    refrescaba —apuntar una respuesta, aceptar una fecha, mandar un correo—
    la pantalla se quedaba sin la fecha propuesta, sin el resumen de lo que
    dijo el proveedor y sin el aviso de expedición: desaparecían de la tabla
    hasta la siguiente recarga entera, sin que nadie hubiera tocado nada.
  */
  async function recargarSeguimiento() {
    const { filas } = await leerSeguimiento(createClient());
    setSeguimientos(filas);
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
    /*
      Apuntar que ha contestado sin decir fecha no borra la fecha que hubiera.

      El modal dice que la fecha es opcional —«la semana que viene te digo»—,
      pero dejarla en blanco mandaba null a confirmed_on y se llevaba por
      delante la que ya estuviera apuntada, sin avisar. Quien escribe una nota
      sobre un pedido que ya tenía fecha no está diciendo que ya no la haya.
      Para quitarla está el camino de siempre: que Sage traiga la suya.
    */
    const laFecha = fecha
      ? { confirmed_on: fecha, confirmed_source: "a_mano", confirmed_at: ahora }
      : {};
    const { error } = await supabase.from("purchase_order_tracking").upsert({
      company_code: pedido.company_code, year: pedido.year, series: pedido.series, number: pedido.number,
      state: "contestado", replied_at: ahora, replied_by: user?.id ?? null,
      ...laFecha,
      notes: nota.trim() || null,
      updated_at: ahora,
    }, { onConflict: "company_code,year,series,number" });
    if (error) { setAviso("No se pudo guardar."); return; }
    setContestando(null);
    setAviso(fecha ? `Apuntado: ${contestando.proveedor} da el ${fecha}.` : `Apuntado: ${contestando.proveedor} ha contestado.`);
    await recargarSeguimiento();
  }

  const fichaAbierta = useMemo(() => conEstado.find((fila) => clave(fila.pedido) === ficha) ?? null, [conEstado, ficha]);

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
    { header: "Estado en Sage", value: (fila) => nombreDelEstado(fila.pedido.status) },
    { header: "Reclamado", value: (fila) => (fila.seguimiento?.level ? `${fila.seguimiento.level} ${fila.seguimiento.level === 1 ? "vez" : "veces"}` : "No") },
    { header: "Última reclamación", value: (fila) => fila.seguimiento?.last_chased_at?.slice(0, 10) ?? "" },
    { header: "Ha contestado", value: (fila) => (fila.contestado ? "Sí" : "No") },
    { header: "Fecha que dio", value: (fila) => fila.seguimiento?.confirmed_on ?? fila.seguimiento?.proposed_on ?? "" },
    { header: "No cuadra con Sage", value: (fila) => (fila.enDisputa ? "Sí" : "No") },
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
        <div className="panel-heading-trailing">
          {/*
            El buzón se lee solo una vez al día (es lo que deja el plan de
            Vercel), así que una respuesta de media mañana no se vería hasta
            mañana. Esto la busca ahora.
          */}
          <button type="button" className="button button-compact button-secondary"
            onClick={() => void buscarRespuestas()} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar respuestas"}
          </button>
          {/*
            Lo de esta pantalla lo trae el agente de Sage. Quien acaba de meter
            un pedido quiere verlo ya, así que puede pedir la lectura en vez de
            esperar a la programada. El botón dice lo que tarda antes de
            pulsarlo, porque manda al servidor de la oficina a recorrer Sage y
            eso solo se puede hacer una vez por hora.
          */}
          <SageRefreshButton ventana="mes" onUpdated={() => setRecarga((clave) => clave + 1)} />
          {ordenadas.length > 0 ? (
            <>
              <button type="button" className="button button-compact button-secondary"
                onClick={() => void downloadXlsx("pedidos_a_proveedor.xlsx", [{ name: "Pendientes", columns: columnas, rows: ordenadas }] as never[])}>Exportar Excel</button>
              <button type="button" className="button button-compact button-secondary"
                onClick={() => downloadCsv("pedidos_a_proveedor.csv", ordenadas, columnas)}>CSV</button>
            </>
          ) : null}
        </div>
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
              <span>Estado en Sage</span>
              <select value={estadoSage} onChange={(evento) => { setPagina(0); setEstadoSage(evento.target.value as typeof estadoSage); }}>
                <option value="pendientes">Pendientes</option>
                <option value="servidos">Servidos y a medias</option>
                <option value="todos">Todos</option>
              </select>
            </label>
          </div>

          {faltaMigracion ? (
            <section className="panel panel-padded">
              <h3>Falta aplicar una migración</h3>
              <p className="muted">
                Los pedidos se ven bien, pero falta alguna de las migraciones de compras
                —<code>202610220001</code>, <code>202610220002</code> o <code>202610220003</code>—, así que el
                seguimiento se está leyendo a medias: puede faltar lo que ha contestado el proveedor o la fecha
                que propone.
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
                {([["sin_fecha", "Sin fecha"], ["vencidos", "Vencidos"], ["reclamados", "Reclamados"], ["contestados", "Contestados"], ["disputa", "En duda"], ["con_fecha", "Confirmados"], ["todos", "Todos"]] as const).map(([clave_, etiqueta]) => (
                  <button key={clave_} type="button" role="tab" aria-selected={filtro === clave_}
                    className={filtro === clave_ ? "view-tab active" : "view-tab"}
                    onClick={() => { setFiltro(clave_); setPagina(0); }}>
                    {etiqueta}
                    {clave_ === "contestados" && resumen.contestados > 0 ? ` (${numberFormatter.format(resumen.contestados)})` : ""}
                    {clave_ === "reclamados" && resumen.reclamados > 0 ? ` (${numberFormatter.format(resumen.reclamados)})` : ""}
                    {clave_ === "disputa" && resumen.enDisputa > 0 ? ` (${numberFormatter.format(resumen.enDisputa)})` : ""}
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

            <div className="table-scroll"><table className="sales-clickable-table"><thead><tr>
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
              {/*
                Las líneas del pedido ya no se despliegan aquí: están en la
                ficha, con el historial al lado, y tener dos sitios donde mirar
                lo mismo solo obligaba a elegir.
              */}
              {enPantalla.map((fila) => {
                const llave = clave(fila.pedido);
                return (
                  <tr key={llave} className={fila.vencido ? "fila-vencida" : undefined}
                    onClick={() => setFicha(llave)} title="Ver la ficha de este pedido">
                    <td>
                      <span className="sales-article">
                        <strong>{fila.pedido.series}{fila.pedido.number}</strong>
                        <small>
                          {fila.pedido.lines} {fila.pedido.lines === 1 ? "línea" : "líneas"}
                          {estaPendiente(fila.pedido.status) ? "" : ` · ${nombreDelEstado(fila.pedido.status)} en Sage`}
                          {fila.seguimiento?.shipping_notice ? " · material enviado" : ""}
                          {/* En Sage todavía no está pasado a proveedor: no lo ha recibido. */}
                          {fila.pedido.sent_to_supplier === false ? <> · <strong className="texto-pendiente">sin pasar a proveedor</strong></> : ""}
                        </small>
                      </span>
                    </td>
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
                        : fila.enDisputa ? (
                          // Tiene fecha en Sage, pero el proveedor ha dicho otra.
                          <span className="sales-article">
                            <span className="badge badge-aviso">{fila.fecha} en Sage</span>
                            <small>el proveedor dice el {fila.enDisputa}</small>
                          </span>
                        ) : <span className={fila.vencido ? "badge badge-lost" : "badge badge-active"}>{fila.fecha}{fila.vencido ? " · vencido" : ""}</span>}
                    </td>
                    <td>{currencyFormatter.format(Number(fila.pedido.pending_amount))}</td>
                    <td>
                      {fila.contestado ? (
                        <span className="sales-article" title={fila.seguimiento?.reply_summary ?? undefined}>
                          <span className="badge badge-active">ha contestado</span>
                          {/* «Falta pasarlo a Sage» solo mientras de verdad falte. */}
                          {fila.sinFecha === 0
                            ? <small>y la fecha ya está en Sage</small>
                            : fila.seguimiento?.confirmed_on
                              ? <small>da el {fila.seguimiento.confirmed_on} · <strong className="texto-pendiente">falta pasarlo a Sage</strong></small>
                              : fila.seguimiento?.proposed_on
                                ? <small>propone el {fila.seguimiento.proposed_on}{fila.seguimiento.proposed_sure === false ? " (sin confirmar)" : ""}</small>
                                : <small>sin fecha todavía</small>}
                        </span>
                      ) : fila.seguimiento?.level ? (
                        <span className="sales-article">
                          <strong>{fila.seguimiento.level === 1 ? "1 vez" : `${fila.seguimiento.level} veces`}</strong>
                          <small>{fila.seguimiento.last_chased_at ? `el ${fila.seguimiento.last_chased_at.slice(0, 10)}` : ""}</small>
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    {/* Los botones hacen lo suyo sin abrir además la ficha. */}
                    <td className="recent-inquiries-actions" onClick={(evento) => evento.stopPropagation()}>
                      {fila.sinFecha > 0 && fila.pedido.supplier_code && estaPendiente(fila.pedido.status) ? (
                        <button type="button"
                          className={fila.pedido.sent_to_supplier === false
                            ? "button button-compact button-secondary"
                            : "button button-compact button-primary"}
                          disabled={!fila.proveedorEmail}
                          title={!fila.proveedorEmail
                            ? "Este proveedor no tiene correo en Sage"
                            : fila.pedido.sent_to_supplier === false
                              ? "En Sage este pedido aún no está pasado a proveedor: no lo ha recibido"
                              : `Escribir a ${fila.proveedorEmail}`}
                          onClick={() => void prepararReclamacion(fila)}>Reclamar</button>
                      ) : null}
                      {/* La fecha dicha con condiciones también se puede dar por
                          buena, pero el botón avisa de que no la dijo en firme. */}
                      {fila.seguimiento?.proposed_on && !fila.seguimiento.confirmed_on ? (
                        <button type="button" className="button button-compact button-primary"
                          title={fila.seguimiento.proposed_sure === false
                            ? `Dar por buena la fecha del ${fila.seguimiento.proposed_on}, aunque no la dijeron en firme`
                            : `Dar por buena la fecha del ${fila.seguimiento.proposed_on}`}
                          onClick={() => void aceptarFecha(fila)}>Aceptar {fila.seguimiento.proposed_on}</button>
                      ) : null}
                      {fila.seguimiento?.level && !fila.contestado ? (
                        <button type="button" className="button button-compact button-secondary"
                          onClick={() => setContestando({ llave, pedido: fila.pedido, proveedor: fila.proveedorNombre })}>Ha contestado</button>
                      ) : null}
                    </td>
                  </tr>
                );
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
                {/* El automático no reclama esto; a mano se puede, pero que se sepa. */}
                {reclamando.sinPasarAProveedor ? (
                  <p className="form-error" style={{ margin: 0 }}>
                    {reclamando.sinPasarAProveedor === 1
                      ? <>En Sage este pedido aún no está <strong>pasado a proveedor</strong>: el proveedor no lo ha recibido, así que le estarías pidiendo la fecha de algo que no le ha llegado.</>
                      : <>En Sage {reclamando.sinPasarAProveedor} de estos pedidos aún no están <strong>pasados a proveedor</strong>: el proveedor no los ha recibido.</>}
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

      <Modal open={Boolean(fichaAbierta)} title={fichaAbierta ? `Pedido ${fichaAbierta.pedido.series}${fichaAbierta.pedido.number}` : "Pedido"}
        eyebrow={fichaAbierta?.proveedorNombre} onClose={() => setFicha(null)} scrollInside large>
        {fichaAbierta && ficha ? (
          <FichaDelPedido
            fila={fichaAbierta}
            lineas={lineasPorPedido.get(ficha) ?? []}
            envios={enviosDe.get(ficha) ?? []}
            respuestas={respuestasDe.get(ficha) ?? []}
            hoy={hoy}
          />
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
      {/* En form-grid para que los campos cojan el ancho: sueltos, el textarea
          sale con el tamaño que le da el navegador y se pega a su etiqueta. */}
      <div className="form-grid">
        <label>
          <span>Fecha que ha dado <small className="muted">(si ha dado alguna)</small></span>
          <DateField value={fecha} onChange={setFecha} />
        </label>
        <label className="form-field-wide">
          <span>Nota <small className="muted">(opcional)</small></span>
          <textarea rows={3} value={nota} onChange={(evento) => setNota(evento.target.value)}
            placeholder="Lo que haya dicho: que falta material, que lo confirma la semana que viene…" />
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="button" disabled={guardando}>{guardando ? "Guardando…" : "Apuntar"}</button>
      </div>
    </form>
  );
}

/** Cómo se llama cada escalón, para no enseñar un número suelto. */
const NOMBRE_DEL_ESCALON: Record<number, string> = { 1: "primer aviso", 2: "segundo aviso", 3: "tercer aviso" };
const NOMBRE_DEL_TIPO: Record<string, string> = {
  respuesta: "Responde el proveedor",
  expedicion: "Aviso de expedición",
  automatico: "Respuesta automática",
  otro: "Correo sin relación",
};

/** Un momento de la vida del pedido, para pintarlos todos en orden. */
type Hito = { cuando: string; titulo: string; detalle: string | null; tono: "salida" | "entrada" | "aviso" };

/**
 * La ficha de un pedido: lo que es, lo que falta y todo lo que ha pasado.
 *
 * El historial se arma juntando los correos que salieron, los que llegaron y
 * lo que entendió la IA, ordenados por fecha. Contesta la pregunta que de
 * verdad se hace uno delante de un pedido atascado: qué hemos hecho con esto
 * y qué nos han dicho.
 */
function FichaDelPedido({ fila, lineas, envios, respuestas, hoy }: {
  fila: { pedido: Pedido; sinFecha: number; fecha: string | null; vencido: boolean; proveedorNombre: string; proveedorEmail: string | null; seguimiento: Seguimiento | null; enDisputa: string | null };
  lineas: Linea[];
  envios: EnvioHecho[];
  respuestas: RespuestaRecibida[];
  hoy: string;
}) {
  const hitos: Hito[] = [{
    cuando: fila.pedido.order_date,
    titulo: "Se hizo el pedido",
    detalle: `${fila.pedido.lines} ${fila.pedido.lines === 1 ? "línea" : "líneas"} · ${currencyFormatter.format(Number(fila.pedido.net_amount))}`,
    tono: "salida",
  }];

  for (const envio of envios) {
    const comoSalio = envio.via === "graph"
      ? (envio.in_thread ? "respondiendo sobre el correo del pedido" : "correo nuevo desde el buzón de compras")
      : "por el servidor, en nombre del buzón de compras";
    hitos.push({
      cuando: envio.sent_at,
      titulo: envio.ok
        ? `Se reclamó la fecha · ${NOMBRE_DEL_ESCALON[envio.level] ?? `aviso ${envio.level}`}${envio.kind === "manual" ? " (a mano)" : ""}`
        : "Intento de reclamación fallido",
      detalle: [envio.to_email ? `a ${envio.to_email}` : null, comoSalio, envio.message].filter(Boolean).join(" · ") || null,
      tono: envio.ok ? "salida" : "aviso",
    });
  }

  for (const recibida of respuestas) {
    // Si el correo era de varios pedidos, lo que dijo de este; si no, lo del correo.
    const suyo = recibida.orders.find((pedido) =>
      pedido.year === fila.pedido.year && pedido.series === fila.pedido.series && pedido.number === fila.pedido.number);
    const porPedido = recibida.orders.length > 1 && suyo?.answered !== undefined;
    const propuesta = porPedido ? suyo?.proposed_on : recibida.proposed_on;
    const segura = porPedido ? suyo?.proposed_sure : recibida.proposed_sure;
    const fecha = propuesta ? `propone el ${propuesta}${segura ? "" : " (sin confirmar del todo)"}` : null;
    const dicho = porPedido
      ? (suyo?.answered ? suyo.summary || recibida.summary : "De este pedido no dice nada")
      : recibida.summary;
    hitos.push({
      cuando: recibida.received_at,
      titulo: NOMBRE_DEL_TIPO[recibida.kind] ?? "Correo recibido",
      detalle: [dicho, fecha, recibida.from_email ? `de ${recibida.from_email}` : null].filter(Boolean).join(" · ") || recibida.subject,
      tono: recibida.kind === "respuesta" ? "entrada" : "aviso",
    });
  }

  if (fila.seguimiento?.confirmed_at && fila.seguimiento.confirmed_on) {
    hitos.push({
      cuando: fila.seguimiento.confirmed_at,
      titulo: `Fecha dada por buena: ${fila.seguimiento.confirmed_on}`,
      detalle: fila.seguimiento.confirmed_source === "ia" ? "aceptando la que entendió el bot" : "a mano",
      tono: "entrada",
    });
  }
  if (fila.seguimiento?.notes) {
    hitos.push({ cuando: fila.seguimiento.replied_at ?? "", titulo: "Nota", detalle: fila.seguimiento.notes, tono: "aviso" });
  }

  hitos.sort((a, b) => (a.cuando ?? "").localeCompare(b.cuando ?? ""));
  const sinHistorial = envios.length === 0 && respuestas.length === 0;

  return (
    <div className="page-stack">
      <section className="kpi-grid kpi-grid-3">
        <div className="panel panel-padded">
          <span className="eyebrow">Proveedor</span>
          <p style={{ margin: "4px 0 0" }}><strong>{fila.proveedorNombre}</strong></p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{fila.proveedorEmail ?? "sin correo en Sage"}</p>
        </div>
        <div className="panel panel-padded">
          <span className="eyebrow">Pendiente</span>
          <p style={{ margin: "4px 0 0" }}><strong>{currencyFormatter.format(Number(fila.pedido.pending_amount))}</strong></p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{hoy ? `${numberFormatter.format(diasDesde(fila.pedido.order_date, hoy))} días esperando` : ""}</p>
        </div>
        <div className="panel panel-padded">
          <span className="eyebrow">Fecha prevista</span>
          <p style={{ margin: "4px 0 0" }}>
            {fila.fecha
              ? <strong>{fila.fecha}{fila.vencido ? " · vencida" : ""}</strong>
              : fila.seguimiento?.confirmed_on
                ? <strong>{fila.seguimiento.confirmed_on}</strong>
                : <strong>Sin fecha</strong>}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {!fila.fecha && fila.seguimiento?.confirmed_on
              ? <>dada por buena aquí · <strong className="texto-pendiente">falta pasarla a Sage</strong></>
              : fila.sinFecha > 0
                ? `${fila.sinFecha} ${fila.sinFecha === 1 ? "línea" : "líneas"} sin confirmar`
                : fila.enDisputa
                  ? <>es la de Sage · <strong className="texto-pendiente">el proveedor dice el {fila.enDisputa}</strong></>
                  : "todas las líneas confirmadas"}
          </p>
        </div>
      </section>

      {fila.pedido.sent_to_supplier === false ? (
        <section className="panel panel-padded">
          <span className="eyebrow">Sin pasar a proveedor</span>
          <p style={{ margin: "4px 0 0" }}>En Sage la casilla «Pasado a proveedor» está en «no».</p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            El proveedor no ha recibido el pedido todavía, así que el aviso automático no se lo reclama
            hasta que la casilla pase a «sí». Reclamar a mano se puede, pero le estarías pidiendo la fecha
            de algo que no le ha llegado.
          </p>
        </section>
      ) : null}

      {fila.seguimiento?.shipping_notice ? (
        <section className="panel panel-padded">
          <span className="eyebrow">Material enviado</span>
          <p style={{ margin: "4px 0 0" }}>{fila.seguimiento.shipping_notice}</p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Llegó un aviso de expedición{fila.seguimiento.shipping_notice_at ? ` el ${fila.seguimiento.shipping_notice_at.slice(0, 10)}` : ""}.
            Sigue sin haber fecha de entrega, así que el pedido se sigue reclamando.
          </p>
        </section>
      ) : null}

      <section className="panel panel-padded">
        <h3 style={{ marginTop: 0 }}>Qué ha pasado</h3>
        {sinHistorial ? (
          <p className="muted">Todavía no se le ha reclamado nada y no ha llegado ninguna respuesta.</p>
        ) : null}
        <ul className="historial">
          {hitos.map((hito, indice) => (
            <li key={`${hito.cuando}-${indice}`}>
              <span className="historial-cuando">{(hito.cuando ?? "").slice(0, 10)}</span>
              <div>
                <div className="historial-titulo">
                  <span className={`historial-punto ${hito.tono}`} aria-hidden="true" />
                  {hito.titulo}
                </div>
                {hito.detalle ? <p className="historial-detalle">{hito.detalle}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel panel-padded">
        <h3 style={{ marginTop: 0 }}>Líneas pendientes</h3>
        <ul className="lineas-pedido">
          {lineas.map((linea) => (
            <li key={linea.line_number}>
              <span>
                <strong>{linea.description || linea.article_code || `Línea ${linea.line_number}`}</strong>
                <small className="muted"> · {numberFormatter.format(Number(linea.pending_units))} pendientes</small>
              </span>
              {linea.expected_on
                ? <span className="badge badge-active">{linea.expected_on}</span>
                : <span className="badge badge-lost">sin fecha</span>}
            </li>
          ))}
          {lineas.length === 0 ? <li><span className="muted">Las líneas de este pedido todavía no han llegado de Sage.</span></li> : null}
        </ul>
      </section>
    </div>
  );
}
