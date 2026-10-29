"use client";

import { Modal } from "@/components/ui/modal";
import { downloadCsv } from "@/lib/csv-export";
import { euros, mesMarcado } from "@/lib/sales-model";
import type { SalesContext } from "./sales-context";
import { rpcAllRows } from "./sales-queries";
import { DataTable, LoadFailed, shortDate, useSageQuery, type Column } from "./sales-ui";

/*
  Los albaranes que hay detrás de una cifra de «Albaranes por comercial».

  Al pulsar «Pablo le hizo 64 a Ana Beltrán» se abre esto: esos 64, uno
  a uno, con fecha, número, cliente, quién lo hizo, a quién se factura e
  importe. Para tener el control: comprobar, preguntar, bajarlo a Excel.
*/

/** Qué albaranes se piden, en los términos de la función de la base. */
export type PeticionDeAlbaranes = {
  titulo: string;
  descripcion: string;
  /** Solo los de estos autores ("u:25", "t:1:150"). */
  authors?: string[];
  /** Los de cualquier autor menos estos (y menos los sin autor): «otros empleados». */
  notAuthors?: string[];
  /** Solo los que se facturan a estas fichas de comisionista ("1:51"). */
  reps: string[];
  /** Cuántos dice el panel que son: si llegan menos, faltan por cargar. */
  esperados: number;
};

type Albaran = {
  company_code: number;
  fiscal_year: number;
  series: string;
  number: number;
  day: string;
  customer_code: string | null;
  customer_name: string | null;
  rep_code: number | null;
  author: string;
  author_name: string;
  net_amount: number;
};

/** Lo que dice la base cuando la función o la tabla todavía no existen. */
const SIN_PREPARAR = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

const numeroDe = (albaran: Albaran) => `${albaran.series ? `${albaran.series}-` : ""}${albaran.number}`;

export function ListaDeAlbaranes({ ctx, peticion, onCerrar }: { ctx: SalesContext; peticion: PeticionDeAlbaranes | null; onCerrar: () => void }) {
  // El mismo tramo que el panel: el periodo entero, y los meses marcados se filtran aquí.
  const { from, to } = ctx.period.base;
  const lista = useSageQuery<{ preparada: boolean; filas: Albaran[] }>(
    peticion ? JSON.stringify(["albaranes", from, to, peticion.authors, peticion.notAuthors, peticion.reps, ctx.filters.companies, ctx.reloadKey]) : null,
    async () => {
      const { data, error } = await rpcAllRows<Albaran>("sage_delivery_documents_list", {
        p_from: from,
        p_to: to,
        p_authors: peticion?.authors ?? null,
        p_not_authors: peticion?.notAuthors ?? null,
        p_reps: peticion?.reps ?? null,
        p_companies: ctx.filters.companies.length > 0 ? ctx.filters.companies : null,
      }, ["day", "company_code", "fiscal_year", "series", "number"].map((column) => ({ column, ascending: column !== "day" })));
      if (error && SIN_PREPARAR.has(String((error as { code?: string }).code ?? ""))) return { data: { preparada: false, filas: [] }, error: null };
      return { data: error ? null : { preparada: true, filas: data ?? [] }, error };
    },
  );

  const filas = (lista.data?.filas ?? []).filter((albaran) => mesMarcado(ctx.filters, albaran.day.slice(0, 7)));
  const faltan = peticion ? Math.max(0, peticion.esperados - filas.length) : 0;
  const comisionista = (albaran: Albaran) => ctx.repOf(albaran.company_code, albaran.rep_code).label;
  const cliente = (albaran: Albaran) => albaran.customer_name ?? (albaran.customer_code ? `Cliente ${albaran.customer_code}` : "Sin cliente");

  const columnas: Column<Albaran>[] = [
    { key: "fecha", header: "Fecha", text: true, render: (albaran) => shortDate(albaran.day), sort: (albaran) => albaran.day },
    { key: "numero", header: "Albarán", text: true, render: (albaran) => numeroDe(albaran), sort: (albaran) => `${albaran.series}-${String(albaran.number).padStart(8, "0")}` },
    { key: "cliente", header: "Cliente", text: true, render: (albaran) => cliente(albaran), sort: (albaran) => cliente(albaran) },
    { key: "autor", header: "Lo hizo", text: true, optional: true, render: (albaran) => albaran.author_name, sort: (albaran) => albaran.author_name },
    { key: "comisionista", header: "Se factura a", text: true, optional: true, render: (albaran) => comisionista(albaran), sort: (albaran) => comisionista(albaran) },
    {
      key: "importe", header: "Importe", render: (albaran) => euros(Number(albaran.net_amount)), sort: (albaran) => Number(albaran.net_amount),
      total: (todas) => euros(todas.reduce((suma, albaran) => suma + Number(albaran.net_amount), 0)),
    },
  ];

  const descargar = () => downloadCsv(`albaranes_${from}_${to}.csv`, filas, [
    { header: "Fecha", value: (albaran) => albaran.day },
    { header: "Sociedad", value: (albaran) => albaran.company_code },
    { header: "Ejercicio", value: (albaran) => albaran.fiscal_year },
    { header: "Albarán", value: (albaran) => numeroDe(albaran) },
    { header: "Código de cliente", value: (albaran) => albaran.customer_code },
    { header: "Cliente", value: (albaran) => albaran.customer_name },
    { header: "Lo hizo", value: (albaran) => albaran.author_name },
    { header: "Se factura a", value: (albaran) => comisionista(albaran) },
    { header: "Importe", value: (albaran) => Number(albaran.net_amount).toFixed(2).replace(".", ",") },
  ]);

  return (
    <Modal open={peticion !== null} title={peticion?.titulo ?? "Albaranes"} eyebrow="Albaranes por comercial" onClose={onCerrar} large scrollInside>
      {peticion ? (
        <div className="albaranes-lista">
          <p className="sales-list-intro">{peticion.descripcion} Pulsa uno para abrir la ficha del cliente.</p>
          {lista.failed ? <LoadFailed what="los albaranes" /> : !lista.data ? <p className="muted">Cargando…</p> : !lista.data.preparada || (filas.length === 0 && peticion.esperados > 0) ? (
            <div className="sales-pending">
              <strong>{lista.data.preparada ? "Todavía no han llegado los albaranes uno a uno" : "Falta preparar la base de datos"}</strong>
              <span>
                {lista.data.preparada
                  ? "Llegan con la próxima lectura de Sage, una vez copiado en el servidor el programa nuevo. Las cifras del panel ya están; la lista de cada una, en cuanto lleguen."
                  : "Antes hay que poner en la base de datos la parte que guarda los albaranes uno a uno; en cuanto esté y llegue la siguiente lectura de Sage, sale aquí la lista."}
              </span>
            </div>
          ) : (
            <>
              <div className="sales-list-toolbar">
                <span className="sales-list-count">{filas.length} albaranes</span>
                {faltan > 0 ? <span className="muted">Faltan {faltan} por cargar: llegan con la próxima lectura completa de Sage.</span> : null}
                <button type="button" className="button button-secondary" onClick={descargar} disabled={filas.length === 0}>Descargar CSV</button>
              </div>
              <DataTable
                rows={filas}
                columns={columnas}
                rowKey={(albaran) => `${albaran.company_code}-${albaran.fiscal_year}-${albaran.series}-${albaran.number}`}
                // Como en el resto del panel: pulsar la fila abre la ficha del cliente.
                onRowClick={(albaran) => {
                  if (albaran.customer_code) ctx.openCustomer({ company_code: albaran.company_code, customer_code: albaran.customer_code, name: albaran.customer_name });
                }}
                initialSort={{ key: "fecha", desc: true }}
                limit={100}
                empty="No hay albaranes."
              />
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
