"use client";

import { numberFormatter } from "@/lib/format";
import { euros } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { DataTable, LoadFailed, Panel, useSageQuery, type Column } from "./sales-ui";

/*
  Lo que no son ventas, puesto uno al lado del otro.

  Comparar dos comerciales por lo que facturan dice la mitad: uno puede
  vender lo mismo con treinta clientes que con ciento veinte, o apoyado en
  una sola familia. Aquí van las otras dos columnas de esa conversación —a
  cuántos clientes le vende cada uno y de qué familias— para los mismos
  marcados que compara el bloque de arriba.

  Cada marcado se pregunta por separado porque las funciones de la base
  devuelven el total de lo que se les pide, no un reparto.

  CADA FUNCIÓN RECIBE SOLO LOS PARÁMETROS QUE TIENE. No es una manía: a
  PostgREST se le pide una función por su nombre Y sus argumentos, así que
  uno de más no filtra de menos, hace que no exista ninguna función con esa
  firma y la llamada entera devuelve 404. Por eso el marcado trae dos juegos
  de argumentos en vez de uno, y la sociedad —que sage_family_summary no
  recibe pero sí devuelve— se filtra aquí con los datos ya en la mano.
*/

/** Qué se compara y cómo se le pregunta a la base por uno solo de ellos. */
export type Marcado = {
  clave: string;
  nombre: string;
  color: string;
  /** Para sage_customer_counts, que acepta p_companies, p_series, p_reps y p_months. */
  paraClientes: Record<string, unknown>;
  /** Para sage_family_summary, que solo acepta p_months y p_reps. */
  paraFamilias: Record<string, unknown>;
  /** La sociedad de este marcado, cuando se comparan sociedades: se filtra a mano. */
  sociedad?: number;
};

type Cuentas = {
  activos: number;
  nuevos: number;
  perdidos: number;
  neto_activos: number;
};
type FamiliaFila = { company_code: number; family_code: string; net_amount: number };

type Fila = {
  clave: string;
  nombre: string;
  clientes: number;
  nuevos: number;
  perdidos: number;
  venta: number;
};

export function DetalleComparado({ ctx, marcados, queEs, dim }: {
  ctx: SalesContext;
  marcados: Marcado[];
  /** Cómo se llama en singular lo que se compara: «Comercial», «Canal»… */
  queEs: string;
  /** Qué dimensión se está comparando, que decide qué se puede preguntar. */
  dim: "month" | "company" | "channel" | "rep";
}) {
  const { period } = ctx;
  /*
    Los filtros del panel que se respetan, además de lo que distingue a cada
    marcado. La subfamilia se queda fuera a propósito: el comparador no la
    aplica —su etiqueta sale en gris— y aplicarla solo aquí haría que esta
    tabla dijera otra cosa que la de arriba.
  */
  const base = {
    p_from: period.from, p_to: period.to,
    p_reps: ctx.rpc.p_reps, p_series: ctx.rpc.p_series,
    ...(ctx.rpc.p_companies ? { p_companies: ctx.rpc.p_companies } : {}),
    ...(ctx.rpc.p_months ? { p_months: ctx.rpc.p_months } : {}),
    ...(ctx.rpc.p_families ? { p_families: ctx.rpc.p_families } : {}),
  };
  const llave = JSON.stringify([marcados.map((m) => m.clave), base, ctx.reloadKey]);

  const clientes = useSageQuery<Fila[]>(
    ctx.detail.customers && marcados.length > 0 ? `clientes-comparados:${llave}` : null,
    async () => {
      const supabase = createClient();
      const respuestas = await Promise.all(marcados.map((marcado) =>
        supabase.rpc("sage_customer_counts", { ...base, ...marcado.paraClientes })));
      const fallo = respuestas.find((r) => r.error)?.error;
      if (fallo) return { data: null, error: fallo };
      return {
        data: respuestas.map((respuesta, indice) => {
          const fila = ((respuesta.data ?? []) as Cuentas[])[0];
          return {
            clave: marcados[indice].clave,
            nombre: marcados[indice].nombre,
            clientes: Number(fila?.activos ?? 0),
            nuevos: Number(fila?.nuevos ?? 0),
            perdidos: Number(fila?.perdidos ?? 0),
            venta: Number(fila?.neto_activos ?? 0),
          };
        }),
        error: null,
      };
    },
  );

  /*
    Las familias de cada uno.

    sage_family_summary solo entiende los meses y el comercial, así que la
    sociedad —la del marcado y la que haya puesta en el panel— se aplica
    aquí, con las filas ya traídas: esa función no recibe la sociedad pero sí
    la devuelve en cada fila.

    Comparando canales no se puede: la venta por familia que manda Sage no
    trae la serie por ninguna parte, ni para pedirla ni para filtrarla luego.
  */
  const sePuedenFamilias = dim !== "channel";
  const sociedadesDelPanel = ctx.rpc.p_companies ?? null;
  const porFamilia = useSageQuery<{ nombre: string; filas: Map<string, number> }[]>(
    sePuedenFamilias && marcados.length > 0 ? `familias-comparadas:${llave}` : null,
    async () => {
      const supabase = createClient();
      const respuestas = await Promise.all(marcados.map((marcado) =>
        supabase.rpc("sage_family_summary", {
          p_from: period.from, p_to: period.to,
          ...(ctx.rpc.p_months ? { p_months: ctx.rpc.p_months } : {}),
          p_reps: ctx.rpc.p_reps ?? null,
          ...marcado.paraFamilias,
        })));
      const fallo = respuestas.find((r) => r.error)?.error;
      if (fallo) return { data: null, error: fallo };
      return {
        data: respuestas.map((respuesta, indice) => {
          const suyas = new Map<string, number>();
          const sociedad = marcados[indice].sociedad;
          for (const fila of (respuesta.data ?? []) as FamiliaFila[]) {
            if (sociedad !== undefined && Number(sociedad) !== Number(fila.company_code)) continue;
            if (sociedadesDelPanel && !sociedadesDelPanel.includes(Number(fila.company_code))) continue;
            suyas.set(fila.family_code, (suyas.get(fila.family_code) ?? 0) + Number(fila.net_amount));
          }
          return { nombre: marcados[indice].nombre, filas: suyas };
        }),
        error: null,
      };
    },
  );

  if (marcados.length === 0) return null;

  /*
    Los clientes no se suman: el mismo cliente le compra a dos comerciales y
    en los dos meses, así que una fila de Total diría más clientes de los que
    hay. Por eso estas columnas no llevan total.

    Y los perdidos son los del año —se cuentan contra el año anterior, no
    contra el tramo—, así que comparando meses saldría la misma cifra doce
    veces. Ahí la columna no sale.
  */
  const columnasClientes: Column<Fila>[] = [
    { key: "quien", header: queEs, text: true, render: (fila) => fila.nombre, sort: (fila) => fila.nombre },
    { key: "clientes", header: "Clientes", render: (fila) => numberFormatter.format(fila.clientes), sort: (fila) => fila.clientes },
    { key: "nuevos", header: "Nuevos", render: (fila) => numberFormatter.format(fila.nuevos), sort: (fila) => fila.nuevos },
    ...(dim === "month"
      ? []
      : [{ key: "perdidos", header: "Perdidos", optional: true, render: (fila: Fila) => numberFormatter.format(fila.perdidos), sort: (fila: Fila) => fila.perdidos }]),
    { key: "venta", header: "Venta", render: (fila) => euros(fila.venta), sort: (fila) => fila.venta },
    { key: "porcliente", header: "Por cliente", render: (fila) => (fila.clientes > 0 ? euros(fila.venta / fila.clientes) : <span className="muted">—</span>), sort: (fila) => (fila.clientes > 0 ? fila.venta / fila.clientes : -Infinity) },
  ];

  // Las familias, una fila por familia y una columna por marcado.
  const familias = porFamilia.data ?? [];
  const todas = new Map<string, number>();
  for (const uno of familias) for (const [codigo, valor] of uno.filas) todas.set(codigo, (todas.get(codigo) ?? 0) + valor);
  const ordenadas = [...todas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([codigo]) => codigo);
  type FilaFamilia = { codigo: string; nombre: string; valores: number[]; total: number };
  const filasFamilia: FilaFamilia[] = ordenadas.map((codigo) => ({
    codigo,
    nombre: ctx.familyName(codigo),
    valores: familias.map((uno) => uno.filas.get(codigo) ?? 0),
    total: todas.get(codigo) ?? 0,
  }));
  const columnasFamilia: Column<FilaFamilia>[] = [
    { key: "familia", header: "Familia", text: true, render: (fila) => fila.nombre, sort: (fila) => fila.nombre },
    ...familias.map((uno, indice) => ({
      key: `col${indice}`,
      header: uno.nombre,
      render: (fila: FilaFamilia) => euros(fila.valores[indice] ?? 0),
      sort: (fila: FilaFamilia) => fila.valores[indice] ?? 0,
      total: (filas: FilaFamilia[]) => euros(filas.reduce((suma, fila) => suma + (fila.valores[indice] ?? 0), 0)),
    })),
  ];

  return (
    <>
      <section className="sales-board">
        <Panel
          title="Clientes de cada uno"
          subtitle="Cuántos le compran, cuántos son nuevos y cuánto deja cada cliente. No se suman: el mismo cliente puede estar en varios"
          className="panel table-panel sales-board-full"
        >
          {!ctx.detail.customers ? (
            <p className="muted">El detalle de clientes todavía no ha llegado de Sage.</p>
          ) : clientes.failed ? <LoadFailed what="los clientes de cada uno" /> : (
            <DataTable
              rows={clientes.data ?? []}
              columns={columnasClientes}
              rowKey={(fila) => fila.clave}
              initialSort={{ key: "clientes", desc: true }}
              empty={clientes.loading ? "Cargando…" : "Sin clientes en este periodo."}
            />
          )}
        </Panel>
      </section>

      <section className="sales-board">
        <Panel
          title="Qué familias vende cada uno"
          subtitle="Las doce que más pesan entre los marcados, con lo que lleva cada uno"
          className="panel table-panel sales-board-full"
        >
          {!sePuedenFamilias ? (
            <p className="muted">
              El reparto por familia que manda Sage no trae el canal, así que esta comparación no se puede hacer
              entre canales. Entre comerciales, sociedades o meses sí.
            </p>
          ) : porFamilia.failed ? <LoadFailed what="las familias de cada uno" /> : (
            <DataTable
              rows={filasFamilia}
              columns={columnasFamilia}
              rowKey={(fila) => fila.codigo}
              initialSort={{ key: "col0", desc: true }}
              empty={porFamilia.loading ? "Cargando…" : "Sin venta por familia en este periodo."}
            />
          )}
        </Panel>
      </section>
    </>
  );
}
