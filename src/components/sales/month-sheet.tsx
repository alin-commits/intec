"use client";

import { Modal } from "@/components/ui/modal";
import { formatPercent, numberFormatter } from "@/lib/format";
import {
  bucketDiscount,
  bucketMargin,
  channelLabel,
  emptyBucket,
  euros,
  externasPorMes,
  filterRows,
  groupRows,
  marcado,
  monthWithYear,
  sumBuckets,
  ticketFormatter,
  type Bucket,
} from "@/lib/sales-model";
import { monthEnd } from "@/lib/sales-period";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { rpcAllRows } from "./sales-queries";
import { changeCell, DataTable, LoadFailed, share, useSageQuery, type Column } from "./sales-ui";

/*
  La ficha de un mes: qué pasó dentro de él.

  La tabla de mes a mes dice cuánto se vendió; esto dice de qué. Quién lo
  vendió, por qué canal, de qué familias y a qué clientes, que es lo que había
  que ir a buscar a otras cuatro pestañas filtrando por ese mes.

  Hace caso a los filtros del panel: mirando a un comercial, la ficha de
  octubre es el octubre de ese comercial, no el de todos. Es lo contrario que
  la ficha de un cliente —a un cliente se le quiere ver entero—, porque aquí
  el mes no es el sujeto, es el recorte.
*/

type FamiliaDeSociedad = { company_code: number; family_code: string; units: number; net_amount: number };
type Familia = { code: string; name: string; units: number; net_amount: number };
type ClienteDelMes = { company_code: number; customer_code: string; name: string; net_amount: number; documents: number; municipality: string | null };

const sinNada = <span className="muted">—</span>;

export function MonthSheet({ month, ctx, onClose, hidden = false }: {
  month: string | null;
  ctx: SalesContext;
  onClose: () => void;
  /** Mientras hay una ficha de cliente encima, esta se aparta sin cerrarse. */
  hidden?: boolean;
}) {
  const { filters, model, period } = ctx;
  const fila = month ? model.monthly.months.find((item) => item.key === month) ?? null : null;

  /*
    Las cifras de cabecera salen de lo que ya está cargado, no de otra
    consulta: la tabla de mes a mes las tiene calculadas y pedirlas otra vez
    daría lo mismo, solo que más tarde y con riesgo de no coincidir con la
    fila que se acaba de pulsar.
  */
  const bucket = fila?.bucket ?? emptyBucket();
  const margen = fila?.margin ?? bucketMargin(bucket);
  const dto = bucketDiscount(bucket);
  /*
    Y la venta con lo que no pasó por Sage, igual que la fila de la tabla:
    sin esto, en los meses de 2025 en que Jender aún no estaba en Sage la
    ficha decía una cifra y la fila que se acababa de pulsar otra, y la
    variación contra el año anterior salía distinta en los dos sitios. El
    margen y el descuento siguen siendo solo de Sage, como en la tabla.
  */
  const fueraDelMes = month ? externasPorMes(ctx.externalSales, filters, ctx.repOf).get(month) ?? 0 : 0;
  const fueraAntes = fila?.pair ? externasPorMes(ctx.previousExternalSales, filters, ctx.repOf).get(fila.pair) ?? 0 : 0;
  const ventas = bucket.net + fueraDelMes;
  const antes = (fila?.beforeNet ?? 0) + fueraAntes;

  // El mes entero como tramo: para la base, un mes es de su día 1 al último.
  const desde = month ? `${month}-01` : null;
  const hasta = month ? monthEnd(month) : null;

  /*
    Comerciales y canales salen de las filas que ya están en memoria. Son un
    agrupado de lo mismo que pinta la tabla de arriba, así que no hace falta
    bajar a la base ni esperar a nadie: la ficha abre con ellos puestos.
  */
  const delMes = month ? filterRows(ctx.rows, filters, ctx.repOf, ["month"]).filter((row) => row.month === month) : [];
  /*
    Por la clave de la persona y no por su nombre: dos códigos sin ficha en
    Sage de sociedades distintas se llaman los dos «Código 5» y se habrían
    sumado como si fueran uno.
  */
  const nombreDe = new Map<string, string>();
  const porComercial = ordenar(groupRows(delMes, (row) => {
    const quien = ctx.repOf(row.company_code, row.rep_code);
    nombreDe.set(quien.key, quien.label);
    return quien.key;
  }), (clave) => nombreDe.get(clave) ?? clave);
  const porCanal = ordenar(groupRows(delMes, (row) => channelLabel(row.series)), (canal) => canal);
  const totalDelMes = delMes.reduce((suma, row) => suma + Number(row.net_amount), 0);

  /*
    Y lo que sí hay que pedir: las familias y los clientes del mes.

    Van con los filtros del panel menos los meses, porque el tramo ya es el
    mes exacto. El de canal se le quita al de familias a propósito: esa
    función no sabe de series —el panel de Productos tampoco se lo manda— y
    enviárselo no filtraría de menos, fallaría entera.
  */
  const conFiltros = { ...ctx.rpc, p_months: undefined, p_from: desde, p_to: hasta };
  /*
    Las familias salen de la misma función que la pestaña Productos, y se
    juntan igual: una fila por familia y sociedad, que aquí se suman por
    familia. No de sage_article_groups: esa solo sabe agrupar por subfamilia
    o por marca, y pedirle «familia» devolvía subfamilias con la etiqueta de
    familias. La sociedad y la familia se filtran aquí porque la función no
    las recibe; el canal no lo sabe, y eso se dice en el bloque.
  */
  const familiasPorSociedad = useSageQuery<FamiliaDeSociedad[]>(
    month ? JSON.stringify(["ficha-mes-familias", desde, hasta, ctx.rpc.p_reps, ctx.reloadKey]) : null,
    async () => {
      const { data, error } = await createClient().rpc("sage_family_summary", {
        p_from: desde, p_to: hasta, ...(ctx.rpc.p_reps ? { p_reps: ctx.rpc.p_reps } : {}),
      });
      return { data: (data ?? []) as FamiliaDeSociedad[], error };
    },
  );
  const familias = (() => {
    const suma = new Map<string, Familia>();
    for (const fila of familiasPorSociedad.data ?? []) {
      if (!marcado(filters.companies, fila.company_code) || !marcado(filters.families, fila.family_code)) continue;
      const hay = suma.get(fila.family_code) ?? { code: fila.family_code, name: ctx.familyName(fila.family_code), units: 0, net_amount: 0 };
      hay.units += Number(fila.units);
      hay.net_amount += Number(fila.net_amount);
      suma.set(fila.family_code, hay);
    }
    return [...suma.values()].sort((a, b) => b.net_amount - a.net_amount);
  })();
  /*
    Los clientes, todos y por páginas: la base corta a mil filas sin avisar,
    y un mes con más de mil clientes dejaría el Total por debajo de lo que
    dice la cabecera.
  */
  const clientes = useSageQuery<ClienteDelMes[]>(
    month ? JSON.stringify(["ficha-mes-clientes", conFiltros, ctx.reloadKey]) : null,
    async () => rpcAllRows<ClienteDelMes>("sage_customer_list", { ...conFiltros, p_kind: "activos", p_days: 30 },
      [{ column: "net_amount", ascending: false }, { column: "company_code" }, { column: "customer_code" }]),
  );

  if (!month || !fila || hidden) return null;

  const ventaDeFamilias = familias.reduce((suma, familia) => suma + familia.net_amount, 0);
  const ventaDeClientes = (clientes.data ?? []).reduce((suma, cliente) => suma + Number(cliente.net_amount), 0);

  return (
    <Modal open title={monthWithYear(month)} eyebrow="Ficha del mes" onClose={onClose} scrollInside large>
      <div className="month-sheet">
        <section className="month-sheet-kpis">
          <Cifra
            titulo="Ventas"
            valor={euros(ventas)}
            pie={<>
              {antes > 0 ? changeCell(ventas, antes) : <span className="muted">sin {period.baseCompareShort ?? "antes"} con que comparar</span>}
              {fueraDelMes > 0 ? <span className="muted"> · {euros(fueraDelMes)} no pasan por Sage</span> : null}
            </>}
          />
          <Cifra titulo="Margen" valor={margen ? euros(margen.amount) : "—"} pie={margen ? <span className="muted">{formatPercent(margen.percent)} del mes</span> : <span className="muted">sin coste cargado</span>} />
          <Cifra titulo="Descuento" valor={dto ? formatPercent(dto.percent) : "—"} pie={dto ? <span className="muted">{euros(dto.amount)} sobre tarifa</span> : <span className="muted">sin tarifa</span>} />
          <Cifra titulo="Albaranes" valor={numberFormatter.format(bucket.documents)} pie={<span className="muted">ticket {ticketFormatter.format(bucket.documents > 0 ? bucket.net / bucket.documents : 0)}</span>} />
        </section>

        {/* El botón de filtrar, porque pulsar el mes ahora abre esto: sin él
            se habría perdido la única manera de llevar el mes a todo el panel. */}
        <p className="month-sheet-acciones">
          <button
            type="button"
            className="button button-compact button-secondary"
            onClick={() => { ctx.toggleMonth(month); onClose(); }}
          >
            {filters.months.includes(month) ? "Quitar este mes del filtro" : "Filtrar todo el panel por este mes"}
          </button>
        </p>

        <div className="month-sheet-grid">
          <Bloque titulo="Comerciales" nota={fueraDelMes > 0 ? `Quién vendió los ${euros(totalDelMes)} que pasaron por Sage` : `Quién vendió los ${euros(totalDelMes)} del mes`}>
            <DataTable
              rows={porComercial}
              columns={columnasDeReparto(totalDelMes)}
              rowKey={(row) => row.clave}
              limit={8}
              empty="Nadie con venta en este mes."
            />
          </Bloque>

          <Bloque titulo="Canales" nota="Por dónde entró la venta">
            <DataTable
              rows={porCanal}
              columns={columnasDeReparto(totalDelMes)}
              rowKey={(row) => row.clave}
              limit={8}
              empty="Sin canales en este mes."
            />
          </Bloque>

          <Bloque
            titulo="Familias más vendidas"
            nota={[
              familias.length > 0 ? `${euros(ventaDeFamilias)} repartidos en ${familias.length} familias` : "Qué se vendió",
              // Este reparto no baja a canal: con uno marcado, se dice.
              filters.channels.length > 0 ? "de todos los canales" : null,
            ].filter(Boolean).join(", ")}
          >
            {familiasPorSociedad.failed ? <LoadFailed what="las familias del mes" /> : (
              <DataTable
                rows={familias}
                columns={[
                  { key: "familia", header: "Familia", render: (row) => row.name, sort: (row) => row.name, total: (rows) => `Total · ${rows.length} familias` },
                  { key: "ventas", header: "Ventas", render: (row) => euros(row.net_amount), sort: (row) => row.net_amount, total: (rows) => euros(rows.reduce((suma, row) => suma + row.net_amount, 0)) },
                  { key: "peso", header: "Peso", render: (row) => share(row.net_amount, ventaDeFamilias), sort: (row) => row.net_amount, total: () => "100 %" },
                  { key: "unidades", header: "Unidades", optional: true, render: (row) => numberFormatter.format(Math.round(row.units)), sort: (row) => row.units, total: (rows) => numberFormatter.format(Math.round(rows.reduce((suma, row) => suma + row.units, 0))) },
                ] satisfies Column<Familia>[]}
                rowKey={(row) => row.code}
                limit={10}
                empty={familiasPorSociedad.loading ? "Leyendo las familias…" : "Sin ventas por familia en este mes."}
              />
            )}
          </Bloque>

          <Bloque
            titulo="Clientes del mes"
            nota={clientes.data && clientes.data.length > 0 ? `${clientes.data.length} compraron este mes. Pulsa uno para su ficha` : "Quién compró"}
          >
            {clientes.failed ? <LoadFailed what="los clientes del mes" /> : (
              <DataTable
                rows={[...(clientes.data ?? [])].sort((a, b) => Number(b.net_amount) - Number(a.net_amount))}
                columns={[
                  { key: "cliente", header: "Cliente", render: (row) => <><strong>{row.name}</strong>{row.municipality ? <small className="muted"> · {row.municipality}</small> : null}</>, sort: (row) => row.name, total: (rows) => `Total · ${rows.length} clientes` },
                  { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount), total: (rows) => euros(rows.reduce((suma, row) => suma + Number(row.net_amount), 0)) },
                  { key: "peso", header: "Peso", render: (row) => share(Number(row.net_amount), ventaDeClientes), sort: (row) => Number(row.net_amount), total: () => "100 %" },
                  { key: "albaranes", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(Number(row.documents)), sort: (row) => Number(row.documents), total: (rows) => numberFormatter.format(rows.reduce((suma, row) => suma + Number(row.documents), 0)) },
                ] satisfies Column<ClienteDelMes>[]}
                rowKey={(row) => `${row.company_code}:${row.customer_code}`}
                limit={10}
                onRowClick={(row) => ctx.openCustomer({ company_code: row.company_code, customer_code: row.customer_code, name: row.name })}
                empty={clientes.loading ? "Leyendo los clientes…" : "Nadie compró en este mes."}
              />
            )}
          </Bloque>
        </div>
      </div>
    </Modal>
  );
}

function Cifra({ titulo, valor, pie }: { titulo: string; valor: string; pie: React.ReactNode }) {
  return (
    <div className="month-sheet-kpi">
      <span className="month-sheet-kpi-label">{titulo}</span>
      <strong>{valor}</strong>
      <small>{pie}</small>
    </div>
  );
}

function Bloque({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <section className="month-sheet-bloque">
      <header>
        <h4>{titulo}</h4>
        <p className="muted">{nota}</p>
      </header>
      {children}
    </section>
  );
}

type Reparto = { clave: string; label: string; bucket: Bucket };

/** De un agrupado a filas ordenadas de más a menos venta, cada una con su nombre. */
function ordenar(mapa: Map<string, Bucket>, nombre: (clave: string) => string): Reparto[] {
  return [...mapa]
    .map(([clave, bucket]) => ({ clave, label: nombre(clave), bucket }))
    .sort((a, b) => b.bucket.net - a.bucket.net);
}

/*
  Las mismas cuatro columnas para comerciales y canales: quién, cuánto, qué
  parte del mes y con qué margen. El peso es lo que de verdad se mira en una
  ficha de un mes —si un mes se sostiene sobre uno solo, se ve aquí—.
*/
function columnasDeReparto(total: number): Column<Reparto>[] {
  return [
    { key: "quien", header: "Nombre", render: (row) => row.label, sort: (row) => row.label, total: (rows) => `Total · ${rows.length}` },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net, total: (rows) => euros(rows.reduce((suma, row) => suma + row.bucket.net, 0)) },
    { key: "peso", header: "Peso", render: (row) => share(row.bucket.net, total), sort: (row) => row.bucket.net, total: () => "100 %" },
    {
      key: "margen",
      header: "Margen %",
      optional: true,
      render: (row) => { const m = bucketMargin(row.bucket); return m ? formatPercent(m.percent) : sinNada; },
      sort: (row) => bucketMargin(row.bucket)?.percent ?? -Infinity,
      // El margen del conjunto se saca del bucket sumado y no promediando los
      // porcentajes: un mes con un comercial grande y otro pequeño no tiene el
      // margen del medio, tiene el que sale de sus euros.
      total: (rows) => {
        const m = bucketMargin(sumBuckets(rows, (row) => row.bucket));
        return m ? formatPercent(m.percent) : sinNada;
      },
    },
  ];
}
