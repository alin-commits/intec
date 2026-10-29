"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { ConsultasIcon, ConversionIcon, DocumentIcon, EuroIcon } from "@/components/icons";
import { AgenciaLector } from "@/components/agencia-lector";
import { KpiCard } from "@/components/kpi-card";
import { DataTable, type Column } from "@/components/sales/sales-ui";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { PageLoader } from "@/components/ui/page-loader";
import { Toast } from "@/components/ui/toast";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import {
  CONCEPTOS_SUGERIDOS,
  cifrasDe,
  cuandoEs,
  invertidoEn,
  mesAMes,
  mesesDe,
  mesesDelAnio,
  porConcepto,
  retornoDe,
  type CifrasDeAgencia,
  type FilaDeConsultas,
  type MarcaElegida,
  type PartidaDeAgencia,
} from "@/lib/agencia";
import { AGENCIA_EDIT_ROLES, AGENCIA_ROLES, hasAnyRole } from "@/lib/constants";
import { todayKey } from "@/lib/dates";
import { reportSafeError } from "@/lib/errors";
import { formatPercent, numberFormatter } from "@/lib/format";
import { euros } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { writeRows } from "@/lib/supabase/write";
import type { BusinessUnit } from "@/lib/types";

/*
  Agencia: lo que se gasta con ella por marca frente a lo que venden las
  consultas de esa marca (sin Portales/RRSS ni leads).

  Todo el gasto de una marca es una inversión y todas sus consultas cuentan
  contra ella: no se reparte entre SEO y SEM. Cada consulta que pasa a ganada
  suma su venta al marcador, y el retorno se recalcula solo.
*/

const COLORES = ["#4f46e5", "#0891b2", "#f59e0b", "#10b981", "#e11d48", "#7c3aed", "#64748b"];
const SIN_MARCA = "";

type Borrador = {
  businessUnitId: string;
  concept: string;
  monthlyAmount: string;
  unaVez: boolean;
  startMonth: string;
  endMonth: string;
  notes: string;
};

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
/** "oct 2026". */
const nombreDelMes = (mes: string) => `${MESES_CORTOS[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

/** "+140,0 %" o "—": el ROI, siempre con su signo. */
const roiTexto = (roi: number | null) => (roi === null ? "—" : `${roi >= 0 ? "+" : ""}${formatPercent(roi * 100)}`);
/** "+12.300 €": la diferencia, con su signo. */
const diferenciaTexto = (valor: number) => `${valor >= 0 ? "+" : "-"}${euros(Math.abs(valor))}`;
/** "2,40 €" por cada euro. */
const porEuroTexto = (valor: number | null) => (valor === null ? "—" : `${valor.toFixed(2).replace(".", ",")} €`);

function mapPartida(fila: Record<string, unknown>): PartidaDeAgencia {
  return {
    id: String(fila.id),
    businessUnitId: (fila.business_unit_id as string | null) ?? null,
    concept: String(fila.concept ?? ""),
    monthlyAmount: Number(fila.monthly_amount ?? 0),
    startMonth: String(fila.start_month ?? "").slice(0, 7),
    endMonth: fila.end_month ? String(fila.end_month).slice(0, 7) : null,
    notes: (fila.notes as string | null) ?? null,
  };
}

/** El marcador: lo vendido llenando la barra, con la marca de lo invertido. */
function MarcadorDeRetorno({ cifras, titulo }: { cifras: CifrasDeAgencia; titulo: string }) {
  const retorno = retornoDe(cifras);
  const escala = Math.max(cifras.vendido, cifras.invertido, 1) * 1.08;
  const pagada = cifras.invertido > 0 && cifras.vendido >= cifras.invertido;
  const recuperado = cifras.invertido > 0 ? cifras.vendido / cifras.invertido : null;
  return (
    <section className={`panel panel-padded agencia-marcador ${pagada ? "is-pagada" : "is-pendiente"}`}>
      <div className="agencia-marcador-cifra">
        <span>{titulo}</span>
        <strong>{porEuroTexto(retorno.porEuro)}</strong>
        <small>vendidos por cada euro invertido</small>
      </div>
      <div className="agencia-marcador-detalle">
        <div
          className="agencia-barra"
          role="img"
          aria-label={`Vendido ${euros(cifras.vendido)} frente a ${euros(cifras.invertido)} invertidos`}
        >
          <div className="agencia-barra-relleno" style={{ width: `${(cifras.vendido / escala) * 100}%` }} />
          {cifras.invertido > 0 ? (
            <div className="agencia-barra-marca" style={{ left: `${(cifras.invertido / escala) * 100}%` }}>
              <span>Invertido {euros(cifras.invertido)}</span>
            </div>
          ) : null}
        </div>
        <p className="agencia-marcador-frase">
          {cifras.invertido === 0
            ? "Todavía no hay inversión apuntada en este periodo: añade el presupuesto de la agencia para calcular el retorno."
            : pagada
              ? <>Se ha pagado: lo vendido supera lo invertido en <strong>{euros(retorno.diferencia)}</strong>.</>
              : <>Lleva recuperado el <strong>{formatPercent((recuperado ?? 0) * 100)}</strong>: faltan <strong>{euros(-retorno.diferencia)}</strong> en ventas para cubrir lo invertido.</>}
        </p>
        <div className="agencia-marcador-datos">
          <span>Vendido <strong>{euros(cifras.vendido)}</strong></span>
          <span>ROI <strong>{roiTexto(retorno.roi)}</strong> · {diferenciaTexto(retorno.diferencia)}</span>
          {cifras.ofertado > 0 ? <span>En oferta <strong>{euros(cifras.ofertado)}</strong> que aún puede sumar</span> : null}
        </div>
      </div>
    </section>
  );
}

type FilaDeMarca = { key: string; nombre: string; cifras: CifrasDeAgencia };

export function AgenciaManager() {
  const hoy = todayKey();
  const anioActual = Number(hoy.slice(0, 4));
  const [acceso, setAcceso] = useState<"comprobando" | "si" | "no">("comprobando");
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [marcas, setMarcas] = useState<BusinessUnit[]>([]);
  const [partidas, setPartidas] = useState<PartidaDeAgencia[]>([]);
  const [filas, setFilas] = useState<FilaDeConsultas[]>([]);
  const [anio, setAnio] = useState(anioActual);
  const [marca, setMarca] = useState<MarcaElegida>("todas");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; borrador: Borrador } | null>(null);
  const [aBorrar, setABorrar] = useState<PartidaDeAgencia | null>(null);
  const [lectorAbierto, setLectorAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargarPartidas = useCallback(async () => {
    const { data, error } = await createClient().from("agency_budget_lines")
      .select("id, business_unit_id, concept, monthly_amount, start_month, end_month, notes").order("start_month");
    if (error) throw error;
    setPartidas((data ?? []).map((fila) => mapPartida(fila as Record<string, unknown>)));
  }, []);

  // Quién entra, las marcas y el presupuesto. Una vez.
  useEffect(() => {
    let activo = true;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: auth } = await supabase.auth.getUser();
        const { data: perfil } = auth.user ? await supabase.from("profiles").select("roles").eq("id", auth.user.id).maybeSingle() : { data: null };
        if (!activo) return;
        if (!perfil || !hasAnyRole(perfil.roles, AGENCIA_ROLES)) {
          setAcceso("no");
          return;
        }
        setPuedeEditar(hasAnyRole(perfil.roles, AGENCIA_EDIT_ROLES));
        const { data: unidades, error } = await supabase.from("business_units")
          .select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").order("sort_order");
        if (error) throw error;
        if (!activo) return;
        setMarcas((unidades ?? []).filter((fila) => fila.is_active).map((fila) => ({
          id: fila.id, name: fila.name, slug: fila.slug, accent: fila.brand_color || "#2563eb", active: fila.is_active, logo: fila.logo_url,
          sortOrder: fila.sort_order ?? 0, visibleInConsultas: fila.visible_in_consultas ?? true, visibleInLeads: fila.visible_in_leads ?? true,
        })));
        setAcceso("si");
        await cargarPartidas();
      } catch (causa) {
        if (!activo) return;
        // Sin esto la página se quedaba comprobando para siempre.
        setAcceso((actual) => (actual === "comprobando" ? "si" : actual));
        setMensaje(reportSafeError(causa, "No se pudo cargar el presupuesto de la agencia. Recarga la página."));
      }
    })();
    return () => { activo = false; };
  }, [cargarPartidas]);

  // Las consultas del año elegido.
  useEffect(() => {
    if (acceso !== "si") return;
    let activo = true;
    void (async () => {
      const { data, error } = await createClient().rpc("agency_inquiry_summary", { p_from: `${anio}-01-01`, p_to: `${anio}-12-31` });
      if (!activo) return;
      if (error) {
        setMensaje(reportSafeError(error, "No se pudieron cargar las consultas."));
        setFilas([]);
        return;
      }
      setFilas((data ?? []) as FilaDeConsultas[]);
    })();
    return () => { activo = false; };
  }, [acceso, anio]);

  const meses = useMemo(() => mesesDelAnio(anio, hoy), [anio, hoy]);
  const cifras = useMemo(() => cifrasDe(partidas, filas, meses, marca), [partidas, filas, meses, marca]);
  const retorno = retornoDe(cifras);
  const presupuestoDelAnio = useMemo(() => invertidoEn(partidas, mesesDe(`${anio}-01`, `${anio}-12`), marca), [partidas, anio, marca]);
  const puntos = useMemo(() => mesAMes(partidas, filas, meses, marca), [partidas, filas, meses, marca]);
  const conceptos = useMemo(() => porConcepto(partidas, meses, marca), [partidas, meses, marca]);

  const anios = useMemo(() => {
    const primero = Math.min(anioActual, ...partidas.map((partida) => Number(partida.startMonth.slice(0, 4))));
    return Array.from({ length: anioActual + 1 - primero + 1 }, (_, indice) => anioActual + 1 - indice);
  }, [partidas, anioActual]);

  const nombreDeMarca = (id: string | null) => (id ? marcas.find((unidad) => unidad.id === id)?.name ?? "Marca sin activar" : "Todas, sin repartir");

  // Por marca, y aparte lo que no es de ninguna: suma en el total, sin consultas propias.
  const sinRepartir = partidas.filter((partida) => partida.businessUnitId === null);
  const porMarca: FilaDeMarca[] = [
    ...marcas.map((unidad) => ({ key: unidad.id, nombre: unidad.name, cifras: cifrasDe(partidas, filas, meses, unidad.id) })),
    { key: SIN_MARCA, nombre: "Todas, sin repartir", cifras: cifrasDe(sinRepartir, [], meses, "todas") },
  ].filter((fila) => fila.cifras.invertido > 0 || fila.cifras.consultas > 0 || fila.cifras.vendido > 0);

  const suma = (lista: FilaDeMarca[]): CifrasDeAgencia => lista.reduce((total, fila) => ({
    invertido: total.invertido + fila.cifras.invertido, consultas: total.consultas + fila.cifras.consultas, ganadas: total.ganadas + fila.cifras.ganadas,
    vendido: total.vendido + fila.cifras.vendido, ofertas: total.ofertas + fila.cifras.ofertas, ofertado: total.ofertado + fila.cifras.ofertado,
  }), { invertido: 0, consultas: 0, ganadas: 0, vendido: 0, ofertas: 0, ofertado: 0 });

  const columnas: Column<FilaDeMarca>[] = [
    { key: "marca", header: "Marca", text: true, render: (fila) => fila.nombre, sort: (fila) => fila.nombre },
    { key: "invertido", header: "Invertido", render: (fila) => euros(fila.cifras.invertido), sort: (fila) => fila.cifras.invertido, total: (lista) => euros(suma(lista).invertido) },
    {
      key: "consultas", header: "Consultas", sort: (fila) => fila.cifras.consultas,
      render: (fila) => {
        const coste = retornoDe(fila.cifras).costePorConsulta;
        return <>{numberFormatter.format(fila.cifras.consultas)}{coste !== null ? <span className="sales-change-amount">{euros(coste)} cada una</span> : null}</>;
      },
      total: (lista) => numberFormatter.format(suma(lista).consultas),
    },
    {
      key: "ganadas", header: "Ganadas", optional: true, sort: (fila) => fila.cifras.ganadas,
      render: (fila) => {
        const conversion = retornoDe(fila.cifras).conversion;
        return <>{numberFormatter.format(fila.cifras.ganadas)}{conversion !== null ? <span className="sales-change-amount">{formatPercent(conversion * 100)}</span> : null}</>;
      },
      total: (lista) => numberFormatter.format(suma(lista).ganadas),
    },
    { key: "vendido", header: "Vendido", render: (fila) => euros(fila.cifras.vendido), sort: (fila) => fila.cifras.vendido, total: (lista) => euros(suma(lista).vendido) },
    {
      key: "retorno", header: "Por cada euro", sort: (fila) => retornoDe(fila.cifras).porEuro ?? -1,
      render: (fila) => <strong>{porEuroTexto(retornoDe(fila.cifras).porEuro)}</strong>,
      total: (lista) => <strong>{porEuroTexto(retornoDe(suma(lista)).porEuro)}</strong>,
    },
    {
      key: "roi", header: "ROI", sort: (fila) => retornoDe(fila.cifras).roi ?? -Infinity,
      render: (fila) => {
        const valor = retornoDe(fila.cifras);
        return <span className={valor.roi === null ? "muted" : valor.roi >= 0 ? "sales-up" : "sales-down"}>{roiTexto(valor.roi)}<span className="sales-change-amount">{diferenciaTexto(valor.diferencia)}</span></span>;
      },
      total: (lista) => {
        const valor = retornoDe(suma(lista));
        return <span className={valor.roi === null ? "muted" : valor.roi >= 0 ? "sales-up" : "sales-down"}>{roiTexto(valor.roi)}<span className="sales-change-amount">{diferenciaTexto(valor.diferencia)}</span></span>;
      },
    },
  ];

  const borradorNuevo = (): Borrador => ({
    businessUnitId: marca === "todas" ? (marcas[0]?.id ?? SIN_MARCA) : marca,
    concept: "", monthlyAmount: "", unaVez: false, startMonth: hoy.slice(0, 7), endMonth: "", notes: "",
  });
  const abrirPartida = (partida: PartidaDeAgencia) => setEditor({
    id: partida.id,
    borrador: {
      businessUnitId: partida.businessUnitId ?? SIN_MARCA, concept: partida.concept, monthlyAmount: String(partida.monthlyAmount),
      unaVez: partida.endMonth === partida.startMonth, startMonth: partida.startMonth, endMonth: partida.endMonth ?? "", notes: partida.notes ?? "",
    },
  });
  const cambiar = <K extends keyof Borrador>(campo: K, valor: Borrador[K]) =>
    setEditor((actual) => (actual ? { ...actual, borrador: { ...actual.borrador, [campo]: valor } } : actual));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!editor) return;
    const { borrador } = editor;
    const importe = Number(borrador.monthlyAmount.replace(",", "."));
    if (!borrador.concept.trim() || !Number.isFinite(importe) || importe < 0 || !/^\d{4}-\d{2}$/.test(borrador.startMonth)) {
      setMensaje("Falta el concepto, el importe o el mes de inicio.");
      return;
    }
    const fin = borrador.unaVez ? borrador.startMonth : borrador.endMonth || null;
    if (fin !== null && (!/^\d{4}-\d{2}$/.test(fin) || fin < borrador.startMonth)) {
      setMensaje("El mes final no puede ser anterior al de inicio.");
      return;
    }
    const fila = {
      business_unit_id: borrador.businessUnitId || null,
      concept: borrador.concept.trim(),
      monthly_amount: importe,
      start_month: `${borrador.startMonth}-01`,
      end_month: fin ? `${fin}-01` : null,
      notes: borrador.notes.trim() || null,
    };
    setOcupado(true);
    try {
      const supabase = createClient();
      await writeRows(
        editor.id ? supabase.from("agency_budget_lines").update(fila).eq("id", editor.id) : supabase.from("agency_budget_lines").insert(fila),
        "No tienes permiso para cambiar el presupuesto de la agencia.",
        "id",
      );
      await cargarPartidas();
      setEditor(null);
      setMensaje("Presupuesto guardado.");
    } catch (causa) {
      setMensaje(reportSafeError(causa, "No se pudo guardar la partida."));
    } finally {
      setOcupado(false);
    }
  };

  const borrar = async () => {
    if (!aBorrar) return;
    setOcupado(true);
    try {
      await writeRows(createClient().from("agency_budget_lines").delete().eq("id", aBorrar.id), "No tienes permiso para borrar partidas.", "id");
      await cargarPartidas();
      setABorrar(null);
      setEditor(null);
      setMensaje("Partida borrada.");
    } catch (causa) {
      setMensaje(reportSafeError(causa, "No se pudo borrar la partida."));
    } finally {
      setOcupado(false);
    }
  };

  if (acceso === "comprobando") return <PageLoader label="Cargando la agencia…" />;
  if (acceso === "no") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Agencia solo está disponible para Administración, Marketing y Dirección.</p>
        </section>
      </div>
    );
  }

  const enCurso = anio === anioActual;
  const periodo = enCurso ? `${anio}, hasta hoy` : String(anio);
  const marcaElegida = marca === "todas" ? null : marcas.find((unidad) => unidad.id === marca) ?? null;
  const partidasVisibles = partidas
    .filter((partida) => marca === "todas" || partida.businessUnitId === marca)
    .filter((partida) => partida.startMonth <= `${anio}-12` && (partida.endMonth === null || partida.endMonth >= `${anio}-01`));

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p>
            Lo que se invierte en la agencia frente a lo que venden las consultas de cada marca, sin las de Portales/RRSS ni
            los leads. Cada consulta ganada suma su venta y el retorno se recalcula solo.
          </p>
        </div>
        <div className="panel-heading-trailing">
          <label className="inline-select"><span>Año</span>
            <select value={anio} onChange={(evento) => setAnio(Number(evento.target.value))}>
              {anios.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
            </select>
          </label>
          {puedeEditar ? <button type="button" className="button button-secondary" onClick={() => setLectorAbierto(true)}>Leer presupuesto con IA</button> : null}
          {puedeEditar ? <button type="button" className="button button-primary" onClick={() => setEditor({ id: null, borrador: borradorNuevo() })}>+ Añadir partida</button> : null}
        </div>
      </section>

      {!puedeEditar ? <div className="notice"><strong>Solo lectura</strong><span>Puedes ver el retorno, pero el presupuesto solo lo cambian Marketing y Administración.</span></div> : null}

      <Toast message={mensaje} onDismiss={() => setMensaje(null)} />

      <div className="brand-chip-row" role="tablist" aria-label="Filtrar por marca">
        <button type="button" role="tab" aria-selected={marca === "todas"} className={marca === "todas" ? "brand-chip active" : "brand-chip"} onClick={() => setMarca("todas")}>Todas las marcas</button>
        {marcas.map((unidad) => (
          <button type="button" role="tab" aria-selected={marca === unidad.id} key={unidad.id} className={marca === unidad.id ? "brand-chip active" : "brand-chip"} onClick={() => setMarca(unidad.id)}>
            <UnitBrandMark unit={unidad} size={22} />
            {unidad.name}
          </button>
        ))}
      </div>

      <MarcadorDeRetorno cifras={cifras} titulo={`${marcaElegida ? marcaElegida.name : "Todas las marcas"} · ${periodo}`} />

      <section className="kpi-grid">
        <KpiCard label="Invertido" value={euros(cifras.invertido)} delta="Sin comparación" icon={<EuroIcon />} tone="amber"
          helper={enCurso ? `hasta este mes · ${euros(presupuestoDelAnio)} en todo ${anio}` : `en ${anio}`} />
        <KpiCard label="Consultas" value={numberFormatter.format(cifras.consultas)} delta="Sin comparación" icon={<ConsultasIcon />} tone="sky"
          helper={retorno.costePorConsulta !== null ? `${euros(retorno.costePorConsulta)} por consulta · sin Portales/RRSS` : "sin Portales/RRSS ni leads"} />
        <KpiCard label="Vendido" value={euros(cifras.vendido)} delta="Sin comparación" icon={<ConversionIcon />} tone="emerald"
          helper={`${numberFormatter.format(cifras.ganadas)} ganadas${retorno.conversion !== null ? ` · ${formatPercent(retorno.conversion * 100)} de las consultas` : ""}`} />
        <KpiCard label="En oferta" value={euros(cifras.ofertado)} delta="Sin comparación" icon={<DocumentIcon />} tone="indigo"
          helper={`${numberFormatter.format(cifras.ofertas)} consultas con oferta o en seguimiento: aún no cuentan`} />
      </section>

      <section className="expenses-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Invertido y vendido, acumulado</h2><p className="panel-subtitle">Mes a mes en {periodo}. Donde la línea verde pasa a la naranja, la agencia se ha pagado</p></div></div>
          <TrendChart
            data={puntos.map((punto) => ({ label: nombreDelMes(punto.mes).split(" ")[0], invertido: Math.round(punto.invertidoAcumulado), vendido: Math.round(punto.vendidoAcumulado) }))}
            series={[{ key: "invertido", label: "Invertido", color: "#f59e0b" }, { key: "vendido", label: "Vendido", color: "#10b981" }]}
            ariaLabel={`Invertido y vendido acumulados en ${periodo}`}
            valueFormatter={euros}
            total={false}
          />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>En qué se va</h2><p className="panel-subtitle">Lo invertido en {periodo}, por concepto</p></div></div>
          <DonutChart
            items={conceptos.map((concepto, indice) => ({ label: concepto.concepto, value: Math.round(concepto.importe), color: COLORES[indice % COLORES.length] }))}
            centerLabel="invertido"
            ariaLabel={`Inversión en la agencia por concepto en ${periodo}`}
            emptyMessage="Sin inversión apuntada en este periodo."
            valueFormatter={euros}
          />
        </article>
      </section>

      <section className="panel panel-padded">
        <div className="panel-heading"><div><h2>Por marca</h2><p className="panel-subtitle">{periodo}. Pulsa una para verla sola. El retorno es sobre la venta, no sobre el beneficio</p></div></div>
        <DataTable
          rows={porMarca}
          columns={columnas}
          rowKey={(fila) => fila.key}
          activeKey={marca === "todas" ? null : marca}
          onRowClick={(fila) => { if (fila.key !== SIN_MARCA) setMarca((actual) => (actual === fila.key ? "todas" : fila.key)); }}
          initialSort={{ key: "invertido", desc: true }}
          empty="Sin inversión ni consultas en este periodo."
        />
      </section>

      <section className="panel panel-padded">
        <div className="panel-heading">
          <div><h2>Presupuesto de la agencia</h2><p className="panel-subtitle">Las partidas que cuentan en {anio}{marcaElegida ? ` para ${marcaElegida.name}` : ""}. Pulsa una para cambiarla</p></div>
        </div>
        {partidasVisibles.length === 0 ? (
          <p className="muted">
            {partidas.length === 0
              ? "Todavía no hay presupuesto. Sube el que manda la agencia con «Leer presupuesto con IA», o apunta cada partida con «+ Añadir partida»."
              : "Ninguna partida cuenta en este año."}
          </p>
        ) : (
          <ul className="agencia-partidas">
            {partidasVisibles.map((partida) => (
              <li key={partida.id}>
                <button type="button" onClick={() => abrirPartida(partida)}>
                  <span className="agencia-partida-texto">
                    <strong>{partida.concept}</strong>
                    <small>{nombreDeMarca(partida.businessUnitId)} · {cuandoEs(partida, nombreDelMes)}{partida.notes ? ` · ${partida.notes}` : ""}</small>
                  </span>
                  <strong>{euros(partida.monthlyAmount)}{partida.endMonth === partida.startMonth ? "" : "/mes"}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={editor !== null} title={editor?.id ? "Cambiar partida" : "Nueva partida"} eyebrow="Presupuesto de la agencia" onClose={() => setEditor(null)}>
        {editor ? (
          <form className="lead-editor-form" onSubmit={(evento) => void guardar(evento)}>
            <div className="form-grid">
              <label><span>Marca *</span>
                <select value={editor.borrador.businessUnitId} disabled={!puedeEditar} onChange={(evento) => cambiar("businessUnitId", evento.target.value)}>
                  {marcas.map((unidad) => <option key={unidad.id} value={unidad.id}>{unidad.name}</option>)}
                  <option value={SIN_MARCA}>Todas, sin repartir</option>
                </select>
              </label>
              <label><span>Concepto *</span>
                <input value={editor.borrador.concept} readOnly={!puedeEditar} maxLength={80} list="agencia-conceptos" placeholder="SEO, SEM, Google Ads…" required
                  onChange={(evento) => cambiar("concept", evento.target.value)} />
              </label>
              <label><span>Cómo se paga *</span>
                <select value={editor.borrador.unaVez ? "una" : "mes"} disabled={!puedeEditar} onChange={(evento) => cambiar("unaVez", evento.target.value === "una")}>
                  <option value="mes">Cada mes</option>
                  <option value="una">Una sola vez</option>
                </select>
              </label>
              <label><span>{editor.borrador.unaVez ? "Importe (€) *" : "Importe al mes (€) *"}</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={editor.borrador.monthlyAmount} readOnly={!puedeEditar} required
                  onChange={(evento) => cambiar("monthlyAmount", evento.target.value)} />
              </label>
              <label><span>{editor.borrador.unaVez ? "Mes *" : "Desde *"}</span>
                <input type="month" value={editor.borrador.startMonth} readOnly={!puedeEditar} required pattern="\d{4}-\d{2}" placeholder="2026-10"
                  onChange={(evento) => cambiar("startMonth", evento.target.value)} />
              </label>
              {!editor.borrador.unaVez ? (
                <label><span>Hasta (vacío: sigue)</span>
                  <input type="month" value={editor.borrador.endMonth} readOnly={!puedeEditar} pattern="\d{4}-\d{2}" placeholder="2026-12"
                    onChange={(evento) => cambiar("endMonth", evento.target.value)} />
                </label>
              ) : null}
              <label className="form-field-wide"><span>Notas</span>
                <textarea rows={2} maxLength={500} value={editor.borrador.notes} readOnly={!puedeEditar} placeholder="Qué incluye, condiciones, cuándo revisarlo…"
                  onChange={(evento) => cambiar("notes", evento.target.value)} />
              </label>
            </div>
            <div className="modal-actions">
              {puedeEditar && editor.id ? (
                <button type="button" className="button button-secondary expenses-delete" onClick={() => setABorrar(partidas.find((partida) => partida.id === editor.id) ?? null)}>Borrar</button>
              ) : null}
              <button type="button" className="button button-secondary" onClick={() => setEditor(null)}>Cerrar</button>
              {puedeEditar ? <button type="submit" className="button button-primary" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar partida"}</button> : null}
            </div>
          </form>
        ) : null}
      </Modal>

      {/* Los conceptos de siempre, para el formulario y para el lector: así se escriben igual. */}
      <datalist id="agencia-conceptos">{CONCEPTOS_SUGERIDOS.map((concepto) => <option key={concepto} value={concepto} />)}</datalist>

      <AgenciaLector
        abierto={lectorAbierto}
        marcas={marcas}
        partidas={partidas}
        nombreDelMes={nombreDelMes}
        onCerrar={() => setLectorAbierto(false)}
        onGuardado={(cuantas) => {
          setLectorAbierto(false);
          setMensaje(`${cuantas} partida${cuantas === 1 ? "" : "s"} guardada${cuantas === 1 ? "" : "s"} del presupuesto.`);
          void cargarPartidas().catch((causa: unknown) => setMensaje(reportSafeError(causa, "Se guardaron, pero no se pudieron recargar. Recarga la página.")));
        }}
      />

      <ConfirmationDialog open={aBorrar !== null} title="¿Borrar la partida?" confirmLabel="Borrar" destructive busy={ocupado} onCancel={() => setABorrar(null)} onConfirm={() => void borrar()}>
        {aBorrar ? (
          <div className="confirmation-summary">
            <span>Partida</span><strong>{aBorrar.concept} · {nombreDeMarca(aBorrar.businessUnitId)}</strong>
            <span>Efecto</span><strong>Deja de contar en lo invertido de todos los meses, también los pasados. Si solo se ha dejado de pagar, mejor ponle un mes final.</strong>
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
